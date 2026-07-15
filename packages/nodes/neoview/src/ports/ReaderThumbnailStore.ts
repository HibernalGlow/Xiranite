export interface ReaderThumbnailAsset {
  bytes: Uint8Array
  contentType?: string
  date?: string
  generationHash?: number
}

export interface ReaderThumbnailStore {
  get(key: string, category: "file" | "folder"): Promise<ReaderThumbnailAsset | undefined>
}
