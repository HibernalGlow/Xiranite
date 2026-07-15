import { describe, expect, it, vi } from "vitest"

import type { ReaderBookmarkListRecord, ReaderBookmarkRecord, ReaderLibraryStore } from "../../ports/ReaderLibraryStore.js"
import { ReaderLibraryService } from "./ReaderLibraryService.js"

describe("ReaderLibraryService", () => {
  it("[neoview.library.contract] normalizes paging and synthesizes system bookmark lists", async () => {
    const store = createStore()
    store.listRecent.mockResolvedValue([])
    store.listBookmarkLists.mockResolvedValue([customList])
    const service = new ReaderLibraryService(store, () => 2000, () => "generated")

    await service.listRecent({ limit: 900, offset: 4 })
    expect(store.listRecent).toHaveBeenCalledWith({ limit: 500, offset: 4 })
    await expect(service.listBookmarkLists()).resolves.toEqual([
      expect.objectContaining({ id: "all", system: true }),
      expect.objectContaining({ id: "default", system: true }),
      expect.objectContaining({ id: "favorites", system: true }),
      customList,
    ])
    await service.close()
    expect(store.close).toHaveBeenCalledOnce()
  })

  it("[neoview.library.bookmark] creates canonical bookmarks and rejects persisted system lists", async () => {
    const store = createStore()
    const service = new ReaderLibraryService(store, () => 2000, () => "bookmark-1")

    await expect(service.saveBookmark({
      source: { kind: "directory", path: "D:/books" },
      name: "  Books  ",
      starred: true,
      listIds: ["favorites", "custom", "custom", "default"],
    })).resolves.toEqual({
      id: "bookmark-1",
      source: { kind: "directory", path: "D:/books" },
      name: "Books",
      kind: "folder",
      starred: true,
      createdAt: 2000,
      updatedAt: 2000,
      listIds: ["custom"],
    })
    expect(store.upsertBookmark).toHaveBeenCalledWith(expect.objectContaining({ id: "bookmark-1", listIds: ["custom"] }))
    await expect(service.saveBookmarkList({ id: "favorites", name: "duplicate" })).rejects.toThrow("reserved")
  })
})

const customList: ReaderBookmarkListRecord = {
  id: "custom",
  name: "Custom",
  isFavorite: false,
  createdAt: 1,
  updatedAt: 1,
}

function createStore() {
  return {
    listRecent: vi.fn<ReaderLibraryStore["listRecent"]>(),
    deleteRecent: vi.fn<ReaderLibraryStore["deleteRecent"]>(),
    clearRecentBefore: vi.fn<ReaderLibraryStore["clearRecentBefore"]>(),
    listBookmarks: vi.fn<ReaderLibraryStore["listBookmarks"]>(),
    upsertBookmark: vi.fn<(bookmark: ReaderBookmarkRecord) => Promise<void>>(async () => undefined),
    deleteBookmark: vi.fn<ReaderLibraryStore["deleteBookmark"]>(),
    listBookmarkLists: vi.fn<ReaderLibraryStore["listBookmarkLists"]>(),
    upsertBookmarkList: vi.fn<ReaderLibraryStore["upsertBookmarkList"]>(),
    deleteBookmarkList: vi.fn<ReaderLibraryStore["deleteBookmarkList"]>(),
    close: vi.fn(async () => undefined),
    [Symbol.asyncDispose]: vi.fn(async () => undefined),
  }
}
