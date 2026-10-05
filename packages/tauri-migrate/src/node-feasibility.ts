import { parse, type SgNode } from "@ast-grep/napi"
import { execFile } from "node:child_process"
import { readdir, readFile, stat } from "node:fs/promises"
import { basename, dirname, join, relative, resolve, sep } from "node:path"
import { promisify } from "node:util"

import packageJson from "../package.json" with { type: "json" }

const runFile = promisify(execFile)

const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "build", "artifacts", "test", "tests"])
const SOURCE_EXTENSION = /\.(ts|tsx|js|jsx)$/
const ENTRY_EXTENSION = /\.mjs$/

/**
 * Requirements from ADR-0073: node cores are native crates, so the question is no longer "can this run as
 * wasm" but "which host service does this crate still need". Native code calls `std::fs`, `std::process`
 * and sockets directly, therefore most specifiers that used to be "host IO" are simply free (`node:os`,
 * `node:process`, `node:worker_threads`); what remains is the policy the host owns: granted roots,
 * recursive enumeration, the registered command allowlist, network, and OS-native services (recycle bin,
 * registry, watcher, clipboard) that no crate can answer inside the node.
 */
export type HostRequirement =
  | "pure-logic"
  | "file-io"
  | "recursive-enumeration"
  | "external-process"
  | "network"
  | "os-native"
  | "no-host-free-answer"

export interface ImportEvidence {
  specifier: string
  file: string
  line: number
  dynamic: boolean
}

export interface RequirementEvidence {
  requirement: HostRequirement
  marker: string
  file: string
  line: number
}

/**
 * One external program a node asks the host to run, with the call site that proves the name. This is the unit the
 * allowlist is built from: `NodeRequirements::processes` is a data question (`docs/xiranite-target-node-manifest.json`),
 * and the only honest source for a name is the code that spawns it.
 */
export interface ProcessGrantEvidence {
  program: string
  /** How the name was proved — see [`ProgramVia`]. */
  via: ProgramVia
  file: string
  line: number
}

/**
 * How a program name was proved from the file that spawns it.
 *
 * `literal` — quoted at the call; `const` — a `const NAME = "…"` in the same file; `wrapper` — the spawn sits
 * inside a same-file helper that takes the program as a parameter, and *every* call site of that helper in the
 * same file passes a provable name. Call sites inside the clipboard block do not count in either direction,
 * because that block is not node demand (see `SurfaceFileAnalysis`).
 *
 * Measured on this tree (2026-10-05): 11 nodes carry `external-process`, 4 have a provable name, and every one of
 * those five names is `literal` — neither `const` nor `wrapper` resolves anything yet; both arms are exercised by
 * `node-feasibility.test.ts` only. The `wrapper` arm still earns its place, because it moves the *blocker* from
 * `readClipboardText`'s `wl-paste` loop to the call that really decides the name: `mvz`/`bandia`/`repacku`/
 * `smartzip` pass `process.platform === "win32" ? "where.exe" : "which"` and then the **located absolute path**
 * (`find7z()` → `C:\Program Files\7-Zip\7z.exe`), `bitv` a resolved `ffprobePath`, `gifu` one wrapper deeper. The
 * located-path half is a host question, not an analyzer gap, and it is recorded in
 * `docs/migration/quickjs-substrate-evaluation.md` §21.2: the allowlist holds program *names*, and a path-shaped
 * request is refused by shape (`proc_operations.rs:127`).
 */
export type ProgramVia = "literal" | "const" | "wrapper"

/** A resolved program name plus the proof it was resolved by. */
type ProgramName = { name: string; via: ProgramVia }

/**
 * A spawn call whose program name is computed at run time (a locator function, a template, a config read). It can
 * only be granted by a human, so the analyzer discloses it instead of guessing: an invented program name on the
 * allowlist is worse than a missing one.
 */
export interface UnresolvedProcessCall {
  marker: string
  /** The argument as written, so a reader can see what decides it. */
  argument: string
  file: string
  line: number
}

/**
 * A host service the node's graph reaches, with the call site that proves it.
 *
 * Same discipline as `processes`: nothing lands here unless a literal spells the name out. `via` says whether
 * the node called it itself (`direct`) or reached it through a workspace package it imports (`through x`),
 * because the manifest row has to be readable back to code by someone who did not write the node.
 */
export interface ServiceGrantEvidence {
  service: string
  via: string
  file: string
  line: number
}

export interface NodeHostRequirementRecord {
  id: string
  packageName: string
  hostRequirements: HostRequirement[]
  reasons: string[]
  requirementEvidence: RequirementEvidence[]
  /** External programs proven from the node's own call sites, in first-seen order. */
  processes: ProcessGrantEvidence[]
  /** Host services the node's graph calls by name; this is the column `descriptor.requirements.services` reads. */
  services: ServiceGrantEvidence[]
  /** Spawn calls the analyzer could not resolve to a name; grantable only by hand. */
  unresolvedProcessCalls: UnresolvedProcessCall[]
  sourceFiles: number
  pluginSurfaceFiles: number
  hasGuiEntry: boolean
  hasCli: boolean
  hasTui: boolean
  workspaceDependencies: string[]
  /** Sibling node packages this node composes; a compile-time dependency, never a host service. */
  composedNodes: string[]
  nativeBindings: string[]
  infrastructureSpecifiers: string[]
  unresolvedSpecifiers: string[]
  evidence: ImportEvidence[]
}

export interface NodeHostRequirementReport {
  schemaVersion: 2
  generator: { name: string; version: string }
  repoRoot: string
  analyzedAt: string
  revision: { commit: string | null; dirty: boolean }
  nodes: NodeHostRequirementRecord[]
  summary: Record<HostRequirement, number>
}

export interface AnalyzeNodePackagesOptions {
  repoRoot: string
  nodeIds?: string[]
  /** Additional specifiers that only the OS can answer; repeatable from the CLI. */
  osNative?: string[]
  /** Additional specifiers with no host-free answer; repeatable from the CLI. */
  noHostFreeAnswer?: string[]
}

/**
 * A node may carry several requirements, so the order here is report order (most host-coupled first),
 * not a tier ranking. `pure-logic` is the residual: nothing above was proven.
 */
const REQUIREMENT_ORDER: HostRequirement[] = [
  "no-host-free-answer",
  "os-native",
  "network",
  "external-process",
  "recursive-enumeration",
  "file-io",
  "pure-logic",
]

/** File mutation through the host's granted roots. `std::fs` answers all of it once a root is granted. */
const FILE_IO_SPECIFIERS = ["node:fs", "@xiranite/file-operations", "write-file-atomic", "move-file", "fs-extra", "graceful-fs"]

/**
 * The host capability surface (`@xiranite/host-capabilities`): the realm's machine access, named by the
 * group object a call hangs off (`fs.move(...)`, `proc.exec(...)`).
 *
 * Two rules follow from that shape and both matter. First, this specifier may never reach
 * `isUnresolved` — an unclassified specifier is reported as `no-host-free-answer`, the harshest tier there
 * is, so every migrated node would be stamped with a requirement it does not have. Second, importing it
 * proves nothing by itself: a node that only asks `clock.now()` needs no roots and no program grant. So the
 * tiers come from the receivers the file actually calls, exactly like `node:child_process`, which is
 * likewise absent from `EXTERNAL_PROCESS_LIBS` for the call-sites-decide reason below.
 */
const CAPABILITY_SPECIFIER = "@xiranite/host-capabilities"
const CAPABILITY_FILE_IO_RECEIVERS = new Set(["fs"])
const CAPABILITY_PROCESS_RECEIVERS = new Set(["proc"])

/** Enumeration a granted root does not make free: the crate walks the tree itself. */
const RECURSIVE_ENUMERATION_LIBS = ["fast-glob", "tinyglobby", "@nodelib/fs.walk", "recursive-readdir", "klaw"]

/** Reaching another program. ADR-0073 turns these into a registered-command allowlist, not a shell. */
const EXTERNAL_PROCESS_LIBS = ["node:child_process", "execa", "cross-spawn", "tinyexec", "fluent-ffmpeg", "@ffmpeg-installer/ffmpeg"]

/**
 * `node:child_process` is deliberately absent: importing it proves nothing, because 22 of 41 retained nodes
 * import it only for the cli-side clipboard block. Third-party runner libraries are demand by themselves.
 */
const PROCESS_LIBRARY_LIBS = EXTERNAL_PROCESS_LIBS.filter((specifier) => !specifier.startsWith("node:"))

const NETWORK_LIBS = [
  "node:http",
  "node:https",
  "node:http2",
  "node:net",
  "node:tls",
  "node:dns",
  "ws",
  "socket.io-client",
  "eventsource",
  "axios",
  "got",
  "undici",
  "node-fetch",
  "@modelcontextprotocol/sdk",
  "@stable-canvas/comfyui-client",
]

/**
 * Services the host must keep as one implementation: recycle bin, registry, shell integration, filesystem
 * change notification, clipboard. `trash` and `@parcel/watcher` are listed here because the node reaches an
 * OS service, not because it needs a byte range.
 */
const OS_NATIVE_LIBS = [
  "@xiranite/shell-integration",
  "@xiranite/czkawka-native",
  "@xiranite/file-operations",
  "winreg",
  "native-reg",
  "@parcel/watcher",
  "trash",
  "clipboardy",
]

/**
 * A binding whose answer is not free: no crate stands behind it, or the capability is the node's whole
 * product. ADR-0073 keeps `findz`'s `@parcel/watcher` in this class; an unlisted `@xiranite/*-native`
 * binding also lands here so a new native dependency can never be read as "the host answers it".
 */
const NO_HOST_FREE_ANSWER_LIBS = [
  "@parcel/watcher",
  "@xiranite/findz-native",
  "bun:ffi",
  "koffi",
  "ffi-napi",
  "ref-napi",
  "node-pty",
  "sharp",
  "@napi-rs/canvas",
  "better-sqlite3",
]

const NATIVE_BINDING_PATTERN = /^@xiranite\/[a-z0-9-]+-native$/

/**
 * Free in native Rust: `std::env`, `std::process::id`, `std::time`, threads, path and URL handling. These
 * were "host IO" under the wasm plan and deliberately are not requirements now.
 */
const HOST_FREE_PREFIXES = [
  "node:path",
  "node:url",
  "node:crypto",
  "node:buffer",
  "node:util",
  "node:events",
  "node:stream",
  "node:string_decoder",
  "node:assert",
  "node:os",
  "node:process",
  "node:worker_threads",
  "node:perf_hooks",
  "node:async_hooks",
  "node:console",
  "node:zlib",
  "node:tty",
  "node:querystring",
]

/** In-process parsing, encoding and diffing. Confirmed host-free by `docs/migration/node-native-shape.md`. */
const HOST_FREE_PACKAGES = [
  "zod",
  "type-fest",
  "p-map",
  "p-limit",
  "p-queue",
  "fflate",
  "zip-stream",
  "@zip.js/zip.js",
  "ag-psd",
  "dayjs",
  "chardet",
  "iconv-lite",
  "opencc-js",
  "csv-parse",
  "yaml",
  "liquidjs",
  "jsonrepair",
  "json-canonicalize",
  "json-rules-engine",
  "ts-pattern",
  "diff",
  "remark",
  "mdast",
  "smol-toml",
  "@xstate/store",
]

/**
 * Contract, config, logging and the API client are host-provided *input*, and React, OpenTUI and the test
 * runners belong to surfaces ADR-0069 keeps outside the crate, so none of them may decide a requirement.
 * A `/node` subpath is the node.js half of an otherwise pure package and is file IO, not infrastructure.
 */
const INFRASTRUCTURE_PREFIXES = [
  "@xiranite/contract",
  "@xiranite/config",
  "@xiranite/shared",
  "@xiranite/cli-runtime",
  "@xiranite/logging",
  "@xiranite/api",
  "@xiranite/runtime",
  "@xiranite/platform",
  "@xiranite/repository",
  "react",
  "react-dom",
  "@opentui",
  "vitest",
  "bun:test",
  "@xiranite/tauri-migrate",
]

const NODE_SUBPATH = /\/node(\/|$)/
const COMPOSED_NODE_SPECIFIER = /^@xiranite\/node-([a-z0-9-]+)/

/**
 * Only the node core is scanned: the CLI, TUI, help text and guided interaction are rebuilt in Rust with
 * clap and ratatui (ADR-0069) and their Node imports say nothing about what the crate needs from the host.
 * This exclusion set is the scope rule ADR-0067 requires the verdict to rest on; it is unchanged.
 */
const NON_PLUGIN_SOURCE_FILES = /^(cli|help|interaction|Tui)\.(ts|tsx)$|\.test\.(ts|tsx)$|\.bun\.test\.tsx$/

const SPAWN_CALLEES = new Set(["execFile", "execFileSync", "spawn", "spawnSync", "exec", "execSync", "fork"])
const DIRECTORY_LISTING_CALLEES = new Set([
  "readdir",
  "readdirSync",
  "readDirectory",
  "readDir",
  "opendir",
  "opendirSync",
  // Runtime members named `listDir` are the same listing seen through a host-provided helper: a recursive
  // `walk` over them is still the crate enumerating the tree itself (kavvka, migratef).
  "listDir",
  "listDirectory",
  "listEntries",
  "readEntries",
])
const FUNCTION_KINDS = new Set(["function_declaration", "generator_function_declaration", "function_expression", "arrow_function", "method_definition"])
const CLIPBOARD_PATTERN = /(clipboard|pbpaste|wl-paste|xclip|xsel)/i
const CORE_CLIPBOARD_FILE = /(^|\/)core\.ts$/

/**
 * The single biggest measurement in `docs/migration/node-native-shape.md`: 22 of 41 retained nodes carry a
 * byte-identical `readClipboardText()` block in `platform.ts` whose only consumer is `cli.ts`. Counting it as
 * node demand would put five binaries on the allowlist that arboard deletes, so spawn evidence is only a
 * requirement when it is not confined to that block.
 */
interface SurfaceFileAnalysis {
  file: string
  imports: ImportEvidence[]
  specifiers: string[]
  externalProcess: {
    marker: string
    line: number
    /** Every program name this call can be proved to run; empty when the argument is computed at run time. */
    programs: ProgramName[]
    /** The argument as written, kept for the unresolved case. */
    argument: string
  }[]
  spawnSpecifiers: string[]
  /** Calls on the host capability surface's file group (`fs.move(...)`) — the realm's file mutation. */
  capabilityIo: { marker: string; line: number }[]
  clipboardEvidence: { marker: string; line: number }[]
  coreMentionsClipboard: boolean
  walkers: { marker: string; line: number }[]
  unresolved: string[]
}

export async function analyzeNodePackages(options: AnalyzeNodePackagesOptions): Promise<NodeHostRequirementReport> {
  const repoRoot = resolve(options.repoRoot)
  const nodesRoot = join(repoRoot, "packages", "nodes")
  const uiRoot = join(repoRoot, "src", "nodes")
  const osNative = [...OS_NATIVE_LIBS, ...(options.osNative ?? [])]
  const noHostFreeAnswer = [...NO_HOST_FREE_ANSWER_LIBS, ...(options.noHostFreeAnswer ?? [])]

  const directories = (await isDirectory(nodesRoot))
    ? (await readdir(nodesRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    : []
  if (directories.length === 0) throw new Error(`No node packages found below ${nodesRoot}`)
  const wanted = options.nodeIds?.length ? new Set(options.nodeIds) : null
  const ids = directories.filter((id) => !wanted || wanted.has(id)).sort()

  const nodes: NodeHostRequirementRecord[] = []
  for (const id of ids) {
    nodes.push(await analyzeNode(id, nodesRoot, uiRoot, repoRoot, osNative, noHostFreeAnswer))
  }

  const summary = Object.fromEntries(REQUIREMENT_ORDER.map((requirement) => [requirement, 0])) as Record<HostRequirement, number>
  for (const node of nodes) {
    for (const requirement of node.hostRequirements) summary[requirement] += 1
  }

  return {
    schemaVersion: 2,
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
  osNative: string[],
  noHostFreeAnswer: string[],
): Promise<NodeHostRequirementRecord> {
  const packageRoot = join(nodesRoot, id)
  const sourceFiles = await walkFiles(join(packageRoot, "src"), (path) => SOURCE_EXTENSION.test(path) || ENTRY_EXTENSION.test(path))
  const files = sourceFiles.concat(await walkFiles(packageRoot, (path) => path.endsWith("package.json")))
  const surfaceFiles = sourceFiles.filter((path) => !NON_PLUGIN_SOURCE_FILES.test(basename(path)) && SOURCE_EXTENSION.test(path))

  const analyses: SurfaceFileAnalysis[] = []
  for (const file of surfaceFiles) analyses.push(await analyzeSurfaceFile(file, repoRoot, osNative, noHostFreeAnswer))

  const manifest = await readPackageManifest(packageRoot)
  const workspaceDependencies = manifest.dependencies.filter((name) => name.startsWith("@xiranite/"))
  const composedNodes = [...new Set(collectComposedNodes(analyses))]
  const capabilityDependencies = manifest.dependencies.filter((name) => !isInfrastructure(name) && !isComposed(name))
  const importedSpecifiers = new Set(analyses.flatMap((item) => item.imports.map((entry) => entry.specifier)))
  const specifiers = new Set([...importedSpecifiers, ...capabilityDependencies])
  // The clipboard block only counts as node demand when the node core reaches it, which is the single
  // measured case (classf) among the 23 nodes carrying that block.
  const clipboardIsDemand = analyses.some((item) => item.coreMentionsClipboard) && analyses.some((item) => item.clipboardEvidence.length > 0)

  const nativeBindings = [...specifiers].filter((specifier) => isNativeBinding(specifier, noHostFreeAnswer))
  const unresolved = [...new Set([...analyses.flatMap((item) => item.unresolved), ...[...specifiers].filter((specifier) => isUnresolved(specifier, osNative, noHostFreeAnswer))])].sort()

  const found = new Map<HostRequirement, { marker: string; file: string; line: number }[]>()
  const decidedSpecifiers = new Set<string>()
  const add = (requirement: HostRequirement, marker: string, file: string, line: number, specifier?: string) => {
    const bucket = found.get(requirement) ?? []
    if (!bucket.some((item) => item.marker === marker)) bucket.push({ marker, file, line })
    found.set(requirement, bucket)
    if (specifier) decidedSpecifiers.add(specifier)
  }

  // A specifier seen in the source is reported where it was imported; a dependency only named in
  // package.json has no import site, so it is attributed to the manifest.
  const importSites = new Map<string, { file: string; line: number }>()
  for (const analysis of analyses) {
    for (const item of analysis.imports) {
      if (!importSites.has(item.specifier)) importSites.set(item.specifier, { file: analysis.file, line: item.line })
    }
  }
  const manifestLocation = { file: `packages/nodes/${id}/package.json`, line: 1 }

  for (const specifier of [...specifiers].sort()) {
    const site = importSites.get(specifier) ?? manifestLocation
    if (matchesAny(specifier, noHostFreeAnswer)) add("no-host-free-answer", specifier, site.file, site.line, specifier)
    if (matchesAny(specifier, osNative)) add("os-native", specifier, site.file, site.line, specifier)
    if (matchesAny(specifier, NETWORK_LIBS)) add("network", specifier, site.file, site.line, specifier)
    if (matchesAny(specifier, PROCESS_LIBRARY_LIBS)) add("external-process", specifier, site.file, site.line, specifier)
    if (matchesAny(specifier, RECURSIVE_ENUMERATION_LIBS)) add("recursive-enumeration", specifier, site.file, site.line, specifier)
    if (matchesAny(specifier, FILE_IO_SPECIFIERS) || NODE_SUBPATH.test(specifier)) add("file-io", specifier, site.file, site.line, specifier)
  }
  for (const binding of nativeBindings) {
    if (!matchesAny(binding, noHostFreeAnswer) && !matchesAny(binding, osNative)) {
      const site = importSites.get(binding) ?? manifestLocation
      add("no-host-free-answer", `${binding} (unregistered native binding)`, site.file, site.line, binding)
    }
  }
  for (const specifier of unresolved) {
    const site = importSites.get(specifier) ?? manifestLocation
    add("no-host-free-answer", `${specifier} (unclassified)`, site.file, site.line, specifier)
  }

  for (const analysis of analyses) {
    // A spawn is node demand only when it is not confined to the clipboard block; the import line is kept
    // so the artifact's evidence still points at the specifier the future allowlist entry comes from.
    if (analysis.externalProcess.length > 0) {
      for (const spawn of analysis.externalProcess) add("external-process", spawn.marker, analysis.file, spawn.line)
      for (const specifier of analysis.spawnSpecifiers) {
        const site = analysis.imports.find((item) => item.specifier === specifier)
        if (site) add("external-process", specifier, analysis.file, site.line, specifier)
      }
    }
    for (const io of analysis.capabilityIo) add("file-io", io.marker, analysis.file, io.line)
    for (const walker of analysis.walkers) add("recursive-enumeration", walker.marker, analysis.file, walker.line)
    if (clipboardIsDemand) {
      for (const clipboard of analysis.clipboardEvidence) add("os-native", `${clipboard.marker} (clipboard)`, analysis.file, clipboard.line)
    }
  }

  // The allowlist data: every spawn the clipboard filter kept, split by whether the program name is provable from
  // the file. Nothing lands in `processes` unless a call site spells it out, and what cannot be spelled out is
  // listed rather than guessed.
  const processes: ProcessGrantEvidence[] = []
  const unresolvedProcessCalls: UnresolvedProcessCall[] = []
  for (const analysis of analyses) {
    for (const spawn of analysis.externalProcess) {
      if (spawn.programs.length === 0) {
        unresolvedProcessCalls.push({ marker: spawn.marker, argument: spawn.argument, file: analysis.file, line: spawn.line })
        continue
      }
      for (const program of spawn.programs) {
        if (processes.some((entry) => entry.program === program.name && entry.file === analysis.file)) continue
        processes.push({ program: program.name, via: program.via, file: analysis.file, line: spawn.line })
      }
    }
  }
  processes.sort((left, right) => left.program.localeCompare(right.program) || left.file.localeCompare(right.file) || left.line - right.line)
  unresolvedProcessCalls.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line)

  const hostRequirements = REQUIREMENT_ORDER.filter((requirement) => requirement !== "pure-logic" && found.has(requirement))
  if (hostRequirements.length === 0) hostRequirements.push("pure-logic")

  const reasons = hostRequirements.map((requirement) => {
    if (requirement === "pure-logic") return "no file, process, network or OS service reaches the node core"
    return `${requirement}: ${found.get(requirement)!.map((item) => item.marker).join(", ")}`
  })
  const requirementEvidence: RequirementEvidence[] = hostRequirements
    .flatMap((requirement) => (found.get(requirement) ?? []).map((item) => ({ requirement, marker: item.marker, file: item.file, line: item.line })))
    .sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line)
    .slice(0, 8)
  const evidence = importsForRequirements(analyses, decidedSpecifiers)

  return {
    id,
    packageName: manifest.name || `@xiranite/node-${id}`,
    hostRequirements,
    reasons,
    requirementEvidence,
    processes,
    services: await servicesReached(analyses, repoRoot),
    unresolvedProcessCalls,
    sourceFiles: files.filter((file) => SOURCE_EXTENSION.test(file)).length,
    pluginSurfaceFiles: surfaceFiles.length,
    hasGuiEntry: await exists(join(uiRoot, id, "entry.ts")),
    hasCli: manifest.exports.includes("./cli"),
    hasTui: await exists(join(packageRoot, "src", "Tui.tsx")),
    workspaceDependencies,
    composedNodes,
    nativeBindings,
    infrastructureSpecifiers: [...specifiers].filter(isInfrastructure),
    unresolvedSpecifiers: unresolved,
    evidence,
  }
}

/** Keeps the artifact's `evidence` lines as `file:line specifier`, limited to specifiers that decided something. */
function importsForRequirements(analyses: SurfaceFileAnalysis[], decided: Set<string>): ImportEvidence[] {
  const markers = [...decided]
  const rows = analyses
    .flatMap((analysis) => analysis.imports)
    .filter((item) => markers.some((marker) => item.specifier === marker || item.specifier.startsWith(`${marker}/`)))
    .sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line)
  const seen = new Set<string>()
  return rows.filter((item) => {
    const key = `${item.file}:${item.line}:${item.specifier}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 8)
}

/**
 * One parse per surface file gives both the specifier list and the local call shape. Dynamic imports and
 * requires are included because a text-only scan cannot see them.
 */
async function analyzeSurfaceFile(
  file: string,
  repoRoot: string,
  osNative: string[],
  noHostFreeAnswer: string[],
): Promise<SurfaceFileAnalysis> {
  const source = await readFile(file, "utf8")
  const tree = parse(file.endsWith("x") ? "tsx" : "typescript", source)
  const root = tree.root()
  const relativePath = relative(repoRoot, file).split(sep).join("/")
  const imports: ImportEvidence[] = []

  for (const node of [
    ...root.findAll({ rule: { kind: "import_statement" } }),
    ...root.findAll({ rule: { kind: "export_statement" } }),
    ...root.findAll({ rule: { kind: "import" } }),
  ]) {
    const specifier = node.field("source")?.text() ?? (node.kind() === "import" ? node.text() : "")
    pushSpecifier(imports, specifier, node, relativePath, false)
  }
  for (const node of root.findAll({ rule: { kind: "call_expression" } })) {
    const text = node.text()
    if (!/^import\s*\(|^require\s*\(/.test(text)) continue
    pushSpecifier(imports, text.slice(text.indexOf("(") + 1), node, relativePath, true)
  }

  const specifiers = imports.map((item) => item.specifier)
  const functions = collectFunctions(root)
  // Only a call on a binding that actually came from a process library is a spawn. Matching the bare
  // property name would read every `RegExp.exec()` in every node core as `child_process.exec`.
  const processBindings = collectProcessBindings(root)
  // `const SEVENZIP = "7z.exe"` is as literal as a quoted argument for the purpose of an allowlist, so the same
  // file's string constants are resolved before a spawn call is called unresolvable.
  const constStrings = collectConstStringBindings(root)
  const callees = new Map<string, Set<string>>()
  const callers = new Map<string, Set<string>>()
  const listingOwners = new Set<string>()
  const spawnSites: {
    name: string | null
    callee: string
    line: number
    programs: ProgramName[]
    argument: string
    /** Set when the unresolved argument is a parameter of the function this spawn sits in. */
    wrapper: { fn: string; index: number } | null
    marker: string
  }[] = []
  const capabilityIo: SurfaceFileAnalysis["capabilityIo"] = []

  for (const node of root.findAll({ rule: { kind: "call_expression" } })) {
    const callee = calleeName(node)
    if (!callee) continue
    const line = node.range().start.line + 1
    const span = nearestSpan(functions, node.range().start.index)
    const owner = span?.name ?? null
    const surface = capabilityCallGroup(node, specifiers)
    if (surface?.group === "process") {
      // `proc.exec("7z.exe", [...])` is the same demand as `execFile("7z.exe", ...)`: the program literal has
      // to reach `processes` or the registration cannot grant it, so the evidence goes through one path.
      const program = spawnProgramEvidence(node, constStrings)
      spawnSites.push({
        name: owner,
        callee: surface.text,
        line,
        programs: program.program === null ? [] : [program.program],
        argument: program.argument,
        wrapper: parameterIndexOf(program.argumentName, span),
        marker: program.program === null ? surface.text : `${surface.text}(${program.program.name})`,
      })
      continue
    }
    if (surface?.group === "io") {
      capabilityIo.push({ marker: surface.text, line })
      // `fs.list` is one directory listing, exactly like the `listDir` runtime members below: a recursive
      // `walk` that reaches it still owns the enumeration, and dropping the tier here would take away the very
      // grant the node needs to run (`smartzip`'s `walk` moved onto the surface and read as non-recursive).
      if (surface.text === "fs.list" && owner) listingOwners.add(owner)
      continue
    }
    if (isSpawnCall(node, processBindings)) {
      const program = spawnProgramEvidence(node, constStrings)
      const parameterIndex = program.argumentName !== null && span !== null ? span.params.indexOf(program.argumentName) : -1
      spawnSites.push({
        name: owner,
        callee,
        line,
        programs: program.program === null ? [] : [program.program],
        argument: program.argument,
        wrapper: parameterIndex >= 0 && span !== null ? { fn: span.name, index: parameterIndex } : null,
        marker: program.program === null ? callee : `${callee}(${program.program.name})`,
      })
    }
    if (DIRECTORY_LISTING_CALLEES.has(callee) && owner) listingOwners.add(owner)
    if (owner && callee !== owner) {
      const edges = callees.get(owner) ?? new Set<string>()
      edges.add(callee)
      callees.set(owner, edges)
      const reverse = callers.get(callee) ?? new Set<string>()
      reverse.add(owner)
      callers.set(callee, reverse)
    }
    if (owner && callee === owner) {
      const edges = callees.get(owner) ?? new Set<string>()
      edges.add(owner)
      callees.set(owner, edges)
    }
  }

  const reachable = (name: string): Set<string> => {
    const seen = new Set<string>()
    const stack = [name]
    while (stack.length) {
      const current = stack.pop()!
      for (const next of callees.get(current) ?? []) {
        if (seen.has(next)) continue
        seen.add(next)
        stack.push(next)
      }
    }
    return seen
  }

  const clipboardRoots = new Set(functions.filter((item) => CLIPBOARD_PATTERN.test(item.name) || CLIPBOARD_PATTERN.test(item.body)).map((item) => item.name))
  // Least fixed point: a function is clipboard-relevant when it is clipboard code itself, or when the only
  // in-file callers of it are clipboard-relevant. Shared helpers (`runCommand`) stay relevant in the node
  // that uses them only for the clipboard, and stop being relevant as soon as another caller appears.
  const clipboardRelevant = new Set(clipboardRoots)
  for (let changed = true; changed; ) {
    changed = false
    for (const item of functions) {
      if (clipboardRelevant.has(item.name)) continue
      const ownCallers = callers.get(item.name)
      if (!ownCallers?.size) continue
      if ([...ownCallers].every((caller) => clipboardRelevant.has(caller))) {
        clipboardRelevant.add(item.name)
        changed = true
      }
    }
  }

  // The wrapper pass. A spawn inside `async function runCommand(command, args)` names nothing on its own line,
  // but the file can still prove the name set: if *every* call of that helper in this file passes a quoted or
  // const-spelled argument, nothing computes the program at run time, and those names are the allowlist. One
  // call with a computed argument, or a helper this file never calls itself (it is exported and used by `cli.ts`),
  // and the site stays unresolved with the blocking call named — that is the line between "one level up is a
  // literal" and "a human has to decide". The marker carries the proving call lines, because the evidence line
  // stays at the spawn where the program is actually run.
  for (const site of spawnSites) {
    if (site.wrapper === null || site.programs.length > 0) continue
    const { fn, index } = site.wrapper
    const calls = root
      .findAll({ rule: { kind: "call_expression" } })
      .filter((call) => call.field("function")?.kind() === "identifier" && call.field("function")?.text() === fn)
      // A call from inside the clipboard block is not node demand, by the rule this file already applies to the
      // spawn itself. Left in, `readClipboardText`'s `for (const command of [["wl-paste"], …])` loop would be the
      // one computed caller that keeps every helper unresolved — which is how a `powershell.exe`/`xclip` probe
      // ended up deciding that the node's real archive tool could not be granted.
      .filter((call) => {
        const caller = nearestSpan(functions, call.range().start.index)?.name ?? null
        return caller === null || !(clipboardRoots.has(caller) || clipboardRelevant.has(caller))
      })
    const names: ProgramName[] = []
    const proofs: string[] = []
    let blocker = calls.length === 0 ? `${fn} is not called anywhere in ${relativePath}` : null
    for (const call of calls) {
      const callLine = call.range().start.line + 1
      const argument = positionalArgumentOf(call, index)
      const resolved = argument === null ? null : programNameOfNode(argument, constStrings)
      if (resolved === null) {
        blocker = `${fn} is called at ${relativePath}:${callLine} with ${argument?.text() ?? "no argument at that position"}`
        break
      }
      proofs.push(`${fn}@${callLine}=${resolved.name}`)
      if (!names.some((item) => item.name === resolved.name)) names.push({ name: resolved.name, via: "wrapper" })
    }
    if (blocker !== null) {
      site.marker = `${site.callee}(${site.argument}) unresolved: ${blocker}`
      continue
    }
    site.programs = names
    site.marker = `${site.callee}(${names.map((item) => item.name).join(", ")}) via ${fn} ${proofs.join(", ")}`
  }

  const externalProcess: SurfaceFileAnalysis["externalProcess"] = []
  // `node:child_process` on its own is not a requirement: the spawn call sites decide.
  const spawnSpecifiers = [...new Set(specifiers.filter((specifier) => matchesAny(specifier, EXTERNAL_PROCESS_LIBS)))].sort()
  const clipboardEvidence = [...clipboardRoots].map((name) => ({ marker: name, line: functions.find((item) => item.name === name)?.line ?? 1 }))
  for (const site of spawnSites) {
    if (site.name === null || !clipboardRoots.size) {
      externalProcess.push({ marker: site.marker, line: site.line, programs: site.programs, argument: site.argument })
      continue
    }
    const ownerCallers = callers.get(site.name)
    const confined = clipboardRoots.has(site.name) || Boolean(ownerCallers?.size && [...ownerCallers].every((caller) => clipboardRelevant.has(caller)))
    if (!confined) externalProcess.push({ marker: site.marker, line: site.line, programs: site.programs, argument: site.argument })
  }

  // Recursion is the requirement, not a name: a runtime member called `listDir` lists one directory. The
  // node must reach a directory listing from inside a cycle (self or mutual) to own the enumeration itself.
  const walkers: { marker: string; line: number }[] = []
  for (const item of functions) {
    const reached = reachable(item.name)
    if (!reached.has(item.name)) continue
    const listsDirectory = listingOwners.has(item.name) || [...reached].some((name) => listingOwners.has(name))
    if (listsDirectory) walkers.push({ marker: `${item.name} (recursive enumeration)`, line: item.line })
  }

  const unresolved = [...new Set(specifiers.filter((specifier) => isUnresolved(specifier, osNative, noHostFreeAnswer)))].sort()

  return {
    file: relativePath,
    imports,
    specifiers,
    externalProcess,
    spawnSpecifiers,
    clipboardEvidence,
    capabilityIo,
    coreMentionsClipboard: CORE_CLIPBOARD_FILE.test(relativePath) && CLIPBOARD_PATTERN.test(source),
    walkers,
    unresolved,
  }
}

interface FunctionSpan {
  name: string
  start: number
  end: number
  line: number
  body: string
  /**
   * Parameter names in declaration order; a destructured, default-valued or rest parameter is recorded as an
   * empty string, because the wrapper pass can only follow a name it can point at.
   */
  params: string[]
}

/** Names every callable in the file: declarations, method definitions and the arrow assigned to a binding or key. */
function collectFunctions(root: SgNode): FunctionSpan[] {
  const spans: FunctionSpan[] = []
  for (const kind of FUNCTION_KINDS) {
    for (const node of root.findAll({ rule: { kind } })) {
      const range = node.range()
      const name = functionName(node)
      if (!name) continue
      spans.push({
        name,
        start: range.start.index,
        end: range.end.index,
        line: range.start.line + 1,
        body: node.text(),
        params: parameterNames(node),
      })
    }
  }
  // Innermost first so `nearestSpan` can stop at the smallest containing span.
  return spans.sort((left, right) => (right.end - right.start) - (left.end - left.start))
}

/** Named children of a node — `arguments` and `formal_parameters` also carry punctuation, which is unnamed. */
function namedChildren(node: SgNode): SgNode[] {
  return node.children().filter((child) => child.isNamed())
}

/** The declared parameter names of one callable, positionally. See `FunctionSpan.params`. */
function parameterNames(node: SgNode): string[] {
  const parameters = node.field("parameters")
  if (!parameters) return []
  const names: string[] = []
  for (const child of namedChildren(parameters)) {
    if (child.kind() === "comment") continue
    if (child.kind() === "identifier") {
      names.push(child.text())
      continue
    }
    // TypeScript wraps each parameter: `command: string` is a `required_parameter` whose pattern is the name,
    // while `{c}: D` or `...rest: string[]` has no single name to point at and is recorded as "".
    const pattern = child.field("pattern") ?? child.field("name")
    names.push(pattern !== null && pattern.kind() === "identifier" ? pattern.text() : "")
  }
  return names
}

function functionName(node: SgNode): string | null {
  const named = node.field("name")
  if (named) return named.text()
  const parent = node.parent()
  if (!parent) return null
  if (parent.kind() === "variable_declarator") return parent.field("name")?.text() ?? null
  if (parent.kind() === "pair") return parent.field("key")?.text().replace(/^["'`]|["'`]$/g, "") ?? null
  return null
}

/** The innermost callable containing `offset`, or `null` at file scope. */
function nearestSpan(spans: FunctionSpan[], offset: number): FunctionSpan | null {
  let best: FunctionSpan | null = null
  let bestWidth = Number.POSITIVE_INFINITY
  for (const span of spans) {
    if (offset < span.start || offset >= span.end) continue
    const width = span.end - span.start
    if (width < bestWidth) {
      best = span
      bestWidth = width
    }
  }
  return best
}

function calleeName(call: SgNode): string | null {
  const callee = call.field("function")
  if (!callee) return null
  if (callee.kind() === "identifier") return callee.text()
  if (callee.kind() === "member_expression") {
    const property = callee.field("property")
    return property?.text() ?? null
  }
  return null
}

/**
 * Names a file may call the process API under: `execFile`, an alias from `import { execFile as run }`, a
 * namespace object, and the `promisify(execFile)` binding most platforms actually use.
 */
function collectProcessBindings(root: SgNode): Set<string> {
  const bindings = new Set<string>()
  for (const node of root.findAll({ rule: { kind: "import_statement" } })) {
    const source = node.field("source")?.text().replace(/^["'`]|["'`]$/g, "") ?? ""
    if (!matchesAny(source, EXTERNAL_PROCESS_LIBS)) continue
    for (const clause of node.findAll({ rule: { kind: "import_clause" } })) {
      for (const identifier of clause.findAll({ rule: { kind: "identifier" } })) bindings.add(identifier.text())
    }
  }
  for (const declarator of root.findAll({ rule: { kind: "variable_declarator" } })) {
    const name = declarator.field("name")
    const value = declarator.field("value")
    if (!name || !value) continue
    const aliased = value.kind() === "call_expression" && value.field("function")?.text() === "promisify"
    const argument = value.field("arguments")?.text() ?? ""
    if (aliased && [...bindings].some((binding) => new RegExp(`\\b${binding}\\b`).test(argument))) bindings.add(name.text())
  }
  return bindings
}

/**
 * The `const NAME = "literal"` bindings of one file, so `execFile(SEVENZIP, …)` is as grantable as
 * `execFile("7z.exe", …)`. Only same-file string constants are resolved on purpose: following an import to a
 * shared package would turn one string in `@xiranite/file-operations` into an allowlist entry for every node that
 * imports it, which is exactly the false grant this table exists to prevent.
 */
function collectConstStringBindings(root: SgNode): Map<string, string> {
  const bindings = new Map<string, string>()
  for (const declarator of root.findAll({ rule: { kind: "variable_declarator" } })) {
    const name = declarator.field("name")
    const value = declarator.field("value")
    if (!name || !value || value.kind() !== "string") continue
    const literal = value.text().replace(/^["'`]|["'`]$/g, "").trim()
    if (literal.length > 0) bindings.set(name.text(), literal)
  }
  return bindings
}

/** The first argument of a call, by earliest start offset (`findAll` is recursive, so position is the filter). */
function firstArgumentOf(call: SgNode): SgNode | null {
  const args = call.field("arguments")
  if (!args) return null
  let first: SgNode | null = null
  for (const kind of ["string", "template_string", "identifier", "member_expression", "call_expression", "new_expression", "object", "array", "number"]) {
    for (const child of args.findAll({ rule: { kind } })) {
      if (!first || child.range().start.index < first.range().start.index) first = child
    }
  }
  return first
}

/**
 * The program name a call argument spells: a quoted string or a same-file string constant answers one, anything
 * else answers `null` so the report can say "this one needs a human" instead of inventing a program.
 */
function programNameOfNode(first: SgNode, constStrings: Map<string, string>): ProgramName | null {
  const text = first.text()
  if (first.kind() === "string") {
    const literal = text.replace(/^["'`]|["'`]$/g, "").trim()
    // A template-ish or interpolated literal is not a program name; `${…}` inside quotes means the caller decides.
    if (literal.length > 0 && !literal.includes("${")) return { name: literal, via: "literal" }
    return null
  }
  if (first.kind() === "identifier") {
    const resolved = constStrings.get(text)
    if (resolved !== undefined) return { name: resolved, via: "const" }
  }
  return null
}

/** The argument at a positional index, skipping punctuation and comments; `null` when the call has fewer arguments. */
function positionalArgumentOf(call: SgNode, index: number): SgNode | null {
  const args = call.field("arguments")
  if (!args) return null
  const positions = namedChildren(args).filter((child) => child.kind() !== "comment")
  return positions[index] ?? null
}

/**
 * What a spawn call asks the host to run. A quoted argument or a same-file string constant answers a name; a
 * locator function, a template, or anything else answers `null` plus the text as written, so the report can say
 * "this one needs a human" instead of inventing a program.
 *
 * `argumentName` is set only for an unresolved bare identifier — the handle the wrapper pass needs in order to
 * ask "is this a parameter of the function this spawn sits in?".
 */
function spawnProgramEvidence(
  call: SgNode,
  constStrings: Map<string, string>,
): { program: ProgramName | null; argument: string; argumentName: string | null } {
  const first = firstArgumentOf(call)
  if (!first) return { program: null, argument: "", argumentName: null }
  const program = programNameOfNode(first, constStrings)
  if (program !== null) return { program, argument: first.text(), argumentName: null }
  return {
    program: null,
    argument: first.text(),
    argumentName: first.kind() === "identifier" ? first.text() : null,
  }
}

/**
 * Which capability group a call hangs off, for a file that imported the surface: `fs.move(...)` is file
 * mutation through the granted roots and `proc.exec(...)` reaches another program. `null` otherwise.
 *
 * The receiver name is the convention this repo's `platform.ts` files use (`const { fs, proc } =
 * hostCapabilities`); a call on any other object is not surface evidence. Matching on the *call* rather than
 * on the specifier is deliberate: importing the surface proves nothing, since a node that only asks
 * `clock.now()` needs neither roots nor a program grant.
 *
 * The last link of the member chain is the receiver, so `hostCapabilities.fs.stat(...)` reads as `fs.stat(...)`:
 * 25 call sites in the retained nodes reach the surface that way instead of through a destructured binding,
 * and a `proc.exec` written fully qualified carries a program literal just as one written short does.
 */
function capabilityCallGroup(call: SgNode, specifiers: string[]): { group: "io" | "process"; text: string } | null {
  if (!specifiers.includes(CAPABILITY_SPECIFIER)) return null
  const callee = call.field("function")
  if (!callee || callee.kind() !== "member_expression") return null
  const object = callee.field("object")?.text() ?? ""
  const property = callee.field("property")?.text() ?? ""
  if (!property) return null
  const receiver = object.includes(".") ? object.slice(object.lastIndexOf(".") + 1) : object
  if (CAPABILITY_FILE_IO_RECEIVERS.has(receiver)) return { group: "io", text: `fs.${property}` }
  if (CAPABILITY_PROCESS_RECEIVERS.has(receiver)) return { group: "process", text: `proc.${property}` }
  return null
}

/** The positional index of a spawn's program argument when that argument is a parameter of its function. */
function parameterIndexOf(
  argumentName: string | null,
  span: { name: string; params: string[] } | null,
): { fn: string; index: number } | null {
  if (argumentName === null || span === null) return null
  const index = span.params.indexOf(argumentName)
  return index >= 0 ? { fn: span.name, index } : null
}

function isSpawnCall(call: SgNode, bindings: Set<string>): boolean {  if (!bindings.size) return false
  const callee = call.field("function")
  if (!callee) return false
  if (callee.kind() === "identifier") return bindings.has(callee.text())
  if (callee.kind() === "member_expression") {
    const object = callee.field("object")?.text() ?? ""
    const property = callee.field("property")?.text() ?? ""
    return bindings.has(object) && SPAWN_CALLEES.has(property)
  }
  return false
}

function pushSpecifier(found: ImportEvidence[], raw: string, node: SgNode, file: string, dynamic: boolean): void {
  const quoted = /^\s*(['"`])([^'"`]+)\1/.exec(raw)
  if (!quoted) return
  const specifier = quoted[2]!
  if (found.some((item) => item.specifier === specifier && item.file === file)) return
  found.push({ specifier, file, line: node.range().start.line + 1, dynamic })
}

function collectComposedNodes(analyses: SurfaceFileAnalysis[]): string[] {
  const ids: string[] = []
  for (const analysis of analyses) {
    for (const specifier of analysis.specifiers) {
      const match = COMPOSED_NODE_SPECIFIER.exec(specifier)
      if (match?.[1]) ids.push(match[1])
    }
  }
  return ids
}

function isComposed(specifier: string): boolean {
  return COMPOSED_NODE_SPECIFIER.test(specifier)
}

function isNativeBinding(specifier: string, noHostFreeAnswer: string[]): boolean {
  return matchesAny(specifier, noHostFreeAnswer) || NATIVE_BINDING_PATTERN.test(specifier)
}

function isInfrastructure(specifier: string): boolean {
  return !NODE_SUBPATH.test(specifier) && !isComposed(specifier) && matchesAny(specifier, INFRASTRUCTURE_PREFIXES)
}

/** Anything the buckets above cannot place is a decision the host still owes, so it must stay visible. */
function isUnresolved(specifier: string, osNative: string[], noHostFreeAnswer: string[]): boolean {
  if (specifier.startsWith(".")) return false
  // The capability surface is classified by the calls it receives (see CAPABILITY_SPECIFIER), never by
  // falling through to "unclassified": that arm answers `no-host-free-answer`, which would stamp every
  // migrated node with the harshest requirement in the vocabulary.
  if (specifier === CAPABILITY_SPECIFIER) return false
  if (isComposed(specifier) || isInfrastructure(specifier)) return false
  if (NODE_SUBPATH.test(specifier)) return false
  return !(
    matchesAny(specifier, FILE_IO_SPECIFIERS)
    || matchesAny(specifier, EXTERNAL_PROCESS_LIBS)
    || matchesAny(specifier, NETWORK_LIBS)
    || matchesAny(specifier, osNative)
    || matchesAny(specifier, noHostFreeAnswer)
    || matchesAny(specifier, RECURSIVE_ENUMERATION_LIBS)
    || HOST_FREE_PREFIXES.some((prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`))
    || HOST_FREE_PACKAGES.some((name) => specifier === name || specifier.startsWith(`${name}/`))
  )
}

function matchesAny(specifier: string, markers: string[]): boolean {
  return markers.some((marker) => specifier === marker || specifier.startsWith(`${marker}/`))
}

/**
 * `service.invoke("<name>", …)` on the surface and `opServiceInvoke("<name>", …)` in a shim's service module
 * are the two ways a service name reaches the host today. Matching the bare word instead would credit a node
 * with a grant it never asks for, so only a quoted first argument counts.
 */
const SERVICE_CALL_PATTERN = /(?:service\.invoke|opServiceInvoke(?:Async)?)\(\s*"([a-z][a-z0-9_-]*)"/

/**
 * How the shim's service modules actually name the service: one `const SERVICE = "<name>"` at the top, and
 * every `opServiceInvoke*(SERVICE, method, …)` passes that constant. A call-site literal is rarer, so both
 * shapes count and nothing else does — the name must still be spelled out somewhere in the code.
 */
const SERVICE_NAME_DECLARATION = /const SERVICE = "([a-z][a-z0-9_-]*)"/

/**
 * The alias table the bundle build uses, read from the shim package rather than imported.
 *
 * `HOST_SERVED_PACKAGES` is the single authority for "this workspace package is answered by a host service":
 * inside a bundle `@xiranite/config/node` is replaced by `config-service.ts`, which calls
 * `service.invoke("config", …)`. Importing the table would drag the shim package into this analyzer's build
 * graph, and copying it would make a second truth, so the entries are parsed from the source and an empty
 * result is a hard failure — a shape change must stop the audit instead of silently reporting no services.
 */
async function hostServedPackages(repoRoot: string): Promise<Record<string, string>> {
  const surfaceFile = join(repoRoot, "packages", "quickjs-shims", "src", "surface.ts")
  const source = await readFile(surfaceFile, "utf8").catch(() => "")
  // An absent shim package is a different repository (a fixture tree), not a changed shape: report no
  // aliasing. The throw below is only for "the file is there but my rule found nothing in it".
  if (source === "") return {}
  const table: Record<string, string> = {}
  for (const match of source.matchAll(/"(@xiranite\/[^"]+)":\s*"([A-Za-z0-9_.-]+\.ts)"/g)) {
    if (match[1] !== undefined && match[2] !== undefined) table[match[1]] = match[2]
  }
  if (Object.keys(table).length === 0) {
    throw new Error("hostServedPackages: surface.ts is present but HOST_SERVED_PACKAGES parsed empty — the audit would report zero services for every node")
  }
  return table
}

const shimServiceNameCache = new Map<string, string[]>()

/** The service names one shim service module calls, following only its own relative imports. */
async function serviceNamesOfShimModule(entryFile: string, seen = new Set<string>()): Promise<string[]> {
  const cached = shimServiceNameCache.get(entryFile)
  if (cached !== undefined) return cached
  const names: string[] = []
  const queue: string[] = [entryFile]
  while (queue.length > 0) {
    const file = queue.shift()!
    if (seen.has(file) || file.includes("/dist/") || file.endsWith(".test.ts") || file.endsWith(".d.ts")) continue
    seen.add(file)
    const source = await readFile(file, "utf8").catch(() => "")
    if (source === "") continue
    for (const pattern of [SERVICE_CALL_PATTERN, SERVICE_NAME_DECLARATION]) {
      for (const match of source.matchAll(new RegExp(pattern.source, "g"))) {
        if (match[1] !== undefined && !names.includes(match[1])) names.push(match[1])
      }
    }
    for (const match of source.matchAll(/from\s+"(\.[^"]+)"/g)) {
      const target = match[1]
      if (target === undefined) continue
      const base = resolve(dirname(file), target)
      for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
        if (await exists(candidate)) {
          queue.push(candidate)
          break
        }
      }
    }
  }
  shimServiceNameCache.set(entryFile, names)
  return names
}

/** The services one node reaches: its own call literals, plus the packages the build aliases onto a service. */
async function servicesReached(analyses: SurfaceFileAnalysis[], repoRoot: string): Promise<ServiceGrantEvidence[]> {
  const served = await hostServedPackages(repoRoot)
  const rows: ServiceGrantEvidence[] = []
  const remember = (service: string, via: string, file: string, line: number) => {
    if (rows.some((row) => row.service === service && row.file === file && row.via === via)) return
    rows.push({ service, via, file, line })
  }
  for (const analysis of analyses) {
    const source = await readFile(join(repoRoot, analysis.file), "utf8").catch(() => "")
    for (const pattern of [SERVICE_CALL_PATTERN, SERVICE_NAME_DECLARATION]) {
      for (const match of source.matchAll(new RegExp(pattern.source, "g"))) {
        if (match[1] === undefined) continue
        remember(match[1], "direct", analysis.file, source.slice(0, match.index ?? 0).split("\n").length)
      }
    }
    for (const specifier of analysis.specifiers) {
      const shimFile = served[specifier] ?? served[specifier.split("/").slice(0, 2).join("/")]
      if (shimFile === undefined) continue
      const names = await serviceNamesOfShimModule(join(repoRoot, "packages", "quickjs-shims", "src", shimFile))
      for (const name of names) {
        remember(name, `aliased ${specifier} -> shims/${shimFile}`, analysis.file, 1)
      }
    }
  }
  return rows.sort(
    (left, right) =>
      left.service.localeCompare(right.service) || left.file.localeCompare(right.file) || left.line - right.line,
  )
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

export const HOST_REQUIREMENTS = REQUIREMENT_ORDER
export const NATIVE_BINDING_MARKERS = NO_HOST_FREE_ANSWER_LIBS
