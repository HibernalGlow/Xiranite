import { renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient, ReaderPageDto } from "../../adapters/reader-http-client"
import { useReaderAdjacentPagePreloader } from "./useReaderAdjacentPagePreloader"

describe("useReaderAdjacentPagePreloader", () => {
  it("[neoview.preload.disabled] performs no adjacent lookup or decode work when disabled from first render", () => {
    const client = clientWith({ listPages: vi.fn() })
    const preload = vi.fn()

    renderHook(() => useReaderAdjacentPagePreloader({
      client,
      sessionId: "reader-disabled",
      activePageIndex: 4,
      totalPages: 20,
      enabled: false,
      preload,
    }))

    expect(client.listPages).not.toHaveBeenCalled()
    expect(client.frameWindow).toBeUndefined()
    expect(preload).not.toHaveBeenCalled()
  })

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

  it("[neoview.preload.plan-react] consumes backend candidate order instead of guessing adjacent pages", async () => {
    const pages = [page(1), page(2), page(3), page(4), page(5)]
    const client = clientWith({ listPages: vi.fn(async () => ({ pages, total: 20 })) })
    const preload = vi.fn()
    renderHook(() => useReaderAdjacentPagePreloader({
      client,
      sessionId: "reader-1",
      activePageIndex: 3,
      totalPages: 20,
      plan: {
        generation: 7,
        frameGeneration: 2,
        direction: "forward",
        directionConfidence: 1,
        mode: "paged",
        admission: "normal",
        velocityPagesPerSecond: 0,
        stableForMs: 150,
        focused: true,
        queueWaitMs: 0,
        memoryPressure: "normal",
        currentPageIndexes: [3],
        candidates: [
          { tier: "near", priority: "view", anchorPageIndex: 4, pageIndexes: [4], pageIds: ["page-4"] },
          { tier: "background", priority: "background", anchorPageIndex: 2, pageIndexes: [2], pageIds: ["page-2"] },
        ],
      },
      preload,
    }))

    await waitFor(() => expect(client.listPages).toHaveBeenCalledWith("reader-1", 2, 3, expect.any(AbortSignal)))
    await waitFor(() => expect(preload).toHaveBeenCalledWith([pages[3], pages[1]], 7))
  })

  it("[neoview.react.predecode] warms frame metadata before decoding adjacent images", async () => {
    const pages = [page(3), page(4), page(5)]
    const frameWindow = vi.fn(async () => ({ frames: [], centerIndex: 4, radius: 1, visiblePages: pages }))
    const client = clientWith({ frameWindow })
    const preload = vi.fn()

    renderHook(() => useReaderAdjacentPagePreloader({
      client,
      sessionId: "reader-1",
      activePageIndex: 4,
      totalPages: 20,
      preload,
    }))

    await waitFor(() => expect(frameWindow).toHaveBeenCalledWith("reader-1", 4, 1, expect.any(AbortSignal)))
    await waitFor(() => expect(preload).toHaveBeenCalledWith([pages[0], pages[2]]))
    expect(client.listPages).not.toHaveBeenCalled()
  })

  it("[neoview.preload.cancel-session] aborts discovery and stays idle while speculative work is disabled", () => {
    const signals: AbortSignal[] = []
    const client = clientWith({
      listPages: vi.fn((_sessionId, _cursor, _limit, signal) => {
        signals.push(signal!)
        return new Promise(() => undefined)
      }),
    })
    const view = renderHook(({ enabled }) => useReaderAdjacentPagePreloader({
      client,
      sessionId: "reader-1",
      activePageIndex: 4,
      totalPages: 20,
      enabled,
      preload: vi.fn(),
    }), { initialProps: { enabled: true } })

    view.rerender({ enabled: false })

    expect(signals[0]?.aborted).toBe(true)
    expect(client.listPages).toHaveBeenCalledTimes(1)
  })
})

function clientWith(overrides: Partial<ReaderHttpClient>): ReaderHttpClient {
  return {
    config: vi.fn(),
    updateSidebarLayout: vi.fn(),
    updateCardLayout: vi.fn(),
    updateBoardLayout: vi.fn(),
    updateViewDefaults: vi.fn(),
    updateSlideshow: vi.fn(),
    open: vi.fn(),
    listPages: vi.fn(),
    navigate: vi.fn(),
    goTo: vi.fn(),
    updateSessionOptions: vi.fn(),
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
