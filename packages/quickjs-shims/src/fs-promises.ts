/**
 * `node:fs/promises` — the file system, entirely through `__xrh`.
 *
 * The QuickJS realm has no filesystem. Every implemented call here becomes one operation of the pinned list
 * (`fs.stat fs.list fs.readText fs.writeText fs.ensureDir fs.move fs.delete`), against the host's granted
 * roots: a path the operation may not touch is the host's answer, not the shim's.
 *
 * Text vs bytes (ADR-0074 decision 2: "bytes cross as bytes, never base64-in-JSON"): operations v1 has no byte
 * operation, so a **binary** read or write cannot be honoured. `readFile`/`writeFile` carry text (the measured
 * call sites all pass `"utf8"`); a binary `Buffer`/`Uint8Array` write or a non-utf8 encoding throws
 * `quickjs-shim-signature-unsupported` naming the operation the host must add (`fs.readBytes` / `fs.writeBytes`).
 *
 * Members beyond operations v1 (`mkdtemp`, `cp`/`copyFile`, `appendFile`, `link`/`symlink`/`readlink`,
 * `realpath`, `utimes`, `open`, `chmod`, `truncate`, ...) are exported as throwing functions, not silently
 * omitted and not faked — the named export exists so esbuild resolves the import, and the call fails at run
 * time naming the missing host operation. Each is listed in the README.
 */
import { QuickJsShimError, SHIM_ERROR_CODES } from "./host.ts"
import { QuickJSDirent, QuickJSStats, normalizeEncodingOption, notImplemented, toPathString, withCallback, type NodeCallback } from "./internal.ts"
import {
  opFsDelete,
  opFsDeleteAsync,
  opFsEnsureDir,
  opFsEnsureDirAsync,
  opFsList,
  opFsListAsync,
  opFsMove,
  opFsMoveAsync,
  opFsReadText,
  opFsReadTextAsync,
  opFsStat,
  opFsStatAsync,
  opFsWriteText,
  opFsWriteTextAsync,
} from "./ops.ts"
import type { FsListEntry } from "./ops.ts"

type PathLike = string | URL | Uint8Array
type ReadFileOptions = { encoding?: string; flag?: string; signal?: unknown } | string

/** The text encoding is the only thing operations v1 can carry; anything else names the byte op it needs. */
function checkTextEncoding(encoding: string | undefined, context: string): "utf8" {
  if (encoding === undefined) return "utf8"
  const normalized = encoding.toLowerCase()
  if (normalized === "utf8" || normalized === "utf-8") return "utf8"
  throw new QuickJsShimError(
    SHIM_ERROR_CODES.signatureUnsupported,
    `${context}: encoding ${JSON.stringify(encoding)} cannot be honoured. Operations v1 exposes no byte-level read, so a code page must be asked for with ` +
      "`@xiranite/shared`'s decodeText over bytes from fs.readBytes once the host serves it.",
    { encoding, requiredOperation: "fs.readBytes(path, { offset?, length? }) -> ArrayBuffer" },
  )
}

function rejectBinaryPayload(value: unknown, context: string): string {
  if (typeof value === "string") return value
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    throw new QuickJsShimError(
      SHIM_ERROR_CODES.signatureUnsupported,
      `${context}: binary payloads do not cross the JSON host envelope. Add the host operation fs.writeBytes(path, bytes, { mode? }) and use it instead.`,
      { requiredOperation: "fs.writeBytes(path, bytes, { mode?, append? }) -> null" },
    )
  }
  if (value === null || value === undefined) {
    throw new QuickJsShimError(SHIM_ERROR_CODES.signatureUnsupported, `${context}: data argument is ${String(value)}.`)
  }
  return String(value)
}

function missingDocument(path: string): Error {
  const error = new Error(`ENOENT: no such file or directory, open '${path}'`) as Error & { code: string; path: string }
  error.code = "ENOENT"
  error.path = path
  return error
}

function textFromReadResult(result: { path: string; content: string | null }, context: string): string {
  if (typeof result?.content === "string") return result.content
  if (result?.content === null || result?.content === undefined) throw missingDocument(result?.path ?? context)
  throw new QuickJsShimError(SHIM_ERROR_CODES.hostResultInvalid, `host fs.readText returned an unusable answer for ${JSON.stringify(context)}.`)
}

/** The one place that turns `fs.list` entries into the requested shape (sync twin in `fs.ts`). */
function toDirentsOrNames(entries: FsListEntry[], withFileTypes: boolean): string[] | QuickJSDirent[] {
  return withFileTypes ? entries.map((entry) => new QuickJSDirent(entry)) : entries.map((entry) => entry.name)
}

function statFrom(payload: unknown): QuickJSStats {
  return QuickJSStats.from(payload as Parameters<typeof QuickJSStats.from>[0])
}

/** Node's `access(path, mode)`: only existence (F_OK) is expressible through fs.stat. */
async function accessAsync(path: PathLike, mode?: number): Promise<void> {
  const target = toPathString(path, "fs.promises.access")
  if (mode !== undefined && mode !== 0) {
    throw new QuickJsShimError(
      SHIM_ERROR_CODES.signatureUnsupported,
      "fs.promises.access: only constants.F_OK is expressible — the host has no permission operation, and a granted root is not the same question.",
      { mode, requiredOperation: "fs.access(path, { read?, write?, execute? })" },
    )
  }
  const info = await opFsStatAsync(target)
  if (info.exists === false) throw missingDocument(target)
}

export async function readFile(path: PathLike, options?: ReadFileOptions): Promise<string> {
  const target = toPathString(path, "fs.promises.readFile")
  const normalized = normalizeEncodingOption(options)
  checkTextEncoding(normalized.encoding, "fs.promises.readFile")
  return textFromReadResult(await opFsReadTextAsync(target), target)
}

export async function writeFile(path: PathLike, data: unknown, options?: ReadFileOptions): Promise<void> {
  const target = toPathString(path, "fs.promises.writeFile")
  const normalized = normalizeEncodingOption(options)
  checkTextEncoding(normalized.encoding, "fs.promises.writeFile")
  const content = rejectBinaryPayload(data, "fs.promises.writeFile")
  const flag = typeof normalized.options["flag"] === "string" ? normalized.options["flag"] : undefined
  if (flag !== undefined && flag !== "w") {
    throw new QuickJsShimError(
      SHIM_ERROR_CODES.signatureUnsupported,
      `fs.promises.writeFile: flag ${JSON.stringify(flag)} is not supported; only truncating writes map onto fs.writeText. Use appendFile for "a" or fs.writeBytes once the host serves it.`,
      { flag, requiredOperation: "fs.writeBytes(path, bytes, { mode?, append? })" },
    )
  }
  await opFsWriteTextAsync(target, content)
}

/** A direct text alias the executor's docs use; identical to `readFile(path, "utf8")`. */
export async function readText(path: PathLike): Promise<string> {
  return readFile(path, "utf8")
}

export async function writeText(path: PathLike, text: string): Promise<void> {
  await writeFile(path, text, "utf8")
}

export async function readdir(path: PathLike, options?: { withFileTypes?: boolean; recursive?: boolean; encoding?: string }): Promise<string[] | QuickJSDirent[]> {
  const target = toPathString(path, "fs.promises.readdir")
  if (typeof options?.encoding === "string" && options.encoding !== "utf8") {
    throw new QuickJsShimError(SHIM_ERROR_CODES.signatureUnsupported, `fs.readdir: encoding ${JSON.stringify(options.encoding)} is not supported; host list results are UTF-8 names.`)
  }
  const payload = await opFsListAsync(target, { recursive: options?.recursive })
  return toDirentsOrNames(payload.entries ?? [], options?.withFileTypes === true)
}

export async function stat(path: PathLike): Promise<QuickJSStats> {
  return statFrom(await opFsStatAsync(toPathString(path, "fs.promises.stat")))
}

/** `lstat` asks the host not to follow the symlink; a host that ignores the flag reports the target. */
export async function lstat(path: PathLike): Promise<QuickJSStats> {
  return statFrom(await opFsStatAsync(toPathString(path, "fs.promises.lstat")))
}

/** `mkdir(path)` maps onto `fs.ensureDir` (mkdir -p). A non-recursive mkdir that must report EEXIST throws. */
export async function mkdir(path: PathLike, options?: { recursive?: boolean; mode?: number }): Promise<string | undefined> {
  const target = toPathString(path, "fs.promises.mkdir")
  if (options?.recursive === false) {
    throw new QuickJsShimError(
      SHIM_ERROR_CODES.signatureUnsupported,
      "fs.promises.mkdir: fs.ensureDir is mkdir -p and cannot report EEXIST for an existing directory. Add fs.mkdirExclusive(path) to the host if a caller depends on that.",
      { requiredOperation: "fs.mkdirExclusive(path) -> null" },
    )
  }
  await opFsEnsureDirAsync(target)
  return undefined
}

export async function rm(path: PathLike, options?: { recursive?: boolean; force?: boolean; maxRetries?: number }): Promise<void> {
  const target = toPathString(path, "fs.promises.rm")
  if (options?.force) {
    const exists = await opFsStatAsync(target).then((info) => info.exists !== false, () => false)
    if (!exists) return
  }
  await opFsDeleteAsync(target, options?.recursive ?? false)
}

export async function unlink(path: PathLike): Promise<void> {
  await opFsDeleteAsync(toPathString(path, "fs.promises.unlink"), false)
}

export async function rmdir(path: PathLike): Promise<void> {
  await opFsDeleteAsync(toPathString(path, "fs.promises.rmdir"), false)
}

export async function rename(source: PathLike, destination: PathLike): Promise<void> {
  await opFsMoveAsync(toPathString(source, "fs.promises.rename"), toPathString(destination, "fs.promises.rename"))
}

export const access: (path: PathLike, mode?: number) => Promise<void> = accessAsync

/* --- Members beyond operations v1: named exports that throw at the call site, not silent omissions. --- */

export const mkdtemp: (prefix: string) => never = notImplemented("fs/promises", "mkdtemp", "fs.mkdtemp(prefix) -> path")
export const appendFile: () => never = notImplemented("fs/promises", "appendFile", "fs.appendText(path, text) -> null")
export const copyFile: () => never = notImplemented("fs/promises", "copyFile", "fs.copy(source, target, { force? }) -> null")
export const cp: () => never = notImplemented("fs/promises", "cp", "fs.copy(source, target, { recursive?, force? }) -> null")
export const link: () => never = notImplemented("fs/promises", "link", "fs.link(source, target)")
export const symlink: () => never = notImplemented("fs/promises", "symlink", "fs.symlink(target, path, type)")
export const readlink: () => never = notImplemented("fs/promises", "readlink", "fs.readlink(path)")
export const realpath: () => never = notImplemented("fs/promises", "realpath", "fs.realpath(path) -> path")
export const utimes: () => never = notImplemented("fs/promises", "utimes", "fs.utimes(path, atimeMs, mtimeMs)")
export const open: () => never = notImplemented("fs/promises", "open", "fs.open/readRange/closeHandle host-handle operations")
export const chmod: () => never = notImplemented("fs/promises", "chmod")
export const chown: () => never = notImplemented("fs/promises", "chown")
export const truncate: () => never = notImplemented("fs/promises", "truncate")
export const lutimes: () => never = notImplemented("fs/promises", "lutimes")
export const statfs: () => never = notImplemented("fs/promises", "statfs")
export const writev: () => never = notImplemented("fs/promises", "writev")
export const readv: () => never = notImplemented("fs/promises", "readv")
export const glob: () => never = notImplemented("fs/promises", "glob")
export const opendir: () => never = notImplemented("fs/promises", "opendir")
export const watch: () => never = notImplemented("fs/promises", "watch")
export const watchFile: () => never = notImplemented("fs/promises", "watchFile")

/**
 * The namespace object `node:fs/promises` hands back. Callback-style members are not part of the promise
 * family; the object is only for the default-import path, while named imports bind the exports above.
 */
const namespace = {
  readFile, writeFile, readText, writeText, readdir, stat, lstat, mkdir, rm, unlink, rmdir, rename, access,
  mkdtemp, appendFile, copyFile, cp, link, symlink, readlink, realpath, utimes, open, chmod, chown, truncate,
  lutimes, statfs, writev, readv, glob, opendir, watch, watchFile, withCallback,
}

export type { NodeCallback }
export { withCallback }
export default namespace
