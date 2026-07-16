export interface CachedPresentation {
  readonly bytes: Uint8Array
  readonly contentType: string
}

export interface ReaderPresentationCacheSnapshot {
  entries: number
  bytes: number
  maxBytes: number
  maxEntryBytes: number
  hits: number
  misses: number
  evictions: number
}

export interface ReaderPresentationCache {
  readonly maxEntryBytes: number
  get(key: string): CachedPresentation | undefined
  set(key: string, value: CachedPresentation): boolean
  trimTo?(maxBytes: number): void
  clear(): void
  snapshot(): ReaderPresentationCacheSnapshot
}
