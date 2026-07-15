import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient, ReaderPageDto, ReaderSessionDto } from "../../../adapters/reader-http-client"
import PageNavigationCard from "./PageNavigationCard"

afterEach(cleanup)

describe("PageNavigationCard", () => {
  it("[neoview.page-list.virtual] requests only visible metadata and skips thumbnail prewarm in text mode", async () => {
    const listPageCatalog = vi.fn(async (_sessionId: string, cursor: number, limit: number) => ({
      pages: Array.from({ length: limit }, (_, offset) => page(cursor + offset)),
      nextCursor: cursor + limit < 1_000 ? cursor + limit : undefined,
      total: 1_000,
    }))
    render(<PageNavigationCard {...context(clientWith({ listPageCatalog }))} />)

    await waitFor(() => expect(listPageCatalog).toHaveBeenCalledWith(
      "reader-1",
      0,
      64,
      { query: "", thumbnails: false },
      expect.any(AbortSignal),
    ))
    expect(document.querySelectorAll('[data-page-index]').length).toBeLessThanOrEqual(24)
  })

  it("[neoview.page-list.search] cancels the old catalog generation and searches server-side", async () => {
    const signals: AbortSignal[] = []
    const listPageCatalog = vi.fn((_sessionId: string, cursor: number, limit: number, options: { query?: string }, signal?: AbortSignal) => {
      if (signal) signals.push(signal)
      if (!options.query) {
        return new Promise<never>((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true }))
      }
      return Promise.resolve({ pages: Array.from({ length: Math.min(limit, 3) }, (_, offset) => page(cursor + offset)), total: 3 })
    })
    render(<PageNavigationCard {...context(clientWith({ listPageCatalog }))} />)
    await waitFor(() => expect(listPageCatalog).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByRole("textbox", { name: "搜索页面" }), { target: { value: "chapter" } })

    await waitFor(() => expect(listPageCatalog).toHaveBeenLastCalledWith(
      "reader-1",
      0,
      64,
      { query: "chapter", thumbnails: false },
      expect.any(AbortSignal),
    ))
    expect(signals[0]?.aborted).toBe(true)
    expect(await screen.findByText("3 / 1000")).toBeTruthy()
  })

  it("[neoview.page-list.thumbnail-mode] requests thumbnails only after the image mode is selected", async () => {
    const listPageCatalog = vi.fn(async (_sessionId: string, cursor: number, limit: number) => ({
      pages: Array.from({ length: limit }, (_, offset) => page(cursor + offset)),
      total: 100,
    }))
    render(<PageNavigationCard {...context(clientWith({ listPageCatalog }))} />)
    await waitFor(() => expect(listPageCatalog).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole("button", { name: "带图列表" }))
    await waitFor(() => expect(listPageCatalog).toHaveBeenLastCalledWith(
      "reader-1",
      0,
      64,
      { query: "", thumbnails: true },
      expect.any(AbortSignal),
    ))
  })

  it("[neoview.page-list.retry] exposes a bounded retry instead of leaving a failed catalog in loading state", async () => {
    const listPageCatalog = vi.fn()
      .mockRejectedValueOnce(new Error("catalog unavailable"))
      .mockResolvedValueOnce({ pages: [page(0)], total: 1 })
    render(<PageNavigationCard {...context(clientWith({ listPageCatalog }))} />)

    expect((await screen.findByRole("alert")).textContent).toContain("catalog unavailable")
    fireEvent.click(screen.getByRole("button", { name: "重试" }))
    await waitFor(() => expect(listPageCatalog).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull())
  })
})

function context(client: ReaderHttpClient) {
  return { client, disabled: false, session: session(), onGoTo: vi.fn() }
}

function clientWith(overrides: Partial<ReaderHttpClient>): ReaderHttpClient {
  return {
    config: vi.fn(), updateSidebarLayout: vi.fn(), updateCardLayout: vi.fn(), updateBoardLayout: vi.fn(),
    updateViewDefaults: vi.fn(), updateSlideshow: vi.fn(), open: vi.fn(), listPages: vi.fn(), navigate: vi.fn(),
    goTo: vi.fn(), updateSessionOptions: vi.fn(), close: vi.fn(), ...overrides,
  }
}

function session(): ReaderSessionDto {
  return {
    sessionId: "reader-1",
    book: { id: "book-1", displayName: "book.cbz", pageCount: 1_000 },
    frame: {
      generation: 1,
      anchorPageIndex: 0,
      direction: "left-to-right",
      layout: { pageMode: "single", panorama: false, singleFirstPage: true, singleLastPage: true, treatWidePageAsSingle: true },
      pages: [{ pageId: "page-0", pageIndex: 0, side: "single" }],
      pageCount: 1_000,
      atStart: true,
      atEnd: false,
    },
    visiblePages: [page(0)],
  }
}

function page(index: number): ReaderPageDto {
  return {
    id: `page-${index}`,
    index,
    name: `${String(index + 1).padStart(4, "0")}.jpg`,
    mediaKind: "image",
    contentVersion: "v1",
    assetUrl: `/reader/page-${index}`,
    thumbnailUrl: `/reader/thumbnail-${index}`,
  }
}
