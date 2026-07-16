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

  it("[neoview.history.batch-remove] deletes a bounded recent identity batch and reports missing rows", async () => {
    const store = createStore()
    store.deleteRecent.mockImplementation(async (id) => id !== "missing")
    const service = new ReaderLibraryService(store)

    await expect(service.removeRecents(["one", "missing", "two"])).resolves.toEqual({ deleted: 2, missingIds: ["missing"] })
    expect(store.deleteRecent).toHaveBeenCalledTimes(3)
    await expect(service.removeRecents(["one", "one"])).rejects.toThrow("duplicate")
    await expect(service.removeRecents([])).rejects.toThrow("1 to 500")
    const controller = new AbortController()
    controller.abort()
    await expect(service.removeRecents(["one"], controller.signal)).rejects.toMatchObject({ name: "AbortError" })
  })

  it("[neoview.bookmark.batch-contract] updates list memberships through one bounded shared command", async () => {
    const store = createStore()
    store.listBookmarkLists.mockResolvedValue([customList])
    store.updateBookmark.mockImplementation(async (id, update) => id === "missing" ? undefined : bookmark(id, update.listIds ?? ["default"], update.starred ?? false))
    const service = new ReaderLibraryService(store, () => 300)

    await expect(service.updateBookmarks([
      { id: "one", listIds: ["custom", "default"] },
      { id: "two", listIds: ["custom"], starred: true },
      { id: "missing", starred: false },
    ])).resolves.toMatchObject({
      items: [{ id: "one" }, { id: "two", starred: true }],
      missingIds: ["missing"],
    })
    expect(store.listBookmarkLists).toHaveBeenCalledOnce()
    expect(store.updateBookmark).toHaveBeenCalledTimes(3)
    expect(store.updateBookmark).toHaveBeenNthCalledWith(2, "two", { starred: true, listIds: ["custom"], updatedAt: 300 })
    await expect(service.updateBookmarks([{ id: "one", starred: true }, { id: "one", starred: false }])).rejects.toThrow("duplicate")
    await expect(service.updateBookmarks([{ id: "one", listIds: ["favorites"] }])).rejects.toThrow("cannot be persisted")
    await expect(service.updateBookmarks([])).rejects.toThrow("1 to 500")
  })

  it("[neoview.bookmark.batch-delete] deletes a bounded identity batch and reports missing rows", async () => {
    const store = createStore()
    store.deleteBookmark.mockImplementation(async (id) => id !== "missing")
    const service = new ReaderLibraryService(store)

    await expect(service.removeBookmarks(["one", "missing", "two"])).resolves.toEqual({ deleted: 2, missingIds: ["missing"] })
    expect(store.deleteBookmark).toHaveBeenCalledTimes(3)
    await expect(service.removeBookmarks(["one", "one"])).rejects.toThrow("duplicate")
    const controller = new AbortController()
    controller.abort()
    await expect(service.removeBookmarks(["one"], controller.signal)).rejects.toMatchObject({ name: "AbortError" })
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

function bookmark(id: string, listIds: readonly string[], starred: boolean): ReaderBookmarkRecord {
  return {
    id,
    source: { kind: "archive", path: `D:/books/${id}.cbz` },
    name: id,
    kind: "file",
    starred,
    createdAt: 100,
    updatedAt: 300,
    listIds,
  }
}
