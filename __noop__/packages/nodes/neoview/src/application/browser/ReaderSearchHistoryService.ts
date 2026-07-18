import type {
  ReaderSearchHistoryRecord,
  ReaderSearchHistoryStore,
} from "../../ports/ReaderSearchHistoryStore.js"

export const READER_SEARCH_HISTORY_SCOPES = ["folder", "file", "bookmark", "history"] as const
export type ReaderSearchHistoryScope = typeof READER_SEARCH_HISTORY_SCOPES[number]

export class ReaderSearchHistoryService {
  constructor(
    private readonly store: ReaderSearchHistoryStore,
    private readonly clock: () => number = Date.now,
    private readonly maximumEntries = 20,
  ) {
    if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 1 || maximumEntries > 100) {
      throw new Error("Reader search history maximumEntries must be from 1 to 100.")
    }
  }

  list(scope: ReaderSearchHistoryScope, limit = this.maximumEntries): Promise<readonly ReaderSearchHistoryRecord[]> {
    assertScope(scope)
    assertLimit(limit)
    return this.store.listSearchHistory(scope, Math.min(limit, this.maximumEntries))
  }

  record(scope: ReaderSearchHistoryScope, query: string): Promise<ReaderSearchHistoryRecord> {
    assertScope(scope)
    const normalizedQuery = normalizeQuery(query)
    const usedAt = this.clock()
    assertTimestamp(usedAt)
    return this.store.recordSearchHistory({ scope, query: normalizedQuery, usedAt }, this.maximumEntries)
  }

  remove(scope: ReaderSearchHistoryScope, query: string): Promise<boolean> {
    assertScope(scope)
    return this.store.deleteSearchHistory(scope, normalizeQuery(query))
  }

  clear(scope: ReaderSearchHistoryScope): Promise<number> {
    assertScope(scope)
    return this.store.clearSearchHistory(scope)
  }
}

function assertScope(scope: string): asserts scope is ReaderSearchHistoryScope {
  if (!(READER_SEARCH_HISTORY_SCOPES as readonly string[]).includes(scope)) {
    throw new Error(`Unsupported Reader search history scope: ${scope}`)
  }
}

function normalizeQuery(query: string): string {
  const value = query.trim()
  if (!value || value.length > 512 || value.includes("\0")) {
    throw new Error("Reader search history query must be 1..512 characters without NUL.")
  }
  return value
}

function assertLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("Reader search history limit must be from 1 to 100.")
}

function assertTimestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Reader search history clock is invalid.")
}
