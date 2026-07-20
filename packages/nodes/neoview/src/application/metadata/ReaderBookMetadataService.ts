import type { ReaderBook, ViewSource } from "../../domain/book/book.js"
import type { ReaderDirectoryEmmRecordStore } from "../../ports/ReaderDirectoryEmmRecordStore.js"
import type { ReaderEmmCatalogTag } from "../../ports/ReaderEmmTagCatalogStore.js"
import { emmTranslationKey } from "../../ports/ReaderEmmTagTranslation.js"
import { legacyEmmBookPathKey, parseLegacyEmmBookMetadata, type ReaderBookEmmMetadata } from "./LegacyEmmBookMetadataCodec.js"

export interface ReaderBookEmmTagTranslationSource {
  translate(tags: readonly ReaderEmmCatalogTag[], signal?: AbortSignal): Promise<ReadonlyMap<string, string>>
}

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
  constructor(
    private readonly records?: ReaderDirectoryEmmRecordStore,
    private readonly translations?: ReaderBookEmmTagTranslationSource,
  ) {}

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
    const record = records.get(key)
    const emm = parseLegacyEmmBookMetadata(record?.emmJson, record?.manualTags)
    if (!emm) return base
    if (!emm.tags.length || !this.translations) return { ...base, emm }
    const translations = await this.translations.translate(
      emm.tags.map(({ namespace, tag }) => ({ category: namespace, tag })),
      signal,
    ).catch(() => new Map<string, string>())
    signal?.throwIfAborted()
    return {
      ...base,
      emm: {
        ...emm,
        tags: emm.tags.map((value) => {
          const translatedLabel = translations.get(emmTranslationKey({ category: value.namespace, tag: value.tag }))
          return translatedLabel && translatedLabel !== value.tag ? { ...value, translatedLabel } : value
        }),
      },
    }
  }
}
