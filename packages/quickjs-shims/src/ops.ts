/**
 * Operations v1 — the parameter and answer names pinned against the host implementation in
 * `crates/xiranite-quickjs-executor/src/host_calls.rs`.
 *
 * Every shim that touches the machine calls through here, so the wire shape of the whole substrate is one
 * file. Parameters are **named JSON** (`{ "path": ... }`), not positional (ADR-0074 decision 1): a named
 * envelope lets the host add an option without renumbering every call site. The answer field names below
 * mirror the executor's `json!({...})` object keys exactly, so a shim that reads `result.content` matches a
 * host that writes `"content"`.
 *
 * No operation outside the closed v1 list is wrapped here. A member that would need one is exported as a
 * throwing `notImplemented` function, not a call to an operation this host does not answer.
 */
import { Buffer } from "./buffer.ts"
import { hostCall, hostCallAsync, hostCallBytes, hostCallBytesAsync, hostSendBytes, hostSendBytesAsync } from "./host.ts"

/** The `fs.stat` answer. `exists` is always present; `kind`/`size`/times are optional host enrichments. */
export interface FsStatResult {
  path: string
  exists?: boolean
  isFile?: boolean
  isDirectory?: boolean
  /** The host's `lstat` truth for a link; the grant arm answers it, the seam-only arm answers null. */
  isSymlink?: boolean | null
  /** Optional richer shape the host may add: `"file" | "dir" | "symlink" | "other"`. */
  kind?: string
  /** The host's wire spelling (`fs_operations.rs`'s `sizeBytes`); `size` stays accepted. */
  sizeBytes?: number | null
  size?: number
  mtimeMs?: number
  atimeMs?: number
  ctimeMs?: number
  birthtimeMs?: number
  mode?: number
}

export interface FsListEntry {
  name: string
  path?: string
  isFile?: boolean
  isDirectory?: boolean
  kind?: string
}

export interface ProcExecResult {
  /** The executor answers `exitCode` (a host that killed the child still answers a number, never a throw). */
  exitCode: number | null
  stdout: string
  stderr: string
  success?: boolean
  signal?: string | null
  truncated?: boolean
  /** True when the host refused the program (external-program allowlist). */
  rejected?: boolean
}

export interface ExecFileOptionsPayload {
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
  maxBufferBytes?: number
  encoding?: string
  windowsHide?: boolean
}

/** `fs.stat(path)` — does the path exist inside the grant, and what kind is it. */
export function opFsStat(path: string): FsStatResult {
  return hostCall("fs.stat", { path }) as FsStatResult
}

export async function opFsStatAsync(path: string): Promise<FsStatResult> {
  return (await hostCallAsync("fs.stat", { path })) as FsStatResult
}

/** `fs.list(path, { recursive?, limit? })` — one directory level (recursive is the host's enumeration tier). */
export function opFsList(path: string, options: { recursive?: boolean; limit?: number } = {}): { entries: FsListEntry[] } {
  return hostCall("fs.list", { path, ...options }) as { entries: FsListEntry[] }
}

export async function opFsListAsync(path: string, options: { recursive?: boolean; limit?: number } = {}): Promise<{ entries: FsListEntry[] }> {
  return (await hostCallAsync("fs.list", { path, ...options })) as { entries: FsListEntry[] }
}

/** `fs.readText(path)` — `content` is JSON null when the host has no document there. */
export function opFsReadText(path: string): { path: string; content: string | null } {
  return hostCall("fs.readText", { path }) as { path: string; content: string | null }
}

export async function opFsReadTextAsync(path: string): Promise<{ path: string; content: string | null }> {
  return (await hostCallAsync("fs.readText", { path })) as { path: string; content: string | null }
}

/** `fs.writeText(path, content)` — creating the parent is the host's job (`fs.write_text`). */
export function opFsWriteText(path: string, content: string): void {
  hostCall("fs.writeText", { path, content })
}

export async function opFsWriteTextAsync(path: string, content: string): Promise<void> {
  await hostCallAsync("fs.writeText", { path, content })
}

/** `fs.ensureDir(path)` — mkdir -p, idempotent. */
export function opFsEnsureDir(path: string): void {
  hostCall("fs.ensureDir", { path })
}

export async function opFsEnsureDirAsync(path: string): Promise<void> {
  await hostCallAsync("fs.ensureDir", { path })
}

/** `fs.move(source, target)` — the executor reads `source`/`target` and owns the granted-root check. */
export function opFsMove(source: string, target: string): void {
  hostCall("fs.move", { source, target })
}

export async function opFsMoveAsync(source: string, target: string): Promise<void> {
  await hostCallAsync("fs.move", { source, target })
}

/** `fs.delete(path, { recursive })` — covers both `unlink` and `rm`. */
export function opFsDelete(path: string, recursive = false): void {
  hostCall("fs.delete", { path, recursive })
}

export async function opFsDeleteAsync(path: string, recursive = false): Promise<void> {
  await hostCallAsync("fs.delete", { path, recursive })
}

/**
 * `fs.mkdtemp(prefix)` — the host makes a unique directory next to `prefix` and answers its path. The parent has
 * to exist (`filesystem.rs:704-708`), which is Node's own requirement.
 */
export function opFsMkdtemp(prefix: string): { path: string; created: boolean } {
  return hostCall("fs.mkdtemp", { prefix }) as { path: string; created: boolean }
}

export async function opFsMkdtempAsync(prefix: string): Promise<{ path: string; created: boolean }> {
  return (await hostCallAsync("fs.mkdtemp", { prefix })) as { path: string; created: boolean }
}

/**
 * `fs.copy(source, target, { recursive?, force? })`.
 *
 * The host's `force` defaults to **true** (`fs_operations.rs:85-91`), which is Node's `cp` default but *not*
 * `copyFile`'s — `copyFile` fails when the destination exists. Every caller here passes the flag explicitly so
 * the two members cannot inherit the host's default by accident.
 */
export interface FsCopyResult {
  source: string
  target: string
  copied: boolean
  recursive: boolean
}

export function opFsCopy(source: string, target: string, options: { recursive?: boolean; force?: boolean } = {}): FsCopyResult {
  return hostCall("fs.copy", { source, target, recursive: options.recursive ?? false, force: options.force ?? true }) as FsCopyResult
}

export async function opFsCopyAsync(source: string, target: string, options: { recursive?: boolean; force?: boolean } = {}): Promise<FsCopyResult> {
  return (await hostCallAsync("fs.copy", { source, target, recursive: options.recursive ?? false, force: options.force ?? true })) as FsCopyResult
}

/** `fs.appendText(path, content)` — text only; the byte twin is `fs.writeBytes` with `append`. */
export function opFsAppendText(path: string, content: string): { path: string; appended: boolean; byteLength: number } {
  return hostCall("fs.appendText", { path, content }) as { path: string; appended: boolean; byteLength: number }
}

export async function opFsAppendTextAsync(path: string, content: string): Promise<{ path: string; appended: boolean; byteLength: number }> {
  return (await hostCallAsync("fs.appendText", { path, content })) as { path: string; appended: boolean; byteLength: number }
}

/**
 * `fs.utimes(path, atimeMs, mtimeMs)` — **epoch milliseconds**, both required (`fs_operations.rs:108,301-309`).
 *
 * Node's own `utimes(path, atime, mtime)` takes a `Date`, a date string, or a number of **seconds** (measured on
 * Node 26: `utimesSync(f, 1000, 2000)` leaves `mtimeMs` at `2000000`). Passing Node's number straight through
 * would set every timestamp 1000× early and still report success, so the conversion lives in
 * `utimesToEpochMs` in `internal.ts` and both fs faces call it.
 */
export function opFsUtimes(path: string, atimeMs: number, mtimeMs: number): { path: string; set: boolean; atimeMs: number; mtimeMs: number } {
  return hostCall("fs.utimes", { path, atimeMs, mtimeMs }) as { path: string; set: boolean; atimeMs: number; mtimeMs: number }
}

export async function opFsUtimesAsync(path: string, atimeMs: number, mtimeMs: number): Promise<{ path: string; set: boolean; atimeMs: number; mtimeMs: number }> {
  return (await hostCallAsync("fs.utimes", { path, atimeMs, mtimeMs })) as { path: string; set: boolean; atimeMs: number; mtimeMs: number }
}

/** `fs.link(source, target)` — a hard link; `source` must already exist inside the grant. */
export function opFsLink(source: string, target: string): { source: string; target: string; linked: boolean } {
  return hostCall("fs.link", { source, target }) as { source: string; target: string; linked: boolean }
}

export async function opFsLinkAsync(source: string, target: string): Promise<{ source: string; target: string; linked: boolean }> {
  return (await hostCallAsync("fs.link", { source, target })) as { source: string; target: string; linked: boolean }
}

/**
 * `fs.symlink(target, path, type)` — `target` is the **stored text**, `path` is where the link appears, matching
 * Node's argument order. The host answers `"file"` (default) and `"dir"` and refuses `"junction"`
 * (`fs_operations.rs:156-161`); POSIX ignores the flag.
 *
 * One divergence from Node, measured in `spikes/fs-ops-realm-probe`: the host runs the **target text** through the
 * granted-roots check, so `symlink("note.txt", link)` — legal and common in Node, where the string is only stored
 * — comes back `the path is outside the authorized roots` (→ `EACCES`). An absolute target inside the granted
 * root is answered. This is the host's capability decision, not a shim rule: a link pointing out of the grant
 * would let a later operation resolve outside it. `linku` is the node that builds relative links most, so it will
 * meet this and must ask for absolute targets or a host-side link policy.
 */
export function opFsSymlink(target: string, path: string, type?: string): { target: string; path: string; linked: boolean; type: string } {
  return hostCall("fs.symlink", { target, path, ...(type === undefined ? {} : { type }) }) as { target: string; path: string; linked: boolean; type: string }
}

export async function opFsSymlinkAsync(target: string, path: string, type?: string): Promise<{ target: string; path: string; linked: boolean; type: string }> {
  return (await hostCallAsync("fs.symlink", { target, path, ...(type === undefined ? {} : { type }) })) as { target: string; path: string; linked: boolean; type: string }
}

/** `fs.readlink(path)` — the stored target text, verbatim (not resolved). */
export function opFsReadlink(path: string): { path: string; target: string } {
  return hostCall("fs.readlink", { path }) as { path: string; target: string }
}

export async function opFsReadlinkAsync(path: string): Promise<{ path: string; target: string }> {
  return (await hostCallAsync("fs.readlink", { path })) as { path: string; target: string }
}

/** `fs.realpath(path)` — the canonical path; the host refuses one that resolves outside every granted root. */
export function opFsRealpath(path: string): { path: string; realPath: string } {
  return hostCall("fs.realpath", { path }) as { path: string; realPath: string }
}

export async function opFsRealpathAsync(path: string): Promise<{ path: string; realPath: string }> {
  return (await hostCallAsync("fs.realpath", { path })) as { path: string; realPath: string }
}

/**
 * `fs.readBytes(path, { offset?, length? })` — the file's bytes over the byte channel (`__xrh.callBytes`), never
 * base64 inside the JSON envelope. `null` is the host's lenient "no document there" answer, the same shape
 * `fs.readText` gives as `content: null`; an offset past EOF answers an **empty** buffer (`filesystem.rs:477-513`).
 */
export function opFsReadBytes(path: string, options: { offset?: number; length?: number } = {}): Uint8Array | null {
  return hostCallBytes("fs.readBytes", { path, ...options })
}

export async function opFsReadBytesAsync(path: string, options: { offset?: number; length?: number } = {}): Promise<Uint8Array | null> {
  return hostCallBytesAsync("fs.readBytes", { path, ...options })
}

/** `fs.writeBytes(path, bytes, { append? })` — payload out through `__xrh.sendBytes`. */
export function opFsWriteBytes(path: string, bytes: Uint8Array, options: { append?: boolean } = {}): { path: string; written: boolean; byteLength: number; append: boolean } {
  return hostSendBytes("fs.writeBytes", { path, append: options.append ?? false }, bytes) as { path: string; written: boolean; byteLength: number; append: boolean }
}

export async function opFsWriteBytesAsync(path: string, bytes: Uint8Array, options: { append?: boolean } = {}): Promise<{ path: string; written: boolean; byteLength: number; append: boolean }> {
  return (await hostSendBytesAsync("fs.writeBytes", { path, append: options.append ?? false }, bytes)) as { path: string; written: boolean; byteLength: number; append: boolean }
}

/**
 * `crypto.digest(algorithm, bytes)` — one hash, answered by the host's own `sha1`/`sha256` (`digest.rs:46-53`).
 *
 * The bytes cross as a payload, and the hex comes back in text: a JS SHA here alongside Rust's `sha2` there would
 * be two implementations of one contract, which is why `createHash` buffers and asks instead of hashing locally.
 * An algorithm the host does not answer is refused **by name** with the list it does answer
 * (`host_calls.rs:374-379`), so an unsupported spelling fails loudly.
 */
export function opCryptoDigest(algorithm: string, bytes: Uint8Array): { algorithm: string; hex: string; byteLength: number } {
  return hostSendBytes("crypto.digest", { algorithm }, bytes) as { algorithm: string; hex: string; byteLength: number }
}

export async function opCryptoDigestAsync(algorithm: string, bytes: Uint8Array): Promise<{ algorithm: string; hex: string; byteLength: number }> {
  return (await hostSendBytesAsync("crypto.digest", { algorithm }, bytes)) as { algorithm: string; hex: string; byteLength: number }
}

/**
 * `proc.spawn(program, args, { cwd? })` — starts the program and returns immediately with a **numeric handle**.
 *
 * The host keeps at most 4 MiB of transcript per stream per live child (`machine.rs:49`) and `proc.poll` answers a
 * 262 144-byte window with a `truncated` flag (`proc_operations.rs:41,175-189`). That is why this layer only hands
 * the handle to callers that asked for `stdio: "ignore"`: a piped `ChildProcess` in Node has unbounded backpressure
 * semantics, and translating those into a capped window would be a fake (a reader would silently lose bytes past
 * the cap). `packages/nodes/bandia/src/platform.ts:153` is the measured realm caller — a detached launcher that
 * never reads output.
 */
export interface ProcSpawnResult {
  handle: number
  pid: number
  program: string
}

export function opProcSpawn(program: string, args: string[], options: { cwd?: string } = {}): ProcSpawnResult {
  return hostCall("proc.spawn", { program, args, ...options }) as ProcSpawnResult
}

/** `proc.wait(handle, { since? })` — blocks inside the host until the child exits, then answers the final report. */
export interface ProcReport {
  running: boolean
  exitCode: number | null
  signal: number | null
  success: boolean | null
  stdout: string
  stderr: string
  stdoutOffset: number
  stderrOffset: number
  truncated: boolean
}

export function opProcWait(handle: number, since = 0): ProcReport {
  return hostCall("proc.wait", { handle, since }) as ProcReport
}

export async function opProcWaitAsync(handle: number, since = 0): Promise<ProcReport> {
  return (await hostCallAsync("proc.wait", { handle, since })) as ProcReport
}

/** `proc.kill(handle)` — the host's own signal path; answers whether a live child was found under the handle. */
export function opProcKill(handle: number): { handle: number; killed: boolean } {
  return hostCall("proc.kill", { handle }) as { handle: number; killed: boolean }
}

/**
 * `os.cpus()` — `{ count, cpus: [{ model, speed, logical }] }`.
 *
 * There is no `times` in the host's answer: per-CPU user/nice/sys/idle/irq counters are not collected anywhere
 * in the realm's process, so `os.ts` returns what the host says instead of padding the shape with zeros.
 */
export interface OsCpuInfo {
  model: string
  speed: number
  logical?: boolean
}

export function opOsCpus(): { count: number; cpus: OsCpuInfo[] } {
  return hostCall("os.cpus", {}) as { count: number; cpus: OsCpuInfo[] }
}

export async function opOsCpusAsync(): Promise<{ count: number; cpus: OsCpuInfo[] }> {
  return (await hostCallAsync("os.cpus", {})) as { count: number; cpus: OsCpuInfo[] }
}

/**
 * The wire-layer decision shared by both fs faces: does this data argument belong on the **byte** channel?
 *
 * `Uint8Array`/`Buffer` always do (bytes never ride the JSON envelope, ADR-0071), and a string does when the
 * caller asked for a code page other than utf8 — the bytes are produced by `Buffer`, which is upstream's
 * encoder, not a second one here. Returning `null` means "the text path can carry this", so the caller uses
 * `fs.writeText`/`fs.appendText`. This lives in one place because a member must not be byte-capable on one face
 * and text-only on the other.
 */
export function payloadBytes(data: unknown, encoding: string | undefined): Uint8Array | null {
  if (data instanceof Uint8Array) return data
  if (typeof data !== "string") return null
  const normalized = encoding?.toLowerCase()
  if (normalized === undefined || normalized === "utf8" || normalized === "utf-8") return null
  return Buffer.from(data, encoding as never)
}

/** `proc.exec(program, args, { cwd?, env?, timeoutMs?, maxBufferBytes? })` — the executor reads `program`. */
export function opProcExec(program: string, args: string[], options: ExecFileOptionsPayload = {}): ProcExecResult {
  return hostCall("proc.exec", { program, args, ...options }) as ProcExecResult
}

export async function opProcExecAsync(program: string, args: string[], options: ExecFileOptionsPayload = {}): Promise<ProcExecResult> {
  return (await hostCallAsync("proc.exec", { program, args, ...options })) as ProcExecResult
}

/** `crypto.randomUUID()` -> string. */
export function opRandomUUID(): string {
  return String(hostCall("crypto.randomUUID", {}))
}

/** `crypto.randomBytes(length)` -> hex string (bounded by the host), decoded by `bytesFromHostPayload`. */
export function opRandomBytes(length: number): unknown {
  return hostCall("crypto.randomBytes", { length })
}

/** `os.tmpdir()` -> string. */
export function opTmpdir(): string {
  return String(hostCall("os.tmpdir", {}))
}

/** `os.homedir()` -> string, read from the host's own `HOME` / `USERPROFILE`. */
export function opHomedir(): string {
  return String(hostCall("os.homedir", {}))
}

/**
 * `service.invoke(service, method, args)` -> the service's own document.
 *
 * The single door to a host service, and deliberately the only generic operation in the list: what
 * lives behind it is a node's domain engine, and the machine surface must not learn its vocabulary.
 * The host refuses a service this node did not declare, so `service` is a policy question, not a
 * discovery mechanism.
 */
export function opServiceInvoke<T>(service: string, method: string, args: unknown): T {
  return hostCall("service.invoke", { service, method, args: args ?? {} }) as T
}

/** The async form, used by a service method that waits (a scan's progress long-poll). */
export async function opServiceInvokeAsync<T>(service: string, method: string, args: unknown): Promise<T> {
  return (await hostCallAsync("service.invoke", { service, method, args: args ?? {} })) as T
}

/** The signature table the README prints; the executor's checklist in one value. */
export const OPERATION_SIGNATURES: Record<string, string> = {
  "fs.stat": "fs.stat(path: string) -> { path, exists, isFile, isDirectory, kind?, size?, mtimeMs?, atimeMs? }",
  "fs.list": "fs.list(path: string, { recursive?, limit? }) -> { entries: [{ name, path?, isFile?, isDirectory?, kind? }] }",
  "fs.readText": "fs.readText(path: string) -> { path, content: string | null }",
  "fs.writeText": "fs.writeText(path: string, content: string) -> { path, written }",
  "fs.ensureDir": "fs.ensureDir(path: string) -> { path, created }",
  "fs.move": "fs.move(source: string, target: string) -> { source, target, moved }",
  "fs.delete": "fs.delete(path: string, recursive: boolean) -> { path, deleted, recursive }",
  "fs.mkdtemp": "fs.mkdtemp(prefix: string) -> { path, created }",
  "fs.copy": "fs.copy(source: string, target: string, { recursive? = false, force? = true }) -> { source, target, copied, recursive }  // the host's force default is NOT Node's copyFile default",
  "fs.appendText": "fs.appendText(path: string, content: string) -> { path, appended, byteLength }",
  "fs.utimes": "fs.utimes(path: string, atimeMs: number, mtimeMs: number) -> { path, atimeMs, mtimeMs, set }  // epoch milliseconds; Node's number argument is seconds",
  "fs.link": "fs.link(source: string, target: string) -> { source, target, linked }",
  "fs.symlink": "fs.symlink(target: string, path: string, type? = \"file\") -> { target, path, linked, type }  // \"dir\" | \"file\"; \"junction\" is refused by the host",
  "fs.readlink": "fs.readlink(path: string) -> { path, target }  // stored text, unresolved",
  "fs.realpath": "fs.realpath(path: string) -> { path, realPath }  // refused when the canonical path leaves every granted root",
  "fs.readBytes": "fs.readBytes(path: string, { offset?, length? }) -> Uint8Array | null  // __xrh.callBytes; null = no document, empty buffer = offset past EOF, 8 MiB ceiling",
  "fs.writeBytes": "fs.writeBytes(path: string, bytes: Uint8Array, { append? = false }) -> { path, written, byteLength, append }  // __xrh.sendBytes",
  "crypto.digest": "crypto.digest(algorithm: string, bytes: Uint8Array) -> { algorithm, hex, byteLength }  // __xrh.sendBytes; the host answers sha1 and sha256 only",
  "os.cpus": "os.cpus() -> { count, cpus: [{ model, speed, logical }] }  // no per-CPU times; nothing in the realm collects them",
  "proc.exec": "proc.exec(program: string, args: string[], { cwd?, env?, timeoutMs?, maxBufferBytes? }) -> { exitCode, stdout, stderr, success, signal, truncated }",
  "proc.spawn": "proc.spawn(program: string, args: string[], { cwd? }) -> { handle: number, pid: number, program: string }  // fire-and-forget; stdio:\"ignore\" callers only",
  "proc.wait": "proc.wait(handle: number, since? = 0) -> { running, exitCode, signal, success, stdout, stderr, stdoutOffset, stderrOffset, truncated }",
  "proc.kill": "proc.kill(handle: number) -> { handle, killed }",
  "clock.now": "clock.now() -> ISO-8601 UTC string (installed as __xrh.now; the shims read the clock through it)",
  "crypto.randomUUID": "crypto.randomUUID() -> string",
  "crypto.randomBytes": "crypto.randomBytes(length: number) -> hex string",
  "os.tmpdir": "os.tmpdir() -> string",
  "os.homedir": "os.homedir() -> string (the host's HOME / USERPROFILE; refused when the environment has none)",
  "service.invoke": "service.invoke(service: string, method: string, args: object) -> the service's own document (refused unless the node declared the service)",
}
