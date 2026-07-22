import type { ReaderBook, ViewSource } from "../../domain/book/book.js"
import type { ReaderDirectoryEmmRecordStore, ReaderEmmRawField } from "../../ports/ReaderDirectoryEmmRecordStore.js"
import type { ReaderEmmCatalogTag } from "../../ports/ReaderEmmTagCatalogStore.js"
import type { ReaderEmmOverrideStore } from "../../ports/ReaderEmmOverrideStore.js"
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
  emmRaw?: { schemaVersion: 1; fields: readonly ReaderEmmRawField[] }
}

export class ReaderBookMetadataService {
  constructor(
    private readonly records?: ReaderDirectoryEmmRecordStore,
    private readonly translations?: ReaderBookEmmTagTranslationSource,
    private readonly overrides?: ReaderEmmOverrideStore,
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
    const key = legacyEmmBookPathKey(book.source.path)
    const records = this.records?.directoryEmmAvailable
      ? await this.records.readDirectoryEmmRecords([key], signal, { includeRaw: true })
      : new Map()
    signal?.throwIfAborted()
    const record = records.get(key)
    const override = await this.overrides?.getEmmOverride(key)
    signal?.throwIfAborted()
    const sourceEmm = parseLegacyEmmBookMetadata(record?.emmJson)
    const inheritedManualTags = parseLegacyEmmBookMetadata(undefined, record?.manualTags)?.tags ?? []
    const manualTags = override?.overrides.manualTags ?? inheritedManualTags
    const emm = composeEmm(sourceEmm, manualTags, override?.overrides.translatedTitle)
    const emmRaw = record?.rawFields?.length ? { schemaVersion: 1 as const, fields: record.rawFields } : undefined
    if (!emm) return emmRaw ? { ...base, emmRaw } : base
    if (!emm.tags.length || !this.translations) return { ...base, emm, ...(emmRaw ? { emmRaw } : {}) }
    const translations = await this.translations.translate(
      emm.tags.map(({ namespace, tag }) => ({ category: namespace, tag })),
      signal,
    ).catch(() => new Map<string, string>())
    signal?.throwIfAborted()
    return {
      ...base,
      ...(emmRaw ? { emmRaw } : {}),
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

function composeEmm(
  source: ReaderBookEmmMetadata | undefined,
  manualTags: readonly { namespace: string; tag: string }[],
  translatedTitle: string | undefined,
): ReaderBookEmmMetadata | undefined {
  const tags = [...(source?.tags ?? []), ...manualTags]
  const title = translatedTitle ?? source?.translatedTitle
  if (!tags.length && !title) return undefined
  return { ...(title ? { translatedTitle: title } : {}), tags }
}
