import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient } from "../../../adapters/reader-http-client"
import BookmarkListCard from "./BookmarkListCard"

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

describe("BookmarkListCard", () => {
  it("[neoview.bookmark.inactive-zero-work] keeps a resident shell without loading bookmark lists while hidden", async () => {
    const listBookmarkLists = vi.fn(async () => [])
    const listBookmarks = vi.fn(async () => [])
    render(<BookmarkListCard {...context(listBookmarkLists, listBookmarks)} panelActive={false} />)

    expect(screen.getByTestId("bookmark-card").getAttribute("data-bookmark-state")).toBe("inactive")
    expect(screen.getByText("暂无书签")).toBeTruthy()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(listBookmarkLists).not.toHaveBeenCalled()
    expect(listBookmarks).not.toHaveBeenCalled()
  })

  it("[neoview.bookmark.empty] starts the shared bookmark source when activated", async () => {
    const listBookmarkLists = vi.fn(async () => [{ id: "all", name: "全部", isFavorite: false, createdAt: 0, updatedAt: 0, system: true }])
    const listBookmarks = vi.fn(async () => [])
    render(<BookmarkListCard {...context(listBookmarkLists, listBookmarks)} />)

    await waitFor(() => expect(listBookmarkLists).toHaveBeenCalledOnce())
    await waitFor(() => expect(listBookmarks).toHaveBeenCalledOnce())
    expect(screen.getByText("当前列表没有书签")).toBeTruthy()
  })

  it("[neoview.bookmark.compact-thumbnails] registers visible compact rows through the shared thumbnail surface", async () => {
    const registerLibraryThumbnails = vi.fn(async (contextId: string, generation: number, items: readonly { id: string }[]) => ({
      contextId,
      generation,
      items: items.map((item) => ({ id: item.id, thumbnailUrl: `/thumbnail/${item.id}`, contentVersion: "v1" })),
    }))
    const listBookmarkLists = vi.fn(async () => [{ id: "all", name: "全部", isFavorite: false, createdAt: 0, updatedAt: 0, system: true }])
    const listBookmarks = vi.fn(async () => [{
      id: "bookmark-one",
      name: "one.cbz",
      kind: "file" as const,
      source: { kind: "archive" as const, path: "D:/books/one.cbz" },
      createdAt: 1,
      updatedAt: 1,
      starred: false,
      listIds: ["all"],
    }])
    const base = context(listBookmarkLists, listBookmarks)
    const view = render(<BookmarkListCard {...base} client={{ ...base.client, registerLibraryThumbnails } as ReaderHttpClient} />)

    await waitFor(() => expect(listBookmarks).toHaveBeenCalledOnce())
    await waitFor(() => expect(view.container.querySelector('[data-bookmark-id="bookmark-one"]')).toBeTruthy())
    await waitFor(() => expect(registerLibraryThumbnails).toHaveBeenCalledOnce())
    expect(registerLibraryThumbnails.mock.calls[0]?.[2]).toEqual([
      expect.objectContaining({ id: "bookmark-one", path: "D:/books/one.cbz", kind: "file", previewCount: 1 }),
    ])
    await waitFor(() => expect(view.container.querySelector('img[src="/thumbnail/bookmark-one"]')).toBeTruthy())
    fireEvent.pointerDown(screen.getByRole("button", { name: "视图：紧凑列表" }), { button: 0, ctrlKey: false, pointerType: "mouse" })
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "封面列表" }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(registerLibraryThumbnails).toHaveBeenCalledOnce()
  })

  it("[neoview.bookmark.focus-restoration] restores focus to the all-list tab after deleting the active custom list", async () => {
    const lists = [
      { id: "all", name: "全部", isFavorite: false, createdAt: 0, updatedAt: 0, system: true },
      { id: "reading", name: "待读", isFavorite: false, createdAt: 1, updatedAt: 1, system: false },
    ]
    const listBookmarkLists = vi.fn(async () => lists)
    const listBookmarks = vi.fn(async () => [])
    const removeBookmarkList = vi.fn(async () => undefined)
    const base = context(listBookmarkLists, listBookmarks)
    render(
      <BookmarkListCard
        {...base}
        client={{ ...base.client, removeBookmarkList } as ReaderHttpClient}
        bookmarkListPreferences={{ activeListId: "reading" }}
      />,
    )

    await waitFor(() => expect(screen.getByRole("button", { name: "编辑当前书签列表" })).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: "编辑当前书签列表" }))
    fireEvent.click(screen.getByRole("button", { name: "删除", exact: true }))
    fireEvent.click(screen.getByRole("button", { name: "删除列表" }))

    await waitFor(() => expect(removeBookmarkList).toHaveBeenCalledWith("reading"))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "全部" })))
  })

  it("[neoview.bookmark.search-sort-query] scopes search and sort to the active bookmark list before paging", async () => {
    const listBookmarkLists = vi.fn(async () => [{ id: "all", name: "全部", isFavorite: false, createdAt: 0, updatedAt: 0, system: true }])
    const listBookmarks = vi.fn(async () => [])
    render(<BookmarkListCard {...context(listBookmarkLists, listBookmarks)} />)

    await waitFor(() => expect(listBookmarks).toHaveBeenCalledOnce())
    fireEvent.change(screen.getByRole("textbox", { name: "搜索书签视图" }), { target: { value: "archive" } })
    await waitFor(() => expect(listBookmarks.mock.calls.some((call) => call[4]?.search === "archive" && call[2] === "all")).toBe(true))
    fireEvent.pointerDown(screen.getByRole("button", { name: "排序：时间 · 降序" }), { button: 0, ctrlKey: false, pointerType: "mouse" })
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "路径" }))
    await waitFor(() => expect(listBookmarks.mock.calls.some((call) => call[4]?.sort?.field === "path")).toBe(true))
  })

  it("syncs ordinary open to the containing Folder path", async () => {
    const item = {
      id: "bookmark-one",
      name: "one.cbz",
      kind: "file" as const,
      source: { kind: "archive" as const, path: "D:/books/one.cbz" },
      createdAt: 1,
      updatedAt: 1,
      starred: false,
      listIds: ["all"],
    }
    const onOpen = vi.fn()
    const onBrowsePath = vi.fn()
    render(<BookmarkListCard
      {...context(
        vi.fn(async () => [{ id: "all", name: "全部", isFavorite: false, createdAt: 0, updatedAt: 0, system: true }]),
        vi.fn(async () => [item]),
      )}
      onOpen={onOpen}
      onBrowsePath={onBrowsePath}
    />)

    fireEvent.click(await screen.findByRole("button", { name: "打开书签：one.cbz" }))
    expect(onBrowsePath).toHaveBeenCalledWith("D:/books")
    expect(onOpen).toHaveBeenCalledWith("D:/books/one.cbz", { browserOriginPath: "D:/books" })
  })
})

function context(
  listBookmarkLists: NonNullable<ReaderHttpClient["listBookmarkLists"]>,
  listBookmarks: NonNullable<ReaderHttpClient["listBookmarks"]>,
) {
  return {
    client: { listBookmarkLists, listBookmarks } as ReaderHttpClient,
    disabled: false,
    onGoTo: vi.fn(),
    onOpen: vi.fn(),
    bookmarkListPreferences: { activeListId: "all" },
  }
}
