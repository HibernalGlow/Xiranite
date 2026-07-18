import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
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
