export type ReaderDirectoryEntryKind = "directory" | "file" | "other"

export interface ReaderDirectoryEntry {
  name: string
  path: string
  kind: ReaderDirectoryEntryKind
  readerSupported: boolean
}

export interface ReaderDirectoryListing {
  path: string
  parentPath?: string
  entries: readonly ReaderDirectoryEntry[]
}

export interface ReaderDirectoryListingProvider {
  read(path: string, signal?: AbortSignal): Promise<ReaderDirectoryListing>
}
