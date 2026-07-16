export interface CachedPresentation {
  readonly bytes: Uint8Array
  readonly contentType: string
}

export interface ReaderPresentationCacheSnapshot {
  entries: number
  bytes: number
  pinnedEntries?: number
  pinnedBytes?: number
  activeLeases?: number
  maxBytes: number
  maxEntryBytes: number
  hits: number
  misses: number
  evictions: number
}

export interface ReaderPresentationCacheLease {
  readonly value: CachedPresentation
  release(): void
  [Symbol.dispose](): void
}

export interface ReaderPresentationCache {
  readonly maxEntryBytes: number
  get(key: string): CachedPresentation | undefined
  pin?(key: string): ReaderPresentationCacheLease | undefined
  set(key: string, value: CachedPresentation): boolean
  trimTo?(maxBytes: number): void
  clear(): void
  snapshot(): ReaderPresentationCacheSnapshot
}
