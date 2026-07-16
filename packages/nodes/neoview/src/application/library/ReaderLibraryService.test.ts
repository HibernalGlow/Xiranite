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
      listIds: ["custom", "default"],
    })
    expect(store.upsertBookmark).toHaveBeenCalledWith(expect.objectContaining({ id: "bookmark-1", listIds: ["custom", "default"] }))
    await expect(service.saveBookmarkList({ id: "favorites", name: "duplicate" })).rejects.toThrow("reserved")
  })

  it("[neoview.library.bookmark-dedupe] merges a repeated path into the existing bookmark", async () => {
    const store = createStore()
    store.findBookmarkByPath.mockResolvedValue({
      id: "existing",
      source: { kind: "path", path: "D:/Books/demo.cbz" },
      name: "Old",
      kind: "file",
      starred: true,
      createdAt: 100,
      updatedAt: 100,
      listIds: ["reading"],
    })
    const service = new ReaderLibraryService(store, () => 200)

    await expect(service.saveBookmark({
      source: { kind: "archive", path: "d:\\books\\DEMO.cbz" },
      name: "Demo",
      listIds: ["default"],
    })).resolves.toMatchObject({
      id: "existing",
      name: "Demo",
      starred: true,
      createdAt: 100,
      updatedAt: 200,
      listIds: ["default", "reading"],
    })
  })

  it("[neoview.library.bookmark-update] explicitly clears starred and replaces list memberships", async () => {
    const store = createStore()
    store.listBookmarkLists.mockResolvedValue([customList])
    store.updateBookmark.mockResolvedValue({
      id: "bookmark-1",
      source: { kind: "archive", path: "D:/books/demo.cbz" },
      name: "Demo",
      kind: "file",
      starred: false,
      createdAt: 100,
      updatedAt: 200,
      listIds: ["custom"],
    })
    const service = new ReaderLibraryService(store, () => 200)

    await expect(service.updateBookmark("bookmark-1", {
      starred: false,
      listIds: [" custom ", "custom"],
    })).resolves.toMatchObject({ starred: false, listIds: ["custom"] })
    expect(store.updateBookmark).toHaveBeenCalledWith("bookmark-1", {
      starred: false,
      listIds: ["custom"],
      updatedAt: 200,
    })
    await expect(service.updateBookmark("bookmark-1", { listIds: [] })).resolves.toBeDefined()
    expect(store.updateBookmark).toHaveBeenLastCalledWith("bookmark-1", {
      listIds: ["default"],
      updatedAt: 200,
    })
    await expect(service.updateBookmark("bookmark-1", { listIds: ["favorites"] })).rejects.toThrow("cannot be persisted")
    await expect(service.updateBookmark("bookmark-1", { listIds: ["missing"] })).rejects.toThrow("unknown lists")
    await expect(service.updateBookmark("bookmark-1", {})).rejects.toThrow("must change")
  })

  it("[neoview.library.bookmark-update-abort] rejects an aborted waiter before touching persistence", async () => {
    const store = createStore()
    const service = new ReaderLibraryService(store, () => 200)
    const controller = new AbortController()
    controller.abort()
    await expect(service.updateBookmark("bookmark-1", { starred: false }, controller.signal)).rejects.toMatchObject({ name: "AbortError" })
    expect(store.updateBookmark).not.toHaveBeenCalled()
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
    findBookmarkByPath: vi.fn<ReaderLibraryStore["findBookmarkByPath"]>(),
    upsertBookmark: vi.fn<(bookmark: ReaderBookmarkRecord) => Promise<void>>(async () => undefined),
    updateBookmark: vi.fn<ReaderLibraryStore["updateBookmark"]>(),
    deleteBookmark: vi.fn<ReaderLibraryStore["deleteBookmark"]>(),
    listBookmarkLists: vi.fn<ReaderLibraryStore["listBookmarkLists"]>(),
    upsertBookmarkList: vi.fn<ReaderLibraryStore["upsertBookmarkList"]>(),
    deleteBookmarkList: vi.fn<ReaderLibraryStore["deleteBookmarkList"]>(),
    close: vi.fn(async () => undefined),
    [Symbol.asyncDispose]: vi.fn(async () => undefined),
  }
}
