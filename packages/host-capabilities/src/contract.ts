/**
 * The host capability surface a node's platform adapter calls.
 *
 * This is **not** a Node compatibility layer. One method answers exactly one host operation from
 * `crates/quickjs-host-protocol`, named for what it does rather than for the Node member that used to
 * spell it (`createTemp`, not `mkdtemp`; `remove`, not `rm`; `exec`, not `execFile`). Everything Promise-
 * shaped: the old surface carried a sync twin for each operation because Node did, and that doubling was
 * the single largest maintenance cost in `packages/quickjs-shims`.
 *
 * Two transports implement it:
 *
 * - `./realm.ts` — inside the embedded QuickJS host, each method is one `__xrh` call.
 * - `./node.ts`  — in the CLI/TUI faces (Node/Bun), each method is the real system call, once, here,
 *   instead of 41 node `platform.ts` files reaching `node:*` themselves.
 *
 * `path` is deliberately absent: path arithmetic is not a host operation, and putting it in this interface
 * would break the one-to-one check below. See `./path.ts`.
 */
import { HOST_OPERATION_NAMES, type HostOperationName } from "./operations.generated.ts"

export type FileKind = "file" | "dir" | "symlink" | "other"

export interface FileStat {
  path: string
  kind: FileKind
  sizeBytes: number | null
  mtimeMs: number | null
  atimeMs: number | null
}

export interface DirEntry {
  name: string
  path: string
  kind: FileKind
}

export interface ExecResult {
  /** A non-zero exit is a value, never a throw; `null` means the host killed the child. */
  exitCode: number | null
  stdout: string
  stderr: string
  truncated: boolean
}

export interface ChildStatus {
  running: boolean
  exitCode: number | null
  stdout: string
  stderr: string
  truncated: boolean
}

export interface PlatformFacts {
  platform: string
  arch: string
  sep: string
  cwd: string
  env: Record<string, string>
}

export interface HostCapabilities {
  fs: {
    stat(path: string): Promise<FileStat | null>
    list(path: string, options?: { recursive?: boolean; limit?: number }): Promise<DirEntry[]>
    readText(path: string): Promise<string | null>
    writeText(path: string, text: string): Promise<void>
    appendText(path: string, text: string): Promise<void>
    readBytes(path: string, options?: { offset?: number; length?: number }): Promise<Uint8Array | null>
    writeBytes(path: string, bytes: Uint8Array, options?: { append?: boolean }): Promise<void>
    ensureDir(path: string): Promise<void>
    createTemp(prefix: string): Promise<string>
    move(source: string, target: string): Promise<void>
    copy(source: string, target: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
    remove(path: string, options?: { recursive?: boolean }): Promise<void>
    hardLink(source: string, target: string): Promise<void>
    symbolicLink(target: string, path: string, kind?: "file" | "dir"): Promise<void>
    /**
     * The stored target text of a symbolic link.
     *
     * Refuses when the path is not a link or is absent — the host's `fs.readlink` arm propagates the
     * capability error, so a transport that answered `null` here would disagree with a realm run.
     */
    readLink(path: string): Promise<string>
    realPath(path: string): Promise<string>
    setTimes(path: string, times: { atimeMs: number; mtimeMs: number }): Promise<void>
  }
  proc: {
    exec(program: string, args: string[], options?: { cwd?: string; env?: Record<string, string> }): Promise<ExecResult>
    start(program: string, args: string[], options?: { cwd?: string }): Promise<{ handle: number; pid: number }>
    poll(handle: number, since?: number): Promise<ChildStatus>
    wait(handle: number, since?: number): Promise<ChildStatus>
    stop(handle: number): Promise<boolean>
  }
  clock: {
    /** The host clock in the journals' spelling — the one date format the operation logs agree on. */
    now(): Promise<string>
  }
  crypto: {
    uuid(): Promise<string>
    randomBytes(count: number): Promise<Uint8Array>
    /** Hex digest; the host owns the only SHA implementation. */
    digest(algorithm: "sha1" | "sha256", bytes: Uint8Array): Promise<string>
  }
  os: {
    tempDir(): Promise<string>
    homeDir(): Promise<string | null>
    cpus(): Promise<{ count: number; models: string[] }>
    platform(): Promise<PlatformFacts>
  }
  service: {
    /** One call against a host service this node declared it needs (`NodeRequirements.services`). */
    invoke(name: string, method: string, args?: Record<string, unknown>): Promise<unknown>
  }
}

/**
 * Which capability answers which host operation.
 *
 * The `satisfies` clause is the point: it requires **every** generated operation to be named (a new
 * `HostOperation` variant in the Rust crate fails `tsc` until it is mapped here) and rejects a name that is
 * no longer in the vocabulary. So the capability surface and the protocol cannot drift silently, and no
 * hand-maintained parity list is needed.
 */
export const CAPABILITY_FOR_OPERATION = {
  "fs.stat": "fs.stat",
  "fs.list": "fs.list",
  "fs.readText": "fs.readText",
  "fs.writeText": "fs.writeText",
  "fs.ensureDir": "fs.ensureDir",
  "fs.move": "fs.move",
  "fs.delete": "fs.remove",
  "fs.mkdtemp": "fs.createTemp",
  "fs.copy": "fs.copy",
  "fs.appendText": "fs.appendText",
  "fs.utimes": "fs.setTimes",
  "fs.readBytes": "fs.readBytes",
  "fs.writeBytes": "fs.writeBytes",
  "fs.link": "fs.hardLink",
  "fs.symlink": "fs.symbolicLink",
  "fs.readlink": "fs.readLink",
  "fs.realpath": "fs.realPath",
  "proc.exec": "proc.exec",
  "proc.spawn": "proc.start",
  "proc.poll": "proc.poll",
  "proc.wait": "proc.wait",
  "proc.kill": "proc.stop",
  "clock.now": "clock.now",
  "crypto.randomUUID": "crypto.uuid",
  "crypto.randomBytes": "crypto.randomBytes",
  "crypto.digest": "crypto.digest",
  "os.tmpdir": "os.tempDir",
  "os.homedir": "os.homeDir",
  "os.cpus": "os.cpus",
  "service.invoke": "service.invoke",
} as const satisfies Record<HostOperationName, string>

/** Every capability path, for the coverage test that walks a transport and proves nothing is a stub. */
export const CAPABILITY_PATHS: readonly string[] = Object.values(CAPABILITY_FOR_OPERATION)

/** The reverse map: `fs.readText` for capability `fs.readText`, used by the realm probes' diagnostics. */
export function operationFor(capabilityPath: string): HostOperationName | undefined {
  const entry = Object.entries(CAPABILITY_FOR_OPERATION).find(([, capability]) => capability === capabilityPath)
  return entry?.[0] as HostOperationName | undefined
}

/** Fails loudly at start-up rather than at the first call site when a transport implements too little. */
export function assertCoverage(transport: unknown, label: string): void {
  const missing = CAPABILITY_PATHS.filter((path) => {
    const [group, method] = path.split(".") as [string, string]
    const holder = (transport as Record<string, unknown>)[group]
    return typeof (holder as Record<string, unknown> | undefined)?.[method] !== "function"
  })
  if (missing.length > 0) {
    throw new Error(`host-capabilities: ${label} implements none of: ${missing.join(", ")}`)
  }
  if (HOST_OPERATION_NAMES.length !== CAPABILITY_PATHS.length) {
    throw new Error(
      `host-capabilities: ${HOST_OPERATION_NAMES.length} host operations but ${CAPABILITY_PATHS.length} capabilities mapped`,
    )
  }
}
