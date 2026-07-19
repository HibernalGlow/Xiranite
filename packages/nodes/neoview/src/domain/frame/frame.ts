import type { ReadingDirection } from "../navigation/navigation.js"
import type { PageId } from "../page/page.js"

export type ReaderGeneration = number
export type PageMode = "single" | "double"
export type ReaderPagePart = 0 | 1

export interface FrameCropInsets {
  top: number
  right: number
  bottom: number
  left: number
}

export interface ReaderLayout {
  pageMode: PageMode
  panorama: boolean
  singleFirstPage: boolean
  singleLastPage: boolean
  treatWidePageAsSingle: boolean
  /** Split landscape pages into two navigation positions in single-page mode. */
  splitWidePages?: boolean
}

export interface FramePage {
  pageId: PageId
  pageIndex: number
  side: "single" | "left" | "right"
  /** Physical half: 0 is left and 1 is right. Omitted for a full page. */
  part?: ReaderPagePart
  cropInsets?: FrameCropInsets
}

export interface FrameSnapshot {
  generation: ReaderGeneration
  anchorPageIndex: number
  /** Physical half of the anchor page. Omitted for a full page. */
  anchorPart?: ReaderPagePart
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
  splitWidePages: false,
}
