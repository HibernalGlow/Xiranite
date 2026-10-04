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
import { QuickJsShimError, SHIM_ERROR_CODES, platformInfoOrFallback } from "./host.ts"
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

const POSIX_OPEN_FLAGS = { O_RDONLY: 0, O_WRONLY: 1, O_RDWR: 2, O_CREAT: 0o100, O_EXCL: 0o200, O_NOCTTY: 0o400, O_TRUNC: 0o1000, O_APPEND: 0o2000, O_DIRECT: 0o40000, O_DIRECTORY: 0o200000, O_NOFOLLOW: 0o400000, O_NOATIME: 0o1000000, O_CLOEXEC: 0o2000000 } as const
const WINDOWS_OPEN_FLAGS = { O_RDONLY: 0, O_WRONLY: 1, O_RDWR: 2, O_CREAT: 0o200, O_EXCL: 0o400, O_NOCTTY: 0, O_TRUNC: 0o1000, O_APPEND: 8, O_DIRECT: 0, O_DIRECTORY: 0, O_NOFOLLOW: 0, O_NOATIME: 0, O_CLOEXEC: 0 } as const

/** Node's `fs.constants`: the access/S_IF/COPYFILE values are portable; open flags are per platform. */
export const constants = {
  F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1,
  COPYFILE_EXCL: 1, COPYFILE_FICLONE: 2, COPYFILE_FICLONE_FORCE: 4,
  S_IFMT: 0o170000, S_IFDIR: 0o040000, S_IFREG: 0o100644 & 0o170000, S_IFLNK: 0o120000, S_IFBLK: 0o060000, S_IFCHR: 0o020000, S_IFIFO: 0o010000, S_IFSOCK: 0o140000,
  S_IRUSR: 0o000400, S_IWUSR: 0o000200, S_IXUSR: 0o000100, S_IRGRP: 0o000040, S_IWGRP: 0o000020, S_IXGRP: 0o000010, S_IROTH: 0o000004, S_IWOTH: 0o000002, S_IXOTH: 0o000001,
  ...(platformInfoOrFallback().platform === "win32" ? WINDOWS_OPEN_FLAGS : POSIX_OPEN_FLAGS),
} as const

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
  readFileSync, writeFileSync, readdirSync, statSync, lstatSync, existsSync, mkdirSync, rmSync, unlinkSync, rmdirSync, renameSync, accessSync,
  appendFileSync, mkdtempSync, copyFileSync, cpSync, linkSync, symlinkSync, readlinkSync, realpathSync, utimesSync, chmodSync, chownSync, truncateSync,
  lutimesSync, statfsSync, openSync, closeSync, readSync, writeSync, createReadStream, createWriteStream, watch, watchFile, unwatchFile,
}
export default namespace
