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
  "node:string_decoder": "string-decoder.ts",
  "node:stream": "stream.ts",
  "node:assert": "assert.ts",
  "node:worker_threads": "worker-threads.ts",
  "node:module": "module.ts",
  "node:zlib": "zlib.ts",
  "node:readline": "readline.ts",
  // `buffer` is aliased, not only a realm global: `string_decoder` → `safe-buffer` does `require('buffer')`, and
  // an unmapped specifier there would put a second, silently different Buffer into every bundle.
  "node:buffer": "buffer.ts",
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
  string_decoder: "string-decoder.ts",
  stream: "stream.ts",
  assert: "assert.ts",
  worker_threads: "worker-threads.ts",
  module: "module.ts",
  zlib: "zlib.ts",
  readline: "readline.ts",
  buffer: "buffer.ts",
}

/**
 * `node:process` and `node:buffer` are installed as realm globals by the prelude (`index.ts`), because many
 * closure files read the bare names and a realm has neither. `buffer` is *also* an aliased module — see
 * `SHIMMED_BUILTINS` — so `require('buffer')` from bundled npm lands on the same Buffer the prelude published.
 */
export const PROCESS_GLOBAL = { specifier: "node:process", module: "process.ts", installedAs: "globalThis.process" } as const
export const BUFFER_GLOBAL = { specifier: "node:buffer", module: "buffer.ts", installedAs: "globalThis.Buffer", alsoAliased: true } as const

/**
 * Workspace packages whose implementation is not JavaScript, aliased to the module that reaches them
 * from inside the realm.
 *
 * These are not Node builtins and do not belong in the tables above: what is being replaced is a
 * package this repository owns, whose real implementation is a native addon the realm cannot load.
 * `@xiranite/czkawka-native` is that case — `createRequire` + a `.node` file
 * (`packages/czkawka-native/src/index.ts:2`), where the engine behind it (`native/czkawka-core`) is now
 * linked into the host and reached through `service.invoke`. The alias keeps the node's import
 * specifier and its call shapes, so the node's own code does not learn which runtime it is in.
 */
export const HOST_SERVED_PACKAGES: Record<string, string> = {
  "@xiranite/czkawka-native": "czkawka-service.ts",
  "@xiranite/config/node": "config-service.ts",
}

export const MODULE_SURFACES: ModuleSurface[] = [
  {
    module: "fs/promises",
    hostOperations: ["fs.stat", "fs.list", "fs.readText", "fs.writeText", "fs.ensureDir", "fs.move", "fs.delete", "fs.mkdtemp", "fs.copy", "fs.appendText", "fs.utimes", "fs.link", "fs.symlink", "fs.readlink", "fs.realpath", "fs.readBytes", "fs.writeBytes"],
    implemented: ["readFile", "writeFile", "readText", "writeText", "readdir", "stat", "lstat", "mkdir", "rm", "unlink", "rmdir", "rename", "access", "mkdtemp", "appendFile", "copyFile", "cp", "link", "symlink", "readlink", "realpath", "utimes"],
    unsupported: [
      { name: "open", reason: "a FileHandle is a descriptor the realm cannot own; positional byte reads are the host's job.", requiredOperation: "fs.open/readRange/closeHandle host-handle operations" },
      { name: "chmod", reason: "the host owns permissions.", requiredOperation: "fs.chmod(path, mode)" },
      { name: "chown", reason: "the host owns identity." },
      { name: "truncate", reason: "operations v1 has no truncate op." },
      { name: "lutimes", reason: "the host answers fs.utimes for a path; there is no link-side mtime setter." },
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
    hostOperations: ["fs.stat", "fs.list", "fs.readText", "fs.writeText", "fs.ensureDir", "fs.move", "fs.delete", "fs.mkdtemp", "fs.copy", "fs.appendText", "fs.utimes", "fs.link", "fs.symlink", "fs.readlink", "fs.realpath", "fs.readBytes", "fs.writeBytes"],
    implemented: ["constants", "promises", "readFileSync", "writeFileSync", "readdirSync", "statSync", "lstatSync", "existsSync", "mkdirSync", "rmSync", "unlinkSync", "rmdirSync", "renameSync", "accessSync", "access", "mkdtempSync", "appendFileSync", "copyFileSync", "cpSync", "linkSync", "symlinkSync", "readlinkSync", "realpathSync", "utimesSync"],
    unsupported: [
      { name: "chmodSync", reason: "the host owns permissions." },
      { name: "chownSync", reason: "the host owns identity." },
      { name: "truncateSync", reason: "operations v1 has no truncate op." },
      { name: "lutimesSync", reason: "as fs.promises.lutimes: fs.utimes is a path setter." },
      { name: "statfsSync", reason: "operations v1 has no statfs op." },
      { name: "openSync", reason: "returns a numeric descriptor the realm cannot own.", requiredOperation: "fs.open/readRange/closeHandle host-handle operations" },
      { name: "closeSync", reason: "as openSync." },
      { name: "readSync", reason: "its first argument is a descriptor, not a path — fs.readBytes answers whole files and ranges, but a fd the realm cannot hold is still required.", requiredOperation: "fs.open/readRange/closeHandle host-handle operations" },
      { name: "writeSync", reason: "as readSync: the positional write needs a descriptor the realm cannot own.", requiredOperation: "fs.open/writeRange/closeHandle host-handle operations" },
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
    hostOperations: ["proc.exec", "proc.spawn", "proc.wait", "proc.kill"],
    implemented: ["execFile", "execFileSync", "spawn", "spawnSync"],
    unsupported: [
      { name: "exec", reason: "shell string parsing bypasses the external-program allowlist. Call execFile(program, argv).", requiredOperation: "proc.execShell (not in operations v1)" },
      { name: "execSync", reason: "shell string parsing bypasses the allowlist. Call execFileSync(program, argv)." },
      { name: "fork", reason: "forking a Node process is meaningless inside the realm." },
      { name: "stdio pipes", reason: "spawn honours stdio:\"ignore\" only (Node answers stdout:null there). A live child is capped at 4 MiB per stream and polled in 262144-byte windows, so a piped ChildProcess would silently lose the tail; the only retained caller (bandia:153) does not read output." },
      { name: "proc.poll consumer", reason: "the window API is answered by the host but nothing reads it yet — wiring it means deciding the stream shape, not adding an op." },
    ],
  },
  {
    module: "os",
    hostOperations: ["os.tmpdir", "os.homedir", "os.cpus"],
    implemented: ["platform", "arch", "tmpdir", "tmpdirSync", "EOL", "lineEnding", "getSeparator", "version", "devNull", "homedir", "cpus", "availableParallelism"],
    unsupported: [
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
    // Not a Node builtin: the alias of `@xiranite/czkawka-native` (HOST_SERVED_PACKAGES), listed here so
    // the op-vocabulary gate can see the one operation it uses and the refusals it answers.
    module: "czkawka-service",
    hostOperations: ["service.invoke"],
    implemented: ["getCzkawkaInfo", "scanDuplicateFiles", "scanBasicFiles", "cancelCzkawkaScan", "getCzkawkaScanProgress"],
    unsupported: [
      { name: "scanExifFiles", reason: "no host method for it yet; an empty answer would read as a clean folder.", requiredOperation: "service.invoke { service: \"czkawka\", method: \"scan.exif\" }" },
      { name: "scanMediaFiles", reason: "no host method for it yet (similar images, videos, music, broken files).", requiredOperation: "service.invoke { service: \"czkawka\", method: \"scan.media\" }" },
      { name: "scanVideoOptimizer", reason: "no host method for it yet; it also needs ffmpeg, which is an external program the node must declare.", requiredOperation: "service.invoke { service: \"czkawka\", method: \"scan.video-optimizer\" }" },
      { name: "createExifCandidate", reason: "no host method for it yet.", requiredOperation: "service.invoke { service: \"czkawka\", method: \"exif.candidate\" }" },
      { name: "createVideoOptimizerCandidate", reason: "no host method for it yet.", requiredOperation: "service.invoke { service: \"czkawka\", method: \"video-optimizer.candidate\" }" },
      { name: "trashPath", reason: "the recycle bin is a host service of its own (ADR-0064), not a czkawka scan method.", requiredOperation: "a trash service behind service.invoke, not the czkawka engine" },
    ],
  },
  {
    // Not a Node builtin either: the alias of `@xiranite/config/node` (HOST_SERVED_PACKAGES). A realm cannot
    // lock a file it holds no descriptor for, and a lock implemented by sandboxed JS has no witness anybody
    // else can check — so every primitive here is one call to the host's config service.
    module: "config-service",
    hostOperations: ["service.invoke"],
    implemented: [
      "loadXiraniteConfig",
      "saveXiraniteConfig",
      "saveXiraniteConfigText",
      "updateXiraniteConfig",
      "updateNodeConfigFile",
      "readAtomicJsonFile",
      "updateAtomicJsonFile",
      "withXiraniteFileLock",
      "resolveNodeConfig",
      "loadNodeConfigWithHints",
      "pathExists",
    ],
    unsupported: [],
  },
  {
    module: "crypto",
    hostOperations: ["crypto.randomUUID", "crypto.randomBytes", "crypto.digest"],
    implemented: ["randomUUID", "randomBytes", "getRandomValues", "createHash", "hash"],
    unsupported: [
      { name: "createHmac", reason: "the host answers unkeyed digests only; a keyed MAC needs its own service.", requiredOperation: "crypto.hmac(algorithm, key, bytes) -> { hex }" },
      { name: "randomFill", reason: "no crypto.randomFill in operations v1.", requiredOperation: "crypto.randomFill(byteLength) -> bytes" },
      { name: "randomFillSync", reason: "as randomFill." },
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
    implemented: ["EventEmitter", "once", "getEventListeners", "listenerCount", "setMaxListeners", "getMaxListeners", "defaultMaxListeners"],
    unsupported: [
      {
        name: "on",
        reason: "the async-iterator form is Node 16+'s; `events@3.3.0` has no `on` at all, and the realm has no host event channel to iterate.",
        requiredOperation: "a host event channel the realm can async-iterate (ADR-0074 decision 5 host services)",
      },
      { name: "addAbortListener", reason: "an AbortSignal listener is host-lifecycle work.", requiredOperation: "a host-side cancellation signal (proc.cancel / run.cancel)" },
      { name: "EventEmitterAsyncResource", reason: "async_hooks is not part of the realm." },
      {
        name: "errorMonitor",
        reason: "`events@3.3.0` carries no errorMonitor routing (measured: zero `rg` hits in `events.js`). Exporting the symbol without the routing would let a listener register under it and never fire, so the name is not exported — a consumer that imports it fails at build time.",
      },
      { name: "captureRejections", reason: "as errorMonitor: the port neither reads the option nor emits the rejection." },
      { name: "captureRejectionSymbol", reason: "as captureRejections." },
      { name: "usingDomains", reason: "the port does not export the name; the realm has no domains, so it would be a value nobody reads." },
    ],
  },
  {
    module: "buffer",
    hostOperations: [],
    implemented: ["Buffer", "SlowBuffer", "kMaxLength", "INSPECT_MAX_BYTES", "atob", "btoa"],
    unsupported: [
      { name: "transpile", reason: "the realm has no VM compile step; `node:vm` is not in the substrate." },
      { name: "resolveObjectURL", reason: "`blob:` URLs are the host's, and the realm has no blob store.", requiredOperation: "a host-held blob store" },
    ],
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
