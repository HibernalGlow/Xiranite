#!/usr/bin/env bun
/**
 * "真隔离 vs 假隔离" scan for every retained node core.
 *
 * The question it answers: does the module the runtime actually calls (`<node>/src/core.ts`, the
 * `loadCore` entry in `packages/runtime/src/node-runner.generated.ts`) reach Node APIs *transitively*?
 * `core.ts` having no `node:` import is necessary but not sufficient — a relative helper or a workspace
 * package can hide the dependency, and Node *globals* (`process`, `Buffer`, `import.meta.url`) never
 * appear in an import statement at all.
 *
 * The closure is resolved by esbuild (the same resolver the product build uses) through its **CLI**:
 * the JS API path hung at 0% CPU on this repo, the CLI is the native binary and finishes each node in
 * well under a second.
 *
 * Usage: bun spikes/node-core-isolation-scan.ts [--json <path>]
 */
import { spawnSync } from "node:child_process"
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { join, relative, resolve } from "node:path"

const repoRoot = resolve(import.meta.dirname, "..")
const nodesRoot = join(repoRoot, "packages", "nodes")
const workDir = join(repoRoot, "spikes", ".wscan")
const esbuild = join(repoRoot, "node_modules", ".bin", "esbuild")

/** Node *globals* a core must not touch: no import statement reveals them. */
const NODE_GLOBALS: ReadonlyArray<readonly [label: string, pattern: RegExp]> = [
  ["process.", /\bprocess\s*\./],
  ["Buffer", /\bBuffer\s*[.(]/],
  ["__dirname", /\b__dirname\b/],
  ["require(", /\brequire\s*\(/],
  ["import.meta.url", /import\.meta\.url/],
]

interface Metafile {
  inputs: Record<string, { imports: Array<{ path: string; external?: boolean }> }>
}

interface Report {
  id: string
  clean: boolean
  firstPartyFiles: number
  nodeBuiltins: string[]
  bareBuiltins: string[]
  packages: string[]
  globals: string[]
  bundleError: string | null
}

async function nodeIds(): Promise<string[]> {
  const entries = await readdir(nodesRoot, { withFileTypes: true })
  const ids: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      await readFile(join(nodesRoot, entry.name, "src", "core.ts"))
      ids.push(entry.name)
    } catch {
      // No core.ts: not a candidate for this scan.
    }
  }
  return ids.sort()
}

async function bundleOne(id: string): Promise<{ metafile: Metafile | null; error: string | null }> {
  const entry = join(nodesRoot, id, "src", "core.ts")
  const metafilePath = join(workDir, `${id}.json`)
  const process_ = spawnSync(esbuild, [
    entry,
    "--bundle",
    "--platform=node",
    "--format=esm",
    `--metafile=${metafilePath}`,
    `--outfile=${join(workDir, `${id}.js`)}`,
  ])
  if (process_.status !== 0) {
    const stderr = (process_.stderr?.toString() ?? "").trim().split("\n")[0] ?? "bundle failed"
    return { metafile: null, error: stderr }
  }
  const metafile = JSON.parse(await readFile(metafilePath, "utf8")) as Metafile
  return { metafile, error: null }
}

function packageName(inputPath: string): string {
  const bare = inputPath.slice("node_modules/".length)
  return bare.split("/").slice(0, bare.startsWith("@") ? 2 : 1).join("/")
}

async function scan(id: string): Promise<Report> {
  const { metafile, error } = await bundleOne(id)
  const report: Report = {
    id,
    clean: false,
    firstPartyFiles: 0,
    nodeBuiltins: [],
    bareBuiltins: [],
    packages: [],
    globals: [],
    bundleError: error,
  }
  if (!metafile) return report

  const nodeBuiltins = new Set<string>()
  const bareBuiltins = new Set<string>()
  const packages = new Set<string>()
  const firstParty: string[] = []
  for (const [inputPath, input] of Object.entries(metafile.inputs)) {
    if (inputPath.startsWith("node_modules/")) {
      packages.add(packageName(inputPath))
      continue
    }
    firstParty.push(inputPath)
    for (const imported of input.imports ?? []) {
      if (imported.path.startsWith("node:")) nodeBuiltins.add(imported.path)
      // A bare builtin (`child_process`) and an unresolved package look alike; esbuild marks the
      // former external, which is the set worth naming separately.
      else if (imported.external && !imported.path.includes("/")) bareBuiltins.add(imported.path)
    }
  }

  for (const inputPath of firstParty) {
    const text = await readFile(join(repoRoot, inputPath), "utf8").catch(() => "")
    const code = text.split("\n").filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line)).join("\n")
    for (const [label, pattern] of NODE_GLOBALS) {
      if (pattern.test(code)) report.globals.push(`${label}@${inputPath}`)
    }
  }

  report.firstPartyFiles = firstParty.length
  report.nodeBuiltins = [...nodeBuiltins].sort()
  report.bareBuiltins = [...bareBuiltins].sort()
  report.packages = [...packages].sort()
  report.globals = report.globals.sort()
  report.clean =
    report.nodeBuiltins.length === 0 &&
    report.bareBuiltins.length === 0 &&
    report.packages.length === 0 &&
    report.globals.length === 0
  return report
}

const jsonFlag = process.argv.indexOf("--json")
const jsonPath = jsonFlag >= 0 ? process.argv[jsonFlag + 1] : join(import.meta.dirname, "core-isolation-report.json")

await rm(workDir, { recursive: true, force: true })
await mkdir(workDir, { recursive: true })
const ids = await nodeIds()
const reports: Report[] = []
for (const id of ids) reports.push(await scan(id))
await rm(workDir, { recursive: true, force: true })

const clean = reports.filter((report) => report.clean)
const dirty = reports.filter((report) => !report.clean)
console.log(`node cores scanned: ${reports.length}`)
console.log(`clean closures (no Node API, no npm package, no Node global): ${clean.length}`)
console.log(`cores reaching outside pure JS: ${dirty.length}`)
for (const report of dirty) {
  const parts: string[] = []
  if (report.bundleError) parts.push(`bundle-error: ${report.bundleError}`)
  if (report.nodeBuiltins.length) parts.push(`node: ${report.nodeBuiltins.join(" ")}`)
  if (report.bareBuiltins.length) parts.push(`bare-builtin: ${report.bareBuiltins.join(" ")}`)
  if (report.packages.length) parts.push(`packages: ${report.packages.join(" ")}`)
  if (report.globals.length) parts.push(`globals: ${report.globals.join(" ")}`)
  console.log(`  ${report.id.padEnd(12)} ${parts.join(" | ")}`)
}
await writeFile(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), reports }, null, 2))
console.log(`wrote ${relative(repoRoot, jsonPath)}`)
