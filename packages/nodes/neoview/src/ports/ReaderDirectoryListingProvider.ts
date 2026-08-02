export type ReaderDirectoryEntryKind = "directory" | "file" | "other"
export type ReaderDirectorySourceKind = "directory" | "efu"

export interface ReaderDirectoryClipmScore {
  label: "P" | "N"
  score: number
  bundleVersion: number
  shortCode: string
  sourcePath: string
}

export interface ReaderDirectoryEntry {
  name: string
  path: string
  kind: ReaderDirectoryEntryKind
  readerSupported: boolean
  modifiedAt?: number
  size?: number
  rating?: number
  collectTagCount?: number
  clipmScore?: ReaderDirectoryClipmScore
  width?: number
  height?: number
  pageCount?: number
  /** True only after a full directory-tree probe confirms it has no non-directory entries. */
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
