import { opendir, realpath, stat } from "node:fs/promises"
import { dirname, join } from "node:path"

import { pageMediaType, pathExtension, type ReaderMediaTypeResolver } from "../../domain/page/media.js"
import type {
  ReaderDirectoryEntry,
  ReaderDirectoryListing,
  ReaderDirectoryListingProvider,
} from "../../ports/ReaderDirectoryListingProvider.js"
import { platformReaderBookFileKind } from "./PlatformReaderBookCandidate.js"
import { normalizePlatformDirectoryPath } from "./PlatformDirectoryPath.js"

const MAX_DIRECTORY_ENTRIES = 100_000

export class PlatformDirectoryListingProvider implements ReaderDirectoryListingProvider {
  constructor(private readonly mediaFormats?: ReaderMediaTypeResolver) {}

  async canonicalize(path: string, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    const canonicalPath = normalizePlatformDirectoryPath(await realpath(normalizePlatformDirectoryPath(path)))
    const sourceStats = await stat(canonicalPath)
    signal?.throwIfAborted()
    if (!sourceStats.isDirectory()) throw new Error(`Reader browser path is not a directory: ${path}`)
    return canonicalPath
  }

  async read(path: string, signal?: AbortSignal): Promise<ReaderDirectoryListing> {
    signal?.throwIfAborted()
    const canonicalPath = normalizePlatformDirectoryPath(await realpath(normalizePlatformDirectoryPath(path)))
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
        readerSupported: kind === "directory" || (kind === "file" && isReaderSupported(entry.name, this.mediaFormats)),
      })
    }
    signal?.throwIfAborted()
    const parentPath = dirname(directoryPath)
    return {
      path: directoryPath,
      parentPath: parentPath === directoryPath ? undefined : parentPath,
      entries,
    }
  }
}

function isReaderSupported(path: string, mediaFormats?: ReaderMediaTypeResolver): boolean {
  return Boolean(pageMediaType(path, mediaFormats)) || platformReaderBookFileKind(path, mediaFormats) !== undefined || pathExtension(path) === "pdf"
}
