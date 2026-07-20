import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient } from "../../../adapters/reader-http-client"
import HistoryListCard from "./HistoryListCard"

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize(): number }) => ({
    getTotalSize: () => count * estimateSize(),
    scrollToIndex: vi.fn(),
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({
      key: index,
      index,
      size: estimateSize(),
      start: index * estimateSize(),
    })),
  }),
}))

afterEach(cleanup)

describe("HistoryListCard", () => {
  it("[neoview.history.inactive-zero-work] keeps a resident shell without requesting history while hidden", async () => {
    const listRecent = vi.fn(async () => [])
    render(<HistoryListCard {...context(listRecent)} panelActive={false} />)

    expect(screen.getByTestId("history-card"))
    expect(screen.getByText("暂无阅读历史")).toBeTruthy()
    expect(screen.getByTestId("history-card").getAttribute("data-history-state")).toBe("inactive")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(listRecent).not.toHaveBeenCalled()
  })

  it("[neoview.history.empty] starts the shared history source when activated", async () => {
    const listRecent = vi.fn(async () => [])
    render(<HistoryListCard {...context(listRecent)} />)

    await waitFor(() => expect(listRecent).toHaveBeenCalledOnce())
    expect(screen.getByText("暂无阅读历史")).toBeTruthy()
    expect(screen.getByTestId("history-card").getAttribute("data-history-state")).toBe("ready")
  })

  it("[neoview.history.compact-thumbnails] registers visible compact rows and renders their shared thumbnail surface", async () => {
    const registerLibraryThumbnails = vi.fn(async (contextId: string, generation: number, items: readonly { id: string }[]) => ({
      contextId,
      generation,
      items: items.map((item) => ({ id: item.id, thumbnailUrl: `/thumbnail/${item.id}`, contentVersion: "v1" })),
    }))
    const base = context(vi.fn(async () => [recentHistory("one")]))
    const view = render(<HistoryListCard {...base} client={{ ...base.client, registerLibraryThumbnails } as ReaderHttpClient} />)

    await waitFor(() => expect(registerLibraryThumbnails).toHaveBeenCalledOnce())
    expect(registerLibraryThumbnails.mock.calls[0]?.[2]).toEqual([
      expect.objectContaining({ id: "one", path: "D:/books/one.cbz", kind: "file", previewCount: 1 }),
    ])
    await waitFor(() => expect(view.container.querySelector('img[src="/thumbnail/one"]')).toBeTruthy())
    fireEvent.pointerDown(screen.getByRole("button", { name: "视图：紧凑列表" }), { button: 0, ctrlKey: false, pointerType: "mouse" })
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "封面列表" }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(registerLibraryThumbnails).toHaveBeenCalledOnce()
  })

  it("[neoview.history.focus-refresh] restores the focused history entry after refresh reorders loaded records", async () => {
    const pages = [
      [recentHistory("one"), recentHistory("two")],
      [recentHistory("inserted"), recentHistory("one"), recentHistory("two")],
    ] as const
    let requestCount = 0
    const listRecent = vi.fn(async () => pages[Math.min(requestCount++, pages.length - 1)]!)
    const view = render(<HistoryListCard {...context(listRecent)} />)

    await waitFor(() => {
      expect(view.container.querySelector('[data-history-context-id="one"][data-history-row-button="0"]')).toBeTruthy()
      expect(view.container.querySelector('[data-history-context-id="two"][data-history-row-button="1"]')).toBeTruthy()
    })
    const focusedBeforeRefresh = view.container.querySelector<HTMLButtonElement>('[data-history-context-id="two"][data-history-row-button="1"]')!
    fireEvent.focus(focusedBeforeRefresh)
    focusedBeforeRefresh.focus()
    expect(screen.getByTestId("history-focus")).toBe(focusedBeforeRefresh)

    fireEvent.click(screen.getByTitle("刷新历史记录"))

    await waitFor(() => expect(listRecent).toHaveBeenCalledTimes(2))
    await waitFor(() => {
      const focused = view.container.querySelector<HTMLButtonElement>('[data-history-context-id="two"][data-testid="history-focus"]')
      expect(focused).toBeTruthy()
      expect(focused?.getAttribute("data-history-row-button")).toBe("2")
      expect(document.activeElement).toBe(focused)
    })
  })

  it("[neoview.history.search-sort-query] sends search and sort before virtual paging", async () => {
    const listRecent = vi.fn(async () => [])
    render(<HistoryListCard {...context(listRecent)} />)

    await waitFor(() => expect(listRecent).toHaveBeenCalledOnce())
    fireEvent.change(screen.getByRole("textbox", { name: "搜索历史记录视图" }), { target: { value: "cover" } })
    await waitFor(() => expect(listRecent.mock.calls.some((call) => call[3]?.search === "cover")).toBe(true))
    fireEvent.pointerDown(screen.getByRole("button", { name: "排序：时间 · 降序" }), { button: 0, ctrlKey: false, pointerType: "mouse" })
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "名称" }))
    await waitFor(() => expect(listRecent.mock.calls.some((call) => call[3]?.sort?.field === "name")).toBe(true))
  })
})

function context(listRecent: NonNullable<ReaderHttpClient["listRecent"]>) {
  return {
    client: { listRecent } as ReaderHttpClient,
    disabled: false,
    onGoTo: vi.fn(),
    onOpen: vi.fn(),
    historyListPreferences: { viewMode: "compact" as const },
  }
}

function recentHistory(bookId: string) {
  return {
    bookId,
    source: { kind: "archive" as const, path: `D:/books/${bookId}.cbz` },
    displayName: `${bookId}.cbz`,
    pageIndex: 0,
    pageCount: 10,
    updatedAt: 1_700_000_000_000,
  }
}
