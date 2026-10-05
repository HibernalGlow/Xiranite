/**
 * `node:fs/promises` — the file system, entirely through `__xrh`.
 *
 * The QuickJS realm has no filesystem. Every implemented call here becomes one named operation of the closed list
 * in `host.ts` (`OPERATIONS_V1`), against the host's granted roots: a path the operation may not touch is the
 * host's answer, not the shim's, and the same ten file operations are refused outright when the run carries no
 * grant (`fs_operations.rs:292-298`).
 *
 * Text vs bytes (ADR-0074 decision 2: "bytes cross as bytes, never base64-in-JSON"): `fs.readBytes` answers a
 * `Uint8Array` through `__xrh.callBytes` and `fs.writeBytes` takes its payload through `__xrh.sendBytes`, so
 * `readFile` without an encoding answers a `Buffer` exactly like Node, a non-utf8 `encoding` decodes those bytes,
 * and a `Buffer`/`Uint8Array` write (or `flag: "a"`) goes down the payload channel. Nothing in this file puts
 * base64 inside a JSON argument.
 *
 * What the host does *not* answer stays a throwing named export — `open`/FileHandle, `chmod`, `chown`, `truncate`,
 * `lutimes`, `statfs`, `writev`/`readv`, `glob`, `opendir`, `watch`, `watchFile` — never silently omitted (esbuild
 * resolves named imports at build time) and never faked. `mkdtemp`, `appendFile`, `copyFile`, `cp`, `link`,
 * `symlink`, `readlink`, `realpath` and `utimes` are wired; `fs.ts` carries their synchronous twins, and both
 * faces share one helper each for Node's seconds-vs-milliseconds `utimes` rule (`utimesToEpochMs`) and for the
 * byte-or-text decision on a write payload (`payloadBytes` in `ops.ts`).
 */
import { Buffer } from "./buffer.ts"
import { QuickJsShimError, SHIM_ERROR_CODES } from "./host.ts"
import { QuickJSDirent, QuickJSStats, eisdirCopyError, normalizeEncodingOption, notImplemented, resolveCopyForce, toPathString, utimesToEpochMs, withCallback, type NodeCallback } from "./internal.ts"
import {
  opFsAppendTextAsync,
  opFsCopyAsync,
  opFsDeleteAsync,
  opFsEnsureDirAsync,
  opFsLinkAsync,
  opFsListAsync,
  opFsMkdtempAsync,
  opFsMoveAsync,
  opFsReadBytesAsync,
  opFsReadlinkAsync,
  opFsReadTextAsync,
  opFsRealpathAsync,
  opFsStatAsync,
  opFsSymlinkAsync,
  opFsUtimesAsync,
  opFsWriteBytesAsync,
  opFsWriteTextAsync,
  payloadBytes,
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
      `${context}: this call site is the text path, so a byte payload cannot be honoured here. Pass no encoding (or Buffer data) and the bytes go through __xrh.sendBytes on fs.writeBytes.`,
      { requiredOperation: "fs.writeBytes(path, bytes, { append? })" },
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

/**
 * `fs.stat`/`fs.lstat` in Node's shape: the host answers a missing path leniently (`exists: false`),
 * Node throws ENOENT. Every retained node's `platform.ts` writes `try { await lstat(p) } catch { missing }`,
 * so returning a zero-size Stats here would read as "the file exists" and make a planner skip its own
 * conflict rules — measured with `dissolvef`'s undo, which refused a move it should have made.
 */
function statFrom(payload: unknown, context: string): QuickJSStats {
  const info = payload as Parameters<typeof QuickJSStats.from>[0]
  if (info?.exists === false) throw missingDocument(info.path ?? context)
  return QuickJSStats.from(info)
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

export async function readFile(path: PathLike, options?: ReadFileOptions): Promise<string | Buffer> {
  const target = toPathString(path, "fs.promises.readFile")
  const normalized = normalizeEncodingOption(options)
  const encoding = normalized.encoding
  if (encoding === undefined || encoding.toLowerCase() === "buffer") {
    const bytes = await opFsReadBytesAsync(target)
    if (bytes === null) throw missingDocument(target)
    return Buffer.from(bytes)
  }
  if (encoding.toLowerCase() === "utf8" || encoding.toLowerCase() === "utf-8") {
    return textFromReadResult(await opFsReadTextAsync(target), target)
  }
  // Any other code page Node names is expressible now: the bytes come over the byte channel and `Buffer` decodes
  // them, so `encoding: "latin1"` is no longer a refusal — and it is still not base64 inside the JSON envelope.
  const raw = await opFsReadBytesAsync(target)
  if (raw === null) throw missingDocument(target)
  return Buffer.from(raw).toString(encoding as never)
}

/** Node's `readText` alias: `readFile(path, "utf8")` as a string. */
export async function readText(path: PathLike): Promise<string> {
  return readFile(path, "utf8") as Promise<string>
}

export async function writeFile(path: PathLike, data: unknown, options?: ReadFileOptions): Promise<void> {
  const target = toPathString(path, "fs.promises.writeFile")
  const normalized = normalizeEncodingOption(options)
  const flag = typeof normalized.options["flag"] === "string" ? normalized.options["flag"] : "w"
  if (flag !== "w" && flag !== "a") {
    throw new QuickJsShimError(
      SHIM_ERROR_CODES.signatureUnsupported,
      `fs.promises.writeFile: flag ${JSON.stringify(flag)} maps onto neither fs.writeText (truncate) nor the append arm of fs.writeBytes; only "w" and "a" are expressible.`,
      { flag },
    )
  }
  const binary = payloadBytes(data, normalized.encoding)
  if (binary !== null) {
    // Bytes (or a non-utf8 code page) go through the payload channel; `a` is its append arm.
    await opFsWriteBytesAsync(target, binary, { append: flag === "a" })
    return
  }
  if (flag === "a") {
    await opFsAppendTextAsync(target, rejectBinaryPayload(data, "fs.promises.writeFile"))
    return
  }
  checkTextEncoding(normalized.encoding, "fs.promises.writeFile")
  await opFsWriteTextAsync(target, rejectBinaryPayload(data, "fs.promises.writeFile"))
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
  const target = toPathString(path, "fs.promises.stat")
  return statFrom(await opFsStatAsync(target), target)
}

/** `lstat` asks the host not to follow the symlink; a host that ignores the flag reports the target. */
export async function lstat(path: PathLike): Promise<QuickJSStats> {
  const target = toPathString(path, "fs.promises.lstat")
  return statFrom(await opFsStatAsync(target), target)
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

/* --- Members whose host operation exists and is wired: each one is a call, not a refusal. --- */

/** `mkdtemp(prefix)` — the host makes the unique directory and answers its path. */
export async function mkdtemp(prefix: PathLike): Promise<string> {
  const result = await opFsMkdtempAsync(toPathString(prefix, "fs.promises.mkdtemp"))
  if (typeof result?.path !== "string") {
    throw new QuickJsShimError(SHIM_ERROR_CODES.hostResultInvalid, "host fs.mkdtemp returned no path.")
  }
  return result.path
}

export async function appendFile(path: PathLike, data: unknown, options?: ReadFileOptions): Promise<void> {
  const target = toPathString(path, "fs.promises.appendFile")
  const normalized = normalizeEncodingOption(options)
  const binary = payloadBytes(data, normalized.encoding)
  if (binary !== null) {
    await opFsWriteBytesAsync(target, binary, { append: true })
    return
  }
  checkTextEncoding(normalized.encoding, "fs.promises.appendFile")
  await opFsAppendTextAsync(target, rejectBinaryPayload(data, "fs.promises.appendFile"))
}

/**
 * Node's `copyFile` **overwrites** by default and only fails on an existing destination when the mode carries
 * `COPYFILE_EXCL` (measured on Node 26: default → destination content replaced, `COPYFILE_EXCL` → `EEXIST`).
 * The host's `fs.copy` defaults `force` to true, so the flag is passed explicitly rather than inherited.
 */
export async function copyFile(source: PathLike, destination: PathLike, mode?: number): Promise<void> {
  const from = toPathString(source, "fs.promises.copyFile")
  const to = toPathString(destination, "fs.promises.copyFile")
  await opFsCopyAsync(from, to, { recursive: false, force: resolveCopyForce({ mode }, "fs.promises.copyFile") })
}

/** Node's `cp`: `force` defaults true, `recursive` defaults false, and a directory without `recursive` is `ERR_FS_EISDIR`. */
export async function cp(source: PathLike, destination: PathLike, options?: { recursive?: boolean; force?: boolean; errorOnExist?: boolean; filter?: (src: string, dest: string) => boolean }): Promise<void> {
  const from = toPathString(source, "fs.promises.cp")
  const to = toPathString(destination, "fs.promises.cp")
  if (typeof options?.filter === "function") {
    throw new QuickJsShimError(
      SHIM_ERROR_CODES.signatureUnsupported,
      "fs.promises.cp: the filter callback cannot run host-side; the host copies the whole path, so a filtered cp would copy more than it reports.",
      { requiredOperation: "fs.copy with a host-side predicate" },
    )
  }
  const recursive = options?.recursive === true
  if (!recursive && (await opFsStatAsync(from)).isDirectory === true) throw eisdirCopyError(from)
  await opFsCopyAsync(from, to, { recursive, force: resolveCopyForce(options ?? {}, "fs.promises.cp") })
}

export async function link(existingPath: PathLike, newPath: PathLike): Promise<void> {
  await opFsLinkAsync(toPathString(existingPath, "fs.promises.link"), toPathString(newPath, "fs.promises.link"))
}

/** Node's `symlink(target, path, type)`: `target` is the stored text, `path` is where the link appears. */
export async function symlink(target: PathLike, path: PathLike, type?: string): Promise<void> {
  await opFsSymlinkAsync(toPathString(target, "fs.promises.symlink"), toPathString(path, "fs.promises.symlink"), type)
}

export async function readlink(path: PathLike, options?: { encoding?: string } | string): Promise<string> {
  const normalized = normalizeEncodingOption(options)
  checkTextEncoding(normalized.encoding, "fs.promises.readlink")
  const result = await opFsReadlinkAsync(toPathString(path, "fs.promises.readlink"))
  return result.target
}

export async function realpath(path: PathLike, options?: { encoding?: string } | string): Promise<string> {
  const normalized = normalizeEncodingOption(options)
  checkTextEncoding(normalized.encoding, "fs.promises.realpath")
  const result = await opFsRealpathAsync(toPathString(path, "fs.promises.realpath"))
  return result.realPath
}

/** Node's `utimes(path, atime, mtime)` takes seconds as a number; the host wants milliseconds (`utimesToEpochMs`). */
export async function utimes(path: PathLike, atime: number | string | Date, mtime: number | string | Date): Promise<void> {
  const target = toPathString(path, "fs.promises.utimes")
  await opFsUtimesAsync(target, utimesToEpochMs(atime, "fs.promises.utimes atime"), utimesToEpochMs(mtime, "fs.promises.utimes mtime"))
}

/* --- Members beyond what the host answers: named exports that throw at the call site, not silent omissions. --- */

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
