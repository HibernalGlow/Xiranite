import type { ReaderDirectoryEntry } from "../../ports/ReaderDirectoryListingProvider.js"
import type { ReaderDirectoryEntryType } from "../../application/browser/ReaderFileTreeService.js"
import type { ReaderMediaTypeResolver } from "../../domain/page/media.js"
import { platformReaderBookFileKind } from "./PlatformReaderBookCandidate.js"

export function platformReaderDirectoryEntryType(
  entry: ReaderDirectoryEntry,
  mediaFormats?: ReaderMediaTypeResolver,
): ReaderDirectoryEntryType {
  if (entry.kind === "directory") return "directory"
  if (entry.kind !== "file") return "other"
  return platformReaderBookFileKind(entry.path, mediaFormats) ?? "other"
}
