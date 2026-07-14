import { describe, expect, it } from "vitest"
import type { ReaderPage } from "../page/page.js"
import { buildFrameSnapshot } from "./frame-builder.js"
import { DEFAULT_READER_LAYOUT } from "./frame.js"

const pages: ReaderPage[] = [
  page(0, 800, 1200),
  page(1, 800, 1200),
  page(2, 1600, 900),
  page(3, 800, 1200),
]

describe("buildFrameSnapshot", () => {
  it("[neoview.frame.boundaries] clamps an out-of-range page and keeps empty books stable", () => {
    expect(snapshot(pages, 99).anchorPageIndex).toBe(3)
    expect(snapshot([], 5)).toMatchObject({ anchorPageIndex: 0, pages: [], atStart: true, atEnd: true })
  })

  it("[neoview.frame.layout] keeps the cover and a wide following page single", () => {
    const cover = snapshot(pages, 0, { pageMode: "double" })
    const pair = snapshot(pages, 1, { pageMode: "double", singleFirstPage: false })
    expect(cover.pages.map((item) => item.pageIndex)).toEqual([0])
    expect(pair.pages.map((item) => item.pageIndex)).toEqual([1])
  })

  it("[neoview.frame.layout] pairs two portrait pages when neither page is a protected wide page", () => {
    const portraitPages = [page(0, 800, 1200), page(1, 800, 1200), page(2, 800, 1200)]
    const frame = snapshot(portraitPages, 1, { pageMode: "double", singleFirstPage: false, singleLastPage: false })
    expect(frame.pages).toEqual([
      { pageId: "page-1", pageIndex: 1, side: "left" },
      { pageId: "page-2", pageIndex: 2, side: "right" },
    ])
  })

  it("[neoview.frame.layout] reverses the visual sides for right-to-left reading", () => {
    const portraitPages = [page(0, 800, 1200), page(1, 800, 1200)]
    const frame = buildFrameSnapshot({
      pages: portraitPages,
      anchorPageIndex: 0,
      generation: 4,
      direction: "right-to-left",
      layout: { ...DEFAULT_READER_LAYOUT, pageMode: "double", singleFirstPage: false, singleLastPage: false },
    })
    expect(frame.pages.map((item) => [item.pageIndex, item.side])).toEqual([[1, "left"], [0, "right"]])
  })

  it("[neoview.frame.layout] keeps a wide page single and reports frame boundaries", () => {
    const frame = snapshot(pages, 2, { pageMode: "double", singleFirstPage: false, singleLastPage: false })
    expect(frame.pages.map((item) => item.pageIndex)).toEqual([2])
    expect(frame.atStart).toBe(false)
    expect(frame.atEnd).toBe(false)
  })
})

function snapshot(sourcePages: ReaderPage[], anchorPageIndex: number, layout: Partial<typeof DEFAULT_READER_LAYOUT> = {}) {
  return buildFrameSnapshot({
    pages: sourcePages,
    anchorPageIndex,
    generation: 1,
    direction: "left-to-right",
    layout: { ...DEFAULT_READER_LAYOUT, ...layout },
  })
}

function page(index: number, width: number, height: number): ReaderPage {
  return {
    id: `page-${index}`,
    index,
    name: `${index}.jpg`,
    sourcePath: `C:/book/${index}.jpg`,
    mediaKind: "image",
    dimensions: { width, height },
    contentVersion: "fixture-v1",
    content: {
      async load() {
        throw new Error("Frame tests do not load page content.")
      },
    },
  }
}
