#!/usr/bin/env bun
/**
 * Build-time bundle step for the QuickJS substrate (ADR-0074).
 *
 * For every node the runtime knows about, esbuild-bundle its `core.ts` and `platform.ts` into self-contained
 * ESM files under `artifacts/node-bundles/`, aliasing the eight `node:` builtins the node set imports (measured
 * in `docs/migration/quickjs-substrate-evaluation.md` §3.2) to `packages/quickjs-shims`, and injecting the
 * prelude that publishes the `process` / `Buffer` realm globals.
 *
 * Two bundles per node — `"<id>".core.js` and `"<id>".platform.js` — because that is the runtime's own seam:
 * `packages/runtime/src/node-runner.ts:80-101` loads a `core` module (exposes `run`) and, for a platform node, a
 * separate `platform` module (exposes `createRuntime`), then merges `NodeRunControl` onto the runtime object.
 * One entry per face keeps that mapping 1:1 and lets the audit scan the *core* closure for Node globals without
 * the platform face's `node:` reads in the way (the whole premise of §11.1 / §13 is that the core is the clean
 * half). A pure node (a spec with `message`, no `createRuntime`) still gets a platform bundle when `platform.ts`
 * exists, but its `createRuntime` name is `null` because the runner never loads it.
 *
 * The esbuild call goes through the **CLI** (`Bun.spawn` on `node_modules/.bin/esbuild`) — the JS API path has
 * hung at 0% CPU in this repo, the same reason `spikes/node-core-isolation-scan.ts:10-14` uses the CLI. The
 * `--metafile` gives each bundle's resolved imports, which is what `unresolvedExternals` is read from.
 *
 * Node ids and the `run`/`createRuntime` export names are DERIVED from the generated table
 * (`packages/runtime/src/node-runner.generated.ts`), never hand-maintained (AGENTS.md). The node *universe* is
 * that table unioned with every `packages/nodes/<id>/src/core.ts` on disk, which is where the two hold nodes
 * (`clipm`, `lata`) — present on disk but not registered — enter the size table without inventing names.
 *
 * Usage: bun scripts/build-node-bundles.ts [--only <id>] [--quiet]
 */
import { readdir, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises"
import { dirname, isAbsolute, join, resolve } from "node:path"

import { BARE_BUILTINS, SHIMMED_BUILTINS, BUFFER_GLOBAL, PROCESS_GLOBAL } from "../packages/quickjs-shims/src/surface.ts"

const repoRoot = resolve(dirname(import.meta.path), "..")
const nodesRoot = join(repoRoot, "packages", "nodes")
const generatedTablePath = join(repoRoot, "packages", "runtime", "src", "node-runner.generated.ts")
const manifestPath = join(repoRoot, "docs", "xiranite-target-node-manifest.json")
const shimSourceDir = join(repoRoot, "packages", "quickjs-shims", "src")
const outDir = join(repoRoot, "artifacts", "node-bundles")
const metaDir = join(repoRoot, "artifacts", ".node-bundle-meta")
const esbuildBin = join(repoRoot, "node_modules", ".bin", "esbuild")

/** Every `node:` / bare specifier that has a shim module, mapped to its absolute path. */
const aliasSpecifiers: Record<string, string> = {}
for (const [specifier, file] of Object.entries(SHIMMED_BUILTINS)) aliasSpecifiers[specifier] = join(shimSourceDir, file)
for (const [bare, file] of Object.entries(BARE_BUILTINS)) aliasSpecifiers[bare] = join(shimSourceDir, file)
aliasSpecifiers[PROCESS_GLOBAL.specifier] = join(shimSourceDir, PROCESS_GLOBAL.module)
aliasSpecifiers[BUFFER_GLOBAL.specifier] = join(shimSourceDir, BUFFER_GLOBAL.module)
aliasSpecifiers.process = join(shimSourceDir, "process.ts")
aliasSpecifiers.buffer = join(shimSourceDir, "buffer.ts")
const preludePath = join(shimSourceDir, "index.ts")

interface NodeSpec {
  packageName: string
  run: string | null
  createRuntime: string | null
}

interface BundleArtifacts {
  path: string
  bytes: number
  ok: boolean
  error: string | null
  unresolvedExternals: string[]
}

interface NodeBundleRecord {
  id: string
  packageName: string | null
  disposition: string
  /** From the generated table; null for an on-disk core the runner does not register (a hold node). */
  run: string | null
  createRuntime: string | null
  core: BundleArtifacts | null
  platform: BundleArtifacts | null
  bundleError: string | null
}

interface EsbuildMeta {
  inputs: Record<string, { imports?: Array<{ path: string; external?: boolean; kind?: string }> }>
  outputs: Record<string, { imports?: Array<{ path: string; external?: boolean; kind?: string }> }>
}

/**
 * Parse the generated runner table for `id -> { packageName, run, createRuntime }`.
 *
 * The file is generated (its first line says so) and stable-shaped, so a bounded scan of the two-space-indented
 * entry blocks is enough; this is deriving from the source of truth, not hand-copying a node list. A block with
 * `message:` and no `createRuntime:` is a pure node (`linedup`), which the contract runs as `core[run](input)`.
 */
async function parseGeneratedTable(): Promise<Record<string, NodeSpec>> {
  const text = await readFile(generatedTablePath, "utf8")
  const body = text.slice(text.indexOf("generatedNodeSpecs"))
  const out: Record<string, NodeSpec> = {}
  const entryRe = /^  ([a-z][a-z0-9_]*): \{/gm
  let match: RegExpExecArray | null
  while ((match = entryRe.exec(body)) !== null) {
    const id = match[1]!
    const start = match.index + match[0].length
    const end = body.indexOf("\n  }", start)
    const block = body.slice(start, end === -1 ? body.length : end)
    const packageName = firstString(block, "packageName")
    const run = firstString(block, "run")
    const createRuntime = firstString(block, "createRuntime")
    out[id] = { packageName: packageName ?? `@xiranite/node-${id}`, run, createRuntime }
  }
  return out
}

function firstString(block: string, key: string): string | null {
  const re = new RegExp(`${key}:\\s*"([^"]*)"`)
  const found = block.match(re)
  return found ? found[1]! : null
}

async function readDispositions(): Promise<Map<string, string>> {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { nodes: Array<{ id: string; disposition: string }> }
  return new Map(manifest.nodes.map((node) => [node.id, node.disposition]))
}

async function onDiskCoreIds(): Promise<string[]> {
  const entries = await readdir(nodesRoot, { withFileTypes: true })
  const ids: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue
    try {
      await stat(join(nodesRoot, entry.name, "src", "core.ts"))
      ids.push(entry.name)
    } catch {
      // No core.ts on disk: not a bundle candidate.
    }
  }
  return ids.sort()
}

function esbuildArgs(entryPoint: string, outFile: string, metaFile: string, injectPrelude: boolean): string[] {
  const args = [entryPoint, "--bundle", "--platform=node", "--format=esm", `--outfile=${outFile}`, `--metafile=${metaFile}`, "--log-level=warning"]
  for (const [specifier, target] of Object.entries(aliasSpecifiers)) {
    args.push(`--alias:${specifier}=${target}`)
  }
  // The `process`/`Buffer` realm prelude is injected only into the **platform** face. Cores are the platform-free
  // half (§11.1/§13: zero Node globals except `findz`); injecting it into a core would put shim globals in the
  // bundle body and make the audit's "core reaches a Node global" arm fire on the harness rather than the logic.
  if (injectPrelude) args.push(`--inject:${preludePath}`)
  return args
}

/**
 * Runs esbuild for one entry and returns the artifact record. A non-zero exit (e.g. `owithu`'s registry-js
 * `.node` binary that esbuild has no loader for) is captured as `error`, not thrown: one blocked node must not
 * abort the other 43, and the audit reports the failure instead of the build crashing.
 */
async function bundleOne(entryPoint: string, outFile: string, metaFile: string, injectPrelude: boolean): Promise<BundleArtifacts> {
  const relOut = toRepoRelative(outFile)
  if (!(await fileExists(entryPoint))) {
    return { path: relOut, bytes: 0, ok: false, error: "entry file does not exist", unresolvedExternals: [] }
  }
  const proc = Bun.spawnSync({
    cmd: [esbuildBin, ...esbuildArgs(entryPoint, outFile, metaFile, injectPrelude)],
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  })
  const stderr = proc.stderr.toString()
  if (proc.exitCode !== 0) {
    const firstLine = stderr.split("\n").map((line) => line.trim()).filter((line) => line.length > 0).find((line) => line.includes("ERROR") || line.includes("error")) ?? "esbuild failed"
    return { path: relOut, bytes: 0, ok: false, error: firstLine, unresolvedExternals: [] }
  }
  const meta = (await readJson<EsbuildMeta>(metaFile)) ?? { inputs: {}, outputs: {} }
  const externals = collectUnresolvedExternals(meta)
  const size = (await stat(outFile)).size
  return { path: relOut, bytes: size, ok: true, error: null, unresolvedExternals: externals }
}

/**
 * The specifiers esbuild left as externals. `--platform=node` keeps every unmapped `node:` builtin external
 * (comfygure's `node:zlib`/`node:stream`, an npm package's `node:events`), which is exactly the set
 * `scripts/audit-node-bundles.ts` turns red; `@xiranite/*` workspace packages that resolve to an unbuilt `dist`
 * also surface here. Only the *entry-facing* externals (the ones the produced bundle still imports) matter, so
 * they are read from the output's import list, not the input graph.
 */
function collectUnresolvedExternals(meta: EsbuildMeta): string[] {
  const found = new Set<string>()
  for (const output of Object.values(meta.outputs)) {
    for (const imp of output.imports ?? []) {
      if (imp.external) found.add(imp.path)
    }
  }
  return [...found].sort()
}

async function buildNode(id: string, spec: NodeSpec | undefined, disposition: string): Promise<NodeBundleRecord> {
  const srcDir = join(nodesRoot, id, "src")
  const coreEntry = join(srcDir, "core.ts")
  const platformEntry = join(srcDir, "platform.ts")
  const [core, platform] = await Promise.all([
    bundleOne(coreEntry, join(outDir, `${id}.core.js`), join(metaDir, `${id}.core.json`), false),
    (await fileExists(platformEntry)) ? bundleOne(platformEntry, join(outDir, `${id}.platform.js`), join(metaDir, `${id}.platform.json`), true) : Promise.resolve(null),
  ])
  const bundleError = !core?.ok ? core?.error ?? "core bundle failed" : !platform || platform.ok ? null : platform.error
  return {
    id,
    packageName: spec?.packageName ?? null,
    disposition,
    run: spec?.run ?? null,
    createRuntime: spec?.createRuntime ?? null,
    core,
    platform,
    bundleError,
  }
}

function toRepoRelative(path: string): string {
  return isAbsolute(path) ? path.slice(repoRoot.length + 1).split("\\").join("/") : path
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T
  } catch {
    return null
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
}

function printSizeTable(records: NodeBundleRecord[]): void {
  const header = "node".padEnd(12) + "core".padStart(11) + "platform".padStart(11) + "  externals"
  console.log(header)
  console.log("-".repeat(header.length))
  let coreTotal = 0
  let platformTotal = 0
  for (const record of records) {
    coreTotal += record.core?.bytes ?? 0
    platformTotal += record.platform?.bytes ?? 0
    const coreSize = record.core?.ok ? formatBytes(record.core.bytes) : record.core ? "FAIL" : "-"
    const platformSize = record.platform === null ? "-" : record.platform.ok ? formatBytes(record.platform.bytes) : "FAIL"
    const externals = unique([
      ...(record.core?.unresolvedExternals ?? []),
      ...(record.platform?.unresolvedExternals ?? []),
    ])
    console.log(`${record.id.padEnd(12)}${coreSize.padStart(11)}${platformSize.padStart(11)}  ${externals.length ? externals.join(" ") : ""}`)
  }
  console.log("-".repeat(header.length))
  console.log(`${`TOTAL ${records.length} nodes`.padEnd(12)}${formatBytes(coreTotal).padStart(11)}${formatBytes(platformTotal).padStart(11)}`)
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort()
}

async function main(): Promise<void> {
  const quiet = process.argv.includes("--quiet")
  const onlyFlag = process.argv.indexOf("--only")
  const only = onlyFlag >= 0 ? process.argv[onlyFlag + 1] : null

  const [table, dispositions, diskIds] = await Promise.all([parseGeneratedTable(), readDispositions(), onDiskCoreIds()])
  const ids = unique([...Object.keys(table), ...diskIds]).filter((id) => only === null || id === only)
  if (ids.length === 0) {
    throw new Error("build:node-bundles derived zero node ids from node-runner.generated.ts + packages/nodes; an empty universe must not read as a passing build.")
  }

  await rm(outDir, { recursive: true, force: true })
  await rm(metaDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  await mkdir(metaDir, { recursive: true })

  const nodes: Record<string, NodeBundleRecord> = {}
  const orderedRecords: NodeBundleRecord[] = []
  // One esbuild child at a time: this machine has a memory budget and the repo serialises build tasks.
  for (const id of ids) {
    const record = await buildNode(id, table[id], dispositions.get(id) ?? "unknown")
    nodes[id] = record
    orderedRecords.push(record)
    if (!quiet && record.bundleError !== null) console.error(`WARN ${id}: ${record.bundleError}`)
  }

  const built = orderedRecords.filter((record) => record.core?.ok)
  const manifest = {
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    hostProtocol: "v1",
    esbuildBin: toRepoRelative(esbuildBin),
    composition: "two bundles per node: <id>.core.js (run) + <id>.platform.js (createRuntime); a pure node has createRuntime=null and its platform bundle is informational only",
    shimAliases: Object.keys(aliasSpecifiers),
    injectedPrelude: toRepoRelative(preludePath),
    counts: {
      nodes: orderedRecords.length,
      registered: Object.keys(table).length,
      coreBuilt: built.length,
      coreFailed: orderedRecords.length - built.length,
      totalCoreBytes: built.reduce((sum, record) => sum + (record.core?.bytes ?? 0), 0),
      totalPlatformBytes: orderedRecords.reduce((sum, record) => sum + (record.platform?.bytes ?? 0), 0),
    },
    nodes,
  }
  await writeFile(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  await rm(metaDir, { recursive: true, force: true })

  if (!quiet) {
    console.log("")
    printSizeTable(orderedRecords)
    console.log(`\nwrote ${toRepoRelative(join(outDir, "manifest.json"))} (${orderedRecords.length} nodes, ${built.length} core bundles ok)`)
  }
}

await main()
