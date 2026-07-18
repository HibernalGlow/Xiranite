import pMap from "p-map"

import type { ViewSource } from "../domain/book/book.js"
import type {
  ReaderBookSettingsImportRecord,
  ReaderBookSettingsImportResult,
  ReaderBookSettingsStore,
} from "../ports/ReaderBookSettingsStore.js"
import type { DecodedLegacyBookSettings } from "./LegacyBookSettingsCodec.js"

export interface ResolvedBookSettingsIdentity {
  bookId: string
  source: ViewSource
  canonical: boolean
}

export interface LegacyBookSettingsImportResult {
  applied: ReaderBookSettingsImportResult
  unresolvedSources: number
  duplicateIdentities: number
}

export class LegacyBookSettingsImporter {
  constructor(
    private readonly store: ReaderBookSettingsStore,
    private readonly resolveIdentity: (source: ViewSource) => Promise<ResolvedBookSettingsIdentity>,
    private readonly now: () => number = Date.now,
  ) {}

  async import(
    decoded: DecodedLegacyBookSettings,
    strategy: "merge" | "overwrite",
    signal?: AbortSignal,
  ): Promise<LegacyBookSettingsImportResult> {
    signal?.throwIfAborted()
    const resolved = await pMap(decoded.entries, async (entry) => {
      signal?.throwIfAborted()
      const identity = await this.resolveIdentity({ kind: "path", path: entry.path })
      signal?.throwIfAborted()
      return { identity, overrides: entry.overrides }
    }, { concurrency: 8 })
    const records = new Map<string, ReaderBookSettingsImportRecord>()
    let unresolvedSources = 0
    let duplicateIdentities = 0
    for (const item of resolved) {
      if (!item.identity.canonical) unresolvedSources += 1
      if (records.has(item.identity.bookId)) duplicateIdentities += 1
      records.set(item.identity.bookId, { bookId: item.identity.bookId, overrides: item.overrides })
    }
    signal?.throwIfAborted()
    return {
      applied: await this.store.importBookSettings([...records.values()], strategy, this.now()),
      unresolvedSources,
      duplicateIdentities,
    }
  }
}
