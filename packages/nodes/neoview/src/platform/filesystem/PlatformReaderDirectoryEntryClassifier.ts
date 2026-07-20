import type { ReaderDirectoryEntry } from "../../ports/ReaderDirectoryListingProvider.js"
import type { ReaderDirectoryEntryType } from "../../domain/browser/ReaderDirectoryFilter.js"
import type { ReaderMediaTypeResolver } from "../../domain/page/media.js"
import { platformReaderBookFileKind } from "./PlatformReaderBookCandidate.js"

export function platformReaderDirectoryEntryType(
  entry: Pick<ReaderDirectoryEntry, "path" | "kind">,
  mediaFormats?: ReaderMediaTypeResolver,
): ReaderDirectoryEntryType {
  if (entry.kind === "directory") return "directory"
  if (entry.kind !== "file") return "other"
  const bookKind = platformReaderBookFileKind(entry.path, mediaFormats)
  if (bookKind === "archive") return "archive"
  if (bookKind === "video") return "video"
  const media = mediaFormats?.resolve(entry.path)
  if (media?.kind === "image") return "image"
  if (media?.kind === "video") return "video"
  return "other"
}
