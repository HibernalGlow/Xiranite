import type { PageId, ReaderGeneration, ReaderPage, ReadingDirection } from "./core.js"

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

export interface BuildFrameInput {
  pages: readonly ReaderPage[]
  anchorPageIndex: number
  generation: ReaderGeneration
  direction: ReadingDirection
  layout: ReaderLayout
}

export const DEFAULT_READER_LAYOUT: ReaderLayout = {
  pageMode: "single",
  panorama: false,
  singleFirstPage: true,
  singleLastPage: true,
  treatWidePageAsSingle: true,
}

export function buildFrameSnapshot(input: BuildFrameInput): FrameSnapshot {
  const pageCount = input.pages.length
  const anchorPageIndex = clampPageIndex(input.anchorPageIndex, pageCount)
  const framePages = selectFramePages(input.pages, anchorPageIndex, input.layout)
  const ordered = input.direction === "right-to-left" && framePages.length === 2
    ? [...framePages].reverse()
    : framePages
  const pages = ordered.map((page, index): FramePage => ({
    pageId: page.id,
    pageIndex: page.index,
    side: ordered.length === 1 ? "single" : index === 0 ? "left" : "right",
  }))
  return {
    generation: input.generation,
    anchorPageIndex,
    direction: input.direction,
    layout: { ...input.layout },
    pages,
    pageCount,
    atStart: pageCount === 0 || anchorPageIndex === 0,
    atEnd: pageCount === 0 || pages.some((page) => page.pageIndex === pageCount - 1),
  }
}

function selectFramePages(pages: readonly ReaderPage[], anchor: number, layout: ReaderLayout): ReaderPage[] {
  const current = pages[anchor]
  if (!current) return []
  if (layout.pageMode === "single" || isWide(current, layout)) return [current]
  if (layout.singleFirstPage && anchor === 0) return [current]
  if (layout.singleLastPage && anchor === pages.length - 1) return [current]
  const next = pages[anchor + 1]
  if (!next || isWide(next, layout)) return [current]
  return [current, next]
}

function isWide(page: ReaderPage, layout: ReaderLayout): boolean {
  return Boolean(layout.treatWidePageAsSingle && page.dimensions && page.dimensions.width > page.dimensions.height)
}

function clampPageIndex(index: number, pageCount: number): number {
  if (pageCount === 0) return 0
  if (!Number.isFinite(index)) return 0
  return Math.min(Math.max(Math.trunc(index), 0), pageCount - 1)
}
