import type { ReaderSearchHistoryStore } from "../ports/ReaderSearchHistoryStore.js"
import type { DecodedLegacySearchHistory } from "./LegacySearchHistoryCodec.js"

export interface LegacySearchHistoryImportResult {
  applied: number
  cleared: number
  skippedNewer: number
}

export class LegacySearchHistoryImporter implements AsyncDisposable {
  #closed = false

  constructor(private readonly store: ReaderSearchHistoryStore) {}

  async import(decoded: DecodedLegacySearchHistory, strategy: "merge" | "overwrite"): Promise<LegacySearchHistoryImportResult> {
    if (this.#closed) throw new Error("Legacy search history importer is closed.")
    let cleared = 0
    if (strategy === "overwrite") {
      for (const scope of decoded.scopes) cleared += await this.store.clearSearchHistory(scope)
    }
    const existing = new Map<string, number>()
    if (strategy === "merge") {
      for (const scope of decoded.scopes) {
        for (const entry of await this.store.listSearchHistory(scope, 100)) existing.set(`${scope}\0${entry.query}`, entry.usedAt)
      }
    }
    let applied = 0
    let skippedNewer = 0
    for (const entry of [...decoded.entries].sort((left, right) => left.usedAt - right.usedAt)) {
      const key = `${entry.scope}\0${entry.query}`
      if ((existing.get(key) ?? -1) >= entry.usedAt) {
        skippedNewer += 1
        continue
      }
      await this.store.recordSearchHistory(entry, 20)
      existing.set(key, entry.usedAt)
      applied += 1
    }
    return { applied, cleared, skippedNewer }
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
