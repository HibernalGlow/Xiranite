import { renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient, ReaderPageDto } from "../../adapters/reader-http-client"
import { useReaderAdjacentPagePreloader } from "./useReaderAdjacentPagePreloader"

describe("useReaderAdjacentPagePreloader", () => {
  it("[neoview.react.predecode] preloads neighbors independently of the thumbnail edge lifecycle", async () => {
    const pages = [page(3), page(4), page(5)]
    const client = clientWith({
      listPages: vi.fn(async () => ({ pages, total: 20 })),
    })
    const preload = vi.fn()
    renderHook(() => useReaderAdjacentPagePreloader({
      client,
      sessionId: "reader-1",
      activePageIndex: 4,
      totalPages: 20,
      preload,
    }))

    await waitFor(() => expect(client.listPages).toHaveBeenCalledWith("reader-1", 3, 3, expect.any(AbortSignal)))
    await waitFor(() => expect(preload).toHaveBeenCalledWith([pages[0], pages[2]]))
  })

  it("[neoview.react.predecode] aborts stale adjacent-page discovery", () => {
    const signals: AbortSignal[] = []
    const client = clientWith({
      listPages: vi.fn((_sessionId, _cursor, _limit, signal) => {
        signals.push(signal!)
        return new Promise(() => undefined)
      }),
    })
    const preload = vi.fn()
    const view = renderHook(({ pageIndex }) => useReaderAdjacentPagePreloader({
      client,
      sessionId: "reader-1",
      activePageIndex: pageIndex,
      totalPages: 20,
      preload,
    }), { initialProps: { pageIndex: 2 } })

    view.rerender({ pageIndex: 3 })
    expect(signals[0]?.aborted).toBe(true)
    view.unmount()
    expect(signals[1]?.aborted).toBe(true)
  })
})

function clientWith(overrides: Partial<ReaderHttpClient>): ReaderHttpClient {
  return {
    open: vi.fn(),
    listPages: vi.fn(),
    navigate: vi.fn(),
    goTo: vi.fn(),
    close: vi.fn(),
    ...overrides,
  }
}

function page(index: number): ReaderPageDto {
  return {
    id: `page-${index}`,
    index,
    name: `${index + 1}.jpg`,
    mediaKind: "image",
    mimeType: "image/jpeg",
    contentVersion: "v1",
    assetUrl: `http://127.0.0.1:41000/reader/page-${index}`,
  }
}
