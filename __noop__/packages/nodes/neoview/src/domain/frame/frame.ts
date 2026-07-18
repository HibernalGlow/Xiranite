import type { ReadingDirection } from "../navigation/navigation.js"
import type { PageId } from "../page/page.js"

export type ReaderGeneration = number
export type PageMode = "single" | "double"

export interface ReaderLayout {
  pageMode: PageMode
  panorama: boolean
  singleFirstPage: boolean
  singleLastPage: boolean
  treatWidePageAsSingle: boolean
}

export interface FramePage {
  pageId: PageId
  pageIndex: number
  side: "single" | "left" | "right"
}

export interface FrameSnapshot {
  generation: ReaderGeneration
  anchorPageIndex: number
  direction: ReadingDirection
  layout: ReaderLayout
  pages: readonly FramePage[]
  pageCount: number
  atStart: boolean
  atEnd: boolean
}

export const DEFAULT_READER_LAYOUT: ReaderLayout = {
  pageMode: "single",
  panorama: false,
  singleFirstPage: true,
  singleLastPage: true,
  treatWidePageAsSingle: true,
}
