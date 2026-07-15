import { opendir, realpath, stat } from "node:fs/promises"
import { dirname, join } from "node:path"

import { pageMediaType, pathExtension } from "../../domain/page/media.js"
import { compareNaturalPath } from "../../domain/sorting/natural-sort.js"
import type {
  ReaderDirectoryEntry,
  ReaderDirectoryListing,
  ReaderDirectoryListingProvider,
} from "../../ports/ReaderDirectoryListingProvider.js"

const READER_EXTENSIONS = new Set(["zip", "cbz", "rar", "cbr", "7z", "cb7", "pdf", "epub"])
const MAX_DIRECTORY_ENTRIES = 100_000

export class PlatformDirectoryListingProvider implements ReaderDirectoryListingProvider {
  async read(path: string, signal?: AbortSignal): Promise<ReaderDirectoryListing> {
    signal?.throwIfAborted()
    const canonicalPath = await realpath(path)
    const sourceStats = await stat(canonicalPath)
    const directoryPath = sourceStats.isDirectory() ? canonicalPath : sourceStats.isFile() ? dirname(canonicalPath) : undefined
    if (!directoryPath) throw new Error(`Reader browser path is not a file or directory: ${path}`)
    signal?.throwIfAborted()
    const entries: ReaderDirectoryEntry[] = []
    const directory = await opendir(directoryPath)
    for await (const entry of directory) {
      signal?.throwIfAborted()
      if (entries.length >= MAX_DIRECTORY_ENTRIES) {
        throw new Error(`Reader browser directory exceeds ${MAX_DIRECTORY_ENTRIES} entries: ${directoryPath}`)
      }
      const kind = entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other"
      entries.push({
        name: entry.name,
        path: join(directoryPath, entry.name),
        kind,
        readerSupported: kind === "directory" || (kind === "file" && isReaderSupported(entry.name)),
      })
    }
    signal?.throwIfAborted()
    entries.sort(compareEntries)
    const parentPath = dirname(directoryPath)
    return {
      path: directoryPath,
      parentPath: parentPath === directoryPath ? undefined : parentPath,
      entries,
    }
  }
}

function compareEntries(left: ReaderDirectoryEntry, right: ReaderDirectoryEntry): number {
  const leftRank = left.kind === "directory" ? 0 : left.kind === "file" ? 1 : 2
  const rightRank = right.kind === "directory" ? 0 : right.kind === "file" ? 1 : 2
  return leftRank - rightRank || compareNaturalPath(left.name, right.name)
}

function isReaderSupported(path: string): boolean {
  return Boolean(pageMediaType(path)) || READER_EXTENSIONS.has(pathExtension(path))
}
