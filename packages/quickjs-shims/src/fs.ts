/**
 * `node:fs` (synchronous family) — the same operations as `fs-promises.ts`, reached through `__xrh.call`
 * instead of `callAsync`.
 *
 * This is a real capability of the pinned protocol, not a convenience: the host runs a synchronous op inline,
 * so `existsSync`/`readFileSync` keep working inside a realm that has no threads to block. The promise family
 * and this one share the same operation set, so a member cannot be implemented on one face and missing on the
 * other — the beyond-v1 members throw on both.
 *
 * Measured inside node closures: `constants` (nine files), `existsSync`, `appendFileSync`, `statSync`.
 * `createReadStream`/`createWriteStream`/`FileHandle` are not implemented — a stream or descriptor is a
 * host-held resource, and ADR-0074 decision 2 keeps byte streams on the host side.
 */
import { QuickJsShimError, SHIM_ERROR_CODES } from "./host.ts"
import { constants as fsConstantTable } from "./constants.ts"
import { QuickJSDirent, QuickJSStats, eisdirCopyError, normalizeEncodingOption, notImplemented, resolveCopyForce, toPathString, utimesToEpochMs } from "./internal.ts"
import {
  opFsAppendText,
  opFsCopy,
  opFsDelete,
  opFsEnsureDir,
  opFsLink,
  opFsList,
  opFsMkdtemp,
  opFsMove,
  opFsReadText,
  opFsReadlink,
  opFsRealpath,
  opFsStat,
  opFsSymlink,
  opFsUtimes,
  opFsWriteText,
} from "./ops.ts"
import * as promisesNamespace from "./fs-promises.ts"

type PathLike = string | URL | Uint8Array
type ReadFileOptions = { encoding?: string; flag?: string } | string

/**
 * Node's `fs.constants`, from the internal table in `constants.ts`. The table is owned there so the POSIX/Windows
 * open-flag split is decided once, from the platform the host reports; `node:constants` itself is no longer an
 * aliased specifier (measured zero consumers on the current graph — see that file's header).
 */
export const constants = fsConstantTable

function checkTextEncoding(encoding: string | undefined, context: string): "utf8" {
  if (encoding === undefined || encoding.toLowerCase() === "utf8" || encoding.toLowerCase() === "utf-8") return "utf8"
  throw new QuickJsShimError(SHIM_ERROR_CODES.signatureUnsupported, `${context}: encoding ${JSON.stringify(encoding)} cannot be honoured; operations v1 has no byte-level read (fs.readBytes).`)
}

function missingDocument(path: string): Error {
  const error = new Error(`ENOENT: no such file or directory, open '${path}'`) as Error & { code: string; path: string }
  error.code = "ENOENT"
  error.path = path
  return error
}

export function readFileSync(path: PathLike, options?: ReadFileOptions): string {
  const target = toPathString(path, "fs.readFileSync")
  const normalized = normalizeEncodingOption(options)
  checkTextEncoding(normalized.encoding, "fs.readFileSync")
  const result = opFsReadText(target)
  if (typeof result?.content === "string") return result.content
  throw missingDocument(result?.path ?? target)
}

export function writeFileSync(path: PathLike, data: unknown, options?: ReadFileOptions): void {
  const target = toPathString(path, "fs.writeFileSync")
  const normalized = normalizeEncodingOption(options)
  checkTextEncoding(normalized.encoding, "fs.writeFileSync")
  if (typeof data !== "string") {
    throw new QuickJsShimError(SHIM_ERROR_CODES.signatureUnsupported, `fs.writeFileSync: binary payloads need fs.writeBytes (not in operations v1).`, { requiredOperation: "fs.writeBytes(path, bytes)" })
  }
  opFsWriteText(target, data)
}

export function readdirSync(path: PathLike, options?: { withFileTypes?: boolean; recursive?: boolean; encoding?: string }): string[] | QuickJSDirent[] {
  const target = toPathString(path, "fs.readdirSync")
  const payload = opFsList(target, { recursive: options?.recursive })
  const entries = payload.entries ?? []
  return options?.withFileTypes ? entries.map((entry) => new QuickJSDirent(entry)) : entries.map((entry) => entry.name)
}

/**
 * Node throws ENOENT from `statSync`/`lstatSync` for a missing path; the host answers `exists: false`.
 * Same rule and same reason as `fs.promises.stat` (see `statFrom` there): the retained nodes' platform
 * files all write `try { statSync(p) } catch { missing }`, so a lenient Stats would be read as presence.
 */
function statsFrom(payload: ReturnType<typeof opFsStat>, context: string): QuickJSStats {
  if (payload.exists === false) throw missingDocument(payload.path ?? context)
  return QuickJSStats.from(payload)
}

export function statSync(path: PathLike): QuickJSStats {
  const target = toPathString(path, "fs.statSync")
  return statsFrom(opFsStat(target), target)
}

export function lstatSync(path: PathLike): QuickJSStats {
  const target = toPathString(path, "fs.lstatSync")
  return statsFrom(opFsStat(target), target)
}

export function existsSync(path: PathLike): boolean {
  try {
    return opFsStat(toPathString(path, "fs.existsSync")).exists !== false
  } catch {
    return false
  }
}

export function mkdirSync(path: PathLike, options?: { recursive?: boolean }): void {
  if (options?.recursive === false) {
    throw new QuickJsShimError(SHIM_ERROR_CODES.signatureUnsupported, "fs.mkdirSync(recursive:false) cannot report EEXIST through fs.ensureDir; add fs.mkdirExclusive to the host.", { requiredOperation: "fs.mkdirExclusive(path)" })
  }
  opFsEnsureDir(toPathString(path, "fs.mkdirSync"))
}

export function rmSync(path: PathLike, options?: { recursive?: boolean; force?: boolean }): void {
  const target = toPathString(path, "fs.rmSync")
  if (options?.force) {
    try {
      if (opFsStat(target).exists === false) return
    } catch {
      return
    }
  }
  opFsDelete(target, options?.recursive ?? false)
}

export function unlinkSync(path: PathLike): void {
  opFsDelete(toPathString(path, "fs.unlinkSync"), false)
}

export function rmdirSync(path: PathLike): void {
  opFsDelete(toPathString(path, "fs.rmdirSync"), false)
}

export function renameSync(source: PathLike, destination: PathLike): void {
  opFsMove(toPathString(source, "fs.renameSync"), toPathString(destination, "fs.renameSync"))
}

export function accessSync(path: PathLike, mode?: number): void {
  const target = toPathString(path, "fs.accessSync")
  if (mode !== undefined && mode !== 0) {
    throw new QuickJsShimError(SHIM_ERROR_CODES.signatureUnsupported, "fs.accessSync: only constants.F_OK is expressible; the host has no permission operation.", { mode })
  }
  if (opFsStat(target).exists === false) throw missingDocument(target)
}

/**
 * Node's async `fs.access`. Same F_OK-only ceiling as `accessSync`, delivered through the callback the way
 * Node delivers it — `rotating-file-stream/dist/esm/index.js:4` imports this exact member
 * (`access(filename, constants.F_OK, error => resolve(!error))`), and that import is why this export exists at
 * all: without it the whole logx platform bundle fails esbuild's named-export check.
 */
export function access(path: PathLike, modeOrCallback?: number | ((error: Error | null) => void), callback?: (error: Error | null) => void): void {
  const mode = typeof modeOrCallback === "function" ? undefined : modeOrCallback
  const cb = typeof modeOrCallback === "function" ? modeOrCallback : callback
  if (typeof cb !== "function") {
    throw new QuickJsShimError(SHIM_ERROR_CODES.signatureUnsupported, "fs.access: a callback is required; the callback API has no promise form.")
  }
  try {
    accessSync(path, mode)
    queueMicrotask(() => cb(null))
  } catch (error) {
    queueMicrotask(() => cb(error instanceof Error ? error : new Error(String(error))))
  }
}

/* --- Wired members: the synchronous twins of `fs-promises.ts`, one call each through `__xrh.call`. --- */

export function mkdtempSync(prefix: PathLike): string {
  const result = opFsMkdtemp(toPathString(prefix, "fs.mkdtempSync"))
  if (typeof result?.path !== "string") throw new QuickJsShimError(SHIM_ERROR_CODES.hostResultInvalid, "host fs.mkdtemp returned no path.")
  return result.path
}

export function appendFileSync(path: PathLike, data: unknown, options?: ReadFileOptions): void {
  const target = toPathString(path, "fs.appendFileSync")
  const normalized = normalizeEncodingOption(options)
  checkTextEncoding(normalized.encoding, "fs.appendFileSync")
  if (typeof data !== "string") {
    throw new QuickJsShimError(SHIM_ERROR_CODES.signatureUnsupported, "fs.appendFileSync: binary payloads need fs.writeBytes with append (the byte channel the bridge does not declare yet).", { requiredOperation: "fs.writeBytes(path, bytes, { append: true })" })
  }
  opFsAppendText(target, data)
}

export function copyFileSync(source: PathLike, destination: PathLike, mode?: number): void {
  const from = toPathString(source, "fs.copyFileSync")
  const to = toPathString(destination, "fs.copyFileSync")
  opFsCopy(from, to, { recursive: false, force: resolveCopyForce({ mode }, "fs.copyFileSync") })
}

export function cpSync(source: PathLike, destination: PathLike, options?: { recursive?: boolean; force?: boolean; errorOnExist?: boolean; filter?: (src: string, dest: string) => boolean }): void {
  const from = toPathString(source, "fs.cpSync")
  const to = toPathString(destination, "fs.cpSync")
  if (typeof options?.filter === "function") {
    throw new QuickJsShimError(SHIM_ERROR_CODES.signatureUnsupported, "fs.cpSync: the filter callback cannot run host-side; the host copies the whole path.", { requiredOperation: "fs.copy with a host-side predicate" })
  }
  const recursive = options?.recursive === true
  if (!recursive && opFsStat(from).isDirectory === true) throw eisdirCopyError(from)
  opFsCopy(from, to, { recursive, force: resolveCopyForce(options ?? {}, "fs.cpSync") })
}

export function linkSync(existingPath: PathLike, newPath: PathLike): void {
  opFsLink(toPathString(existingPath, "fs.linkSync"), toPathString(newPath, "fs.linkSync"))
}

export function symlinkSync(target: PathLike, path: PathLike, type?: string): void {
  opFsSymlink(toPathString(target, "fs.symlinkSync"), toPathString(path, "fs.symlinkSync"), type)
}

export function readlinkSync(path: PathLike, options?: { encoding?: string } | string): string {
  const normalized = normalizeEncodingOption(options)
  checkTextEncoding(normalized.encoding, "fs.readlinkSync")
  return opFsReadlink(toPathString(path, "fs.readlinkSync")).target
}

export function realpathSync(path: PathLike, options?: { encoding?: string } | string): string {
  const normalized = normalizeEncodingOption(options)
  checkTextEncoding(normalized.encoding, "fs.realpathSync")
  return opFsRealpath(toPathString(path, "fs.realpathSync")).realPath
}

export function utimesSync(path: PathLike, atime: number | string | Date, mtime: number | string | Date): void {
  const target = toPathString(path, "fs.utimesSync")
  opFsUtimes(target, utimesToEpochMs(atime, "fs.utimesSync atime"), utimesToEpochMs(mtime, "fs.utimesSync mtime"))
}

/* --- Beyond what the host answers: throwing named exports (mirror of fs-promises.ts). --- */
export const chmodSync: () => never = notImplemented("fs", "chmodSync")
export const chownSync: () => never = notImplemented("fs", "chownSync")
export const truncateSync: () => never = notImplemented("fs", "truncateSync")
export const lutimesSync: () => never = notImplemented("fs", "lutimesSync")
export const statfsSync: () => never = notImplemented("fs", "statfsSync")
export const openSync: () => never = notImplemented("fs", "openSync", "fs.open/readRange/closeHandle host-handle operations")
export const closeSync: () => never = notImplemented("fs", "closeSync")
export const readSync: () => never = notImplemented("fs", "readSync", "fs.readBytes with an offset")
export const writeSync: () => never = notImplemented("fs", "writeSync")
export const createReadStream: () => never = notImplemented("fs", "createReadStream", "a host-held byte stream")
export const createWriteStream: () => never = notImplemented("fs", "createWriteStream", "a host-held byte stream")
export const watch: () => never = notImplemented("fs", "watch")
export const watchFile: () => never = notImplemented("fs", "watchFile")
export const unwatchFile: () => never = notImplemented("fs", "unwatchFile")

/** `fs.promises` is the same object the `node:fs/promises` alias hands out, so identity holds across faces. */
export const promises: typeof promisesNamespace = { ...promisesNamespace }

const namespace = {
  constants, promises,
  readFileSync, writeFileSync, readdirSync, statSync, lstatSync, existsSync, mkdirSync, rmSync, unlinkSync, rmdirSync, renameSync, accessSync, access,
  appendFileSync, mkdtempSync, copyFileSync, cpSync, linkSync, symlinkSync, readlinkSync, realpathSync, utimesSync, chmodSync, chownSync, truncateSync,
  lutimesSync, statfsSync, openSync, closeSync, readSync, writeSync, createReadStream, createWriteStream, watch, watchFile, unwatchFile,
}
export default namespace
