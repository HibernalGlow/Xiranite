import type { ViewSource } from "../domain/book/book.js"
import type { ReaderDataImportBatch, ReaderDataImportResult, ReaderDataStore } from "../ports/ReaderDataStore.js"
import type { DecodedLegacyReaderData, LegacyReaderDataReportEntry } from "./LegacyReaderDataCodec.js"

export interface ResolvedReaderSourceIdentity {
  bookId: string
  source: ViewSource
  canonical: boolean
}

export interface LegacyReaderDataImportResult {
  applied: ReaderDataImportResult
  unresolvedSources: number
  reportEntries: readonly LegacyReaderDataReportEntry[]
}

export class LegacyReaderDataImporter implements AsyncDisposable {
  #closed = false

  constructor(
    private readonly store: ReaderDataStore,
    private readonly resolveIdentity: (source: ViewSource) => Promise<ResolvedReaderSourceIdentity>,
  ) {}

  async import(decoded: DecodedLegacyReaderData, strategy: "merge" | "overwrite"): Promise<LegacyReaderDataImportResult> {
    if (this.#closed) throw new Error("Legacy reader data importer is closed.")
    const batch: ReaderDataImportBatch = {
      progress: [],
      bookmarks: [],
      bookmarkLists: decoded.bookmarkLists.map((list) => ({ ...list, updatedAt: list.createdAt })),
      pathStacks: [],
      mediaProgress: [],
    }
    const progress = batch.progress as Array<ReaderDataImportBatch["progress"][number]>
    const bookmarks = batch.bookmarks as Array<ReaderDataImportBatch["bookmarks"][number]>
    const pathStacks = batch.pathStacks as Array<ReaderDataImportBatch["pathStacks"][number]>
    const mediaProgress = batch.mediaProgress as Array<ReaderDataImportBatch["mediaProgress"][number]>
    const reportEntries: LegacyReaderDataReportEntry[] = []
    let unresolvedSources = 0

    for (const item of decoded.history) {
      const identity = await this.resolveIdentity(item.source)
      if (!identity.canonical) {
        unresolvedSources += 1
        reportEntries.push({ area: "history", disposition: "normalized", message: "Imported a missing or unavailable source with a best-effort identity." })
      }
      const isMedia = identity.source.kind === "media" || item.videoProgress !== undefined
      progress.push({
        bookId: identity.bookId,
        source: identity.source,
        displayName: item.displayName,
        pageIndex: isMedia ? 0 : item.pageIndex,
        pageCount: isMedia ? 1 : item.pageCount,
        updatedAt: item.updatedAt,
      })
      if (item.pathStack.length > 1 || item.pathStack.some((ref) => ref.innerPath)) {
        pathStacks.push({ bookId: identity.bookId, pathStack: item.pathStack, updatedAt: item.updatedAt })
      }
      if (item.videoProgress) {
        mediaProgress.push({ bookId: identity.bookId, updatedAt: item.updatedAt, ...item.videoProgress })
      }
    }

    for (const item of decoded.bookmarks) {
      const identity = await this.resolveIdentity(item.source)
      if (!identity.canonical) {
        unresolvedSources += 1
        reportEntries.push({ area: "bookmark", disposition: "normalized", message: "Imported a missing or unavailable bookmark source with a best-effort identity." })
      }
      bookmarks.push({
        id: item.id,
        source: identity.source,
        name: item.name,
        kind: item.kind,
        starred: item.starred,
        createdAt: item.createdAt,
        updatedAt: item.createdAt,
        listIds: item.listIds.filter((id) => id !== "favorites" && id !== "all"),
      })
    }

    return {
      applied: await this.store.importData(batch, strategy),
      unresolvedSources,
      reportEntries,
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    await this.store.close()
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close()
  }
}
