export interface ReaderSearchHistoryRecord {
  scope: string
  query: string
  usedAt: number
  useCount: number
}

export interface ReaderSearchHistoryStore extends AsyncDisposable {
  listSearchHistory(scope: string, limit: number): Promise<readonly ReaderSearchHistoryRecord[]>
  recordSearchHistory(record: Omit<ReaderSearchHistoryRecord, "useCount">, maximumEntries: number): Promise<ReaderSearchHistoryRecord>
  deleteSearchHistory(scope: string, query: string): Promise<boolean>
  clearSearchHistory(scope: string): Promise<number>
  close(): Promise<void>
}
