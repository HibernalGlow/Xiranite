export type ReaderDirectoryEntryKind = "directory" | "file" | "other"

export interface ReaderDirectoryEntry {
  name: string
  path: string
  kind: ReaderDirectoryEntryKind
  readerSupported: boolean
  modifiedAt?: number
  size?: number
  rating?: number
  collectTagCount?: number
  width?: number
  height?: number
  pageCount?: number
  tags?: readonly string[]
  collectTags?: readonly string[]
  manualTags?: readonly string[]
}

export interface ReaderDirectoryListing {
  path: string
  parentPath?: string
  entries: readonly ReaderDirectoryEntry[]
}

export interface ReaderDirectoryListingProvider {
  canonicalize?(path: string, signal?: AbortSignal): Promise<string>
  read(path: string, signal?: AbortSignal): Promise<ReaderDirectoryListing>
}
