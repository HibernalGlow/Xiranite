#!/usr/bin/env bun
/**
 * Realm smoke for every migrated node: does its own shipped bundle evaluate and run inside the embedded
 * QuickJS host at all?
 *
 * Why this exists and what it caught: the per-node gates that a migration can run (Vitest + `tsc`) execute the
 * **Node** transport, because a test runner has no notion of the bundle-build alias table. A node can therefore
 * be fully green and still be unable to evaluate in the realm — measured here: `sleept` rejects while evaluating,
 * with the same error before and after the capability migration (the host's `os.cpus` arm answers
 * `{model:"cpuN", speed:0}` with no `times`, and `readCpuSample` reads `cpu.times.user`). Vitest could not have
 * seen that at any point in its existence.
 *
 * This is a smoke scan, not a behaviour suite: it feeds one generic request document and asks whether the node
 * reached a business answer or died on an undefined symbol. A validation refusal ("No valid paths provided")
 * is a pass — it proves the module evaluated, the runtime was constructed, and the call path reached the host.
 *
 * Usage: `bun spikes/realm-node-scan/scan.ts` (needs `cargo build -p xiranite-quickjs-executor --bin
 * quickjs-run -j 1` and a `bun run build:node-bundles` before it, since it reads `artifacts/node-bundles/`).
 * `--ids nameu,samea` narrows the set; exit code is non-zero when a bundle crashes on an undefined symbol,
 * which is the class this scan exists to catch.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const repoRoot = join(import.meta.dirname, "..", "..")
const bin = join(repoRoot, "target", "debug", "quickjs-run")
const onlyFlag = process.argv.indexOf("--ids")
const only = onlyFlag >= 0 ? (process.argv[onlyFlag + 1] ?? "").split(",").filter(Boolean) : null

if (!existsSync(bin)) {
  console.error(`missing ${bin}; run: cargo build -p xiranite-quickjs-executor --bin quickjs-run -j 1`)
  process.exit(1)
}

// The granted root every node sees, with one file so a listing is non-empty.
const granted = mkdtempSync(join(tmpdir(), "realm-node-scan-"))
writeFileSync(join(granted, "sample.txt"), "hi")
const request = JSON.stringify({
  path: granted,
  root: granted,
  directory: granted,
  input: granted,
  target: granted,
  archive: granted,
  source: granted,
})

/** Migrated = its platform.ts calls the capability surface. That is the set this scan covers. */
function migratedNodes(): string[] {
  const manifest = JSON.parse(
    readFileSync(join(repoRoot, "docs", "xiranite-target-node-manifest.json"), "utf8"),
  ) as { nodes: { id: string; disposition: string }[] }
  return manifest.nodes
    .filter((node) => node.disposition === "retain-rewrite")
    .map((node) => node.id)
    .filter((id) => {
      const platform = join(repoRoot, "packages", "nodes", id, "src", "platform.ts")
      return existsSync(platform) && readFileSync(platform, "utf8").includes("@xiranite/host-capabilities")
    })
    .filter((id) => (only === null ? true : only.includes(id)))
}

interface Row {
  id: string
  status: "ran" | "crash" | "no-bundle" | "no-runtime-export"
  detail: string
}

/**
 * Symbols that mean the realm is missing something (a global the bundle assumed, an answer shape that is not
 * there). A business refusal never matches, which is why "ffprobe was not found" counts as having run.
 */
const UNDEFINED_SYMBOL = /is not defined|cannot read prop|is not a function|ReferenceError|TypeError/

/**
 * Host services a node reaches, read off its own imports. The host refuses `service.invoke` for anything
 * the registration did not declare (`host_services.rs:54-71` names them: czkawka, findz, config), so the
 * harness has to declare what the node actually uses — otherwise this scan reports the host's correct
 * refusal as a node crash, which is exactly the false alarm it must not produce.
 */
const SERVICE_BY_PACKAGE: Record<string, string> = {
  "@xiranite/czkawka-native": "czkawka",
  "@xiranite/findz-native": "findz",
  "@xiranite/config/node": "config",
}

function declaredServices(id: string): string[] {
  const platform = join(repoRoot, "packages", "nodes", id, "src", "platform.ts")
  if (!existsSync(platform)) return []
  const source = readFileSync(platform, "utf8")
  return Object.entries(SERVICE_BY_PACKAGE)
    .filter(([specifier]) => source.includes(specifier))
    .map(([, service]) => service)
}

function runNode(id: string): Row {
  const bundle = join(repoRoot, "artifacts", "node-bundles", `${id}.js`)
  if (!existsSync(bundle)) return { id, status: "no-bundle", detail: "bundle build failed for this node" }
  const exportsBlock = [...readFileSync(bundle, "utf8").matchAll(/export \{([^}]*)\}/gs)].pop()?.[1] ?? ""
  const names = exportsBlock
    .split(",")
    .map((entry) => entry.trim().split(/\s+as\s+/).pop() ?? "")
    .filter(Boolean)
  const runExport = names.find((name) => /^(run|__nodeEntry)/.test(name))
  const createExport = names.find((name) => /^(createNode|createRuntime)/.test(name)) ?? "-"
  if (!runExport) {
    return { id, status: "no-runtime-export", detail: `exports ${names.slice(0, 5).join(", ") || "none"}` }
  }
  const services = declaredServices(id)
  const proc = Bun.spawnSync({
    cmd: [
      bin,
      bundle,
      runExport,
      createExport,
      request,
      granted,
      "--node-id",
      id,
      ...(services.length > 0 ? ["--services", services.join(",")] : []),
    ],
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  })
  const out = proc.stdout.toString().trim()
  let message = out
  try {
    message = String((JSON.parse(out) as { message?: string }).message ?? out)
  } catch {
    // Not a JSON document: keep the raw text, since a harness usage error is itself a finding.
  }
  if (proc.exitCode !== 0) {
    const tail = message || proc.stderr.toString().trim().split("\n").slice(-2).join(" | ")
    return { id, status: "crash", detail: tail.slice(0, 160) }
  }
  if (UNDEFINED_SYMBOL.test(message)) return { id, status: "crash", detail: message.slice(0, 160) }
  return { id, status: "ran", detail: message.slice(0, 90) }
}

const rows = migratedNodes().map(runNode)
const ran = rows.filter((row) => row.status === "ran")
const crashed = rows.filter((row) => row.status === "crash")
const skipped = rows.filter((row) => row.status === "no-bundle" || row.status === "no-runtime-export")

console.log(`granted root ${granted}`)
console.log(`evaluated and reached an answer: ${ran.length}/${rows.length}`)
for (const row of ran.slice(0, 8)) console.log(`  ran     ${row.id.padEnd(11)} ${row.detail}`)
for (const row of crashed) console.log(`  CRASH   ${row.id.padEnd(11)} ${row.detail}`)
for (const row of skipped) console.log(`  skipped ${row.id.padEnd(11)} ${row.status}: ${row.detail}`)
if (crashed.length > 0) {
  console.error(`${crashed.length} node bundle(s) died in the realm; see the CRASH rows above`)
  process.exit(1)
}
