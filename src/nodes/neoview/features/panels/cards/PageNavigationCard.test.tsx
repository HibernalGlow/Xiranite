import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient, ReaderPageDto, ReaderSessionDto } from "../../../adapters/reader-http-client"
import PageNavigationCard, { PageRow, PageThumbnail, ThumbnailRow } from "./PageNavigationCard"
import { buildPageListContextMenuItems, commitPageClipboardCopy } from "./page-list/PageListContextActions"

afterEach(cleanup)

describe("PageNavigationCard", () => {
  it("[neoview.page-list.inactive-zero-work] keeps an empty shell without loading page batches while hidden", async () => {
    const listPageCatalog = vi.fn(async () => ({ pages: [page(0)], total: 1 }))
    const view = render(<PageNavigationCard {...context(clientWith({ listPageCatalog }))} panelActive={false} />)

    expect(view.container.querySelector('[data-reader-card-empty="true"]')).toBeTruthy()
    expect(listPageCatalog).not.toHaveBeenCalled()
  })

  it("[neoview.page-list.settings] restores and persists view/follow preferences without navigating", async () => {
    const listPageCatalog = vi.fn(async () => ({ pages: [page(0)], total: 100 }))
    const onGoTo = vi.fn()
    const onPageListPreferences = vi.fn(async () => undefined)
    const props = context(clientWith({ listPageCatalog }), 0, 100, onGoTo)
    render(<PageNavigationCard {...props} pageListPreferences={{ viewMode: "thumbnails", followProgress: false }} onPageListPreferences={onPageListPreferences} />)
    await waitFor(() => expect(listPageCatalog).toHaveBeenCalledOnce())

    expect((await screen.findByRole("button", { name: "缩略图网格" })).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByRole("button", { name: "跟随阅读进度" }).getAttribute("aria-pressed")).toBe("false")
    fireEvent.click(screen.getByRole("button", { name: "带图列表" }))
    fireEvent.click(screen.getByRole("button", { name: "跟随阅读进度" }))

    await waitFor(() => expect(onPageListPreferences).toHaveBeenCalledTimes(2))
    expect(onPageListPreferences.mock.calls.map(([patch]) => patch)).toEqual([
      { viewMode: "details" },
      { followProgress: true },
    ])
    expect(onGoTo).not.toHaveBeenCalled()
  })

  it("[neoview.page-list.settings-rollback] restores confirmed preferences after persistence fails", async () => {
    const listPageCatalog = vi.fn(async () => ({ pages: [page(0)], total: 100 }))
    const onPageListPreferences = vi.fn().mockRejectedValue(new Error("偏好保存失败"))
    render(
      <PageNavigationCard
        {...context(clientWith({ listPageCatalog }), 0, 100)}
        pageListPreferences={{ viewMode: "list", followProgress: true }}
        onPageListPreferences={onPageListPreferences}
      />,
    )
    await waitFor(() => expect(listPageCatalog).toHaveBeenCalledOnce())

    await screen.findByRole("button", { name: "缩略图网格" })
    fireEvent.click(screen.getByRole("button", { name: "缩略图网格" }))
    expect((await screen.findByRole("alert")).textContent).toContain("偏好保存失败")
    expect(screen.getByRole("button", { name: "列表" }).getAttribute("aria-pressed")).toBe("true")
  })

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
    await waitFor(() => expect(screen.getByRole("button", { name: "带图列表" }).getAttribute("aria-pressed")).toBe("true"))
    expect(listPageCatalog).toHaveBeenCalledTimes(1)
    expect(listPageCatalog).toHaveBeenLastCalledWith(
      "reader-1",
      0,
      64,
      { query: "", thumbnails: false },
      expect.any(AbortSignal),
    )
  })

  it("[neoview.page-list.sparse-active] opens a 100K catalog around the active page instead of cursor zero", async () => {
    const listPageCatalog = vi.fn(async (_sessionId: string, cursor: number, limit: number) => ({
      pages: Array.from({ length: limit }, (_, offset) => page(cursor + offset)),
      total: 100_000,
    }))
    render(<PageNavigationCard {...context(clientWith({ listPageCatalog }), 80_123, 100_000)} />)

    await waitFor(() => expect(listPageCatalog).toHaveBeenCalledWith(
      "reader-1",
      80_128 - 64,
      64,
      { query: "", thumbnails: false },
      expect.any(AbortSignal),
    ))
    expect(listPageCatalog.mock.calls.some((call) => call[1] === 0)).toBe(false)
  })

  it("[neoview.page-list.follow-preview] previews without navigation and navigates every followed Slider change", async () => {
    const listPageCatalog = vi.fn(async (_sessionId: string, cursor: number, limit: number) => ({
      pages: Array.from({ length: limit }, (_, offset) => page(cursor + offset)),
      total: 100,
    }))
    const onGoTo = vi.fn(async () => undefined)
    const globalKeyDown = vi.fn()
    const view = render(<div onKeyDown={globalKeyDown}><PageNavigationCard {...context(clientWith({ listPageCatalog }), 0, 100, onGoTo)} /></div>)
    await waitFor(() => expect(listPageCatalog).toHaveBeenCalledOnce())

    fireEvent.click(screen.getByRole("button", { name: "跟随阅读进度" }))
    fireEvent.keyDown(screen.getByRole("slider", { name: "页面位置" }), { key: "ArrowRight" })
    await waitFor(() => expect(view.container.querySelector('[data-neoview-page-list="true"]')?.getAttribute("data-preview-index")).toBe("1"))
    expect(onGoTo).not.toHaveBeenCalled()
    expect(globalKeyDown).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "跟随阅读进度" }))
    fireEvent.keyDown(screen.getByRole("slider", { name: "页面位置" }), { key: "ArrowRight" })
    await waitFor(() => expect(onGoTo).toHaveBeenCalledWith(1))
  })

  it("[neoview.page-list.keyboard] loads the target batch and activates a roving keyboard focus", async () => {
    const listPageCatalog = vi.fn(async (_sessionId: string, cursor: number, limit: number) => ({
      pages: Array.from({ length: limit }, (_, offset) => page(cursor + offset)),
      total: 100,
    }))
    const onGoTo = vi.fn(async () => undefined)
    const view = render(<PageNavigationCard {...context(clientWith({ listPageCatalog }), 0, 100, onGoTo)} />)
    await waitFor(() => expect(listPageCatalog).toHaveBeenCalledOnce())
    const viewport = screen.getByRole("listbox", { name: "页面" })

    fireEvent.keyDown(viewport, { key: "End" })
    await waitFor(() => expect(listPageCatalog).toHaveBeenCalledWith(
      "reader-1", 64, 36, { query: "", thumbnails: false }, expect.any(AbortSignal),
    ))
    expect(view.container.querySelector('[data-neoview-page-list="true"]')?.getAttribute("data-focused-position")).toBe("99")
    fireEvent.keyDown(viewport, { key: "Enter" })
    await waitFor(() => expect(onGoTo).toHaveBeenCalledWith(99))

    fireEvent.keyDown(view.container.querySelector('[data-neoview-page-list="true"]')!, { key: "f", ctrlKey: true })
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "搜索页面" }))
  })

  it("[neoview.page-list.shared-thumbnail] uses the shared contain-fit page surface", () => {
    const view = render(<PageThumbnail page={page(0)} className="h-16 w-12" />)
    expect(view.container.querySelector("img")?.className).toContain("object-contain")
    expect(view.container.querySelector('[data-reader-thumbnail-surface="true"]')?.getAttribute("data-thumbnail-fit")).toBe("contain")
  })

  it("[neoview.page-list.shared-renderer] reuses Folder entry frames without changing page thumbnail geometry", () => {
    const view = render(<PageRow start={0} size={76} position={0} page={page(0)} activePageIndex={0} details disabled={false} onGoTo={vi.fn()} />)
    const details = view.container.querySelector<HTMLElement>('[data-reader-entry-surface="true"]')!
    expect(details.dataset.entryVariant).toBe("content")
    expect(details.querySelector('[data-reader-thumbnail-surface="true"]')?.className).toContain("h-16")
    expect(details.querySelector('[data-reader-thumbnail-surface="true"]')?.className).toContain("w-12")

    view.rerender(<ThumbnailRow start={0} rowIndex={0} pages={new Map([[0, page(0)]])} activePageIndex={0} disabled={false} onGoTo={vi.fn()} />)
    const tile = view.container.querySelector<HTMLElement>('[data-page-thumbnail-tile]')!
    expect(tile.dataset.entryVariant).toBe("thumbnail")
    expect(tile.className).toContain("h-auto")
    expect(tile.querySelector('[data-reader-thumbnail-surface="true"]')?.className).toContain("aspect-[3/4]")
    expect(tile.querySelector('[data-reader-thumbnail-surface="true"]')?.getAttribute("data-thumbnail-fit")).toBe("contain")
  })

  it("[neoview.page-list.context-actions] reuses one opaque page menu across all three renderers", async () => {
    const onGoTo = vi.fn(async () => undefined)
    const onAction = vi.fn(async () => undefined)
    const view = render(<PageRow start={0} size={34} position={0} page={page(0)} activePageIndex={0} details={false} disabled={false} onGoTo={onGoTo} />)
    expect(view.container.querySelector('[data-page-id="page-0"]')?.getAttribute("data-context-menu")).toBe("neoview-page-list")
    expect(view.container.querySelector('[data-page-id="page-0"]')?.getAttribute("data-entry-variant")).toBe("compact")
    view.rerender(<PageRow start={0} size={76} position={0} page={page(0)} activePageIndex={0} details disabled={false} onGoTo={onGoTo} />)
    expect(view.container.querySelector('[data-page-id="page-0"]')?.getAttribute("data-entry-variant")).toBe("content")
    view.rerender(<ThumbnailRow start={0} rowIndex={0} pages={new Map([[0, page(0)]])} activePageIndex={0} disabled={false} onGoTo={onGoTo} />)
    expect(view.container.querySelector('[data-page-thumbnail-tile="0"]')?.getAttribute("data-context-menu")).toBe("neoview-page-list")

    const items = buildPageListContextMenuItems({ pageId: "page-0", pageIndex: "0", pageName: "0001.jpg" }, {
      disabled: false, actionUnavailable: false, canCopy: true, onGoTo, onAction,
    })!
    expect(items.filter((item) => item.type !== "separator").map((item) => item.id)).toEqual([
      "neoview-page-copy", "neoview-page-go-to", "neoview-page-reveal", "neoview-page-open", "neoview-page-name",
    ])
    expect(items.at(-1)).toMatchObject({ type: "label", label: "0001.jpg" })
    await items.find((item) => item.id === "neoview-page-go-to")?.onSelect?.()
    await items.find((item) => item.id === "neoview-page-copy")?.onSelect?.()
    expect(onGoTo).toHaveBeenCalledWith(0)
    expect(onAction).toHaveBeenCalledWith("copy", "page-0", "0001.jpg")
  })

  it("[neoview.page-list.action-lifecycle] keeps only the latest successful archive clipboard lease", async () => {
    const releasePageActionLease = vi.fn(async () => undefined)
    const copyFiles = vi.fn(async () => undefined)
    const leaseRef = { current: undefined as { sessionId: string; token: string } | undefined }
    const signal = new AbortController().signal
    const options = { sessionId: "reader-1", signal, leaseRef, copyFiles, releaseLease: releasePageActionLease }

    await commitPageClipboardCopy({ path: "C:/temp/one.jpg", leaseToken: "lease-one" }, options)
    await commitPageClipboardCopy({ path: "C:/temp/two.jpg", leaseToken: "lease-two" }, options)

    expect(copyFiles).toHaveBeenNthCalledWith(1, ["C:/temp/one.jpg"])
    expect(copyFiles).toHaveBeenNthCalledWith(2, ["C:/temp/two.jpg"])
    expect(releasePageActionLease).toHaveBeenCalledWith("reader-1", "lease-one")
    expect(releasePageActionLease).not.toHaveBeenCalledWith("reader-1", "lease-two")
    expect(leaseRef.current).toEqual({ sessionId: "reader-1", token: "lease-two" })

    copyFiles.mockRejectedValueOnce(new Error("clipboard failed"))
    await expect(commitPageClipboardCopy({ path: "C:/temp/three.jpg", leaseToken: "lease-three" }, options)).rejects.toThrow("clipboard failed")
    expect(releasePageActionLease).toHaveBeenCalledWith("reader-1", "lease-three")
    expect(leaseRef.current).toEqual({ sessionId: "reader-1", token: "lease-two" })
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

  it("[neoview.page-list.prewarm] prewarms the complete catalog in bounded sequential batches", async () => {
    let running = 0
    let maximumRunning = 0
    const listPageCatalog = vi.fn(async (_sessionId: string, cursor: number, limit: number, options: { thumbnails?: boolean }) => {
      running += 1
      maximumRunning = Math.max(maximumRunning, running)
      await Promise.resolve()
      running -= 1
      const total = 1_200
      return {
        pages: Array.from({ length: limit }, (_, offset) => page(cursor + offset)),
        nextCursor: cursor + limit < total ? cursor + limit : undefined,
        total,
        options,
      }
    })
    render(<PageNavigationCard {...context(clientWith({ listPageCatalog }), 0, 1_200)} />)
    await waitFor(() => expect(listPageCatalog).toHaveBeenCalledWith(
      "reader-1", 0, 64, { query: "", thumbnails: false }, expect.any(AbortSignal),
    ))

    fireEvent.click(screen.getByRole("button", { name: "预热全部缩略图" }))
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("全部缩略图已预加载"))
    const prewarmCalls = listPageCatalog.mock.calls.filter((call) => call[3]?.thumbnails === true)
    expect(prewarmCalls.map((call) => [call[1], call[2]])).toEqual([[0, 500], [500, 500], [1_000, 200]])
    expect(maximumRunning).toBe(1)
  })

  it("[neoview.page-list.prewarm-lifecycle] cancels thumbnail prewarm when the Card unmounts", async () => {
    let prewarmSignal: AbortSignal | undefined
    const listPageCatalog = vi.fn((_sessionId: string, cursor: number, limit: number, options: { thumbnails?: boolean }, signal?: AbortSignal) => {
      if (options.thumbnails) {
        prewarmSignal = signal
        return new Promise<never>(() => undefined)
      }
      return Promise.resolve({ pages: Array.from({ length: limit }, (_, offset) => page(cursor + offset)), total: 1_000 })
    })
    const view = render(<PageNavigationCard {...context(clientWith({ listPageCatalog }))} />)
    await waitFor(() => expect(listPageCatalog).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole("button", { name: "预热全部缩略图" }))
    await waitFor(() => expect(prewarmSignal).toBeDefined())

    view.unmount()
    expect(prewarmSignal?.aborted).toBe(true)
  })

  it("[neoview.page-list.empty] reports an empty book instead of remaining in loading state", async () => {
    const listPageCatalog = vi.fn()
    render(<PageNavigationCard {...context(clientWith({ listPageCatalog }), 0, 0)} />)

    expect(await screen.findByText("书籍没有页面")).toBeTruthy()
    expect(listPageCatalog).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "预热全部缩略图" }).hasAttribute("disabled")).toBe(true)
  })
})

function context(
  client: ReaderHttpClient,
  activePageIndex = 0,
  totalPages = 1_000,
  onGoTo = vi.fn(),
  systemActions?: { copyFiles?(paths: string[]): Promise<void> },
) {
  return { client, disabled: false, session: session(activePageIndex, totalPages), onGoTo, systemActions }
}

function clientWith(overrides: Partial<ReaderHttpClient>): ReaderHttpClient {
  return {
    config: vi.fn(), updateSidebarLayout: vi.fn(), updateCardLayout: vi.fn(), updateBoardLayout: vi.fn(),
    updateViewDefaults: vi.fn(), updateSlideshow: vi.fn(), open: vi.fn(), listPages: vi.fn(), navigate: vi.fn(),
    goTo: vi.fn(), updateSessionOptions: vi.fn(), close: vi.fn(), ...overrides,
  }
}

function session(activePageIndex = 0, totalPages = 1_000): ReaderSessionDto {
  return {
    sessionId: "reader-1",
    book: { id: "book-1", displayName: "book.cbz", pageCount: totalPages },
    frame: {
      generation: 1,
      anchorPageIndex: activePageIndex,
      direction: "left-to-right",
      layout: { pageMode: "single", panorama: false, singleFirstPage: true, singleLastPage: true, treatWidePageAsSingle: true },
      pages: [{ pageId: `page-${activePageIndex}`, pageIndex: activePageIndex, side: "single" }],
      pageCount: totalPages,
      atStart: activePageIndex === 0,
      atEnd: activePageIndex === totalPages - 1,
    },
    visiblePages: [page(activePageIndex)],
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
