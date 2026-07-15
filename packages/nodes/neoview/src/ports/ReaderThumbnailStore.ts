export interface ReaderThumbnailAsset {
  bytes: Uint8Array
  contentType?: string
  sourceSize?: number
  date?: string
  generationHash?: number
}

export type ReaderThumbnailCategory = "file" | "folder"

export interface ReaderThumbnailWrite {
  key: string
  category: ReaderThumbnailCategory
  bytes: Uint8Array
  sourceSize?: number
  date?: string
  generationHash?: number
}

export interface ReaderThumbnailFailure {
  key: string
  reason: string
  retryCount: number
  lastAttempt: string
  errorMessage?: string
}

export interface ReaderThumbnailStore {
  get(key: string, category: ReaderThumbnailCategory): Promise<ReaderThumbnailAsset | undefined>
  put?(thumbnail: ReaderThumbnailWrite): Promise<void>
  getFailure?(key: string): Promise<ReaderThumbnailFailure | undefined>
  recordFailure?(failure: Omit<ReaderThumbnailFailure, "retryCount">): Promise<void>
}
