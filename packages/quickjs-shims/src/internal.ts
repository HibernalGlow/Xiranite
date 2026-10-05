/**
 * Shared plumbing for the `node:` builtin shims.
 *
 * This file holds the *values* the filesystem shims hand back (a Node-shaped `Stats` and `Dirent`), the path
 * coercion every file operation needs, and the two helpers the whole package uses to be honest about a gap:
 * `notImplemented` (a member that exists in Node but this shim cannot serve — it throws).
 *
 * It deliberately has no table-driven `defineModule` indirection. Aliased modules are resolved by esbuild's
 * **named import** check at build time, so each builtin module must export every member its consumers import
 * as a real named binding; a runtime-built object hides exactly the names esbuild needs to see. The one source
 * of truth for *what is implemented* is `surface.ts` (a plain data file the audit and the README read); this
 * file only provides the machinery those hand-written exports call.
 */
import { QuickJsShimError, SHIM_ERROR_CODES, bytesToUtf8, hostNowMs, isWindows } from "./host.ts"
import type { FsListEntry, FsStatResult } from "./ops.ts"

export type ModuleKind = "file" | "dir" | "symlink" | "other"

/**
 * The message format the migration pins for an unimplemented member. A node's `catch` and the README both key
 * on this shape, so it is spelled once: `quickjs-shim: <module>.<member> is not implemented`.
 */
export function notImplementedMessage(module: string, member: string): string {
  return `quickjs-shim: ${module}.${member} is not implemented`
}

/**
 * Returns a function that throws the pinned `not implemented` error. A builtin module uses it for every member
 * Node has that operations v1 cannot serve, so the named export exists (esbuild resolves it) and the failure
 * lands at the call site with the missing host operation named in the details.
 */
export function notImplemented(module: string, member: string, requiredOperation?: string): (...args: unknown[]) => never {
  return () => {
    throw new QuickJsShimError(
      SHIM_ERROR_CODES.memberUnsupported,
      notImplementedMessage(module, member),
      requiredOperation === undefined ? { module, member } : { module, member, requiredOperation },
    )
  }
}

/**
 * A refusal for a member that is a **class** in Node. Three access patterns have to fail the same way:
 * `new X()` (construction), `X.call(this)` (iconv-lite subclasses `stream.Transform` through a plain call) and
 * `Object.create(X.prototype)` (which needs a prototype object to exist). A `notImplemented` arrow satisfies
 * none of them — an arrow is not constructible — so the refusal is a function declaration whose body throws.
 */
export function notImplementedClass(module: string, member: string, requiredOperation?: string): new (...args: unknown[]) => never {
  return function QuickJsShimRefusedClass(this: unknown): never {
    throw new QuickJsShimError(
      SHIM_ERROR_CODES.memberUnsupported,
      notImplementedMessage(module, member),
      requiredOperation === undefined ? { module, member } : { module, member, requiredOperation },
    )
  } as unknown as new (...args: unknown[]) => never
}

/** Node's `fs.Stats`, shaped from the host's `fs.stat` payload. */
export class QuickJSStats {
  readonly size: number
  readonly mode: number
  readonly mtimeMs: number
  readonly atimeMs: number
  readonly ctimeMs: number
  readonly birthtimeMs: number
  readonly kind: ModuleKind

  constructor(payload: FsStatResult) {
    if (payload === null || typeof payload !== "object") {
      throw new QuickJsShimError(SHIM_ERROR_CODES.hostResultInvalid, `host fs.stat returned an unusable payload: ${JSON.stringify(payload)}`)
    }
    this.kind = statKind(payload)
    this.size = numberOr(payload.size, 0)
    this.mode = numberOr(payload.mode, defaultModeFor(this.kind))
    this.mtimeMs = numberOr(payload.mtimeMs, 0)
    this.atimeMs = numberOr(payload.atimeMs, this.mtimeMs)
    this.ctimeMs = numberOr(payload.ctimeMs, this.mtimeMs)
    this.birthtimeMs = numberOr(payload.birthtimeMs, this.ctimeMs)
  }

  isFile(): boolean {
    return this.kind === "file"
  }
  isDirectory(): boolean {
    return this.kind === "dir"
  }
  isSymbolicLink(): boolean {
    return this.kind === "symlink"
  }
  isBlockDevice(): boolean {
    return false
  }
  isCharacterDevice(): boolean {
    return false
  }
  isFIFO(): boolean {
    return false
  }
  isSocket(): boolean {
    return false
  }

  /**
   * `mtime`/`atime`/`ctime`/`birthtime` are `Date` properties in Node, not methods. Nodes that compare or
   * restore file times read them directly, so the instance carries both the `*Ms` number and the `Date`.
   */
  static from(payload: FsStatResult): QuickJSStats & { mtime: Date; atime: Date; ctime: Date; birthtime: Date } {
    const stats = new QuickJSStats(payload)
    const stamped = stats as QuickJSStats & { mtime: Date; atime: Date; ctime: Date; birthtime: Date }
    defineDate(stamped, "mtime", stats.mtimeMs)
    defineDate(stamped, "atime", stats.atimeMs)
    defineDate(stamped, "ctime", stats.ctimeMs)
    defineDate(stamped, "birthtime", stats.birthtimeMs)
    return stamped
  }
}

function defineDate(target: object, key: string, ms: number): void {
  Object.defineProperty(target, key, { value: new Date(ms), enumerable: true, configurable: true })
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function defaultModeFor(kind: ModuleKind): number {
  return kind === "dir" ? 0o040755 : 0o100644
}

/**
 * The host's `fs.stat` answer carries `isFile`/`isDirectory`/`exists`; `kind` is an optional richer field.
 * Deriving the kind from the boolean shape (rather than requiring `kind`) keeps the shim honest about what
 * operations v1 actually answers: a host that only returns `isFile`/`isDirectory` is fully supported, and a
 * size/mtime-less stat is a documented ceiling (README), not a throw.
 */
function statKind(payload: FsStatResult): ModuleKind {
  if (typeof payload.kind === "string") return payload.kind as ModuleKind
  if (payload.isDirectory === true) return "dir"
  if (payload.isFile === true) return "file"
  return "other"
}

/** Node's `fs.Dirent`, built from an `fs.list` entry. */
export class QuickJSDirent {
  readonly name: string
  private readonly kind: ModuleKind

  constructor(entry: FsListEntry) {
    this.name = entry.name
    this.kind = entryKind(entry)
  }

  isFile(): boolean {
    return this.kind === "file"
  }
  isDirectory(): boolean {
    return this.kind === "dir"
  }
  isSymbolicLink(): boolean {
    return this.kind === "symlink"
  }
  isBlockDevice(): boolean {
    return false
  }
  isCharacterDevice(): boolean {
    return false
  }
  isFIFO(): boolean {
    return false
  }
  isSocket(): boolean {
    return false
  }
}

function entryKind(entry: FsListEntry): ModuleKind {
  if (typeof entry.kind === "string") return entry.kind as ModuleKind
  if (entry.isDirectory === true) return "dir"
  if (entry.isFile === true) return "file"
  return "other"
}

/**
 * The host's granted-root check lives in the host; the shim only has to hand it a string. Numeric file
 * descriptors and non-`file:` URLs are refused because the realm cannot own them.
 */
export function toPathString(value: unknown, context: string): string {
  if (typeof value === "string") return value
  if (isUrlLike(value)) {
    const url = value as URL
    if (url.protocol !== "file:") {
      throw new QuickJsShimError(
        SHIM_ERROR_CODES.signatureUnsupported,
        `${context}: only file: URLs can name a path for the host filesystem, got ${JSON.stringify(url.protocol)}`,
      )
    }
    return fileUrlToPath(url.href)
  }
  if (value instanceof Uint8Array) return bytesToUtf8(value)
  if (typeof value === "number" && Number.isInteger(value)) {
    throw new QuickJsShimError(SHIM_ERROR_CODES.signatureUnsupported, `${context}: numeric file descriptors are not supported by the host filesystem API.`)
  }
  throw new QuickJsShimError(SHIM_ERROR_CODES.signatureUnsupported, `${context}: unsupported path argument of type ${typeof value}.`)
}

function isUrlLike(value: unknown): boolean {
  return typeof value === "object" && value !== null && "href" in value && "protocol" in value
}

/**
 * `file:` URL to a host path. Separator handling follows the host rule in
 * `crates/xiranite-core/src/filesystem.rs` `normalize_separators` (`\`-only spelling on a POSIX grant would
 * otherwise name a single flat file name): a POSIX host yields `/`-joined, a Windows host yields `\`-joined,
 * `file:///C:/x` decodes to `C:\x`.
 */
export function fileUrlToPath(href: string): string {
  let withoutScheme = href.slice("file://".length)
  if (withoutScheme.startsWith("localhost/")) withoutScheme = withoutScheme.slice("localhost".length)
  const queryIndex = withoutScheme.search(/[?#]/)
  if (queryIndex >= 0) withoutScheme = withoutScheme.slice(0, queryIndex)
  let decoded = decodeURIComponent(withoutScheme)
  const windows = hostIsWindows()
  if (windows) {
    if (/^\/[A-Za-z]:/.test(decoded)) decoded = decoded.slice(1)
    if (!decoded.startsWith("\\") && decoded.startsWith("//")) decoded = decoded.replace(/^\/\//, "\\\\")
  }
  return decoded.replace(/\//g, windows ? "\\" : "/")
}

function hostIsWindows(): boolean {
  try {
    return isWindows()
  } catch {
    return false
  }
}

/** Normalises Node's `{ encoding } | "utf8" | { flag } | null | undefined` option bag. */
export function normalizeEncodingOption(value: unknown): { encoding: string | undefined; options: Record<string, unknown> } {
  if (value === null || value === undefined) return { encoding: undefined, options: {} }
  if (typeof value === "string") return { encoding: value, options: {} }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>
    return { encoding: typeof record["encoding"] === "string" ? record["encoding"] : undefined, options: record }
  }
  throw new QuickJsShimError(SHIM_ERROR_CODES.signatureUnsupported, `unsupported options argument of type ${typeof value}.`)
}

/** True only for the encodings the text-only host envelope can carry without a byte operation. */
export function isUtf8Request(encoding: string): boolean {
  const normalized = encoding.toLowerCase().replace(/[^a-z0-9]/g, "")
  return normalized === "utf8" || normalized === "utf8encoding" || normalized === "bufferencodingutf8"
}

/** Node's callback-last convention, used by the async family when a callback is passed. */
export type NodeCallback<T> = (error: Error | null, value?: T) => void

export function withCallback<T>(promise: Promise<T>, callback?: NodeCallback<T>): Promise<T> | undefined {
  if (typeof callback !== "function") return promise
  promise.then(
    (value) => callback(null, value),
    (error: unknown) => callback(error instanceof Error ? error : new Error(String(error))),
  )
  return undefined
}

export { hostNowMs }
