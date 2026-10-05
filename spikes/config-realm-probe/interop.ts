#!/usr/bin/env bun
/**
 * Cross-runtime interop proof for the config lock: the Node/Bun transport and the host's
 * `xiranite_core::config_store` implement the same on-disk protocol, and `packages/config/src/node.ts`
 * claims therefore that "the CLI process and the host are looking at the same lock". Claiming it in a
 * comment is not evidence — this measures it, both directions.
 *
 * Direction 1: a realm transaction holds the lock (long on purpose: `slowMerge` burns real host
 * round-trips, since the realm has no timers) while this Node process tries to write the same config with
 * `lockRetries: 0`. It must be refused, must not write, and must succeed afterwards once the realm releases.
 *
 * Direction 2: this Node process holds the lock for a measured stretch while a realm run writes. The realm
 * must *wait* (elapsed time, not just success) and then land its own content — a realm that could not see
 * Node's lock file would finish instantly and clobber.
 *
 * Usage: bun spikes/config-realm-probe/interop.ts
 */
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { updateXiraniteConfig, withXiraniteFileLock } from "@xiranite/config/node"

const repoRoot = join(import.meta.dir, "..", "..")
const harness = join(repoRoot, "target/debug/quickjs-run")
const bundle = join(import.meta.dir, "out/probe.js")

if (!existsSync(harness) || !existsSync(bundle)) {
  console.error(`missing inputs: harness=${existsSync(harness)} bundle=${existsSync(bundle)} — run cargo build -p xiranite-quickjs-executor --bin quickjs-run and bun spikes/config-realm-probe/build.ts`)
  process.exit(1)
}

let failures = 0
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) failures += 1
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` :: ${extra}` : ""}`)
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))

/**
 * Async on purpose. The first draft used `spawnSync` here, which parks the whole Node process: the poll loop
 * below could not run until the realm had already finished, so "we never saw the lock" measured the driver
 * rather than the product. A concurrency probe must not block the thread it is observing from.
 */
function runRealm(request: Record<string, unknown>, dir: string): Promise<{ elapsedMs: number; out: string; code: number }> {
  const started = Date.now()
  return new Promise((resolveRun) => {
    const child = spawn(harness, [bundle, "run", "-", JSON.stringify(request), dir, "--node-id", "interop", "--services", "config"], { stdio: ["ignore", "pipe", "pipe"] })
    let out = ""
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => { out += chunk })
    child.stderr.resume()
    child.on("close", (code) => resolveRun({ elapsedMs: Date.now() - started, out, code: code ?? -1 }))
  })
}

const dir = mkdtempSync(join(tmpdir(), "xiranite-lock-interop-"))
const canonical = realpath(dir)
const configPath = join(canonical, "xiranite.config.toml")
const lockPath = `${configPath}.xr-write.lock`
const realmDir = canonical

// Seed the document: a fresh temp dir has no config file until the first commit, and the probes below
// compare "unchanged" against its contents.
writeFileSync(configPath, "# interop seed\n", "utf8")

function realpath(path: string): string {
  // macOS hands out /var/... through a symlink and the transport locks the canonical path.
  const probe = spawnSync("node", ["-e", `process.stdout.write(require("fs").realpathSync(${JSON.stringify(path)}))`], { encoding: "utf8" })
  return probe.stdout.trim() || path
}

try {
  /* ---------------- direction 1: the realm holds, Node must see it ---------------- */
  let realmResult: { elapsedMs: number; out: string; code: number } | null = null
  const realmRun = runRealm({ action: "slowMerge", dir: realmDir, spin: 15_000 }, realmDir).then((answer) => { realmResult = answer })

  let sawLock = false
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (existsSync(lockPath)) {
      sawLock = true
      break
    }
    await sleep(10)
  }
  check("方向一：realm 事务期间锁文件确实出现在磁盘上", sawLock, `lock=${lockPath}`)

  const realmToken = sawLock ? readFileSync(lockPath, "utf8") : ""
  check("方向一：锁内容是宿主那种 pid-计数 token", /^\d+-\d+$/.test(realmToken), `token=${realmToken}`)

  const before = readFileSync(configPath, "utf8")
  let refusal = ""
  try {
    await updateXiraniteConfig((config) => ({ ...config, nodes: { ...(config.nodes ?? {}), intruder: { wrote: true } } }), { dataDir: realmDir, lockRetries: 0 })
  } catch (error) {
    refusal = (error as Error).message
  }
  check("方向一：Node 认得宿主的锁（lockRetries 0 必须被拒）", /Timed out waiting for the Xiranite config writer/.test(refusal), refusal.slice(0, 90))
  check("方向一：被拒的这次真的没写盘", readFileSync(configPath, "utf8") === before)

  await realmRun
  void realmResult
  check("方向一：realm 自己把事务写完了", /probe-slow/.test(readFileSync(configPath, "utf8")), readFileSync(configPath, "utf8").replace(/\n/g, " ").slice(0, 80))
  check("方向一：realm 收手后锁文件消失了", !existsSync(lockPath))

  let afterOk = true
  try {
    await updateXiraniteConfig((config) => ({ ...config, nodes: { ...(config.nodes ?? {}), afterRelease: { ok: true } } }), { dataDir: realmDir, lockRetries: 0 })
  } catch {
    afterOk = false
  }
  check("方向一：空档期 Node 能写（不是恒拒的瞎尺）", afterOk)

  /* ---------------- direction 2: Node holds, the realm must wait ---------------- */
  const holdMs = 1_200
  const holder = withXiraniteFileLock(configPath, async () => {
    await sleep(holdMs)
    return "held"
  })
  await sleep(120) // let the Node lock land before the realm starts knocking
  const realmWait = await runRealm({ action: "writeNode", dir: realmDir, section: "sec-interop", mode: "waited" }, realmDir)
  const nodeResult = await holder

  check("方向二：Node 侧持锁正常收尾", nodeResult === "held")
  check("方向二：realm 等到了而不是抄近路", realmWait.elapsedMs >= holdMs - 200, `realm elapsed=${realmWait.elapsedMs}ms hold=${holdMs}ms`)
  check("方向二：realm 等到之后把自己的内容写进去了", /sec-interop/.test(readFileSync(configPath, "utf8")), `realm code=${realmWait.code} out=${realmWait.out.replace(/\n/g, " ").slice(0, 140)} file=${readFileSync(configPath, "utf8").replace(/\n/g, " ").slice(-70)}`)
} finally {
  rmSync(dir, { recursive: true, force: true })
  rmSync(realmDir, { recursive: true, force: true })
}

console.log(failures === 0 ? "\nINTEROP ALL PASS" : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
