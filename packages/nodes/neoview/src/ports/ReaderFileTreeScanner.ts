export type ReaderFileTreeEntryKind = "directory" | "file" | "other"

export interface ReaderFileTreeEntry {
  name: string
  path: string
  relativePath: string
  depth: number
  kind: ReaderFileTreeEntryKind
}

export interface ReaderFileTreeScanOptions {
  maximumDepth?: number
  maximumEntries?: number
  includeDirectories?: boolean
  includeFiles?: boolean
  includeOther?: boolean
}

export interface ReaderFileTreeScanner {
  scan(rootPath: string, options?: ReaderFileTreeScanOptions, signal?: AbortSignal): AsyncIterable<ReaderFileTreeEntry>
}
