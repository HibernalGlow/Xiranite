/**
 * `node:url` — pure TypeScript on top of the host's platform facts.
 *
 * The measured use inside node closures is `fileURLToPath` (a worker/CLI locator) and `pathToFileURL` (the
 * same). `URL` / `URLSearchParams` are *not* installed in the realm: QuickJS-NG (the tree vendored by
 * `rquickjs-sys 0.14`) ships no WHATWG URL, and the `quickjs-wpt-sys` crate an earlier revision of this file
 * named is not a published crate. So this module forwards them lazily through the global scope; a realm
 * without a provider fails at the call site with the missing name, instead of freezing `undefined` at
 * module-init time. See `docs/migration/llrt-harvest-spike.md` section 6b for who could provide them.
 */
import { QuickJsShimError, SHIM_ERROR_CODES, isWindows } from "./host.ts"
import { fileUrlToPath, notImplemented } from "./internal.ts"

function encodeFilePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
}

/** `url.pathToFileURL(path)` -> a `file:` URL object. */
export function pathToFileURL(path: string | URL): URL {
  const text = typeof path === "string" ? path : path instanceof URL ? fileUrlToPath(path.href) : String(path)
  const windows = hostIsWindows()
  const slashes = text.replace(/\\/g, "/")
  if (windows) {
    if (/^[A-Za-z]:/.test(slashes)) return new URL(`file:///${encodeFilePath(slashes)}`)
    if (slashes.startsWith("//")) return new URL(`file://${encodeFilePath(slashes.slice(2))}`)
    return new URL(`file://${encodeFilePath(slashes)}`)
  }
  const absolute = slashes.startsWith("/") ? slashes : `/${slashes}`
  return new URL(`file://${encodeFilePath(absolute)}`)
}

/** `url.fileURLToPath(url)` -> a host path string. Accepts a URL object or a `file:` string. */
export function fileURLToPath(url: string | URL): string {
  const href = typeof url === "string" ? url : url instanceof URL ? url.href : String(url)
  if (!href.startsWith("file:")) {
    throw new QuickJsShimError(SHIM_ERROR_CODES.signatureUnsupported, `url.fileURLToPath: expected a file: URL, got ${JSON.stringify(href.slice(0, 16))}`)
  }
  return fileUrlToPath(href)
}

function hostIsWindows(): boolean {
  try {
    return isWindows()
  } catch {
    return false
  }
}

/** WHATWG URL / URLSearchParams are engine globals; forward them lazily (ADR-0074 decision 1). */
export function getURL(): typeof URL {
  const value = (globalThis as Record<string, unknown>).URL as typeof URL | undefined
  if (typeof value !== "function") throw notImplemented("url", "URL", "the executor must enable quickjs-wpt-sys for WHATWG URL")
  return value
}

export function getURLSearchParams(): typeof URLSearchParams {
  const value = (globalThis as Record<string, unknown>).URLSearchParams as typeof URLSearchParams | undefined
  if (typeof value !== "function") throw notImplemented("url", "URLSearchParams", "the executor must enable quickjs-wpt-sys for URLSearchParams")
  return value
}

// Legacy `url.parse`/`url.format`/`url.resolve` and `Url` have three parsing modes and are not used by the node
// set. `URL` is the supported spelling. They are exported as throws so a stray import fails at the call site.
export const parse: () => never = notImplemented("url", "parse")
export const format: () => never = notImplemented("url", "format")
export const resolve: () => never = notImplemented("url", "resolve")
export const domainToASCII: (domain: string) => string = (domain) => domain
export const domainToUnicode: (domain: string) => string = (domain) => domain

const namespace = { pathToFileURL, fileURLToPath, getURL, getURLSearchParams, parse, format, resolve, domainToASCII, domainToUnicode }
export default namespace
