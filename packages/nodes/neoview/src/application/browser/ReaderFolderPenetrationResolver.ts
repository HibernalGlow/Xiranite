import { resolve } from "node:path"

import { LRUCache } from "lru-cache"

import { pageMediaType, pathExtension, type ReaderMediaTypeResolver } from "../../domain/page/media.js"
import type {
  ReaderDirectoryEntry,
  ReaderDirectoryListingProvider,
} from "../../ports/ReaderDirectoryListingProvider.js"

const DEFAULT_MAXIMUM_CACHE_ENTRIES = 512
const DEFAULT_CACHE_TTL_MS = 30_000
const HARD_MAXIMUM_DEPTH = 32
const ARCHIVE_EXTENSIONS = new Set(["zip", "cbz", "rar", "cbr", "7z", "cb7"])
const DOCUMENT_EXTENSIONS = new Set(["pdf", "epub"])
const SIDECAR_EXTENSIONS = new Set([
  "ass", "idx", "json", "log", "nfo", "srt", "ssa", "sub", "txt", "url", "vtt", "xml",
])

export type ReaderFolderPenetrationTerminalKind = "archive" | "document" | "media-directory" | "file"
export type ReaderFolderPenetrationReason =
  | "archive"
  | "document"
  | "media-directory"
  | "file"
  | "multiple-primary-items"
  | "empty"
  | "depth-limit"
  | "cycle"
  | "permission"
  | "unsupported-content"

export interface ReaderFolderPenetrationPolicy {
  maxDepth?: number
  terminalTargets?: readonly ReaderFolderPenetrationTerminalKind[]
}

export interface ReaderFolderPenetrationStep {
  path: string
  canonicalPath: string
  ignoredSidecars: number
}

export interface ReaderFolderPenetrationResolution {
  status: "resolved" | "branch" | "empty" | "blocked"
  originPath: string
  terminal?: { kind: ReaderFolderPenetrationTerminalKind; path: string }
  chain: readonly ReaderFolderPenetrationStep[]
  reason: ReaderFolderPenetrationReason
}

export interface ReaderFolderPenetrationResolverOptions {
  mediaFormats?: ReaderMediaTypeResolver
  maximumCacheEntries?: number
  cacheTtlMs?: number
}

interface NormalizedPolicy {
  maxDepth: number
  terminalTargets: ReadonlySet<ReaderFolderPenetrationTerminalKind>
  cacheKey: string
}

interface ClassifiedEntries {
  directories: ReaderDirectoryEntry[]
  archives: ReaderDirectoryEntry[]
  documents: ReaderDirectoryEntry[]
  media: ReaderDirectoryEntry[]
  files: ReaderDirectoryEntry[]
  sidecars: ReaderDirectoryEntry[]
  unsupported: ReaderDirectoryEntry[]
}

interface PenetrationFlight {
  controller: AbortController
  consumers: number
  promise: Promise<ReaderFolderPenetrationResolution>
}

export class ReaderFolderPenetrationResolver {
  readonly #cache: LRUCache<string, ReaderFolderPenetrationResolution>
  readonly #flights = new Map<string, PenetrationFlight>()

  constructor(
    private readonly provider: ReaderDirectoryListingProvider,
    private readonly options: ReaderFolderPenetrationResolverOptions = {},
  ) {
    this.#cache = new LRUCache({
      max: boundedInteger(options.maximumCacheEntries, 1, 4_096, DEFAULT_MAXIMUM_CACHE_ENTRIES),
      ttl: boundedInteger(options.cacheTtlMs, 1_000, 5 * 60_000, DEFAULT_CACHE_TTL_MS),
    })
  }

  async resolve(
    originPath: string,
    policy: ReaderFolderPenetrationPolicy = {},
    signal?: AbortSignal,
  ): Promise<ReaderFolderPenetrationResolution> {
    const origin = requirePath(originPath)
    const normalizedPolicy = normalizePolicy(policy)
    const key = `${pathKey(origin)}\u0000${normalizedPolicy.cacheKey}`
    const cached = this.#cache.get(key)
    if (cached) return cloneResolution(cached)

    let flight = this.#flights.get(key)
    if (!flight) {
      const controller = new AbortController()
      const promise = this.#resolve(origin, normalizedPolicy, controller.signal)
        .then((resolution) => {
          if (resolution.reason !== "permission") this.#cache.set(key, resolution)
          return resolution
        })
        .finally(() => this.#flights.delete(key))
      flight = { controller, consumers: 0, promise }
      this.#flights.set(key, flight)
    }
    flight.consumers += 1
    try {
      const resolution = await waitForCaller(flight.promise, signal)
      return cloneResolution(resolution)
    } finally {
      flight.consumers -= 1
      if (flight.consumers === 0 && this.#flights.get(key) === flight) {
        flight.controller.abort(new DOMException("Penetration resolution has no consumers.", "AbortError"))
      }
    }
  }

  clear(): void {
    this.#cache.clear()
  }

  invalidate(path: string): void {
    const changed = pathKey(requirePath(path))
    for (const [key, resolution] of this.#cache.entries()) {
      if (resolution.chain.some((step) => isSameOrDescendant(pathKey(step.canonicalPath), changed)
        || isSameOrDescendant(changed, pathKey(step.canonicalPath)))) this.#cache.delete(key)
    }
  }

  snapshot(): { cacheSize: number; activeFlights: number } {
    return { cacheSize: this.#cache.size, activeFlights: this.#flights.size }
  }

  async #resolve(
    originPath: string,
    policy: NormalizedPolicy,
    signal?: AbortSignal,
  ): Promise<ReaderFolderPenetrationResolution> {
    const chain: ReaderFolderPenetrationStep[] = []
    const visited = new Set<string>()
    let currentPath = originPath

    for (let depth = 0; depth <= policy.maxDepth; depth += 1) {
      signal?.throwIfAborted()
      let listing
      try {
        listing = await this.provider.read(currentPath, signal)
      } catch (error) {
        signal?.throwIfAborted()
        return result("blocked", originPath, chain, "permission")
      }
      signal?.throwIfAborted()
      const canonicalPath = this.provider.canonicalize
        ? await this.provider.canonicalize(listing.path, signal)
        : listing.path
      const canonicalKey = pathKey(canonicalPath)
      if (visited.has(canonicalKey)) return result("blocked", originPath, chain, "cycle")
      visited.add(canonicalKey)

      const classified = classifyEntries(listing.entries, this.options.mediaFormats)
      chain.push({ path: listing.path, canonicalPath, ignoredSidecars: classified.sidecars.length })

      const terminalFiles = [
        ...classified.archives.map((entry) => ({ entry, kind: "archive" as const })),
        ...classified.documents.map((entry) => ({ entry, kind: "document" as const })),
        ...classified.files.map((entry) => ({ entry, kind: "file" as const })),
      ].filter(({ kind }) => policy.terminalTargets.has(kind))
      const hasBlockingFiles = classified.unsupported.length > 0

      if (classified.directories.length === 0) {
        if (terminalFiles.length === 1 && !hasBlockingFiles) {
          const terminal = terminalFiles[0]!
          return resolved(originPath, chain, terminal.kind, terminal.entry.path)
        }
        if (terminalFiles.length === 0 && classified.media.length > 0 && !hasBlockingFiles
          && policy.terminalTargets.has("media-directory")) {
          return resolved(originPath, chain, "media-directory", listing.path)
        }
        if (terminalFiles.length === 0 && classified.media.length === 0 && !hasBlockingFiles) {
          return result("empty", originPath, chain, "empty")
        }
        return result("branch", originPath, chain, terminalFiles.length > 1 ? "multiple-primary-items" : "unsupported-content")
      }

      if (classified.directories.length === 1 && terminalFiles.length === 0 && !hasBlockingFiles) {
        if (depth >= policy.maxDepth) return result("blocked", originPath, chain, "depth-limit")
        currentPath = classified.directories[0]!.path
        continue
      }
      return result("branch", originPath, chain, "multiple-primary-items")
    }
    return result("blocked", originPath, chain, "depth-limit")
  }
}

function classifyEntries(entries: readonly ReaderDirectoryEntry[], mediaFormats?: ReaderMediaTypeResolver): ClassifiedEntries {
  const output: ClassifiedEntries = { directories: [], archives: [], documents: [], media: [], files: [], sidecars: [], unsupported: [] }
  for (const entry of entries) {
    if (entry.kind === "directory") {
      output.directories.push(entry)
      continue
    }
    if (entry.kind !== "file") {
      output.unsupported.push(entry)
      continue
    }
    const extension = pathExtension(entry.path)
    if (ARCHIVE_EXTENSIONS.has(extension)) output.archives.push(entry)
    else if (DOCUMENT_EXTENSIONS.has(extension)) output.documents.push(entry)
    else if (pageMediaType(entry.path, mediaFormats)) output.media.push(entry)
    else if (SIDECAR_EXTENSIONS.has(extension)) output.sidecars.push(entry)
    else if (entry.readerSupported) output.files.push(entry)
    else output.unsupported.push(entry)
  }
  return output
}

function normalizePolicy(policy: ReaderFolderPenetrationPolicy): NormalizedPolicy {
  const maxDepth = boundedInteger(policy.maxDepth, 1, HARD_MAXIMUM_DEPTH, 3)
  const requested = policy.terminalTargets ?? ["archive", "document", "media-directory", "file"]
  const terminalTargets = new Set(requested)
  const ordered = [...terminalTargets].sort()
  return { maxDepth, terminalTargets, cacheKey: `${maxDepth}:${ordered.join(",")}` }
}

function resolved(
  originPath: string,
  chain: readonly ReaderFolderPenetrationStep[],
  kind: ReaderFolderPenetrationTerminalKind,
  path: string,
): ReaderFolderPenetrationResolution {
  return { status: "resolved", originPath, terminal: { kind, path }, chain, reason: kind }
}

function result(
  status: ReaderFolderPenetrationResolution["status"],
  originPath: string,
  chain: readonly ReaderFolderPenetrationStep[],
  reason: ReaderFolderPenetrationReason,
): ReaderFolderPenetrationResolution {
  return { status, originPath, chain, reason }
}

function cloneResolution(resolution: ReaderFolderPenetrationResolution): ReaderFolderPenetrationResolution {
  return {
    ...resolution,
    terminal: resolution.terminal ? { ...resolution.terminal } : undefined,
    chain: resolution.chain.map((step) => ({ ...step })),
  }
}

function requirePath(path: string): string {
  const value = path.trim()
  if (!value || value.length > 32_767 || value.includes("\0")) throw new Error("Reader penetration path must be non-empty and contain no NUL.")
  return value
}

function pathKey(path: string): string {
  const normalized = resolve(path).replaceAll("\\", "/").replace(/\/+$/u, "")
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized
}

function isSameOrDescendant(candidate: string, ancestor: string): boolean {
  return candidate === ancestor || candidate.startsWith(`${ancestor}/`)
}

async function waitForCaller<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  signal.throwIfAborted()
  return await Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
  ])
}

function boundedInteger(value: number | undefined, minimum: number, maximum: number, fallback: number): number {
  if (!Number.isInteger(value)) return fallback
  return Math.min(maximum, Math.max(minimum, value!))
}
