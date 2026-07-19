import type { ReadingDirection } from "../navigation/navigation.js"
import type { ReaderPage } from "../page/page.js"
import type { FrameCropInsets, FramePage, FrameSnapshot, ReaderGeneration, ReaderLayout, ReaderPagePart } from "./frame.js"

export interface BuildFrameInput {
  pages: readonly ReaderPage[]
  anchorPageIndex: number
  anchorPart?: ReaderPagePart
  generation: ReaderGeneration
  direction: ReadingDirection
  layout: ReaderLayout
}

export function buildFrameSnapshot(input: BuildFrameInput): FrameSnapshot {
  const pageCount = input.pages.length
  const anchorPageIndex = clampPageIndex(input.anchorPageIndex, pageCount)
  const anchorPage = input.pages[anchorPageIndex]
  const anchorPart = anchorPage && isSplitWidePage(anchorPage, input.layout)
    ? normalizeReaderPagePart(input.anchorPart, input.direction)
    : undefined
  const framePages = selectFramePages(input.pages, anchorPageIndex, input.layout)
  const ordered = input.direction === "right-to-left" && framePages.length === 2
    ? [...framePages].reverse()
    : framePages
  const pages = ordered.map(({ page, pageIndex }, index): FramePage => {
    const part = pageIndex === anchorPageIndex ? anchorPart : undefined
    return {
      pageId: page.id,
      pageIndex,
      side: ordered.length === 1 ? "single" : index === 0 ? "left" : "right",
      ...(part === undefined ? {} : { part, cropInsets: cropInsetsForPart(part) }),
    }
  })
  const firstPart = firstReaderPagePart(input.direction)
  const secondPart = firstPart === 0 ? 1 : 0
  return {
    generation: input.generation,
    anchorPageIndex,
    ...(anchorPart === undefined ? {} : { anchorPart }),
    direction: input.direction,
    layout: { ...input.layout, splitWidePages: input.layout.splitWidePages ?? false },
    pages,
    pageCount,
    atStart: pageCount === 0 || (anchorPageIndex === 0 && (anchorPart === undefined || anchorPart === firstPart)),
    atEnd: pageCount === 0 || (pages.some((page) => page.pageIndex === pageCount - 1) && (anchorPart === undefined || anchorPart === secondPart)),
  }
}

function selectFramePages(
  pages: readonly ReaderPage[],
  anchor: number,
  layout: ReaderLayout,
): Array<{ page: ReaderPage; pageIndex: number }> {
  const current = pages[anchor]
  if (!current) return []
  const currentEntry = { page: current, pageIndex: anchor }
  if (layout.pageMode === "single" || isWide(current, layout)) return [currentEntry]
  if (layout.singleFirstPage && anchor === 0) return [currentEntry]
  if (layout.singleLastPage && anchor === pages.length - 1) return [currentEntry]
  const next = pages[anchor + 1]
  if (!next || isWide(next, layout)) return [currentEntry]
  return [currentEntry, { page: next, pageIndex: anchor + 1 }]
}

function isWide(page: ReaderPage, layout: ReaderLayout): boolean {
  return Boolean(layout.treatWidePageAsSingle && page.dimensions && page.dimensions.width > page.dimensions.height)
}

export function isSplitWidePage(page: ReaderPage | undefined, layout: ReaderLayout): boolean {
  return Boolean(
    page
    && layout.pageMode === "single"
    && !layout.panorama
    && layout.splitWidePages
    && page.dimensions
    && page.dimensions.width > page.dimensions.height,
  )
}

export function firstReaderPagePart(direction: ReadingDirection): ReaderPagePart {
  return direction === "right-to-left" ? 1 : 0
}

export function secondReaderPagePart(direction: ReadingDirection): ReaderPagePart {
  return firstReaderPagePart(direction) === 0 ? 1 : 0
}

function normalizeReaderPagePart(part: ReaderPagePart | undefined, direction: ReadingDirection): ReaderPagePart {
  return part === 0 || part === 1 ? part : firstReaderPagePart(direction)
}

function cropInsetsForPart(part: ReaderPagePart): FrameCropInsets {
  return part === 0
    ? { top: 0, right: 50, bottom: 0, left: 0 }
    : { top: 0, right: 0, bottom: 0, left: 50 }
}

function clampPageIndex(index: number, pageCount: number): number {
  if (pageCount === 0) return 0
  if (!Number.isFinite(index)) return 0
  return Math.min(Math.max(Math.trunc(index), 0), pageCount - 1)
}
