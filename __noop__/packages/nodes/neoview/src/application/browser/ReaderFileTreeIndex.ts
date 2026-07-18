import { dirname, isAbsolute, relative, resolve } from "node:path"

import { LRUCache } from "lru-cache"

import type {
  ReaderDirectoryEntry,
  ReaderDirectoryListing,
  ReaderDirectoryListingProvider,
} from "../../ports/ReaderDirectoryListingProvider.js"
import { DEFAULT_READER_DIRECTORY_SORT, sortReaderDirectoryEntries } from "./ReaderDirectorySort.js"

const DEFAULT_MAXIMUM_CACHE_ENTRIES = 512
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1_000
const MAXIMUM_EXCLUDED_PATHS = 256

export interface ReaderFileTreeIndexOptions {
  excludedPaths?: readonly string[]
  maximumCacheEntries?: number
  cacheTtlMs?: number
  updateExcludedPaths?: (paths: readonly string[]) => Promise<readonly string[]>
}

export interface ReaderFileTreeNodePage {
  path: string
  parentPath?: string
  entries: readonly ReaderDirectoryEntry[]
  generation: number
  cacheHit: boolean
  excludedPaths: readonly string[]
}

export type ReaderFileTreeExclusionCommand = {
  action: "exclude" | "include"
  path: string
}

export class ReaderFileTreeIndex {
  readonly #cache: LRUCache<string, ReaderDirectoryListing, string>
  readonly #updateExcludedPaths?: ReaderFileTreeIndexOptions["updateExcludedPaths"]
  #excludedPaths: string[]
  #generation = 1
  #updateQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly provider: ReaderDirectoryListingProvider,
    options: ReaderFileTreeIndexOptions = {},
  ) {
    this.#excludedPaths = normalizeExcludedPaths(options.excludedPaths ?? [])
    this.#updateExcludedPaths = options.updateExcludedPaths
    this.#cache = new LRUCache<string, ReaderDirectoryListing, string>({
      max: boundedInteger(options.maximumCacheEntries, 1, 4_096, DEFAULT_MAXIMUM_CACHE_ENTRIES),
      ttl: boundedInteger(options.cacheTtlMs, 1_000, 24 * 60 * 60 * 1_000, DEFAULT_CACHE_TTL_MS),
      fetchMethod: async (_key, _staleValue, { signal, context }) => this.provider.read(context, signal),
    })
  }

  async read(path: string, refresh = false, signal?: AbortSignal): Promise<ReaderFileTreeNodePage> {
    const requestedPath = requirePath(path)
    if (this.isExcluded(requestedPath)) throw new Error(`Reader file tree path is excluded: ${requestedPath}`)
    const key = pathKey(requestedPath)
    const cacheHit = !refresh && this.#cache.has(key)
    if (refresh) this.#cache.delete(key)
    const listing = await this.#cache.fetch(key, { signal, context: requestedPath })
    if (!listing) throw new Error(`Reader file tree path is unavailable: ${requestedPath}`)
    signal?.throwIfAborted()
    const entries = sortReaderDirectoryEntries(
      listing.entries.filter((entry) => entry.kind === "directory" && !this.isExcluded(entry.path)),
      DEFAULT_READER_DIRECTORY_SORT,
      listing.path,
    )
    return {
      path: listing.path,
      parentPath: listing.parentPath,
      entries,
      generation: this.#generation,
      cacheHit,
      excludedPaths: [...this.#excludedPaths],
    }
  }

  async updateExclusion(command: ReaderFileTreeExclusionCommand, signal?: AbortSignal): Promise<readonly string[]> {
    let result: readonly string[] = []
    const operation = this.#updateQueue.then(async () => {
      result = await this.#applyExclusion(command, signal)
    })
    this.#updateQueue = operation.catch(() => undefined)
    await operation
    return result
  }

  async #applyExclusion(command: ReaderFileTreeExclusionCommand, signal?: AbortSignal): Promise<readonly string[]> {
    if (!this.#updateExcludedPaths) throw new Error("Reader file tree exclusions are read-only.")
    signal?.throwIfAborted()
    const requestedPath = requirePath(command.path)
    let candidate = requestedPath
    if (command.action === "exclude") {
      candidate = this.provider.canonicalize
        ? await this.provider.canonicalize(requestedPath, signal)
        : (await this.provider.read(requestedPath, signal)).path
      signal?.throwIfAborted()
    }
    const candidateKey = pathKey(candidate)
    const next = command.action === "exclude"
      ? normalizeExcludedPaths([...this.#excludedPaths, candidate])
      : this.#excludedPaths.filter((path) => pathKey(path) !== candidateKey)
    if (next.length === this.#excludedPaths.length && next.every((path, index) => path === this.#excludedPaths[index])) {
      return [...this.#excludedPaths]
    }
    const persisted = normalizeExcludedPaths(await this.#updateExcludedPaths(next))
    this.#excludedPaths = persisted
    this.clear()
    return [...this.#excludedPaths]
  }

  clear(path?: string): number {
    if (path) this.#cache.delete(pathKey(path))
    else this.#cache.clear()
    this.#generation += 1
    return this.#generation
  }

  invalidate(changedPath: string): void {
    const changed = requirePath(changedPath)
    this.#cache.delete(pathKey(changed))
    this.#cache.delete(pathKey(dirname(changed)))
    this.#generation += 1
  }

  isExcluded(path: string): boolean {
    const candidate = pathKey(path)
    return this.#excludedPaths.some((excluded) => isSameOrDescendant(candidate, pathKey(excluded)))
  }

  exclusionPatterns(rootPath: string): string[] {
    const root = resolve(requirePath(rootPath))
    const patterns: string[] = []
    for (const excludedPath of this.#excludedPaths) {
      const child = relative(root, resolve(excludedPath))
      if (!child) return ["**"]
      if (isAbsolute(child) || child === ".." || child.startsWith(`..${separatorFor(child)}`)) continue
      patterns.push(`${child.replaceAll("\\", "/")}/`)
    }
    return patterns
  }

  snapshot(): { generation: number; size: number; excludedPaths: readonly string[] } {
    return { generation: this.#generation, size: this.#cache.size, excludedPaths: [...this.#excludedPaths] }
  }
}

function normalizeExcludedPaths(paths: readonly string[]): string[] {
  if (paths.length > MAXIMUM_EXCLUDED_PATHS) throw new Error(`Reader file tree accepts at most ${MAXIMUM_EXCLUDED_PATHS} excluded paths.`)
  const output = new Map<string, string>()
  for (const path of paths) {
    const value = resolve(requirePath(path))
    output.set(pathKey(value), value)
  }
  return [...output.values()]
}

function requirePath(path: string): string {
  const value = path.trim()
  if (!value || value.length > 32_767 || value.includes("\0")) throw new Error("Reader file tree path must be non-empty and contain no NUL.")
  return value
}

function pathKey(path: string): string {
  const normalized = resolve(path).replaceAll("\\", "/").replace(/\/+$/u, "")
  return process.platform === "win32" ? normalized.toLocaleLowerCase() : normalized
}

function isSameOrDescendant(candidate: string, ancestor: string): boolean {
  return candidate === ancestor || candidate.startsWith(`${ancestor}/`)
}

function separatorFor(path: string): string {
  return path.includes("\\") ? "\\" : "/"
}

function boundedInteger(value: number | undefined, minimum: number, maximum: number, fallback: number): number {
  return value === undefined ? fallback : Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : fallback
}
