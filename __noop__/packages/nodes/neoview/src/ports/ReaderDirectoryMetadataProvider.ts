import type { ReaderDirectoryEntry } from "./ReaderDirectoryListingProvider.js"

export type ReaderDirectoryMetadataField =
  | "date"
  | "size"
  | "rating"
  | "collectTagCount"
  | "dimensions"
  | "pageCount"
  | "tags"

export interface ReaderDirectoryMetadataProvider {
  readonly supportedFields: ReadonlySet<ReaderDirectoryMetadataField>
  hydrate(
    entries: readonly ReaderDirectoryEntry[],
    fields: ReadonlySet<ReaderDirectoryMetadataField>,
    signal?: AbortSignal,
  ): Promise<readonly ReaderDirectoryEntry[]>
}
