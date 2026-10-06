/**
 * `node:child_process` — every external program goes through one host operation (`proc.exec`) and the host's
 * allowlist. The realm cannot fork.
 *
 * `execFile` and `execFileSync` are the two shapes operations v1 can serve: `proc.exec(program, args, {cwd})`
 * waits for completion and answers `{ exitCode, stdout, stderr, signal }`. `execFile` attaches Node's
 * `customPromisifyArgs = ["stdout","stderr"]` so the five nodes that `promisify(execFile)` resolve to
 * `{ stdout, stderr }`, exactly as they do on Node.
 *
 * `spawn`/`spawnSync` are deliberately **not** implemented: a live `ChildProcess` handle (streams, signals,
 * `kill`) needs a host-held resource plus an event channel that operations v1 does not carry. The measured
 * `spawn` call sites (bandia's Bandizip progress reader, jellypot's launcher, gifu/mvz) are named in the README
 * as remaining work; they ask for `proc.spawn`. `shell: true` and `exec` (a shell string) are refused even
 * where a host could honour them — a shell bypasses the external-program allowlist, the one permission the
 * substrate must not soften.
 */
import { QuickJsShimError, SHIM_ERROR_CODES } from "./host.ts"
import { notImplemented, toPathString } from "./internal.ts"
import { opProcExec, opProcExecAsync } from "./ops.ts"
import type { ExecFileOptionsPayload, ProcExecResult } from "./ops.ts"

const customPromisifyArgs = Symbol.for("nodejs.util.promisify.custom_args")

type PathLike = string | URL | Uint8Array

interface ExecFileInputOptions extends ExecFileOptionsPayload {
  shell?: unknown
  maxBuffer?: number
  timeout?: number
  encoding?: string
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

function readOptions(maybeOptions: unknown): ExecFileInputOptions {
  if (maybeOptions === null || maybeOptions === undefined || typeof maybeOptions === "function") return {}
  if (typeof maybeOptions !== "object") {
    throw new QuickJsShimError(SHIM_ERROR_CODES.signatureUnsupported, `child_process options must be an object, got ${typeof maybeOptions}.`)
  }
  return maybeOptions as ExecFileInputOptions
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

/** Live-process and shell surfaces: not implementable through operations v1. Each throws naming `proc.spawn`. */
export const spawn: () => never = notImplemented("child_process", "spawn", "proc.spawn(program, args, { cwd }) -> handle")
export const spawnSync: () => never = notImplemented("child_process", "spawnSync", "proc.exec already waits; spawnSync needs no new op but is not wired here")
export const exec: () => never = notImplemented("child_process", "exec", "shell string parsing bypasses the allowlist; call execFile(program, argv) instead")
export const execSync: () => never = notImplemented("child_process", "execSync", "shell string parsing bypasses the allowlist; call execFileSync(program, argv) instead")
export const fork: () => never = notImplemented("child_process", "fork")

const namespace = { execFile, execFileSync, spawn, spawnSync, exec, execSync, fork }
export default namespace
