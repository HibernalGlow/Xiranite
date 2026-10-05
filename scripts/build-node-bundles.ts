#!/usr/bin/env bun
/**
 * Build-time bundle step for the QuickJS substrate (ADR-0074).
 *
 * For every node the runtime knows about, esbuild-bundle its `core.ts` and `platform.ts` into self-contained
 * ESM files under `artifacts/node-bundles/`, aliasing the `node:` builtins the node set imports to
 * `packages/quickjs-shims`, and injecting the prelude that publishes the `process` / `Buffer` realm globals.
 *
 * Two bundles per face — `"<id>".core.js` and `"<id>".platform.js` — because that is the runtime's own seam:
 * `packages/runtime/src/node-runner.ts:80-101` loads a `core` module (exposes `run`) and, for a platform node, a
 * separate `platform` module (exposes `createRuntime`), then merges `NodeRunControl` onto the runtime object.
 * One entry per face keeps that mapping 1:1 and lets the audit scan the *core* closure for Node globals without
 * the platform face's `node:` reads in the way (the whole premise of §11.1 / §13 is that the core is the clean
 * half). A pure node (a spec with `message`, no `createRuntime`) still gets a platform bundle when `platform.ts`
 * exists, but its `createRuntime` name is `null` because the runner never loads it.
 *
 * A third bundle per node — `"<id>.js"`, the record's `host` field — is the artifact the **embedded executor**
 * loads. `crates/xiranite-quickjs-executor/src/node.rs` registers a scripted node from one `&'static str`
 * (`include_str!("../bundles/<id>.js")`) carrying both entry names, because a host that read two files off disk
 * at run time would be a second distribution model (ADR-0074 §6 says the host binary carries every linked
 * bundle). It is built from a synthesized entry that re-exports `run` from `core.ts` and `createRuntime` from
 * `platform.ts`, so there is still exactly one implementation of each — the entry carries no logic, and the
 * per-face bundles above stay the source the audit measures.
 *
 * The esbuild call goes through the **CLI** (`Bun.spawn` on `node_modules/.bin/esbuild`) — the JS API path has
 * hung at 0% CPU in this repo, the same reason `spikes/node-core-isolation-scan.ts:10-14` uses the CLI. The
 * `--metafile` gives each bundle's resolved imports, which is what `unresolvedExternals` is read from.
 *
 * ### Why this is not rolldown (measured 2026-10-05, so nobody retries it blind)
 *
 * rolldown 1.1.5 (what Vite 8 pins here) and 1.2.12 (current latest) both emit a **single-file ESM bundle whose
 * `__esmMin` runtime helper is defined after its first top-level use** (`use=217, def=521` for
 * `packages/nodes/encodeb/src/platform.ts`), so evaluating the artifact throws `TypeError: __esmMin is not a
 * function`. This is the bundler's output, not our runtime: `node --input-type=module` and `bun` both throw on
 * the same file. Four of the 24 built host bundles hit it — encodeb, logx, linku, kisaki, i.e. every node whose
 * platform closure pulls a CommonJS dependency. Measured and ruled out: `output.strictExecutionOrder` true/false,
 * `minify:false`, dropping `codeSplitting:false`, rolldown 1.2.12, and aliasing `zod` to its ESM entry (zod is not
 * even in these closures). rolldown also has no `metafile` (the gate would have to read `chunk.imports`), and an
 * `inject`-equivalent needs a synthesized entry because a `transform`-hook import is tree-shaken away.
 * Revisit only if the helper ordering is fixed upstream; the repro is one `rolldown()` call on that entry.
 *
 * Node ids and the `run`/`createRuntime` export names are DERIVED from the generated table
 * (`packages/runtime/src/node-runner.generated.ts`), never hand-maintained (AGENTS.md). The node *universe* is
 * that table unioned with every `packages/nodes/<id>/src/core.ts` on disk, which is where the two hold nodes
 * (`clipm`, `lata`) — present on disk but not registered — enter the size table without inventing names.
 *
 * Usage: bun scripts/build-node-bundles.ts [--only <id>] [--quiet]
 */
import { readdir, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises"
import { basename, isAbsolute, join, resolve } from "node:path"

import { BARE_BUILTINS, HOST_SERVED_PACKAGES, SHIMMED_BUILTINS, BUFFER_GLOBAL, PROCESS_GLOBAL } from "../packages/quickjs-shims/src/surface.ts"

const repoRoot = resolve(import.meta.dirname, "..")
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
// A workspace package whose engine lives in the host, not in JavaScript (see HOST_SERVED_PACKAGES).
for (const [specifier, file] of Object.entries(HOST_SERVED_PACKAGES)) aliasSpecifiers[specifier] = join(shimSourceDir, file)
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
  /** The single-file bundle the embedded executor loads; null when the node registers no `run` export. */
  host: BundleArtifacts | null
  bundleError: string | null
}

/** One esbuild invocation: an entry, where its artifact goes, and whether the realm prelude joins it. */
interface BundleRequest {
  entryPoint: string
  outFile: string
  /**
   * The `process`/`Buffer` realm prelude goes in through esbuild's `--inject`, on the platform and host faces
   * only. Cores stay the platform-free half (§11.1/§13): injecting the prelude into a core would put shim
   * globals in the bundle body and make the audit's "core reaches a Node global" arm fire on the harness
   * rather than on the node's own logic.
   */
  injectPrelude: boolean
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
  if (injectPrelude) args.push(`--inject:${preludePath}`)
  return args
}

/**
 * Runs esbuild for one entry and returns the artifact record. A non-zero exit (e.g. `owithu`'s registry-js
 * `.node` binary that esbuild has no loader for) is captured as `error`, not thrown: one blocked node must not
 * abort the other 43, and the audit reports the failure instead of the build crashing.
 */
async function bundleOne(request: BundleRequest): Promise<BundleArtifacts> {
  const relOut = toRepoRelative(request.outFile)
  if (!(await fileExists(request.entryPoint))) {
    return { path: relOut, bytes: 0, ok: false, error: "entry file does not exist", unresolvedExternals: [] }
  }
  const metaFile = join(metaDir, `${basename(request.outFile)}.meta.json`)
  const proc = Bun.spawnSync({
    cmd: [esbuildBin, ...esbuildArgs(request.entryPoint, request.outFile, metaFile, request.injectPrelude)],
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
  return {
    path: relOut,
    bytes: (await stat(request.outFile)).size,
    ok: true,
    error: null,
    unresolvedExternals: collectUnresolvedExternals(meta),
  }
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

/**
 * Builds the three artifacts of one node: the core face, the platform face (when `platform.ts` exists), and the
 * single-file host bundle the embedded executor links.
 *
 * The two faces run **serially**, as the whole build does: this machine has a memory budget and rolldown's native
 * binding holds the module graph until `close()`, so two live graphs at once is the shape that used to OOM the
 * esbuild/Vitest stack. The realm prelude goes into the platform and host faces only — a core bundle with the
 * prelude in it would make the audit's "core reaches a Node global" arm fire on the harness rather than the logic.
 */
async function buildNode(id: string, spec: NodeSpec | undefined, disposition: string): Promise<NodeBundleRecord> {
  const srcDir = join(nodesRoot, id, "src")
  const coreEntry = join(srcDir, "core.ts")
  const platformEntry = join(srcDir, "platform.ts")
  const core = await bundleOne({ entryPoint: coreEntry, outFile: join(outDir, `${id}.core.js`), injectPrelude: false })
  const platform = (await fileExists(platformEntry))
    ? await bundleOne({ entryPoint: platformEntry, outFile: join(outDir, `${id}.platform.js`), injectPrelude: true })
    : null
  const host = await buildHostBundle(id, spec, coreEntry, platformEntry, core, platform)
  const bundleError = !core?.ok ? core?.error ?? "core bundle failed" : !platform || platform.ok ? !host || host.ok ? null : host.error : platform.error
  return {
    id,
    packageName: spec?.packageName ?? null,
    disposition,
    run: spec?.run ?? null,
    createRuntime: spec?.createRuntime ?? null,
    core,
    platform,
    host,
    bundleError,
  }
}

/**
 * The one-file bundle for the embedded executor: `run` plus, for a platform node, `createRuntime`.
 *
 * The entry is synthesized per node and re-exports the two faces' own source files — it holds no logic, so the
 * executor still gets exactly one implementation of each, and the per-face bundles stay what the audit measures.
 * Built only when both faces bundled: a node whose core does not compile must not get a host artifact that
 * looks present but cannot load.
 */
async function buildHostBundle(
  id: string,
  spec: NodeSpec | undefined,
  coreEntry: string,
  platformEntry: string,
  core: BundleArtifacts | null,
  platform: BundleArtifacts | null,
): Promise<BundleArtifacts | null> {
  const run = spec?.run ?? null
  const createRuntime = spec?.createRuntime ?? null
  if (run === null || !core?.ok) return null
  if (createRuntime !== null && !platform?.ok) return null
  const wantsPlatform = createRuntime !== null && (await fileExists(platformEntry))
  const entryPath = join(metaDir, `${id}.host-entry.ts`)
  const lines = [`export { ${run} } from ${JSON.stringify(coreEntry)}`]
  if (wantsPlatform && createRuntime !== null) lines.push(`export { ${createRuntime} } from ${JSON.stringify(platformEntry)}`)
  await writeFile(entryPath, `${lines.join("\n")}\n`)
  return bundleOne({ entryPoint: entryPath, outFile: join(outDir, `${id}.js`), injectPrelude: wantsPlatform })
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
  const header = "node".padEnd(12) + "core".padStart(11) + "platform".padStart(11) + "host".padStart(11) + "  externals"
  console.log(header)
  console.log("-".repeat(header.length))
  let coreTotal = 0
  let platformTotal = 0
  let hostTotal = 0
  for (const record of records) {
    coreTotal += record.core?.bytes ?? 0
    platformTotal += record.platform?.bytes ?? 0
    hostTotal += record.host?.bytes ?? 0
    const coreSize = record.core?.ok ? formatBytes(record.core.bytes) : record.core ? "FAIL" : "-"
    const platformSize = record.platform === null ? "-" : record.platform.ok ? formatBytes(record.platform.bytes) : "FAIL"
    // `-` for a node the runner registers no `run` for; the host bundle exists only for those.
    const hostSize = record.host === null ? "-" : record.host.ok ? formatBytes(record.host.bytes) : "FAIL"
    const externals = unique([
      ...(record.core?.unresolvedExternals ?? []),
      ...(record.platform?.unresolvedExternals ?? []),
    ])
    console.log(`${record.id.padEnd(12)}${coreSize.padStart(11)}${platformSize.padStart(11)}${hostSize.padStart(11)}  ${externals.length ? externals.join(" ") : ""}`)
  }
  console.log("-".repeat(header.length))
  console.log(`${`TOTAL ${records.length} nodes`.padEnd(12)}${formatBytes(coreTotal).padStart(11)}${formatBytes(platformTotal).padStart(11)}${formatBytes(hostTotal).padStart(11)}`)
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

  // A full build starts from an empty directory, so a stale bundle can never look current. A `--only` build
  // must not: it is the shape a single-node migration session runs, and wiping the other 43 nodes' artifacts
  // (and then writing a manifest that names one node) made `audit:node-bundles` red for work that was still
  // on disk. Instead it replaces exactly the ids it rebuilt and carries the rest forward from the old manifest.
  const previousManifestPath = join(outDir, "manifest.json")
  const carried: Record<string, NodeBundleRecord> = {}
  if (only === null) {
    await rm(outDir, { recursive: true, force: true })
    await rm(metaDir, { recursive: true, force: true })
  } else {
    const previous = await readJson<{ nodes?: Record<string, NodeBundleRecord> }>(previousManifestPath)
    for (const [id, record] of Object.entries(previous?.nodes ?? {})) {
      if (!ids.includes(id)) carried[id] = record
    }
    for (const id of ids) {
      for (const suffix of [".core.js", ".platform.js", ".js"]) await rm(join(outDir, `${id}${suffix}`), { force: true })
      for (const suffix of [".host-entry.ts"]) await rm(join(metaDir, `${id}${suffix}`), { force: true })
      // The per-bundle esbuild metas are named after the artifact, so a `--only` rebuild must drop the stale one
      // or the carried-forward externals would describe the previous bundle.
      for (const suffix of [".core.js", ".platform.js", ".js"]) await rm(join(metaDir, `${id}${suffix}.meta.json`), { force: true })
    }
  }
  await mkdir(outDir, { recursive: true })
  await mkdir(metaDir, { recursive: true })

  const nodes: Record<string, NodeBundleRecord> = { ...carried }
  const orderedRecords: NodeBundleRecord[] = Object.values(carried).sort((left, right) => left.id.localeCompare(right.id))
  // One rolldown build at a time: this machine has a memory budget and the repo serialises build tasks.
  for (const id of ids) {
    const record = await buildNode(id, table[id], dispositions.get(id) ?? "unknown")
    nodes[id] = record
    orderedRecords.push(record)
    if (!quiet && record.bundleError !== null) console.error(`WARN ${id}: ${record.bundleError}`)
  }

  const built = orderedRecords.filter((record) => record.core?.ok)
  const manifest = {
    generatedAt: new Date().toISOString(),
    /** `all` for a full build; a single id when this run only replaced that node's artifacts. */
    scope: only ?? "all",
    schemaVersion: 1,
    hostProtocol: "v1",
    esbuildBin: toRepoRelative(esbuildBin),
    composition: "three bundles per node: <id>.core.js (run) + <id>.platform.js (createRuntime) for the two faces, and <id>.js (both exports in one file) as the artifact the embedded executor links; a pure node has createRuntime=null and its platform bundle is informational only, an unregistered on-disk core has host=null",
    shimAliases: Object.keys(aliasSpecifiers),
    injectedPrelude: toRepoRelative(preludePath),
    counts: {
      nodes: orderedRecords.length,
      registered: Object.keys(table).length,
      coreBuilt: built.length,
      coreFailed: orderedRecords.length - built.length,
      totalCoreBytes: built.reduce((sum, record) => sum + (record.core?.bytes ?? 0), 0),
      totalPlatformBytes: orderedRecords.reduce((sum, record) => sum + (record.platform?.bytes ?? 0), 0),
      hostBuilt: orderedRecords.filter((record) => record.host?.ok).length,
      totalHostBytes: orderedRecords.reduce((sum, record) => sum + (record.host?.bytes ?? 0), 0),
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
