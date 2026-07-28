import type { ReaderDirectoryEntryDto } from "../../../../adapters/reader-http-client"

/** A directory icon may replace its thumbnail only after a full directory-tree probe succeeds. */
export function folderEntryIsEmptyDirectory(entry: Pick<ReaderDirectoryEntryDto, "kind" | "directoryEmpty">): boolean {
  return entry.kind === "directory" && entry.directoryEmpty === true
}
