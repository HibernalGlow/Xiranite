export type ReaderLibraryThumbnailWarmupKind = "file" | "folder"
export type ReaderLibraryThumbnailPreviewCount = 1 | 4 | 9 | 16

export interface ReaderLibraryThumbnailWarmupItem {
  id: string
  path: string
  kind: ReaderLibraryThumbnailWarmupKind
  previewCount: ReaderLibraryThumbnailPreviewCount
}

export interface ReaderLibraryThumbnailWarmupPort {
  warm(
    item: ReaderLibraryThumbnailWarmupItem,
    options: { contextId: string; signal?: AbortSignal },
  ): Promise<void>
}
