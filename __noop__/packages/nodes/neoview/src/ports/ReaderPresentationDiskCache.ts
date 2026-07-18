import type { CachedPresentation } from "./ReaderPresentationCache.js"

export interface ReaderPresentationDiskCacheLease extends CachedPresentation {
  readonly key: string
  release(): void
  [Symbol.dispose](): void
}

export interface ReaderPresentationDiskCacheSnapshot {
  entries: number
  bytes: number
  maxBytes: number
  maxEntryBytes: number
  activeLeases: number
  hits: number
  misses: number
  writes: number
  rejectedWrites: number
  evictions: number
  integrityFailures: number
}

export interface ReaderPresentationDiskCacheCleanupResult extends ReaderPresentationDiskCacheSnapshot {
  reason: "budget" | "age" | "explicit" | "low-disk"
  removedEntries: number
  removedBytes: number
  durationMs: number
}

export interface ReaderPresentationDiskCache {
  readonly maxEntryBytes: number
  acquire(key: string, signal?: AbortSignal): Promise<ReaderPresentationDiskCacheLease | undefined>
  put(key: string, value: CachedPresentation, signal?: AbortSignal): Promise<boolean>
  invalidate(key: string): Promise<void>
  clear(): Promise<ReaderPresentationDiskCacheCleanupResult>
  cleanup(reason?: ReaderPresentationDiskCacheCleanupResult["reason"]): Promise<ReaderPresentationDiskCacheCleanupResult>
  snapshot(): Promise<ReaderPresentationDiskCacheSnapshot>
  close(): Promise<void>
  [Symbol.asyncDispose](): Promise<void>
}
