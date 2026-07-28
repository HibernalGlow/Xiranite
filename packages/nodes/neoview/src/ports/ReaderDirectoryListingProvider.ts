export type ReaderDirectoryEntryKind = "directory" | "file" | "other"
export type ReaderDirectorySourceKind = "directory" | "efu"

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
  /** True only after a direct child-entry probe confirms the directory is empty. */
  directoryEmpty?: boolean
  tags?: readonly string[]
  collectTags?: readonly string[]
  manualTags?: readonly string[]
}

export interface ReaderDirectoryListing {
  path: string
  parentPath?: string
  sourceKind?: ReaderDirectorySourceKind
  entries: readonly ReaderDirectoryEntry[]
}

export interface ReaderDirectoryListingProvider {
  canonicalize?(path: string, signal?: AbortSignal): Promise<string>
  exists?(path: string, signal?: AbortSignal): Promise<boolean>
  read(path: string, signal?: AbortSignal): Promise<ReaderDirectoryListing>
}
