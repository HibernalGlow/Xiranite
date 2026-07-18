import { opendir, stat } from "node:fs/promises"
import { dirname, join } from "node:path"

import { pageMediaType, pathExtension, type ReaderMediaTypeResolver } from "../../domain/page/media.js"
import type {
  ReaderDirectoryEntry,
  ReaderDirectoryListing,
  ReaderDirectoryListingProvider,
} from "../../ports/ReaderDirectoryListingProvider.js"
import type { ReaderShortcutResolver } from "../../ports/ReaderShortcutResolver.js"
import { platformReaderBookFileKind } from "./PlatformReaderBookCandidate.js"
import { canonicalizePlatformDirectoryPath } from "./PlatformDirectoryPath.js"
import { resolveReaderShortcutChain } from "../windows/WindowsReaderShortcutResolver.js"

const MAX_DIRECTORY_ENTRIES = 100_000

export class PlatformDirectoryListingProvider implements ReaderDirectoryListingProvider {
  constructor(
    private readonly mediaFormats?: ReaderMediaTypeResolver,
    private readonly shortcutResolver?: ReaderShortcutResolver,
  ) {}

  async canonicalize(path: string, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    const canonicalPath = await resolveListingPath(path, this.shortcutResolver, signal)
    const sourceStats = await stat(canonicalPath)
    signal?.throwIfAborted()
    if (!sourceStats.isDirectory()) throw new Error(`Reader browser path is not a directory: ${path}`)
    return canonicalPath
  }

  async read(path: string, signal?: AbortSignal): Promise<ReaderDirectoryListing> {
    signal?.throwIfAborted()
    const canonicalPath = await resolveListingPath(path, this.shortcutResolver, signal)
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
        readerSupported: kind === "directory" || (kind === "file" && await isReaderSupported(join(directoryPath, entry.name), this.mediaFormats, this.shortcutResolver, signal)),
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

async function isReaderSupported(
  path: string,
  mediaFormats?: ReaderMediaTypeResolver,
  shortcutResolver?: ReaderShortcutResolver,
  signal?: AbortSignal,
): Promise<boolean> {
  let candidatePath = path
  if (pathExtension(candidatePath) === "lnk") {
    if (!shortcutResolver) return false
    try {
      const resolved = await resolveReaderShortcutChain(candidatePath, shortcutResolver, signal)
      if (resolved.kind === "directory") return true
      candidatePath = resolved.path
    } catch {
      return false
    }
  }
  return Boolean(pageMediaType(candidatePath, mediaFormats)) || platformReaderBookFileKind(candidatePath, mediaFormats) !== undefined || pathExtension(candidatePath) === "pdf" || pathExtension(candidatePath) === "epub"
}

async function resolveListingPath(path: string, shortcutResolver: ReaderShortcutResolver | undefined, signal?: AbortSignal): Promise<string> {
  const canonicalPath = await canonicalizePlatformDirectoryPath(path)
  if (pathExtension(canonicalPath) !== "lnk") return canonicalPath
  if (!shortcutResolver) return canonicalPath
  return (await resolveReaderShortcutChain(canonicalPath, shortcutResolver, signal)).path
}
