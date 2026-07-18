import { pageMediaType, pathExtension, type ReaderMediaTypeResolver } from "../../domain/page/media.js"
import type { ReaderDirectoryEntry } from "../../ports/ReaderDirectoryListingProvider.js"

const ARCHIVE_BOOK_EXTENSIONS = new Set(["zip", "cbz", "rar", "cbr", "7z", "cb7", "epub"])

export type PlatformReaderBookFileKind = "archive" | "video"

export function platformReaderBookFileKind(
  path: string,
  mediaFormats?: ReaderMediaTypeResolver,
): PlatformReaderBookFileKind | undefined {
  if (ARCHIVE_BOOK_EXTENSIONS.has(pathExtension(path))) return "archive"
  return pageMediaType(path, mediaFormats)?.kind === "video" ? "video" : undefined
}

export function platformReaderBookCandidate(
  entry: ReaderDirectoryEntry,
  mediaFormats?: ReaderMediaTypeResolver,
): boolean {
  if (!entry.readerSupported) return false
  if (entry.kind === "directory") return true
  if (entry.kind !== "file") return false
  if (pathExtension(entry.path) === "lnk") return entry.readerSupported
  return platformReaderBookFileKind(entry.path, mediaFormats) !== undefined
}
