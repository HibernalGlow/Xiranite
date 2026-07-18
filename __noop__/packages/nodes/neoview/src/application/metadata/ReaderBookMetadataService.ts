import type { ReaderBook, ViewSource } from "../../domain/book/book.js"
import type { ReaderDirectoryEmmRecordStore } from "../../ports/ReaderDirectoryEmmRecordStore.js"
import { legacyEmmBookPathKey, parseLegacyEmmBookMetadata, type ReaderBookEmmMetadata } from "./LegacyEmmBookMetadataCodec.js"

export interface ReaderBookStaticMetadata {
  bookId: string
  displayName: string
  sourcePath: string
  sourceKind: ViewSource["kind"]
  sourceFormat?: "pdf" | "epub"
  pageCount: number
  emm?: ReaderBookEmmMetadata
}

export class ReaderBookMetadataService {
  constructor(private readonly records?: ReaderDirectoryEmmRecordStore) {}

  async load(book: ReaderBook, signal?: AbortSignal): Promise<ReaderBookStaticMetadata> {
    signal?.throwIfAborted()
    const sourceFormat = book.source.kind === "document" ? book.source.format : undefined
    const base: ReaderBookStaticMetadata = {
      bookId: book.id,
      displayName: book.displayName,
      sourcePath: book.source.path,
      sourceKind: book.source.kind,
      sourceFormat,
      pageCount: book.pages.length,
    }
    if (!this.records?.directoryEmmAvailable) return base
    const key = legacyEmmBookPathKey(book.source.path)
    const records = await this.records.readDirectoryEmmRecords([key], signal)
    signal?.throwIfAborted()
    const emm = parseLegacyEmmBookMetadata(records.get(key)?.emmJson)
    return emm ? { ...base, emm } : base
  }
}
