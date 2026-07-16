import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderBookmarkDto, ReaderHttpClient, SaveReaderBookmarkDto } from "../../../adapters/reader-http-client"
import BookmarkListCard from "./BookmarkListCard"
import HistoryListCard from "./HistoryListCard"

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize(): number }) => ({
    getTotalSize: () => count * estimateSize(),
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({
      key: index,
      index,
      size: estimateSize(),
      start: index * estimateSize(),
    })),
  }),
}))

afterEach(() => {
  cleanup()
})

describe("Reader library cards", () => {
  it("[neoview.history.card] restores a recent source and deletes through the shared library contract", async () => {
    const listRecent = vi.fn(async () => [{
      bookId: "book-1",
      source: { kind: "archive" as const, path: "D:/books/demo.cbz" },
      displayName: "demo.cbz",
      pageIndex: 4,
      pageCount: 20,
      updatedAt: 1_700_000_000_000,
    }])
    const removeRecent = vi.fn(async () => undefined)
    const onOpen = vi.fn()
    render(<HistoryListCard client={{ listRecent, removeRecent } as ReaderHttpClient} disabled={false} onOpen={onOpen} onGoTo={vi.fn()} />)
    await screen.findByText("demo.cbz")
    fireEvent.click(screen.getByText("demo.cbz"))
    expect(onOpen).toHaveBeenCalledWith("D:/books/demo.cbz")
    fireEvent.click(screen.getByRole("button", { name: "删除历史：demo.cbz" }))
    await waitFor(() => expect(removeRecent).toHaveBeenCalledWith("book-1"))
  })

  it("[neoview.bookmark.card] filters lists and saves the current book without duplicating state", async () => {
    const listBookmarkLists = vi.fn(async () => [
      { id: "all", name: "全部", isFavorite: false, createdAt: 0, updatedAt: 0, system: true },
      { id: "favorites", name: "收藏", isFavorite: true, createdAt: 0, updatedAt: 0, system: true },
    ])
    const listBookmarks = vi.fn(async () => [])
    const saveBookmark = vi.fn(async (bookmark: SaveReaderBookmarkDto) => ({
      id: "bookmark-1",
      kind: "file" as const,
      starred: false,
      createdAt: 1,
      updatedAt: 1,
      listIds: [],
      ...bookmark,
    }))
    render(
      <BookmarkListCard
        client={{ listBookmarkLists, listBookmarks, saveBookmark } as ReaderHttpClient}
        disabled={false}
        sourcePath="D:/books/demo.cbz"
        session={{ sessionId: "reader-1", book: { id: "book-1", displayName: "demo.cbz", pageCount: 20 }, frame: { anchorPageIndex: 4 } as never, visiblePages: [] }}
        onOpen={vi.fn()}
        onGoTo={vi.fn()}
      />,
    )
    await waitFor(() => expect(listBookmarkLists).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole("button", { name: "收藏当前书籍" }))
    await waitFor(() => expect(saveBookmark).toHaveBeenCalledWith(expect.objectContaining({
      source: { kind: "path", path: "D:/books/demo.cbz" },
      name: "demo.cbz",
    })))
  })

  it("[neoview.bookmark.thumbnail-visible] registers only the virtual bookmark window and releases its thumbnail context", async () => {
    const bookmark: ReaderBookmarkDto = {
      id: "bookmark-1",
      source: { kind: "archive", path: "D:/books/demo.cbz" },
      name: "demo.cbz",
      kind: "file",
      starred: false,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_100_000,
      listIds: [],
    }
    const registerLibraryThumbnails = vi.fn(async (contextId: string, generation: number) => ({
      contextId,
      generation,
      items: [{ id: bookmark.id, thumbnailUrl: "/reader/library/bookmark-1", contentVersion: "v1" }],
    }))
    const releaseLibraryThumbnailContext = vi.fn(async () => undefined)
    const updateBookmark = vi.fn(async () => ({ ...bookmark, starred: true }))
    const view = render(
      <BookmarkListCard
        client={{
          listBookmarkLists: vi.fn(async () => [{ id: "all", name: "全部", isFavorite: false, createdAt: 0, updatedAt: 0, system: true }]),
          listBookmarks: vi.fn(async () => [bookmark]),
          registerLibraryThumbnails,
          releaseLibraryThumbnailContext,
          updateBookmark,
        } as ReaderHttpClient}
        disabled={false}
        onOpen={vi.fn()}
        onGoTo={vi.fn()}
      />,
    )

    await waitFor(() => expect(registerLibraryThumbnails).toHaveBeenCalledWith(
      expect.stringMatching(/^bookmark:/),
      1,
      [{ id: "bookmark-1", path: "D:/books/demo.cbz", kind: "file", previewCount: 1 }],
      expect.any(AbortSignal),
    ))
    await waitFor(() => expect(view.container.querySelector("img")?.getAttribute("src")).toBe("/reader/library/bookmark-1"))
    expect(screen.getByText("D:/books/demo.cbz")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "收藏：demo.cbz" }))
    await waitFor(() => expect(updateBookmark).toHaveBeenCalledWith("bookmark-1", { starred: true }))

    view.unmount()
    await waitFor(() => expect(releaseLibraryThumbnailContext).toHaveBeenCalledWith(expect.stringMatching(/^bookmark:/)))
  })

  it("[neoview.library.lifecycle] aborts an unfinished library request when the card unmounts", async () => {
    let signal: AbortSignal | undefined
    const listRecent = vi.fn((_offset: number, _limit: number, requestSignal?: AbortSignal) => {
      signal = requestSignal
      return new Promise<readonly never[]>(() => undefined)
    })
    const view = render(<HistoryListCard client={{ listRecent } as ReaderHttpClient} disabled={false} onOpen={vi.fn()} onGoTo={vi.fn()} />)
    await waitFor(() => expect(listRecent).toHaveBeenCalledOnce())
    view.unmount()
    expect(signal?.aborted).toBe(true)
  })
})
