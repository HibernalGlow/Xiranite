export interface ReaderEmmRatingCatalogRecord {
  path: string
  rating: number
}

export interface ReaderEmmRatingCatalogStore {
  listEmmRatingRecords(signal?: AbortSignal): Promise<readonly ReaderEmmRatingCatalogRecord[]>
}
