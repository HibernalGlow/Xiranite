export interface SolidArchiveIndexCacheSnapshot {
  entries: number
  maxEntries: number
  payloadBytes: number
  maxPayloadBytes: number
  hits: number
  misses: number
  evictions: number
}

export interface SolidArchiveCacheSnapshot {
  entries: number
  retainedBytes: number
  maxBytes: number
  activeEntries: number
  activeLeases: number
  memoryBytes?: number
  maxMemoryBytes?: number
  maxMemoryEntryBytes?: number
  indexCache?: SolidArchiveIndexCacheSnapshot
}
