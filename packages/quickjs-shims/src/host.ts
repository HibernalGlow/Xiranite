/**
 * The only file in this package that talks to the Rust host.
 *
 * The host installs exactly one global before a node bundle is evaluated (ADR-0074 decision 2: every
 * machine-dependent answer comes from the host, and there is only one implementation of it):
 *
 * ```js
 * globalThis.__xrh = {
 *   call(op, jsonArgs) -> jsonString,             // synchronous host operation
 *   callAsync(op, jsonArgs) -> Promise<string>,   // host settles it later; the engine pumps jobs
 *   now() -> "2023-11-14T22:13:20.000Z",          // host clock, one spelling
 *   platform: { platform, arch, sep, pathSep, cwd, env /* json string *\/ }
 * }
 * ```
 *
 * Errors are data, never engine traps: every failure this layer raises is a `QuickJsShimError` carrying a
 * stable `code`, so a node's `catch` and the host's `PluginError` mapping can both read it.
 */

/** Global key the host owns. Kept in one place so a rename cannot drift across eight modules. */
export const HOST_GLOBAL_KEY = "__xrh"

/**
 * Stable error codes. A node may branch on these and the host may log on these; nothing else in this package
 * throws a bare `Error` with a made-up code.
 */
export const SHIM_ERROR_CODES = {
  /** `__xrh` was never installed: the bundle is running outside the QuickJS host. */
  hostMissing: "quickjs-shim-host-missing",
  /** The member exists in Node but this shim does not implement it (see README). */
  memberUnsupported: "quickjs-shim-member-unsupported",
  /** The shim called an operation the host does not serve (operations v1 is a closed list). */
  operationUnsupported: "quickjs-shim-operation-unsupported",
  /** The host answered with an error object / threw. */
  hostRejected: "quickjs-shim-host-rejected",
  /** The host answered, but not with the shape this protocol pins. */
  hostResultInvalid: "quickjs-shim-host-result-invalid",
  /** A Node signature this shim cannot honour (a non-utf8 `encoding`, a binary `Buffer` payload, ...). */
  signatureUnsupported: "quickjs-shim-signature-unsupported",
} as const

export type ShimErrorCode = (typeof SHIM_ERROR_CODES)[keyof typeof SHIM_ERROR_CODES]

export class QuickJsShimError extends Error {
  /**
   * Node's own error field. It carries a `quickjs-shim-*` code when the refusal is the shim's (an unwired
   * member, an unusable signature, a missing host operation) and a Node errno (`ENOENT`, `EEXIST`, `EACCES`)
   * when the host refused for a condition Node names — because every retained node's `platform.ts` branches on
   * `err.code`, and a shim code there would read as "some other error". The original shim code stays in
   * `details.shimCode`.
   */
  readonly code: ShimErrorCode | string
  readonly details?: Record<string, unknown>

  constructor(code: ShimErrorCode | string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = "QuickJsShimError"
    this.code = code
    if (details !== undefined) this.details = details
  }
}

/**
 * Host refusal text → Node's errno, for the conditions Node itself reports.
 *
 * Only phrases the host is documented to produce and that this layer has observed (`spikes/fs-ops-realm-probe`):
 * `filesystem.rs:426` answers "the destination already exists" for `fs.copy` with `force: false`, and the grant
 * check answers "the path is outside the authorized roots" for every widened fs operation. Anything else keeps
 * its message and a shim code — inventing an errno for text this layer has not seen would be exactly the fake
 * answer the plugin-API contract forbids.
 */
const HOST_REFUSAL_ERRNOS: readonly { readonly pattern: RegExp; readonly errno: string }[] = [
  { pattern: /destination already exists/i, errno: "EEXIST" },
  { pattern: /outside the authorized roots/i, errno: "EACCES" },
]

/**
 * Operations v1 — the closed list the host answers. This array is the contract; `scripts/audit-node-bundles.ts`
 * fails if a shim module claims any operation outside it. Spelled once here and mirrored in `host_calls.rs`.
 */
export const OPERATIONS_V1 = [
  "fs.stat",
  "fs.list",
  "fs.readText",
  "fs.writeText",
  "fs.ensureDir",
  "fs.move",
  "fs.delete",
  // Answered by the executor since it widened `fs_operations`, and wired here as of this list: a member that
  // needs one now makes a call instead of throwing. All of these go through the granted filesystem, so a host
  // without a grant refuses them (`fs_operations.rs:292-298`) — that refusal is the host's answer, not a check
  // duplicated in JS.
  "fs.mkdtemp",
  "fs.copy",
  "fs.appendText",
  "fs.utimes",
  "fs.link",
  "fs.symlink",
  "fs.readlink",
  "fs.realpath",
  "proc.exec",
  "clock.now",
  "crypto.randomUUID",
  "crypto.randomBytes",
  "os.tmpdir",
  "os.homedir",
  // The host answers `{ count, cpus: [{ model, speed, logical }] }` — there is no per-CPU `times`, so `os.ts`
  // hands back the list it is given rather than inventing idle/user counters.
  "os.cpus",
  // The one door to a host service. Its own arguments carry the domain vocabulary
  // (`{ service, method, args }`), so a node's engine never adds members to this list.
  "service.invoke",
] as const

export type OperationV1 = (typeof OPERATIONS_V1)[number]

/**
 * What a member would still need. As of this wiring the list is no longer a set of *requests* — the host answers
 * every entry below — it is the set the shim layer has not reached yet, each one blocked on a shape rather than
 * on an implementation:
 * - the three byte ops need `__xrh.callBytes` / `__xrh.sendBytes`, which the realm already installs
 *   (`shims.rs:101-128`) but `XiraniteHostBridge` above does not declare, so `readFile`/`writeFile` stay
 *   text-only and `crypto.createHash` still throws;
 * - `proc.spawn`/`poll`/`wait`/`kill` answer a numeric handle and an offset-capped transcript window, while a
 *   realm `ChildProcess` needs a stream/descriptor shape — a design step, not a wrapper;
 * - `fs.readRange`/`closeHandle`, `fs.mkdirExclusive`, `fs.access` and a host-held line stream are genuinely
 *   not served, and the members that want them say so in `surface.ts`.
 */
export const OPERATIONS_V2_REQUESTED = [
  "fs.readBytes(path, {offset?, length?}) -> Uint8Array    // binary file content; NOT base64-in-JSON",
  "fs.writeBytes(path, bytes, { append? }) -> { written, byteLength }",
  "crypto.digest(algorithm, bytes) -> { algorithm, hex, byteLength }  // host carries sha1/sha256",
  "proc.spawn(program, args, { cwd }) -> { handle, pid, program }     // + proc.poll/wait/kill by handle",
] as const

export interface HostPlatformInfo {
  /** Node's spelling: `win32` | `darwin` | `linux` | ... */
  platform: string
  arch: string
  /** File-system separator: `\` on Windows. */
  sep: string
  /** PATH list separator: `;` on Windows. */
  pathSep: string
  cwd: string
  /** JSON object string, e.g. `{"PATH":"/usr/bin"}`. */
  env: string
}

export interface XiraniteHost {
  call(op: string, jsonArgs: string): string
  callAsync?(op: string, jsonArgs: string): Promise<string>
  now?(): string
  platform: HostPlatformInfo
}

/** Reads the host or fails loudly: a bundle loaded outside the host must not half-work. */
export function host(): XiraniteHost {
  const candidate = (globalThis as Record<string, unknown>)[HOST_GLOBAL_KEY] as XiraniteHost | undefined
  if (
    candidate === undefined ||
    candidate === null ||
    typeof candidate.call !== "function" ||
    typeof candidate.platform !== "object" ||
    candidate.platform === null
  ) {
    throw new QuickJsShimError(
      SHIM_ERROR_CODES.hostMissing,
      `globalThis.${HOST_GLOBAL_KEY} is not installed: these shims only run inside the Xiranite QuickJS host.`,
      { expected: ["call", "callAsync", "now", "platform"] },
    )
  }
  return candidate
}

/** True once the host is present, for the few places that can degrade instead of throwing. */
export function hasHost(): boolean {
  const candidate = (globalThis as Record<string, unknown>)[HOST_GLOBAL_KEY] as XiraniteHost | undefined
  return candidate !== undefined && candidate !== null && typeof candidate.call === "function" && typeof candidate.platform === "object"
}

/**
 * The neutral answer used only where a *value* export must exist at module-init time (`path.sep`, `os.EOL`,
 * `fs.constants`): ESM cannot export a lazy value, and the audit tooling imports these modules in a process
 * that has no host. Inside a realm the host is installed first (the executor's documented order), so node code
 * never sees the POSIX fallback.
 */
export const FALLBACK_PLATFORM_INFO: HostPlatformInfo = { platform: "linux", arch: "unknown", sep: "/", pathSep: ":", cwd: "/", env: "{}" }

let cachedPlatform: HostPlatformInfo | undefined
let cachedEnv: Record<string, string> | undefined

export function platformInfo(): HostPlatformInfo {
  cachedPlatform ??= host().platform
  return cachedPlatform
}

/** Host platform facts without throwing when the host is absent (module-init value exports only). */
export function platformInfoOrFallback(): HostPlatformInfo {
  return hasHost() ? platformInfo() : FALLBACK_PLATFORM_INFO
}

/** True when the host reports Windows. Path, url and child_process branch on this. */
export function isWindows(): boolean {
  return platformInfo().platform === "win32"
}

/**
 * `env` arrives as a JSON string because the pinned envelope is JSON. Parsed once: the host owns the process
 * environment, so it cannot change mid-run inside this realm.
 */
export function hostEnv(): Record<string, string> {
  if (cachedEnv !== undefined) return cachedEnv
  const raw = platformInfo().env
  if (typeof raw !== "string" || raw.length === 0) {
    cachedEnv = {}
    return cachedEnv
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw new QuickJsShimError(SHIM_ERROR_CODES.hostResultInvalid, `__xrh.platform.env is not valid JSON: ${String(cause)}`)
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new QuickJsShimError(SHIM_ERROR_CODES.hostResultInvalid, "__xrh.platform.env must be a JSON object.")
  }
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    out[key] = value === null || value === undefined ? "" : String(value)
  }
  cachedEnv = out
  return out
}

/** Host wall clock in ISO-8601 UTC, the one spelling the journals already record. */
export function hostNowIso(): string {
  const h = host()
  if (typeof h.now !== "function") {
    throw new QuickJsShimError(SHIM_ERROR_CODES.operationUnsupported, "the host did not install __xrh.now(); operations v1 require clock.now.")
  }
  return h.now()
}

/** Host wall clock in epoch milliseconds, read from the one clock (`__xrh.now`), never `Date.now()`. */
export function hostNowMs(): number {
  const ms = Date.parse(hostNowIso())
  if (Number.isNaN(ms)) {
    throw new QuickJsShimError(SHIM_ERROR_CODES.hostResultInvalid, `__xrh.now() returned a non-ISO timestamp: ${JSON.stringify(hostNowIso())}`)
  }
  return ms
}

export function unsupportedOperation(op: string, why: string): QuickJsShimError {
  return new QuickJsShimError(
    SHIM_ERROR_CODES.operationUnsupported,
    `the host does not serve operation ${JSON.stringify(op)} (${why}). Operations v1 are: ${OPERATIONS_V1.join(" ")}.`,
    { operation: op, requested: [...OPERATIONS_V2_REQUESTED] },
  )
}

/**
 * Parses one host answer. Envelope rules this layer requires (and the README states):
 * - a plain JSON value is the success payload;
 * - `{ ok: true, value }` / `{ ok: false, ...message }` are also accepted (a Rust host serialises a `Result`);
 * - the string `"__UNSUPPORTED__"` is the host's way to say it does not serve the op.
 */
export function decodeHostResult(op: string, raw: string): unknown {
  if (raw === "__UNSUPPORTED__") throw unsupportedOperation(op, "the host answered __UNSUPPORTED__")
  let payload: unknown
  try {
    payload = raw.length === 0 ? null : JSON.parse(raw)
  } catch (cause) {
    throw new QuickJsShimError(SHIM_ERROR_CODES.hostResultInvalid, `host operation ${op} returned a body that is not valid JSON: ${String(cause)}`)
  }
  if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>
    if (record["ok"] === false) {
      const message = typeof record["message"] === "string" ? record["message"] : JSON.stringify(payload)
      const errno = hostErrno(message)
      throw new QuickJsShimError(errno ?? SHIM_ERROR_CODES.hostRejected, `host operation ${op} failed: ${message}`, {
        operation: op,
        details: record,
        ...(errno === undefined ? {} : { shimCode: SHIM_ERROR_CODES.hostRejected, errno }),
      })
    }
    if (record["ok"] === true && "value" in record) return record["value"]
  }
  return payload
}

function asShimError(op: string, cause: unknown): QuickJsShimError {
  if (cause instanceof QuickJsShimError) return cause
  const message = cause instanceof Error ? cause.message : String(cause)
  if (/unknown host operation|unsupported|not implemented/i.test(message)) return unsupportedOperation(op, message)
  return refused(op, message)
}

function hostErrno(message: string): string | undefined {
  return HOST_REFUSAL_ERRNOS.find((entry) => entry.pattern.test(message))?.errno
}

function refused(op: string, message: string, details?: Record<string, unknown>): QuickJsShimError {
  const errno = hostErrno(message)
  return new QuickJsShimError(errno ?? SHIM_ERROR_CODES.hostRejected, `host operation ${op} threw: ${message}`, {
    operation: op,
    ...(errno === undefined ? {} : { shimCode: SHIM_ERROR_CODES.hostRejected, errno }),
    ...(details === undefined ? {} : details),
  })
}

/** Named-parameter JSON envelope; see `ops.ts` for the argument names of each operation. */
export function hostCall(op: string, args: unknown): unknown {
  let raw: string
  try {
    raw = host().call(op, JSON.stringify(args ?? {}))
  } catch (cause) {
    throw asShimError(op, cause)
  }
  return decodeHostResult(op, raw)
}

/**
 * Async host call. `callAsync` is pinned, but a host that only installs the synchronous entry still works:
 * the same op is called through `call` and wrapped, because the operation itself is identical.
 */
export async function hostCallAsync(op: string, args: unknown): Promise<unknown> {
  const h = host()
  if (typeof h.callAsync === "function") {
    let raw: string
    try {
      raw = await h.callAsync(op, JSON.stringify(args ?? {}))
    } catch (cause) {
      throw asShimError(op, cause)
    }
    return decodeHostResult(op, raw)
  }
  return hostCall(op, args)
}

/* ------------------------------------------------------------------ bytes over JSON ------------------------------ */

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

function hexToBytes(value: string): Uint8Array {
  const clean = value.length % 2 === 0 ? value : value.slice(0, value.length - 1)
  const out = new Uint8Array(Math.floor(clean.length / 2))
  for (let index = 0; index < out.length; index += 1) {
    const byte = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16)
    if (Number.isNaN(byte)) {
      throw new QuickJsShimError(SHIM_ERROR_CODES.hostResultInvalid, `host returned a non-hex byte string: ${JSON.stringify(value)}`)
    }
    out[index] = byte
  }
  return out
}

function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replace(/[^A-Za-z0-9+/]/g, "")
  const out = new Uint8Array(Math.floor((normalized.length * 3) / 4))
  let buffer = 0
  let bits = 0
  let written = 0
  for (const character of normalized) {
    const index = BASE64_ALPHABET.indexOf(character)
    if (index < 0) continue
    buffer = (buffer << 6) | index
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[written] = (buffer >> bits) & 0xff
      written += 1
    }
  }
  return written === out.length ? out : out.subarray(0, written)
}

/**
 * Random bytes arrive inside a JSON string because that is what the pinned envelope carries; the host answers
 * `crypto.randomBytes` as hex. This is the one deliberate exception to "bytes cross as bytes" (ADR-0074
 * decision 2): it is a nonce, not a file payload, so the base64 tax is paid on a few dozen bytes. File content
 * never crosses here — `fs.readBytes` is requested as a byte operation, never a base64 path (that is ADR-0071's
 * retired failure mode).
 */
export function bytesFromHostPayload(value: unknown, expectedLength?: number): Uint8Array {
  let bytes: Uint8Array
  if (typeof value === "string") bytes = /[^0-9a-fA-F]/.test(value) || value.length % 2 !== 0 ? base64ToBytes(value) : hexToBytes(value)
  else if (value instanceof Uint8Array) bytes = value
  else if (Array.isArray(value) && value.every((item) => typeof item === "number")) bytes = Uint8Array.from(value as number[])
  else if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>
    if (typeof record["hex"] === "string") bytes = hexToBytes(record["hex"])
    else if (typeof record["base64"] === "string") bytes = base64ToBytes(record["base64"])
    else throw new QuickJsShimError(SHIM_ERROR_CODES.hostResultInvalid, "host byte result must carry `hex` or `base64`.")
  } else throw new QuickJsShimError(SHIM_ERROR_CODES.hostResultInvalid, `host byte result has an unusable type: ${typeof value}`)
  if (expectedLength !== undefined && bytes.length !== expectedLength) {
    throw new QuickJsShimError(SHIM_ERROR_CODES.hostResultInvalid, `host returned ${bytes.length} byte(s) where ${expectedLength} were requested.`, {
      requested: expectedLength,
      received: bytes.length,
    })
  }
  return bytes
}

export function bytesToUtf8(bytes: Uint8Array): string {
  // Hand-rolled UTF-8 decode: QuickJS ships TextDecoder only when the host enables it, and host byte results
  // are valid UTF-8 by contract.
  let output = ""
  let index = 0
  const end = bytes.length
  while (index < end) {
    const first = bytes[index]!
    if (first < 0x80) {
      output += String.fromCharCode(first)
      index += 1
      continue
    }
    let codePoint: number
    if ((first & 0xe0) === 0xc0) {
      codePoint = ((first & 0x1f) << 6) | (bytes[index + 1]! & 0x3f)
      index += 2
    } else if ((first & 0xf0) === 0xe0) {
      codePoint = ((first & 0x0f) << 12) | ((bytes[index + 1]! & 0x3f) << 6) | (bytes[index + 2]! & 0x3f)
      index += 3
    } else {
      codePoint = ((first & 0x07) << 18) | ((bytes[index + 1]! & 0x3f) << 12) | ((bytes[index + 2]! & 0x3f) << 6) | (bytes[index + 3]! & 0x3f)
      index += 4
    }
    if (codePoint >= 0x10000) {
      const offset = codePoint - 0x10000
      output += String.fromCharCode(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff))
    } else {
      output += String.fromCharCode(codePoint)
    }
  }
  return output
}

export function utf8ToBytes(text: string): Uint8Array {
  const out: number[] = []
  for (const character of text) {
    const codePoint = character.codePointAt(0)!
    if (codePoint < 0x80) out.push(codePoint)
    else if (codePoint < 0x800) out.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f))
    else if (codePoint < 0x10000) out.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f))
    else out.push(0xf0 | (codePoint >> 18), 0x80 | ((codePoint >> 12) & 0x3f), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f))
  }
  return Uint8Array.from(out)
}

export function bytesToLatin1(bytes: Uint8Array): string {
  let output = ""
  for (const byte of bytes) output += String.fromCharCode(byte)
  return output
}

export function latin1ToBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let index = 0; index < text.length; index += 1) out[index] = text.charCodeAt(index) & 0xff
  return out
}

export function bytesToHex(bytes: Uint8Array): string {
  let output = ""
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0")
  return output
}

export function bytesToBase64(bytes: Uint8Array): string {
  let output = ""
  for (let index = 0; index < bytes.length; index += 3) {
    const chunk = bytes.subarray(index, Math.min(index + 3, bytes.length))
    const value = (chunk[0]! << 16) | ((chunk[1] ?? 0) << 8) | (chunk[2] ?? 0)
    output += BASE64_ALPHABET[(value >> 18) & 0x3f]
    output += BASE64_ALPHABET[(value >> 12) & 0x3f]
    output += chunk.length > 1 ? BASE64_ALPHABET[(value >> 6) & 0x3f] : "="
    output += chunk.length > 2 ? BASE64_ALPHABET[value & 0x3f] : "="
  }
  return output
}
