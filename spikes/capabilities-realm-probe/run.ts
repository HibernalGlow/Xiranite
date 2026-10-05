/**
 * The realm-side gate for `@xiranite/host-capabilities`.
 *
 * Vitest cannot prove anything about the realm transport: the package specifier only becomes the realm
 * transport through the alias table in `scripts/build-node-bundles.ts`, and a test runner has no notion of
 * that table. This spike builds the probe the same way a node bundle is built (same alias, same injected
 * prelude) and runs it through the real host, so every machine answer travels `__xrh` into Rust and back.
 *
 * It asserts against what it creates inside the granted root, so it is deterministic, and every check is
 * reported by name. `bun spikes/capabilities-realm-probe/run.ts` exits non-zero if any check fails.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const repoRoot = join(import.meta.dirname, "..", "..")
const outDir = join(repoRoot, "spikes", "capabilities-realm-probe", "out")
const bundle = join(outDir, "probe.js")
const quickjsRun = join(repoRoot, "target", "debug", "quickjs-run")

mkdirSync(outDir, { recursive: true })

const args = [
  join(repoRoot, "spikes", "capabilities-realm-probe", "probe.ts"),
  "--bundle",
  "--platform=node",
  "--format=esm",
  `--outfile=${bundle}`,
  `--alias:@xiranite/host-capabilities=${join(repoRoot, "packages", "host-capabilities", "src", "realm.ts")}`,
  `--inject:${join(repoRoot, "packages", "quickjs-shims", "src", "index.ts")}`,
  "--log-level=warning",
]

const built = Bun.spawnSync({ cmd: [join(repoRoot, "node_modules", ".bin", "esbuild"), ...args], cwd: repoRoot, stdout: "pipe", stderr: "pipe" })
if (built.exitCode !== 0) {
  console.error(`esbuild failed (rc=${built.exitCode}):\n${built.stderr.toString()}`)
  process.exit(1)
}
console.log(`built ${bundle} (${readFileSync(bundle).length} bytes)`)

// The granted root: a scratch directory the host authorises, so an escape attempt is a refusal rather than
// a read of whoever's machine this runs on.
const root = join(repoRoot, "..", ".caps-realm-probe-root")
rmSync(root, { recursive: true, force: true })
mkdirSync(root, { recursive: true })
writeFileSync(join(root, "seed.txt"), "seed")
writeFileSync(join(root, "wide-日本.txt"), "日本語")

if (!existsSync(quickjsRun)) {
  console.error(`no ${quickjsRun}; run cargo build -p xiranite-quickjs-executor --bin quickjs-run -j 1 first`)
  process.exit(1)
}

const request = JSON.stringify({ root })
const ran = Bun.spawnSync({
  cmd: [quickjsRun, bundle, "probeRun", "-", request, root, "--node-id", "harness"],
  cwd: repoRoot,
  stdout: "pipe",
  stderr: "pipe",
})
if (ran.exitCode !== 0) {
  console.error(`quickjs-run rc=${ran.exitCode}\n${ran.stdout.toString()}\n${ran.stderr.toString()}`)
  process.exit(1)
}
const text = ran.stdout.toString()
let document
try {
  document = JSON.parse(text)
} catch {
  console.error(`stdout was not one JSON document (${text.length} bytes):\n${text.slice(0, 600)}`)
  process.exit(1)
}
type Payload = { success: boolean; message: string; checks: Record<string, boolean>; failures: string[]; detail: Record<string, unknown> }

// The host wraps the node's own result document, so the probe's payload is either at `data` or nested one
// level deeper as `data.data` — both spellings are read, and a payload with zero checks is a failure (an
// empty check list would otherwise report as "all passed").
const documentOuter = document as { success?: boolean; message?: string; data?: unknown }
const candidates = [documentOuter.data, (documentOuter.data as { data?: unknown } | undefined)?.data]
const payload = candidates.find(
  (candidate) => !!candidate && typeof (candidate as Payload).checks === "object" && Object.keys((candidate as Payload).checks).length > 0,
) as Payload | undefined

if (!payload) {
  console.error(`no probe payload with checks in the host document:\n${JSON.stringify(document, null, 2).slice(0, 1200)}`)
  process.exit(1)
}

// The verdict is computed from the named checks, never from a success flag the probe itself carried back:
// a transport that reports success while a check is false must still fail the gate.
const { checks } = payload
const failures = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name)
for (const [name, passed] of Object.entries(checks)) console.log(`  ${passed ? "ok  " : "FAIL"} ${name}`)
if (failures.length === 0) {
  console.log(`capabilities realm probe: ${Object.keys(checks).length} checks passed inside the QuickJS host`)
  process.exit(0)
}
console.error(`FAIL: ${failures.length} of ${Object.keys(checks).length} checks failed: ${failures.join(", ")}`)
console.error(JSON.stringify(payload.detail, null, 2).slice(0, 1800))
process.exit(1)
