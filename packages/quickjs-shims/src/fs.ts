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
import { QuickJSDirent, QuickJSStats, normalizeEncodingOption, notImplemented, toPathString } from "./internal.ts"
import {
  opFsDelete,
  opFsEnsureDir,
  opFsList,
  opFsMove,
  opFsReadText,
  opFsStat,
  opFsWriteText,
} from "./ops.ts"
import * as promisesNamespace from "./fs-promises.ts"

type PathLike = string | URL | Uint8Array
type ReadFileOptions = { encoding?: string; flag?: string } | string

/**
 * Node's `fs.constants`. The table is owned by `constants.ts` — the same object `require("constants")`
 * publishes — so the two spellings cannot drift apart, including the POSIX/Windows open-flag split the host's
 * reported platform selects.
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

export function statSync(path: PathLike): QuickJSStats {
  return QuickJSStats.from(opFsStat(toPathString(path, "fs.statSync")))
}

export function lstatSync(path: PathLike): QuickJSStats {
  return QuickJSStats.from(opFsStat(toPathString(path, "fs.lstatSync")))
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

/* --- Beyond operations v1: throwing named exports (mirror of fs-promises.ts). --- */
export const appendFileSync: () => never = notImplemented("fs", "appendFileSync", "fs.appendText(path, text) -> null")
export const mkdtempSync: () => never = notImplemented("fs", "mkdtempSync", "fs.mkdtemp(prefix) -> path")
export const copyFileSync: () => never = notImplemented("fs", "copyFileSync", "fs.copy(source, target) -> null")
export const cpSync: () => never = notImplemented("fs", "cpSync", "fs.copy(source, target, { recursive? }) -> null")
export const linkSync: () => never = notImplemented("fs", "linkSync", "fs.link(source, target)")
export const symlinkSync: () => never = notImplemented("fs", "symlinkSync", "fs.symlink(target, path, type)")
export const readlinkSync: () => never = notImplemented("fs", "readlinkSync", "fs.readlink(path)")
export const realpathSync: () => never = notImplemented("fs", "realpathSync", "fs.realpath(path) -> path")
export const utimesSync: () => never = notImplemented("fs", "utimesSync", "fs.utimes(path, atimeMs, mtimeMs)")
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
