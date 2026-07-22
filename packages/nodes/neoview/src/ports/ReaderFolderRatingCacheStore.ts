import type { ReaderFolderRatingEntry } from "../application/metadata/ReaderFolderRatingCache.js"

export interface ReaderFolderRatingCacheSnapshot {
  entries: readonly ReaderFolderRatingEntry[]
  updatedAt?: number
}

export interface ReaderFolderRatingCacheStore {
  loadFolderRatingCache(): Promise<ReaderFolderRatingCacheSnapshot>
  replaceFolderRatingCache(entries: readonly ReaderFolderRatingEntry[], updatedAt: number): Promise<void>
  clearFolderRatingCache(): Promise<void>
}
