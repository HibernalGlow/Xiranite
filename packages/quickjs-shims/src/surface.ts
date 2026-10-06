/**
 * The audit-facing description of this package: which `node:` specifiers have a shim module, which members of
 * each module actually do something, and which host operations each module needs.
 *
 * This is a *data* file on purpose, and it must be importable in a process with no `__xrh` — it therefore
 * imports no runtime module, only types. `scripts/audit-node-bundles.ts` reads `SHIMMED_BUILTINS` to decide
 * which surviving `node:` specifiers in a bundle are mapped (green) versus unmapped (red); `scripts/build-node-bundles.ts`
 * reads it to build the esbuild `--alias` list; the README table is rendered from `MODULE_SURFACES`.
 *
 * `implemented` lists the members that call a **v1** host operation (or are pure). `unsupported` lists every
 * other member Node has, with the reason and (where one exists) the host operation it would need. The
 * builtins themselves export every name in both lists so esbuild's named-import resolution stays green; the
 * `unsupported` exports are `notImplemented` throws.
 */
import type { ShimErrorCode } from "./host.ts"

export interface UnsupportedMember {
  name: string
  /** Node's member name. */
  reason: string
  /** The host operation that would unlock it, when there is one to name. */
  requiredOperation?: string
}

export interface ModuleSurface {
  /** Shim module id as it appears in reports, e.g. `fs/promises`. */
  module: string
  implemented: string[]
  unsupported: UnsupportedMember[]
  /** Host operations this module calls. Must be a subset of `OPERATIONS_V1`; the audit fails on anything else. */
  hostOperations: string[]
}

/**
 * The eight builtins the node set imports, measured in
 * `docs/migration/quickjs-substrate-evaluation.md` §3.2 (fs/promises 38 nodes, path 36, child_process 31,
 * fs 10, util 4, os 4, crypto 3, url 1). Maps a specifier to the shim file that serves it.
 */
export const SHIMMED_BUILTINS: Record<string, string> = {
  "node:fs/promises": "fs-promises.ts",
  "node:fs": "fs.ts",
  "node:path": "path.ts",
  "node:child_process": "child-process.ts",
  "node:os": "os.ts",
  "node:util": "util.ts",
  "node:crypto": "crypto.ts",
  "node:url": "url.ts",
  "node:events": "events.ts",
  "node:constants": "constants.ts",
  "node:string_decoder": "string-decoder.ts",
  "node:stream": "stream.ts",
  "node:assert": "assert.ts",
  "node:worker_threads": "worker-threads.ts",
  "node:module": "module.ts",
  "node:zlib": "zlib.ts",
  "node:readline": "readline.ts",
}

/** Bare (unprefixed) spellings the same closures can use; esbuild needs both keys or `import("fs")` escapes. */
export const BARE_BUILTINS: Record<string, string> = {
  "fs/promises": "fs-promises.ts",
  fs: "fs.ts",
  path: "path.ts",
  child_process: "child-process.ts",
  os: "os.ts",
  util: "util.ts",
  crypto: "crypto.ts",
  url: "url.ts",
  events: "events.ts",
  constants: "constants.ts",
  string_decoder: "string-decoder.ts",
  stream: "stream.ts",
  assert: "assert.ts",
  worker_threads: "worker-threads.ts",
  module: "module.ts",
  zlib: "zlib.ts",
  readline: "readline.ts",
}

/** `node:process` / `node:buffer` are installed as realm globals by the prelude, not aliased per import. */
export const PROCESS_GLOBAL = { specifier: "node:process", module: "process.ts", installedAs: "globalThis.process" } as const
export const BUFFER_GLOBAL = { specifier: "node:buffer", module: "buffer.ts", installedAs: "globalThis.Buffer" } as const

export const MODULE_SURFACES: ModuleSurface[] = [
  {
    module: "fs/promises",
    hostOperations: ["fs.stat", "fs.list", "fs.readText", "fs.writeText", "fs.ensureDir", "fs.move", "fs.delete"],
    implemented: ["readFile", "writeFile", "readText", "writeText", "readdir", "stat", "lstat", "mkdir", "rm", "unlink", "rmdir", "rename", "access"],
    unsupported: [
      { name: "open", reason: "a FileHandle is a descriptor the realm cannot own; positional byte reads are the host's job.", requiredOperation: "fs.open/readRange/closeHandle host-handle operations" },
      { name: "appendFile", reason: "operations v1 has no append op.", requiredOperation: "fs.appendText(path, text) -> null" },
      { name: "copyFile", reason: "operations v1 has no copy op.", requiredOperation: "fs.copy(source, target) -> null" },
      { name: "cp", reason: "operations v1 has no copy op.", requiredOperation: "fs.copy(source, target, { recursive? }) -> null" },
      { name: "mkdtemp", reason: "operations v1 has no unique-tempdir op.", requiredOperation: "fs.mkdtemp(prefix) -> path" },
      { name: "link", reason: "operations v1 has no hardlink op.", requiredOperation: "fs.link(source, target)" },
      { name: "symlink", reason: "operations v1 has no symlink op.", requiredOperation: "fs.symlink(target, path, type)" },
      { name: "readlink", reason: "operations v1 has no readlink op.", requiredOperation: "fs.readlink(path)" },
      { name: "realpath", reason: "operations v1 has no realpath op.", requiredOperation: "fs.realpath(path) -> path" },
      { name: "utimes", reason: "operations v1 has no mtime-set op.", requiredOperation: "fs.utimes(path, atimeMs, mtimeMs)" },
      { name: "chmod", reason: "the host owns permissions.", requiredOperation: "fs.chmod(path, mode)" },
      { name: "chown", reason: "the host owns identity." },
      { name: "truncate", reason: "operations v1 has no truncate op." },
      { name: "lutimes", reason: "operations v1 has no link-mtime op." },
      { name: "statfs", reason: "operations v1 has no statfs op." },
      { name: "writev", reason: "no vectored write in operations v1." },
      { name: "readv", reason: "no vectored read in operations v1." },
      { name: "glob", reason: "enumeration policy is the host's (recursive-enumeration tier)." },
      { name: "opendir", reason: "a directory cursor needs a host-held handle." },
      { name: "watch", reason: "file watching is a host service (ADR-0074 decision 5), not a realm object." },
      { name: "watchFile", reason: "as watch." },
    ],
  },
  {
    module: "fs",
    hostOperations: ["fs.stat", "fs.list", "fs.readText", "fs.writeText", "fs.ensureDir", "fs.move", "fs.delete"],
    implemented: ["constants", "promises", "readFileSync", "writeFileSync", "readdirSync", "statSync", "lstatSync", "existsSync", "mkdirSync", "rmSync", "unlinkSync", "rmdirSync", "renameSync", "accessSync", "access"],
    unsupported: [
      { name: "appendFileSync", reason: "operations v1 has no append op.", requiredOperation: "fs.appendText(path, text) -> null" },
      { name: "mkdtempSync", reason: "operations v1 has no unique-tempdir op.", requiredOperation: "fs.mkdtemp(prefix) -> path" },
      { name: "copyFileSync", reason: "operations v1 has no copy op.", requiredOperation: "fs.copy(source, target) -> null" },
      { name: "cpSync", reason: "operations v1 has no copy op.", requiredOperation: "fs.copy(source, target, { recursive? }) -> null" },
      { name: "linkSync", reason: "operations v1 has no hardlink op.", requiredOperation: "fs.link(source, target)" },
      { name: "symlinkSync", reason: "operations v1 has no symlink op.", requiredOperation: "fs.symlink(target, path, type)" },
      { name: "readlinkSync", reason: "operations v1 has no readlink op.", requiredOperation: "fs.readlink(path)" },
      { name: "realpathSync", reason: "operations v1 has no realpath op.", requiredOperation: "fs.realpath(path) -> path" },
      { name: "utimesSync", reason: "operations v1 has no mtime-set op.", requiredOperation: "fs.utimes(path, atimeMs, mtimeMs)" },
      { name: "chmodSync", reason: "the host owns permissions." },
      { name: "chownSync", reason: "the host owns identity." },
      { name: "truncateSync", reason: "operations v1 has no truncate op." },
      { name: "lutimesSync", reason: "operations v1 has no link-mtime op." },
      { name: "statfsSync", reason: "operations v1 has no statfs op." },
      { name: "openSync", reason: "returns a numeric descriptor the realm cannot own.", requiredOperation: "fs.open/readRange/closeHandle host-handle operations" },
      { name: "closeSync", reason: "as openSync." },
      { name: "readSync", reason: "positional reads must go to the host as fs.readBytes with an offset." },
      { name: "writeSync", reason: "as readSync." },
      { name: "createReadStream", reason: "a ReadStream is a host-held descriptor with backpressure." },
      { name: "createWriteStream", reason: "as createReadStream." },
      { name: "watch", reason: "file watching is a host service (ADR-0074 decision 5)." },
      { name: "watchFile", reason: "as watch." },
      { name: "unwatchFile", reason: "as watch." },
    ],
  },
  {
    module: "path",
    hostOperations: [],
    implemented: ["sep", "delimiter", "normalize", "join", "resolve", "isAbsolute", "relative", "dirname", "basename", "extname", "parse", "format", "win32", "posix", "toNamespacedPath"],
    unsupported: [{ name: "_makeLong", reason: "Windows \\\\?\\ namespace helper; the host's granted-root check replaces it." }],
  },
  {
    module: "child_process",
    hostOperations: ["proc.exec"],
    implemented: ["execFile", "execFileSync"],
    unsupported: [
      { name: "spawn", reason: "a live ChildProcess needs a host-held handle plus an event channel.", requiredOperation: "proc.spawn(program, args, { cwd }) -> handle" },
      { name: "spawnSync", reason: "not wired; proc.exec already waits." },
      { name: "exec", reason: "shell string parsing bypasses the external-program allowlist. Call execFile(program, argv).", requiredOperation: "proc.execShell (not in operations v1)" },
      { name: "execSync", reason: "shell string parsing bypasses the allowlist. Call execFileSync(program, argv)." },
      { name: "fork", reason: "forking a Node process is meaningless inside the realm." },
    ],
  },
  {
    module: "os",
    hostOperations: ["os.tmpdir"],
    implemented: ["platform", "arch", "tmpdir", "tmpdirSync", "EOL", "lineEnding", "getSeparator", "version", "devNull"],
    unsupported: [
      { name: "homedir", reason: "granted roots come from the host; a guessed home writes outside them.", requiredOperation: "os.homedir() -> path" },
      { name: "cpus", reason: "a fabricated CPU count silently changes a node's concurrency.", requiredOperation: "os.cpus() -> [ { model, speed } ]" },
      { name: "availableParallelism", reason: "same as cpus." },
      { name: "hostname", reason: "no os.hostname in operations v1." },
      { name: "totalmem", reason: "memory budgets are the host's NodeRequirements." },
      { name: "freemem", reason: "no memory operation in operations v1." },
      { name: "networkInterfaces", reason: "no os network surface in operations v1." },
      { name: "userInfo", reason: "identity is the host's." },
      { name: "uptime", reason: "the host's clock is pinned as __xrh.now, a wall clock." },
      { name: "loadavg", reason: "no os.loadavg in operations v1." },
      { name: "machine", reason: "as arch, but the host does not pin it." },
      { name: "release", reason: "as version, but the host does not pin it." },
      { name: "getPriority", reason: "process priority is the host's." },
      { name: "setPriority", reason: "as getPriority." },
    ],
  },
  {
    module: "util",
    hostOperations: [],
    implemented: ["promisify", "callbackify", "inspect", "types", "debuglog", "styleText", "deprecate", "isDeepEqual"],
    unsupported: [
      { name: "parseArgs", reason: "argv parsing belongs to the CLI face, which keeps Node's own util." },
      { name: "TextEncoder", reason: "engine global (quickjs-wpt-sys), not realm code.", requiredOperation: "the executor enables quickjs-wpt-sys for the global TextEncoder/TextDecoder" },
      { name: "TextDecoder", reason: "engine global (quickjs-wpt-sys), not realm code." },
    ],
  },
  {
    module: "crypto",
    hostOperations: ["crypto.randomUUID", "crypto.randomBytes"],
    implemented: ["randomUUID", "randomBytes"],
    unsupported: [
      { name: "createHash", reason: "a JS SHA here and Rust's sha2 in the host would be two implementations of one contract.", requiredOperation: "crypto.digest(algorithm, bytes) -> { hex }" },
      { name: "hash", reason: "as createHash.", requiredOperation: "crypto.digest(algorithm, bytes) -> { hex }" },
      { name: "createHmac", reason: "no digest in operations v1." },
      { name: "randomFill", reason: "no crypto.randomFill in operations v1.", requiredOperation: "crypto.randomFill(byteLength) -> bytes" },
      { name: "randomFillSync", reason: "as randomFill." },
      { name: "getRandomValues", reason: "as randomFill." },
      { name: "randomInt", reason: "no crypto.randomInt in operations v1." },
      { name: "timingSafeEqual", reason: "constant-time comparison belongs next to the digest that uses it." },
      { name: "createCipheriv", reason: "no cipher surface in operations v1." },
      { name: "createDecipheriv", reason: "as createCipheriv." },
      { name: "createSign", reason: "as createHash." },
      { name: "createVerify", reason: "as createHash." },
      { name: "pbkdf2", reason: "a CPU-budget question for the host." },
      { name: "pbkdf2Sync", reason: "as pbkdf2." },
      { name: "scrypt", reason: "as pbkdf2." },
      { name: "scryptSync", reason: "as scrypt." },
    ],
  },
  {
    module: "url",
    hostOperations: [],
    implemented: ["pathToFileURL", "fileURLToPath", "getURL", "getURLSearchParams", "domainToASCII", "domainToUnicode"],
    unsupported: [
      { name: "parse", reason: "legacy URL; three parsing modes, none used by the node set. `URL` is the supported spelling." },
      { name: "format", reason: "as parse." },
      { name: "resolve", reason: "as parse." },
    ],
  },
  {
    module: "events",
    hostOperations: [],
    implemented: ["EventEmitter", "errorMonitor", "captureRejectionSymbol", "getEventListeners", "listenerCount", "setMaxListeners", "getMaxListeners", "defaultMaxListeners", "usingDomains"],
    unsupported: [
      { name: "once", reason: "needs the async-iterator family; the port covers the emitter contract only." },
      { name: "on", reason: "as once." },
      { name: "addAbortListener", reason: "an AbortSignal listener is host-lifecycle work." },
      { name: "EventEmitterAsyncResource", reason: "async_hooks is not part of the realm." },
    ],
  },
  {
    module: "constants",
    hostOperations: [],
    implemented: ["F_OK", "R_OK", "W_OK", "X_OK", "COPYFILE_EXCL", "S_IFMT", "S_IFDIR", "S_IFREG", "S_IFLNK", "O_RDONLY", "O_WRONLY", "O_RDWR", "O_CREAT", "O_EXCL", "O_TRUNC", "O_APPEND", "constants"],
    unsupported: [],
  },
  {
    module: "string_decoder",
    hostOperations: [],
    implemented: ["StringDecoder"],
    unsupported: [],
  },
  {
    module: "stream",
    hostOperations: [],
    implemented: ["Stream", "Readable", "Writable", "Duplex", "Transform", "PassThrough", "ReadableState", "pipeline", "finished", "addAbortSignal", "compose", "destroy", "isDisturbed", "isErrored", "isReadable", "isWritable", "from", "wrap"],
    unsupported: [
      { name: "setDefaultHighWaterMark", reason: "not carried by the readable-stream port; a second high-water-mark would diverge from it." },
      { name: "getDefaultHighWaterMark", reason: "as setDefaultHighWaterMark." },
    ],
  },
  {
    module: "assert",
    hostOperations: [],
    implemented: ["AssertionError", "deepEqual", "deepStrictEqual", "doesNotMatch", "doesNotReject", "doesNotThrow", "equal", "fail", "ifError", "match", "notDeepEqual", "notDeepStrictEqual", "notEqual", "notStrictEqual", "ok", "rejects", "strict", "strictEqual", "throws"],
    unsupported: [],
  },
  {
    module: "worker_threads",
    hostOperations: [],
    implemented: ["isMainThread", "threadId", "parentPort", "resourceLimits", "SHARE_ENV", "getEnvironmentData", "setEnvironmentData"],
    unsupported: [
      { name: "Worker", reason: "a worker is a second QuickJS context.", requiredOperation: "worker_threads.spawn host service" },
      { name: "MessageChannel", reason: "as Worker.", requiredOperation: "worker_threads.spawn host service" },
      { name: "MessagePort", reason: "as Worker.", requiredOperation: "worker_threads.spawn host service" },
      { name: "BroadcastChannel", reason: "as Worker.", requiredOperation: "worker_threads.spawn host service" },
      { name: "receiveMessageOnPort", reason: "as Worker.", requiredOperation: "worker_threads.spawn host service" },
    ],
  },
  {
    module: "module",
    hostOperations: [],
    implemented: ["createRequire (refuses at call time, which is the guarded path)", "isBuiltin", "builtinModules"],
    unsupported: [
      { name: "Module", reason: "there is no runtime module graph to carry; the realm resolves at build time." },
      { name: "_resolveFilename", reason: "as Module." },
      { name: "register", reason: "as Module." },
      { name: "registerHooks", reason: "as Module." },
    ],
  },
  {
    module: "zlib",
    hostOperations: [],
    implemented: ["brotliDecompress", "brotliDecompressSync", "constants"],
    unsupported: [
      { name: "brotliCompress", reason: "no WebAssembly in the realm and the pure-JS brotli encoder is unavailable (measured 2026-10-05).", requiredOperation: "zlib.brotliCompress(bytes) -> bytes over the host handle channel" },
      { name: "brotliCompressSync", reason: "as brotliCompress.", requiredOperation: "zlib.brotliCompress(bytes) -> bytes over the host handle channel" },
      { name: "gzip", reason: "as brotliCompress; no retained node reaches the gzip family today.", requiredOperation: "zlib.brotliCompress(bytes) -> bytes over the host handle channel" },
      { name: "gunzip", reason: "as gzip.", requiredOperation: "zlib.brotliCompress(bytes) -> bytes over the host handle channel" },
      { name: "createGzip", reason: "a streaming zlib object needs a host-held descriptor." },
      { name: "createGunzip", reason: "as createGzip." },
    ],
  },
  {
    module: "readline",
    hostOperations: [],
    implemented: [],
    unsupported: [
      { name: "createInterface", reason: "a line reader needs a host-held stream; fs.readText + a JS split is the alternative for whole documents.", requiredOperation: "readline over a host-held stream (fs.readLines(path) or a byte handle)" },
      { name: "Interface", reason: "as createInterface.", requiredOperation: "readline over a host-held stream (fs.readLines(path) or a byte handle)" },
      { name: "emitKeypressEvents", reason: "terminal control belongs to the face, not the realm." },
      { name: "clearLine", reason: "as emitKeypressEvents." },
      { name: "clearScreenDown", reason: "as emitKeypressEvents." },
      { name: "cursorTo", reason: "as emitKeypressEvents." },
      { name: "moveCursor", reason: "as emitKeypressEvents." },
    ],
  },
]

/**
 * Node globals that must never appear in a *core* closure. The core is the platform-free half of a node —
 * measured: zero Node APIs across all 44 core closures (`spikes/core-isolation-report.json`) — so any of these
 * reaching a core bundle is a regression against the premise of the whole migration.
 */
export const CORE_FORBIDDEN_GLOBALS = ["process.", "Buffer", "__dirname", "require(", "import.meta"] as const

/** Same list as a matcher the gate runs against comment-stripped core-bundle source. */
export const CORE_FORBIDDEN_GLOBAL_PATTERNS: ReadonlyArray<readonly [label: string, pattern: RegExp]> = [
  ["process.", /\bprocess\s*\./],
  ["Buffer", /\bBuffer\s*[.([]/],
  ["__dirname", /\b__dirname\b/],
  ["require(", /\brequire\s*\(/],
  ["import.meta", /\bimport\.meta\b/],
]

/** `memberState("fs/promises", "cp") -> "implemented" | "unsupported" | "unknown"`. */
export function memberState(moduleId: string, member: string): "implemented" | "unsupported" | "unknown" {
  const normalized = moduleId.replace(/^node:/, "")
  const surface = MODULE_SURFACES.find((entry) => entry.module === normalized)
  if (surface === undefined) return "unknown"
  if (surface.implemented.includes(member)) return "implemented"
  if (surface.unsupported.some((entry) => entry.name === member)) return "unsupported"
  return "unknown"
}

/** Every host operation any module calls; must be a subset of operations v1. */
export function requiredHostOperations(): string[] {
  return [...new Set(MODULE_SURFACES.flatMap((surface) => surface.hostOperations))].sort()
}

export type { ShimErrorCode }
