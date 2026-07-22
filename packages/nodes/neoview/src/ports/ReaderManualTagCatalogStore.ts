export interface ReaderManualTagSummary { namespace: string; tag: string; count: number }
export interface ReaderManualTagCatalogStore {
  listManualTagSummaries(limit: number, signal?: AbortSignal): Promise<readonly ReaderManualTagSummary[]>
}
