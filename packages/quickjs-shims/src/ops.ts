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
import { hostCall, hostCallAsync } from "./host.ts"

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
  "proc.exec": "proc.exec(program: string, args: string[], { cwd?, env?, timeoutMs?, maxBufferBytes? }) -> { exitCode, stdout, stderr, success, signal, truncated }",
  "clock.now": "clock.now() -> ISO-8601 UTC string (installed as __xrh.now; the shims read the clock through it)",
  "crypto.randomUUID": "crypto.randomUUID() -> string",
  "crypto.randomBytes": "crypto.randomBytes(length: number) -> hex string",
  "os.tmpdir": "os.tmpdir() -> string",
  "os.homedir": "os.homedir() -> string (the host's HOME / USERPROFILE; refused when the environment has none)",
  "service.invoke": "service.invoke(service: string, method: string, args: object) -> the service's own document (refused unless the node declared the service)",
}
