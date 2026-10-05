/**
 * `node:child_process` — every external program goes through one host operation (`proc.exec`) and the host's
 * allowlist. The realm cannot fork.
 *
 * `execFile` and `execFileSync` are the two shapes operations v1 can serve: `proc.exec(program, args, {cwd})`
 * waits for completion and answers `{ exitCode, stdout, stderr, signal }`. `execFile` attaches Node's
 * `customPromisifyArgs = ["stdout","stderr"]` so the five nodes that `promisify(execFile)` resolve to
 * `{ stdout, stderr }`, exactly as they do on Node.
 *
 * `spawn` and `spawnSync` are wired to what the host actually supports: `spawnSync` is `proc.exec` in Node's
 * result shape (a non-zero exit is a value, not a throw), and `spawn` is `proc.spawn` for the **`stdio: "ignore"`**
 * case only — see `spawn`'s own note for why the piped form is refused rather than emulated on a capped transcript
 * window. `shell: true` and `exec`/`execSync` (a shell string) are refused even where a host could honour them — a
 * shell bypasses the external-program allowlist, the one permission the substrate must not soften.
 */
import { QuickJsShimError, SHIM_ERROR_CODES } from "./host.ts"
import { notImplemented, toPathString } from "./internal.ts"
import { opProcExec, opProcExecAsync, opProcKill, opProcSpawn, opProcWait } from "./ops.ts"
import type { ExecFileOptionsPayload, ProcExecResult, ProcReport, ProcSpawnResult } from "./ops.ts"

const customPromisifyArgs = Symbol.for("nodejs.util.promisify.custom_args")

type PathLike = string | URL | Uint8Array

interface ExecFileInputOptions extends ExecFileOptionsPayload {
  shell?: unknown
  maxBuffer?: number
  timeout?: number
  encoding?: string
}

/** `spawn`/`spawnSync` carry everything `execFile` does plus the stdio/detached knobs. */
interface SpawnOptions extends ExecFileInputOptions {
  stdio?: unknown
  detached?: boolean
  windowsHide?: boolean
}

interface ExecFileCallback {
  (error: Error | null, stdout: string, stderr: string): void
}

/** `encoding: "buffer"` asks for bytes; the JSON envelope cannot carry them. Named so the throw is exact. */
function wantsBytes(encoding: string | undefined, context: string): void {
  if (encoding === undefined || encoding === "utf8" || encoding === "utf-8") return
  if (encoding === "buffer") {
    throw new QuickJsShimError(
      SHIM_ERROR_CODES.signatureUnsupported,
      `${context}: encoding "buffer" needs stdout as bytes. The host must answer proc.exec with a byte-capable result (ADR-0074 decision 3: bytes cross as bytes).`,
      { requiredOperation: "proc.exec -> ArrayBuffer stdout" },
    )
  }
  throw new QuickJsShimError(SHIM_ERROR_CODES.signatureUnsupported, `${context}: unsupported encoding ${JSON.stringify(encoding)}.`)
}

function readOptions<T extends ExecFileInputOptions = ExecFileInputOptions>(maybeOptions: unknown): T {
  if (maybeOptions === null || maybeOptions === undefined || typeof maybeOptions === "function") return {} as T
  if (typeof maybeOptions !== "object") {
    throw new QuickJsShimError(SHIM_ERROR_CODES.signatureUnsupported, `child_process options must be an object, got ${typeof maybeOptions}.`)
  }
  return maybeOptions as T
}

function payloadFor(options: ExecFileInputOptions, context: string): ExecFileOptionsPayload {
  if (options.shell !== undefined && options.shell !== false) {
    throw new QuickJsShimError(
      SHIM_ERROR_CODES.signatureUnsupported,
      `${context}: shell is refused. The host's external-program allowlist is the permission boundary; a shell would move the decision to argv string concatenation.`,
      { shell: options.shell },
    )
  }
  wantsBytes(options.encoding, context)
  return {
    cwd: options.cwd === undefined ? undefined : toPathString(options.cwd as PathLike, context),
    env: options.env,
    timeoutMs: typeof options.timeout === "number" ? options.timeout : options.timeoutMs,
    maxBufferBytes: typeof options.maxBuffer === "number" ? options.maxBuffer : options.maxBufferBytes,
    encoding: options.encoding,
  }
}

/** Node's callback receives `(error & { stdout, stderr, code })`; a non-zero exit is an error object. */
function failureFrom(result: ProcExecResult, file: string, args: string[]): Error | null {
  const code = typeof result.exitCode === "number" ? result.exitCode : null
  const rejected = result.rejected === true
  const failed = rejected || result.success === false || (code !== null && code !== 0)
  if (!failed) return null
  const message = rejected
    ? `spawn ${file} ${args.join(" ")} EACCES: the host refused the program (not on the external-program allowlist).`
    : `Command failed: ${file} ${args.join(" ")}\n${result.stderr || ""}`
  const error = new Error(message) as Error & { code: number | string; stdout: string; stderr: string; killed?: boolean; signal?: string | null }
  error.code = rejected ? "EACCES" : (code ?? "UNKNOWN")
  error.stdout = result.stdout
  error.stderr = result.stderr
  error.signal = result.signal ?? null
  return error
}

export interface ExecFileApi {
  (file: string, args?: string[], options?: ExecFileInputOptions, callback?: ExecFileCallback): void
  (file: string, callback?: ExecFileCallback): void
}

/**
 * `child_process.execFile(file, args?, options?, callback?)`. Callback form calls back with Node's
 * `(error, stdout, stderr)`; the promise form (no callback) resolves `{ stdout, stderr }` because the function
 * carries `customPromisifyArgs`.
 */
export function execFile(
  file: string,
  argsOrCallback?: string[] | ExecFileCallback,
  optionsOrCallback?: ExecFileInputOptions | ExecFileCallback,
  maybeCallback?: ExecFileCallback,
): Promise<{ stdout: string; stderr: string }> | void {
  const argv = Array.isArray(argsOrCallback) ? argsOrCallback : []
  const rawOptions = Array.isArray(argsOrCallback) ? optionsOrCallback : (argsOrCallback as ExecFileInputOptions | undefined)
  const callback =
    typeof maybeCallback === "function"
      ? maybeCallback
      : typeof optionsOrCallback === "function"
        ? optionsOrCallback
        : typeof argsOrCallback === "function"
          ? argsOrCallback
          : undefined
  const options = readOptions(rawOptions)
  const payload = payloadFor(options, "child_process.execFile")

  if (typeof callback === "function") {
    opProcExecAsync(file, argv, payload).then(
      (result) => callback(failureFrom(result, file, argv), result.stdout, result.stderr),
      (reason: unknown) => callback(reason instanceof Error ? reason : new Error(String(reason)), "", ""),
    )
    return undefined
  }

  return opProcExecAsync(file, argv, payload).then((result) => {
    const error = failureFrom(result, file, argv)
    if (error !== null) throw error
    return { stdout: result.stdout, stderr: result.stderr }
  })
}

// The contract that makes `promisify(execFile)` resolve `{ stdout, stderr }` instead of just stdout.
;(execFile as unknown as Record<symbol, string[]>)[customPromisifyArgs] = ["stdout", "stderr"]

export function execFileSync(file: string, args?: string[] | ExecFileInputOptions, maybeOptions?: ExecFileInputOptions): string {
  const argv = Array.isArray(args) ? args : []
  const options = readOptions(Array.isArray(args) ? maybeOptions : (args as ExecFileInputOptions | undefined))
  wantsBytes(options.encoding, "child_process.execFileSync")
  const result = opProcExec(file, argv, payloadFor(options, "child_process.execFileSync"))
  const error = failureFrom(result, file, argv)
  if (error !== null) throw error
  return result.stdout
}

/**
 * Node's `spawn` in the realm, and the one shape it can honestly serve: **`stdio: "ignore"`**.
 *
 * `proc.spawn` answers `{ handle, pid, program }` and the host keeps at most 4 MiB of transcript per stream
 * (`machine.rs:49`), handed out in 262 144-byte `proc.poll` windows with a `truncated` flag
 * (`proc_operations.rs:41,175-189`). A piped Node `ChildProcess` promises unbounded output with backpressure, and
 * mapping that onto a capped window would silently drop bytes past the cap — so a call that wants pipes is
 * refused, naming exactly what it would need.
 *
 * The refusal costs nothing in practice: the only `spawn` in the retained node set is
 * `packages/nodes/bandia/src/platform.ts:153`, `spawn(everything, [...], { detached: true, stdio: "ignore" })
 * .unref()` — a launcher that never reads output. And with `stdio: "ignore"` Node's own contract says
 * `child.stdout` **is** `null`, so the object below is not an approximation of Node, it is Node's shape for this
 * option. (`packages/nodes/lata/src/platform.ts:51` does read `child.stdout.on("data")`; `lata` is shelved and
 * unregistered, so the piped form stays unimplemented until that node returns or a host-side capture op exists.)
 */
export function spawn(program: string, args?: string[] | SpawnOptions, maybeOptions?: SpawnOptions): RealmChildProcess {
  const argv = Array.isArray(args) ? args : []
  const options = readOptions<SpawnOptions>(Array.isArray(args) ? maybeOptions : (args as SpawnOptions | undefined))
  const payload = payloadFor(options, "child_process.spawn")
  if (!stdioIgnoresOutput(options.stdio)) {
    throw new QuickJsShimError(
      SHIM_ERROR_CODES.memberUnsupported,
      'child_process.spawn: only stdio "ignore" is honoured in the realm. The host caps a live child at 4 MiB per stream and answers 262144-byte windows, so a piped ChildProcess would silently lose output past the cap; use stdio:"ignore" (Node answers stdout:null for it anyway), execFile for a waited run, or ask for a host-side capture (proc.exec -> file) for a full transcript.',
      { stdio: options.stdio, requiredOperation: "host-side child output capture (proc.spawn with a file sink)" },
    )
  }
  const answer = opProcSpawn(program, argv, { ...(payload.cwd === undefined ? {} : { cwd: payload.cwd }) })
  return realmChild(answer)
}

/** Node's `stdio: "ignore"` spelling, in both the string and the array form. */
export function stdioIgnoresOutput(stdio: unknown): boolean {
  if (stdio === undefined) return false
  if (stdio === "ignore") return true
  if (Array.isArray(stdio)) return (stdio[1] ?? "ignore") === "ignore" && (stdio[2] ?? "ignore") === "ignore"
  return false
}

export interface RealmChildProcess {
  readonly pid: number
  readonly program: string
  readonly handle: number
  /** `null` exactly as Node reports it for `stdio: "ignore"`. */
  readonly stdout: null
  readonly stderr: null
  readonly stdin: null
  readonly killed: boolean
  kill(signal?: string): boolean
  wait(): ProcReport
  unref(): RealmChildProcess
  ref(): RealmChildProcess
}

function realmChild(answer: ProcSpawnResult): RealmChildProcess {
  let killed = false
  const child: RealmChildProcess = {
    pid: answer.pid,
    program: answer.program,
    handle: answer.handle,
    stdout: null,
    stderr: null,
    stdin: null,
    get killed(): boolean {
      return killed
    },
    kill(): boolean {
      killed = opProcKill(answer.handle).killed
      return killed
    },
    wait(): ProcReport {
      return opProcWait(answer.handle)
    },
    unref(): RealmChildProcess {
      // The realm has no event loop handle to release: the host child is already detached from the run's own
      // completion, so `unref`/`ref` are the no-ops Node's semantics allow here.
      return child
    },
    ref(): RealmChildProcess {
      return child
    },
  }
  return child
}

/**
 * `spawnSync` is `proc.exec` wearing Node's return shape: it waits, and a non-zero exit is a **result**, not a
 * throw (unlike `execFileSync`). Measured caller: `gifu`'s 7-Zip locator path in its integration test.
 */
export function spawnSync(program: string, args?: string[] | SpawnOptions, maybeOptions?: SpawnOptions): ProcExecResult & { output: (string | null)[]; status: number | null } {
  const argv = Array.isArray(args) ? args : []
  const options = readOptions<SpawnOptions>(Array.isArray(args) ? maybeOptions : (args as SpawnOptions | undefined))
  const result = opProcExec(program, argv, payloadFor(options, "child_process.spawnSync"))
  return { ...result, status: result.exitCode, output: [null, result.stdout, result.stderr] }
}

/** Shell forms: refused even where a host could honour them, because a shell string moves the decision into argv. */
export const exec: () => never = notImplemented("child_process", "exec", "shell string parsing bypasses the allowlist; call execFile(program, argv) instead")
export const execSync: () => never = notImplemented("child_process", "execSync", "shell string parsing bypasses the allowlist; call execFileSync(program, argv) instead")
export const fork: () => never = notImplemented("child_process", "fork", "a Node fork needs a JS runtime on the other end; the realm has one and it is this one")

const namespace = { execFile, execFileSync, spawn, spawnSync, exec, execSync, fork }
export default namespace
