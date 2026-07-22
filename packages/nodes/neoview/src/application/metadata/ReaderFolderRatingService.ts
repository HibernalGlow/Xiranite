import { buildReaderFolderRatingCache, normalizeReaderFolderRatingPath, type ReaderFolderRatingEntry } from "./ReaderFolderRatingCache.js"
import type { ReaderEmmRatingCatalogStore } from "../../ports/ReaderEmmRatingCatalogStore.js"
import type { ReaderFolderRatingCacheSnapshot, ReaderFolderRatingCacheStore } from "../../ports/ReaderFolderRatingCacheStore.js"

export class ReaderFolderRatingService {
  constructor(
    private readonly catalog: ReaderEmmRatingCatalogStore,
    private readonly cache: ReaderFolderRatingCacheStore,
    private readonly now: () => number = Date.now,
  ) {}

  load(): Promise<ReaderFolderRatingCacheSnapshot> { return this.cache.loadFolderRatingCache() }

  async rebuild(signal?: AbortSignal): Promise<ReaderFolderRatingCacheSnapshot> {
    const records = await this.catalog.listEmmRatingRecords(signal)
    signal?.throwIfAborted()
    const updatedAt = this.now()
    const entries = buildReaderFolderRatingCache(records)
    await this.cache.replaceFolderRatingCache(entries, updatedAt)
    return { entries, updatedAt }
  }

  async supplement(path: string): Promise<ReaderFolderRatingCacheSnapshot> {
    const snapshot = await this.cache.loadFolderRatingCache()
    const root = normalizeReaderFolderRatingPath(path)
    if (!root || root.length > 32_768 || root.includes("\0")) throw new Error("Folder rating path is invalid.")
    const entries = supplementEntries(snapshot.entries, root)
    const updatedAt = this.now()
    await this.cache.replaceFolderRatingCache(entries, updatedAt)
    return { entries, updatedAt }
  }

  clear(): Promise<void> { return this.cache.clearFolderRatingCache() }
}

function supplementEntries(entries: readonly ReaderFolderRatingEntry[], root: string): readonly ReaderFolderRatingEntry[] {
  const byPath = new Map(entries.map((entry) => [normalizeReaderFolderRatingPath(entry.path), entry]))
  const directChildren = [...byPath.values()].filter((entry) => parent(entry.path) === root)
  if (!directChildren.length || byPath.has(root)) return entries
  byPath.set(root, { path: root, averageRating: directChildren.reduce((sum, entry) => sum + entry.averageRating, 0) / directChildren.length, count: directChildren.length, direct: false })
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path))
}

function parent(path: string): string | undefined {
  const normalized = normalizeReaderFolderRatingPath(path)
  const separator = normalized.lastIndexOf("/")
  return separator > 2 ? normalized.slice(0, separator) : undefined
}
