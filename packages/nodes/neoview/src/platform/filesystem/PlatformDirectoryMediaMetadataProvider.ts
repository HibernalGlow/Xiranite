import { Readable } from "node:stream"

import type { ReaderDirectoryEntry } from "../../ports/ReaderDirectoryListingProvider.js"
import { pageMediaType } from "../../domain/page/media.js"
import type {
  ReaderDirectoryMetadataField,
  ReaderDirectoryMetadataProvider,
} from "../../ports/ReaderDirectoryMetadataProvider.js"
import type { ImageMetadataProbe } from "../../ports/ImageMetadataProbe.js"
import type { ReaderBookLoader } from "../../ports/ReaderBookLoader.js"

const MEDIA_METADATA_CONCURRENCY = 2

export class PlatformDirectoryMediaMetadataProvider implements ReaderDirectoryMetadataProvider {
  readonly supportedFields = new Set<ReaderDirectoryMetadataField>(["dimensions", "pageCount"])

  constructor(
    private readonly bookLoader: ReaderBookLoader,
    private readonly imageMetadataProbe: ImageMetadataProbe,
  ) {}

  async hydrate(
    entries: readonly ReaderDirectoryEntry[],
    fields: ReadonlySet<ReaderDirectoryMetadataField>,
    signal?: AbortSignal,
  ): Promise<readonly ReaderDirectoryEntry[]> {
    if (!fields.has("dimensions") && !fields.has("pageCount")) return entries
    return Readable.from(entries).map(
      (entry) => this.#hydrateEntry(entry, fields, signal),
      { concurrency: MEDIA_METADATA_CONCURRENCY },
    ).toArray()
  }

  async #hydrateEntry(
    entry: ReaderDirectoryEntry,
    fields: ReadonlySet<ReaderDirectoryMetadataField>,
    signal?: AbortSignal,
  ): Promise<ReaderDirectoryEntry> {
    const media = pageMediaType(entry.path)
    const wantsDimensions = fields.has("dimensions")
      && media !== undefined
      && media.kind !== "video"
      && (!validDimension(entry.width) || !validDimension(entry.height))
    const wantsPageCount = fields.has("pageCount") && !validPageCount(entry.pageCount)
    if (entry.kind !== "file" || !entry.readerSupported || (!wantsDimensions && !wantsPageCount)) return entry
    signal?.throwIfAborted()
    let book: Awaited<ReturnType<ReaderBookLoader>> | undefined
    try {
      book = await this.bookLoader({ kind: "path", path: entry.path }, { signal })
      signal?.throwIfAborted()
      const firstPage = book.pages[0]
      const dimensions = wantsDimensions && firstPage
        ? firstPage.dimensions ?? (await this.imageMetadataProbe.probe(firstPage.content, firstPage.mimeType, signal))?.dimensions
        : undefined
      signal?.throwIfAborted()
      return {
        ...entry,
        width: dimensions?.width ?? entry.width,
        height: dimensions?.height ?? entry.height,
        pageCount: wantsPageCount ? book.pages.length : entry.pageCount,
      }
    } catch (error) {
      if (signal?.aborted) throw error
      return entry
    } finally {
      await book?.close().catch(() => undefined)
    }
  }
}

function validDimension(value: number | undefined): boolean {
  return Number.isSafeInteger(value) && value! > 0
}

function validPageCount(value: number | undefined): boolean {
  return Number.isSafeInteger(value) && value! >= 0
}
