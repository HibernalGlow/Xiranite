export type PageId = string

export type PageMediaKind = "image" | "animated-image" | "video" | "document-page"

export interface PageDimensions {
  width: number
  height: number
}

export interface ReaderPage {
  id: PageId
  index: number
  name: string
  sourcePath: string
  entryPath?: string
  mediaKind: PageMediaKind
  mimeType?: string
  byteLength?: number
  dimensions?: PageDimensions
}
