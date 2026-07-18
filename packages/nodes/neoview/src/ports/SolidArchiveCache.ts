export interface SolidArchiveCacheSnapshot {
  entries: number
  retainedBytes: number
  maxBytes: number
  activeEntries: number
  activeLeases: number
  memoryBytes?: number
  maxMemoryBytes?: number
  maxMemoryEntryBytes?: number
}
