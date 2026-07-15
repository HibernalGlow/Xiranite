import type { PageContent } from "./page-content.js"

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
  thumbnailSource?: {
    key: string
    category: "file" | "folder"
  }
  mediaKind: PageMediaKind
  mimeType?: string
  byteLength?: number
  dimensions?: PageDimensions
  contentVersion: string
  content: PageContent
}
