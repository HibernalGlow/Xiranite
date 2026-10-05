/**
 * The realm path implementation — pure TypeScript, no host call. It lives in the capability package (ADR-0079)
 * and `packages/quickjs-shims/src/path.ts` re-exports it, because one implementation of `join` cannot live in
 * two places: the granted filesystem keys its plan rows on this exact spelling.
 *
 * String surgery is machine-independent *provided* the separator and the Windows-ness come from the host
 * (`__xrh.platform.sep` / `.platform`), which is exactly what ADR-0074 decision 2 asks for. Operations v1 pins
 * no `path.*` operation, so there is no host path service to route to; `path.sep` and the win32/posix branch
 * read the host platform block.
 *
 * `join` is the one function held to a host rule rather than Node's, on purpose. The granted filesystem in
 * `crates/xiranite-core/src/filesystem.rs` joins with `join_paths` (`:418-436`), normalizes separators with
 * `normalize_separators` (`:372-374`, collapse `\` into `/`), and authorizes with `path_within` (`:389-410`);
 * a node's plan rows are keyed on the strings that filesystem builds, so a `path.join` that collapsed `..`
 * or emitted a native separator would produce a row the host could not match. `joinPathsMatch` below
 * reproduces `join_paths` line for line and is the reason this file does not use Node's `join` for the top
 * level. `path.posix.join` / `path.win32.join` keep Node's semantics because those handles are what a node
 * uses when it *wants* a platform-specific path, not the host-neutral one.
 */
import { QuickJsShimError, SHIM_ERROR_CODES, isWindows, platformInfo, platformInfoOrFallback } from "@xiranite/quickjs-shims/host"

export interface ParsedPath {
  root: string
  dir: string
  base: string
  ext: string
  name: string
}

/** `normalize_separators`: filesystem.rs `:372`. Collapse `\` into `/`. */
function normalizeSeparators(path: string): string {
  return path.replace(/\\/g, "/")
}

/**
 * filesystem.rs `join_paths` (`:418-436`), reproduced exactly: the first part keeps its text minus trailing
 * `/` (it is the parent and may be `/`, a drive path or a UNC prefix); later parts contribute their text minus
 * leading and trailing `/`. An empty first part does not invent a root.
 */
function joinPathsMatch(parts: string[]): string {
  let joined = ""
  for (let index = 0; index < parts.length; index += 1) {
    const raw = normalizeSeparators(parts[index] ?? "")
    const piece = index === 0 ? trimEnd(raw, "/") : trimBoth(raw, "/")
    if (piece.length === 0) {
      // `/` trimmed to nothing is still a root; keep exactly one separator for it.
      if (index === 0 && raw.startsWith("/")) joined += "/"
      continue
    }
    if (joined.length > 0 && !joined.endsWith("/")) joined += "/"
    joined += piece
  }
  return joined
}

function trimEnd(value: string, char: string): string {
  let end = value.length
  while (end > 0 && value[end - 1] === char) end -= 1
  return value.slice(0, end)
}

function trimBoth(value: string, char: string): string {
  return trimEnd(trimStart(value, char), char)
}

function trimStart(value: string, char: string): string {
  let start = 0
  while (start < value.length && value[start] === char) start += 1
  return value.slice(start)
}

interface PathEngine {
  sep: string
  delimiter: string
  win32: boolean
}

const posixEngine: PathEngine = { sep: "/", delimiter: ":", win32: false }
const win32Engine: PathEngine = { sep: "\\", delimiter: ";", win32: true }

function native(): PathEngine {
  return hostIsWindows() ? win32Engine : posixEngine
}

function hostIsWindows(): boolean {
  try {
    return isWindows()
  } catch {
    return false
  }
}

function isSeparator(engine: PathEngine, character: string): boolean {
  return character === engine.sep || (engine.win32 && (character === "\\" || character === "/"))
}

function sepClass(engine: PathEngine): RegExp {
  return engine.win32 ? /[\\/]/ : /\//
}

function isAbsoluteWith(path: string, engine: PathEngine): boolean {
  if (engine.win32) {
    if (path.length >= 2 && (path[0] === "\\" || path[0] === "/" || path[1] === "\\" || path[1] === "/")) return true
    return /^[A-Za-z]:[\\/]/.test(path)
  }
  return path.startsWith("/")
}

/** Collapses `.`/`..`/duplicate separators for the engine's own separator. */
function normalizeSegments(path: string, engine: PathEngine, allowAboveRoot: boolean): string {
  const out: string[] = []
  for (const segment of path.split(sepClass(engine))) {
    if (segment.length === 0 || segment === ".") continue
    if (segment === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop()
      else if (allowAboveRoot) out.push("..")
      continue
    }
    out.push(segment)
  }
  return out.join(engine.sep)
}

function rootLength(path: string, engine: PathEngine): number {
  if (engine.win32) {
    if (path.length >= 2 && (path[0] === "\\" || path[0] === "/") && (path[1] === "\\" || path[1] === "/")) {
      const second = path.indexOf("\\", 2)
      const secondAlt = path.indexOf("/", 2)
      const next = second === -1 ? secondAlt : secondAlt === -1 ? second : Math.min(second, secondAlt)
      if (next === -1) return path.length
      const third = indexOfAny(path, next + 1, "\\/")
      return third === -1 ? path.length : third
    }
    if (/^[A-Za-z]:[\\/]/.test(path)) return 3
    return 0
  }
  return path.startsWith("/") ? 1 : 0
}

function indexOfAny(path: string, from: number, characters: string): number {
  for (let index = from; index < path.length; index += 1) {
    if (characters.includes(path[index]!)) return index
  }
  return -1
}

function resolveWith(paths: string[], engine: PathEngine): string {
  let resolved = ""
  let absolute = false
  for (let index = paths.length - 1; index >= -1 && !absolute; index -= 1) {
    const part = index >= 0 ? paths[index]! : hostCwd(engine)
    if (typeof part !== "string" || part.length === 0) continue
    resolved = `${part}${engine.sep}${resolved}`
    absolute = isAbsoluteWith(part, engine)
  }
  const collapsed = normalizeSegments(resolved, engine, !absolute)
  if (absolute) return engine.sep.length + collapsed.length > 0 ? `${engine.sep}${collapsed}` : engine.sep
  return collapsed.length > 0 ? collapsed : "."
}

function hostCwd(engine: PathEngine): string {
  try {
    return platformInfo().cwd
  } catch {
    return engine.win32 ? "\\" : "/"
  }
}

function normalizeWith(path: string, engine: PathEngine): string {
  if (path.length === 0) return "."
  const isAbs = isAbsoluteWith(path, engine)
  const root = path.slice(0, rootLength(path, engine))
  const trailing = isSeparator(engine, path[path.length - 1]!)
  const segments = normalizeSegments(path, engine, !isAbs)
  if (segments.length === 0 && isAbs) return root.length > 0 ? root : engine.sep
  if (segments.length === 0) return isAbs ? engine.sep : "."
  const prefixed = isAbs ? `${root}${segments}` : segments
  return trailing ? `${prefixed}${engine.sep}` : prefixed
}

function dirnameWith(path: string, engine: PathEngine): string {
  if (path.length === 0) return "."
  const root = path.slice(0, rootLength(path, engine))
  // Strip trailing separators (but keep a lone root).
  let end = path.length
  while (end > 1 && end > root.length + 1 && isSeparator(engine, path[end - 1]!)) end -= 1
  // Find the separator that delimits the last segment.
  let last = -1
  for (let index = end - 1; index >= 1; index -= 1) {
    if (isSeparator(engine, path[index]!)) {
      last = index
      break
    }
  }
  if (last < root.length) {
    // Only the root remains: return the root, or the separator for a path with no root prefix.
    if (root.length > 0) return root
    return isAbsoluteWith(path, engine) ? engine.sep : "."
  }
  const parent = path.slice(0, last)
  if (engine.win32 && /^[A-Za-z]:$/.test(parent)) return `${parent}\\`
  if (parent.length === 0) return engine.sep
  return parent
}

/** Whether a path has any component after its drive/UNC/root prefix. */
function hasSegmentsAfterRoot(path: string, engine: PathEngine): boolean {
  const root = path.slice(0, rootLength(path, engine))
  return path.length > root.length && path.slice(root.length).split(sepClass(engine)).some((segment) => segment.length > 0)
}

function basenameWith(path: string, engine: PathEngine, suffix?: string): string {
  let base = path
  while (base.length > 1 && isSeparator(engine, base[base.length - 1]!)) base = base.slice(0, -1)
  let start = 0
  for (let index = base.length - 1; index >= 0; index -= 1) {
    if (isSeparator(engine, base[index]!)) {
      start = index + 1
      break
    }
  }
  let result = base.slice(start)
  if (typeof suffix === "string" && suffix.length > 0 && result.endsWith(suffix) && result.length > suffix.length) {
    result = result.slice(0, result.length - suffix.length)
  }
  return result
}

function extnameWith(path: string, engine: PathEngine): string {
  const base = basenameWith(path, engine)
  if (base.startsWith(".") && base.length === 1) return ""
  for (let index = base.length - 1; index > 0; index -= 1) {
    if (base[index] === ".") return base.slice(index)
  }
  return ""
}

function relativeWith(from: string, to: string, engine: PathEngine): string {
  const fromResolved = resolveWith([from], engine)
  const toResolved = resolveWith([to], engine)
  if (fromResolved === toResolved) return ""
  const fromSegments = fromResolved.split(sepClass(engine))
  const toSegments = toResolved.split(sepClass(engine))
  const shared = Math.min(fromSegments.length, toSegments.length)
  let offset = 0
  while (offset < shared && fromSegments[offset] === toSegments[offset]) offset += 1
  const ups = fromSegments.length - offset
  const downs = toSegments.slice(offset)
  if (ups === 0) return downs.join(engine.sep)
  const up = "..".repeat(ups)
  return downs.length === 0 ? up : `${up}${engine.sep}${downs.join(engine.sep)}`
}

function parseWith(path: string, engine: PathEngine): ParsedPath {
  if (path.length === 0) throw new QuickJsShimError(SHIM_ERROR_CODES.signatureUnsupported, "path.parse expects a non-empty string.")
  const root = path.slice(0, rootLength(path, engine))
  const dir = path === root ? "" : dirnameWith(path, engine)
  const base = basenameWith(path, engine)
  const ext = extnameWith(base, engine)
  const name = base.slice(0, base.length - ext.length)
  return { root, dir: dir.length === 0 ? root : dir, base, ext, name }
}

function formatWith(parsed: Partial<ParsedPath>, engine: PathEngine): string {
  const dir = parsed["dir"] ?? parsed["root"] ?? ""
  const base = parsed["base"] ?? `${parsed["name"] ?? ""}${parsed["ext"] ?? ""}`
  if (base.length === 0) return dir
  if (dir.length === 0) return base
  return dir.endsWith(engine.sep) || (engine.win32 && dir.endsWith("\\")) ? `${dir}${base}` : `${dir}${engine.sep}${base}`
}

/** Node-style cross-platform engine (explicit `.win32` / `.posix` handles). Its `join` is Node's, not the host's. */
function engineApi(engine: PathEngine) {
  return {
    sep: engine.sep,
    delimiter: engine.delimiter,
    normalize: (path: string) => normalizeWith(path, engine),
    join: (...parts: string[]) => {
      const kept = parts.filter((part) => typeof part === "string" && part.length > 0)
      if (kept.length === 0) return "."
      return normalizeWith(kept.join(engine.sep), engine)
    },
    resolve: (...parts: string[]) => resolveWith(parts, engine),
    isAbsolute: (path: string) => isAbsoluteWith(path, engine),
    relative: (from: string, to: string) => relativeWith(from, to, engine),
    dirname: (path: string) => dirnameWith(path, engine),
    basename: (path: string, suffix?: string) => basenameWith(path, engine, suffix),
    extname: (path: string) => extnameWith(path, engine),
    parse: (path: string) => parseWith(path, engine),
    format: (parsed: Partial<ParsedPath>) => formatWith(parsed, engine),
    toNamespacedPath: (path: string) => path,
  }
}

const enginePosix = engineApi(posixEngine)
const engineWin32 = engineApi(win32Engine)

/**
 * The native engine is read **per call**: the audit tooling (`scripts/audit-node-bundles.ts` importing
 * `surface.ts`) loads these modules in a process with no `__xrh`, and a realm may evaluate the prelude before
 * the host publishes its platform block. `sep`/`delimiter` are the exception — Node types them as strings and
 * ESM cannot export a lazy value, so they read the host when present and fall back to POSIX otherwise.
 */
export const sep: string = platformInfoOrFallback().sep
export const delimiter: string = platformInfoOrFallback().pathSep
export const win32 = engineWin32
export const posix = enginePosix

/** The host-matching join (filesystem.rs `join_paths`). This is what `node:path`'s top-level `join` is. */
export function join(...parts: string[]): string {
  for (const part of parts) {
    if (typeof part !== "string") throw new QuickJsShimError(SHIM_ERROR_CODES.signatureUnsupported, `path.join expects strings, got ${typeof part}.`)
  }
  return joinPathsMatch(parts)
}

export const normalize: (path: string) => string = (path) => normalizeWith(path, native())
export const resolve: (...parts: string[]) => string = (...parts) => resolveWith(parts, native())
export const isAbsolute: (path: string) => boolean = (path) => isAbsoluteWith(path, native())
export const relative: (from: string, to: string) => string = (from, to) => relativeWith(from, to, native())
export const dirname: (path: string) => string = (path) => dirnameWith(path, native())
export const basename: (path: string, suffix?: string) => string = (path, suffix) => basenameWith(path, native(), suffix)
export const extname: (path: string) => string = (path) => extnameWith(path, native())
export const parse: (path: string) => ParsedPath = (path) => parseWith(path, native())
export const format: (parsed: Partial<ParsedPath>) => string = (parsed) => formatWith(parsed, native())
export const toNamespacedPath: (path: string) => string = (path) => path
/** Needs the Windows `\\?\` file-API namespace; the host's granted-root check replaces it. Throws, not a no-op. */
// The one member this module refuses rather than implements: it needs the Windows `\\?\` namespace, and the
// host's granted-root check already replaces it. Kept as a named refusal so a bundle that reaches it fails
// by name instead of at esbuild's named-import resolution step.
export const _makeLong: (path: string) => string = () => {
  throw new QuickJsShimError(SHIM_ERROR_CODES.memberUnsupported, "path._makeLong is not implemented")
}

const namespace = {
  sep,
  delimiter,
  win32,
  posix,
  join,
  normalize,
  resolve,
  isAbsolute,
  relative,
  dirname,
  basename,
  extname,
  parse,
  format,
  toNamespacedPath,
  _makeLong,
}

export default namespace
