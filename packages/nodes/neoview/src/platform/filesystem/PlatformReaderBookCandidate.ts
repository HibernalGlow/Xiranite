import { pathExtension, type ReaderMediaTypeResolver } from "../../domain/page/media.js"
import type { ReaderDirectoryEntry } from "../../ports/ReaderDirectoryListingProvider.js"

const ARCHIVE_BOOK_EXTENSIONS = new Set(["zip", "cbz", "rar", "cbr", "7z", "cb7", "epub"])

export function platformReaderBookCandidate(
  entry: ReaderDirectoryEntry,
  mediaFormats?: ReaderMediaTypeResolver,
): boolean {
  if (!entry.readerSupported) return false
  if (entry.kind === "directory") return true
  if (entry.kind !== "file") return false
  if (ARCHIVE_BOOK_EXTENSIONS.has(pathExtension(entry.path))) return true
  return mediaFormats?.resolve(entry.path)?.kind === "video"
}
