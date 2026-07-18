import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient } from "../../../adapters/reader-http-client"
import BookmarkListCard from "./BookmarkListCard"

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
