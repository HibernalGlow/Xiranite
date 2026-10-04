import { parse, type SgNode } from "@ast-grep/napi"
import { execFile } from "node:child_process"
import { readdir, readFile, stat } from "node:fs/promises"
import { basename, join, relative, resolve, sep } from "node:path"
import { promisify } from "node:util"

import packageJson from "../package.json" with { type: "json" }

const runFile = promisify(execFile)

const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "build", "artifacts", "test", "tests"])
const SOURCE_EXTENSION = /\.(ts|tsx|js|jsx)$/
const ENTRY_EXTENSION = /\.mjs$/

/**
 * Tiers from ADR-0063 principle 8: pure computation may run as a WASM plugin, file work needs host
 * functions, machine capability stays in the Rust host, and anything reaching a heavy native library
 * is not promised as a plugin until a real `wasm32` target build proves it.
 */
export type WasmFeasibility = "wasm-plugin" | "wasm-with-host-io" | "rust-host" | "blocked-native" | "manual-review"

export interface ImportEvidence {
  specifier: string
  file: string
  line: number
  dynamic: boolean
}

export interface NodeFeasibilityRecord {
  id: string
  packageName: string
  feasibility: WasmFeasibility
  reasons: string[]
  sourceFiles: number
  pluginSurfaceFiles: number
  hasGuiEntry: boolean
  hasCli: boolean
  hasTui: boolean
  workspaceDependencies: string[]
  nativeBindings: string[]
  infrastructureSpecifiers: string[]
  unclassifiedSpecifiers: string[]
  evidence: ImportEvidence[]
}

export interface NodeFeasibilityReport {
  schemaVersion: 1
  generator: { name: string; version: string }
  repoRoot: string
  analyzedAt: string
  revision: { commit: string | null; dirty: boolean }
  nodes: NodeFeasibilityRecord[]
  summary: Record<WasmFeasibility, number>
}

export interface AnalyzeNodePackagesOptions {
  repoRoot: string
  nodeIds?: string[]
  /** Additional specifiers treated as heavy native dependencies; repeatable from the CLI. */
  blockedNative?: string[]
  /** Additional specifiers that require the Rust host rather than a plugin. */
  rustHostOnly?: string[]
}

const NATIVE_BINDINGS = [
  "sharp",
  "@parcel/watcher",
  "fluent-ffmpeg",
  "@ffmpeg-installer/ffmpeg",
  "node-pty",
  "koffi",
  "ffi-napi",
  "ref-napi",
  "@napi-rs/canvas",
  "better-sqlite3",
]

const RUST_HOST_ONLY = [
  "bun:ffi",
  "@xiranite/shell-integration",
  "@xiranite/native-loader",
  "winreg",
  "native-reg",
]

/**
 * Reaching the machine through an *argument* (paths, a command line, a file byte range) stays plugin
 * work: the host only performs the action. So child processes and worker threads are host IO, not a
 * reason to keep the whole node out of WASM.
 */
const HOST_IO = [
  "node:fs",
  "node:os",
  "node:process",
  "node:child_process",
  "node:worker_threads",
  "@xiranite/file-operations",
  "@xiranite/platform",
  "@xiranite/repository",
  "trash",
  "move-file",
]

/**
 * A `/node` subpath is the node.js half of an otherwise pure workspace package (`@xiranite/logging/node`
 * reads a log directory off disk), so it is host IO and must not be swallowed by the infrastructure list.
 */
const NODE_SUBPATH = /\/node(\/|$)/

/** Relative and pure-JS specifiers that are safe inside a WASM plugin. */
const PURE_PREFIXES = ["node:path", "node:url", "node:crypto", "node:buffer", "node:util", "node:events", "node:stream", "node:string_decoder", "node:assert"]
const PURE_PACKAGES = ["zod", "p-map", "type-fest", "fflate", "zip-stream", "ag-psd", "p-limit", "dayjs"]

/**
 * Infrastructure neither proves a node is WASM-safe nor blocks it: the contract/config/logging packages
 * are host-provided input, and React, OpenTUI and the test runners belong to the surfaces ADR-0063
 * removes from the backend (Component/Tui/cli/help), so they must not decide a tier.
 */
const INFRASTRUCTURE_PREFIXES = [
  "@xiranite/contract",
  "@xiranite/config",
  "@xiranite/shared",
  "@xiranite/cli-runtime",
  "@xiranite/logging",
  "@xiranite/api",
  "@xiranite/runtime",
  "react",
  "react-dom",
  "@opentui",
  "vitest",
  "bun:test",
  "@xiranite/tauri-migrate",
]

/**
 * Only core and platform logic becomes a plugin (ADR-0063 principle: the node keeps a React frontend
 * and an Extism backend). The CLI, TUI, help text and guided interaction are excluded because they are
 * rebuilt in Rust with clap and ratatui (ADR-0069) and never ship inside the WASM module, so their
 * Node imports say nothing about whether a core can run as a plugin.
 */
const NON_PLUGIN_SOURCE_FILES = /^(cli|help|interaction|Tui)\.(ts|tsx)$|\.test\.(ts|tsx)$|\.bun\.test\.tsx$/

const TIER_ORDER: WasmFeasibility[] = ["blocked-native", "rust-host", "wasm-with-host-io", "manual-review", "wasm-plugin"]

export async function analyzeNodePackages(
  options: AnalyzeNodePackagesOptions,
): Promise<NodeFeasibilityReport> {
  const repoRoot = resolve(options.repoRoot)
  const nodesRoot = join(repoRoot, "packages", "nodes")
  const uiRoot = join(repoRoot, "src", "nodes")
  const blockedNative = [...NATIVE_BINDINGS, ...(options.blockedNative ?? [])]
  const rustHostOnly = [...RUST_HOST_ONLY, ...(options.rustHostOnly ?? [])]

  const directories = (await isDirectory(nodesRoot))
    ? (await readdir(nodesRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    : []
  if (directories.length === 0) throw new Error(`No node packages found below ${nodesRoot}`)
  const wanted = options.nodeIds?.length ? new Set(options.nodeIds) : null
  const ids = directories.filter((id) => !wanted || wanted.has(id)).sort()

  const nodes: NodeFeasibilityRecord[] = []
  for (const id of ids) {
    nodes.push(await analyzeNode(id, nodesRoot, uiRoot, repoRoot, blockedNative, rustHostOnly))
  }

  const summary = Object.fromEntries(TIER_ORDER.map((tier) => [tier, 0])) as Record<WasmFeasibility, number>
  for (const node of nodes) summary[node.feasibility] += 1

  return {
    schemaVersion: 1,
    generator: { name: packageJson.name, version: packageJson.version },
    repoRoot,
    analyzedAt: new Date().toISOString(),
    revision: await gitRevision(repoRoot),
    nodes,
    summary,
  }
}

async function analyzeNode(
  id: string,
  nodesRoot: string,
  uiRoot: string,
  repoRoot: string,
  blockedNative: string[],
  rustHostOnly: string[],
): Promise<NodeFeasibilityRecord> {
  const packageRoot = join(nodesRoot, id)
  const sourceFiles = await walkFiles(join(packageRoot, "src"), (path) => SOURCE_EXTENSION.test(path) || ENTRY_EXTENSION.test(path))
  const files = sourceFiles.concat(await walkFiles(packageRoot, (path) => path.endsWith("package.json")))
  // Only core and platform code is a plugin candidate; the CLI/TUI/help/interaction surfaces are deleted.
  const pluginSurfaceFiles = sourceFiles.filter((path) => !NON_PLUGIN_SOURCE_FILES.test(basename(path)))
  const imports: ImportEvidence[] = []

  for (const file of pluginSurfaceFiles) {
    if (!SOURCE_EXTENSION.test(file)) continue
    imports.push(...await extractImports(file, repoRoot))
  }

  const manifest = await readPackageManifest(packageRoot)
  const workspaceDependencies = manifest.dependencies.filter((name) => name.startsWith("@xiranite/"))
  const capabilityDependencies = manifest.dependencies.filter((name) => !isInfrastructure(name))
  const specifiers = new Set([...imports.map((item) => item.specifier), ...capabilityDependencies])

  const nativeBindings = [...specifiers].filter((specifier) => isNativeBinding(specifier, blockedNative, rustHostOnly))
  const blockedMatched = nativeBindings.filter((specifier) => matchesAny(specifier, blockedNative))
  const hostBound = nativeBindings.filter((specifier) => !blockedMatched.includes(specifier))
  const hostIo = [...specifiers].filter((specifier) => isHostIo(specifier))
  const unclassified = [...specifiers].filter((specifier) => !isClassified(specifier, blockedNative, rustHostOnly))

  const feasibility: WasmFeasibility = blockedMatched.length > 0
    ? "blocked-native"
    : hostBound.length > 0
      ? "rust-host"
      : hostIo.length > 0
        ? "wasm-with-host-io"
        : unclassified.length > 0
          ? "manual-review"
          : "wasm-plugin"

  const reasons = buildReasons(feasibility, blockedMatched, hostBound, hostIo, unclassified)
  const evidence = imports
    .filter((item) => isReasonEvidence(item, nativeBindings, hostIo, unclassified))
    .sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line)
    .slice(0, 8)

  return {
    id,
    packageName: manifest.name || `@xiranite/node-${id}`,
    feasibility,
    reasons,
    sourceFiles: files.filter((file) => SOURCE_EXTENSION.test(file)).length,
    pluginSurfaceFiles: pluginSurfaceFiles.filter((file) => SOURCE_EXTENSION.test(file)).length,
    hasGuiEntry: await exists(join(uiRoot, id, "entry.ts")),
    hasCli: manifest.exports.includes("./cli"),
    hasTui: await exists(join(packageRoot, "src", "Tui.tsx")),
    workspaceDependencies,
    nativeBindings,
    infrastructureSpecifiers: [...specifiers].filter(isInfrastructure),
    unclassifiedSpecifiers: unclassified,
    evidence,
  }
}

/** Dynamic imports are invisible to a text-only scan, so both forms are read from the syntax tree. */
async function extractImports(file: string, repoRoot: string): Promise<ImportEvidence[]> {
  const source = await readFile(file, "utf8")
  const tree = parse(file.endsWith("x") ? "tsx" : "typescript", source)
  const root = tree.root()
  const relativePath = relative(repoRoot, file).split(sep).join("/")
  const found: ImportEvidence[] = []

  const staticNodes = [
    ...root.findAll({ rule: { kind: "import_statement" } }),
    ...root.findAll({ rule: { kind: "export_statement" } }),
    ...root.findAll({ rule: { kind: "import" } }),
  ]
  for (const node of staticNodes) {
    const specifier = node.field("source")?.text() ?? (node.kind() === "import" ? node.text() : "")
    pushSpecifier(found, specifier, node, relativePath, false)
  }

  for (const node of root.findAll({ rule: { kind: "call_expression" } })) {
    const text = node.text()
    if (!/^import\s*\(|^require\s*\(/.test(text)) continue
    pushSpecifier(found, text.slice(text.indexOf("(") + 1), node, relativePath, true)
  }

  return found
}

function pushSpecifier(
  found: ImportEvidence[],
  raw: string,
  node: SgNode,
  file: string,
  dynamic: boolean,
): void {
  const quoted = /^\s*(['"`])([^'"`]+)\1/.exec(raw)
  if (!quoted) return
  const specifier = quoted[2]!
  if (found.some((item) => item.specifier === specifier && item.file === file)) return
  found.push({ specifier, file, line: node.range().start.line + 1, dynamic })
}

function isNativeBinding(specifier: string, blockedNative: string[], rustHostOnly: string[]): boolean {
  return matchesAny(specifier, blockedNative) || matchesAny(specifier, rustHostOnly) || /^@xiranite\/[a-z0-9-]+-native$/.test(specifier)
}

function isInfrastructure(specifier: string): boolean {
  return !NODE_SUBPATH.test(specifier) && matchesAny(specifier, INFRASTRUCTURE_PREFIXES)
}

function isHostIo(specifier: string): boolean {
  return NODE_SUBPATH.test(specifier) || matchesAny(specifier, HOST_IO)
}

function isClassified(
  specifier: string,
  blockedNative: string[],
  rustHostOnly: string[],
): boolean {
  if (specifier.startsWith(".")) return true
  if (isInfrastructure(specifier)) return true
  if (isNativeBinding(specifier, blockedNative, rustHostOnly)) return true
  if (isHostIo(specifier)) return true
  return PURE_PREFIXES.some((prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`))
    || PURE_PACKAGES.some((name) => specifier === name || specifier.startsWith(`${name}/`))
}

function matchesAny(specifier: string, markers: string[]): boolean {
  return markers.some((marker) => specifier === marker || specifier.startsWith(`${marker}/`))
}

function isReasonEvidence(
  item: ImportEvidence,
  nativeBindings: string[],
  hostIo: string[],
  unclassified: string[],
): boolean {
  const buckets = [...nativeBindings, ...hostIo, ...unclassified]
  return buckets.some((specifier) => item.specifier === specifier || item.specifier.startsWith(`${specifier}/`))
}

function buildReasons(
  feasibility: WasmFeasibility,
  blockedMatched: string[],
  hostBound: string[],
  hostIo: string[],
  unclassified: string[],
): string[] {
  switch (feasibility) {
    case "blocked-native":
      return [`loads a heavy native library or binding: ${blockedMatched.join(", ")}`]
    case "rust-host":
      return [`needs host machine capability: ${hostBound.join(", ")}`]
    case "wasm-with-host-io":
      return [`touches filesystem or process state: ${hostIo.join(", ")}`]
    case "manual-review":
      return [`unclassified dependency: ${unclassified.join(", ")}`]
    default:
      return ["no host, native or unclassified dependency found"]
  }
}

async function readPackageManifest(packageRoot: string): Promise<{ name: string; dependencies: string[]; exports: string[] }> {
  try {
    const text = await readFile(join(packageRoot, "package.json"), "utf8")
    const manifest = JSON.parse(text) as {
      name?: string
      dependencies?: Record<string, string>
      exports?: Record<string, unknown>
    }
    return {
      name: manifest.name ?? "",
      dependencies: Object.keys(manifest.dependencies ?? {}),
      exports: Object.keys(manifest.exports ?? {}),
    }
  } catch {
    return { name: "", dependencies: [], exports: [] }
  }
}

async function gitRevision(repoRoot: string): Promise<{ commit: string | null; dirty: boolean }> {
  try {
    const head = await runFile("git", ["rev-parse", "HEAD"], { cwd: repoRoot })
    const status = await runFile("git", ["status", "--porcelain"], { cwd: repoRoot })
    return { commit: head.stdout.trim(), dirty: status.stdout.trim().length > 0 }
  } catch {
    return { commit: null, dirty: false }
  }
}

async function walkFiles(root: string, predicate: (path: string) => boolean): Promise<string[]> {
  if (!(await isDirectory(root))) return []
  const result: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) result.push(...(await walkFiles(path, predicate)))
    } else if (entry.isFile() && predicate(path)) {
      result.push(path)
    }
  }
  return result.sort()
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export const FEASIBILITY_TIERS = TIER_ORDER
export const NATIVE_BINDING_MARKERS = NATIVE_BINDINGS
