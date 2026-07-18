export interface ReaderEmmCatalogTag {
  category: string
  tag: string
}

export interface ReaderEmmTagCatalogStore {
  sampleEmmTags(count: number, signal?: AbortSignal): Promise<readonly ReaderEmmCatalogTag[]>
}
