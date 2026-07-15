import { stat } from "node:fs/promises"
import { Readable } from "node:stream"

import type { ReaderDirectoryEntry } from "../../ports/ReaderDirectoryListingProvider.js"
import type {
  ReaderDirectoryMetadataField,
  ReaderDirectoryMetadataProvider,
} from "../../ports/ReaderDirectoryMetadataProvider.js"

const STAT_CONCURRENCY = 16

export class PlatformDirectoryMetadataProvider implements ReaderDirectoryMetadataProvider {
  readonly supportedFields = new Set<ReaderDirectoryMetadataField>(["date", "size"])

  async hydrate(
    entries: readonly ReaderDirectoryEntry[],
    fields: ReadonlySet<ReaderDirectoryMetadataField>,
    signal?: AbortSignal,
  ): Promise<readonly ReaderDirectoryEntry[]> {
    const statFields = fields.has("date") || fields.has("size")
    if (!statFields) return entries
    return Readable.from(entries).map(async (entry) => {
      signal?.throwIfAborted()
      try {
        const metadata = await stat(entry.path)
        signal?.throwIfAborted()
        return {
          ...entry,
          modifiedAt: fields.has("date") ? metadata.mtimeMs : entry.modifiedAt,
          size: fields.has("size") && metadata.isFile() ? metadata.size : entry.size,
        }
      } catch (error) {
        if (signal?.aborted) throw error
        return entry
      }
    }, { concurrency: STAT_CONCURRENCY, signal }).toArray()
  }
}
