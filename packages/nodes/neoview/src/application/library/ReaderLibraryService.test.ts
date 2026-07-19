import { describe, expect, it, vi } from "vitest"

import type { ReaderBookmarkListRecord, ReaderBookmarkRecord, ReaderLibraryStore } from "../../ports/ReaderLibraryStore.js"
import { ReaderLibraryService } from "./ReaderLibraryService.js"

describe("ReaderLibraryService", () => {
  it("[neoview.library.contract] [neoview.folder.filter-library-service] normalizes paging, filters and synthesizes system bookmark lists", async () => {
    const store = createStore()
    store.listRecent.mockResolvedValue([])
    store.listBookmarks.mockResolvedValue([])
    store.listBookmarkLists.mockResolvedValue([customList])
    const service = new ReaderLibraryService(store, () => 2000, () => "generated")

    await service.listRecent({ limit: 900, offset: 4 })
    expect(store.listRecent).toHaveBeenCalledWith({ limit: 500, offset: 4 })
    await service.listRecent({ limit: 20, offset: 5, filter: "video" })
    expect(store.listRecent).toHaveBeenLastCalledWith({ limit: 20, offset: 5, filter: "video" })
    await service.listBookmarks({ listId: " reading ", limit: 20, offset: 5, filter: "archive" })
    expect(store.listBookmarks).toHaveBeenLastCalledWith({ limit: 20, offset: 5, filter: "archive", listId: "reading" })
    expect(() => service.listRecent({ filter: "invalid" as never })).toThrow("filter is invalid")
    expect(() => service.listBookmarks({ filter: "invalid" as never })).toThrow("filter is invalid")
    await expect(service.listBookmarkLists()).resolves.toEqual([
      expect.objectContaining({ id: "all", system: true }),
      expect.objectContaining({ id: "default", system: true }),
      expect.objectContaining({ id: "favorites", system: true }),
      customList,
    ])
    await service.close()
    expect(store.close).toHaveBeenCalledOnce()
  })

  it("[neoview.library.close-drain] shares close and waits for an in-flight operation before closing the store", async () => {
    const store = createStore()
    const pending = deferred<readonly never[]>()
    store.listRecent.mockReturnValue(pending.promise)
    const service = new ReaderLibraryService(store)

    const listing = service.listRecent()
    const closing = service.close()
    expect(service.close()).toBe(closing)
    expect(store.close).not.toHaveBeenCalled()
    expect(() => service.listRecent()).toThrow("closed")

    pending.resolve([])
    await expect(listing).resolves.toEqual([])
    await closing
    expect(store.close).toHaveBeenCalledOnce()
  })

  it("[neoview.library.statistics] delegates the bounded aggregate to a capable shared store", async () => {
    const store = Object.assign(createStore(), {
      getLibraryStatistics: vi.fn(async () => ({ recentCount: 4, bookmarkCount: 3, bookmarkListCount: 2, mediaProgressCount: 1 })),
    })
    const service = new ReaderLibraryService(store)

    await expect(service.statistics()).resolves.toEqual({ recentCount: 4, bookmarkCount: 3, bookmarkListCount: 2, mediaProgressCount: 1 })
    expect(store.getLibraryStatistics).toHaveBeenCalledOnce()
    expect(() => new ReaderLibraryService(createStore()).statistics()).toThrow("unavailable")
  })

  it("[neoview.library.playlists] exposes one shared playlist service only when its store supports the port", () => {
    const store = Object.assign(createStore(), playlistStore())
    const library = new ReaderLibraryService(store, () => 20, () => "generated")

    expect(library.playlists()).toBe(library.playlists())
    expect(() => new ReaderLibraryService(createStore()).playlists()).toThrow("unavailable")
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
    store.deleteRecentBatch.mockResolvedValue({ deleted: 2, missingIds: ["missing"] })
    const service = new ReaderLibraryService(store)

    await expect(service.removeRecents(["one", "missing", "two"])).resolves.toEqual({ deleted: 2, missingIds: ["missing"] })
    expect(store.deleteRecentBatch).toHaveBeenCalledWith(["one", "missing", "two"])
    expect(store.deleteRecent).not.toHaveBeenCalled()
    await expect(service.removeRecents(["one", "one"])).rejects.toThrow("duplicate")
    await expect(service.removeRecents([])).rejects.toThrow("1 to 500")
    const controller = new AbortController()
    controller.abort()
    await expect(service.removeRecents(["one"], controller.signal)).rejects.toMatchObject({ name: "AbortError" })
  })

  it("[neoview.library.remove-cancel-late] reports cancellation that arrives while a delete is in flight", async () => {
    const store = createStore()
    const pending = deferred<boolean>()
    store.deleteRecent.mockReturnValue(pending.promise)
    const service = new ReaderLibraryService(store)
    const controller = new AbortController()
    const removal = service.removeRecent("one", controller.signal)

    controller.abort(new DOMException("cancelled", "AbortError"))
    pending.resolve(true)
    await expect(removal).rejects.toMatchObject({ name: "AbortError" })
    expect(store.deleteRecent).toHaveBeenCalledWith("one")
  })

  it("[neoview.history.cleanup-oldest] delegates bounded oldest cleanup to the atomic store operation", async () => {
    const store = createStore()
    store.deleteOldestRecent.mockResolvedValue({ selectedIds: ["a-old", "z-old", "middle"], deleted: 3 })
    const service = new ReaderLibraryService(store)

    await expect(service.removeOldestRecents(3)).resolves.toEqual({
      selectedIds: ["a-old", "z-old", "middle"],
      deleted: 3,
      missingIds: [],
    })
    expect(store.deleteOldestRecent).toHaveBeenCalledWith(3)
    expect(store.listRecent).not.toHaveBeenCalled()
    expect(store.deleteRecent).not.toHaveBeenCalled()
    await expect(service.removeOldestRecents(0)).rejects.toThrow("1 to 500")
    await expect(service.removeOldestRecents(501)).rejects.toThrow("1 to 500")
  })

  it("[neoview.history.cleanup-oldest-cancel] rejects an already cancelled cleanup before opening a write transaction", async () => {
    const store = createStore()
    const controller = new AbortController()
    controller.abort()
    const service = new ReaderLibraryService(store)

    await expect(service.removeOldestRecents(2, controller.signal)).rejects.toMatchObject({ name: "AbortError" })
    expect(store.deleteOldestRecent).not.toHaveBeenCalled()
  })

  it("[neoview.library.cleanup-folder] normalizes legacy folder prefixes before one shared store operation", async () => {
    const store = createStore()
    store.clearByPathPrefix.mockResolvedValue(3)
    const service = new ReaderLibraryService(store)

    await expect(service.clearByFolder("recents", " D:\\Books\\Series ")).resolves.toBe(3)
    await expect(service.clearByFolder("bookmarks", "D:/BOOKS")).resolves.toBe(3)
    expect(store.clearByPathPrefix.mock.calls).toEqual([
      ["recents", "d:/books/series"],
      ["bookmarks", "d:/books"],
    ])
    expect(() => service.clearByFolder("recents", "  ")).toThrow("folder path is invalid")
  })

  it("[neoview.library.advanced-cleanup] delegates bookmark oldest/date and explicit collection clear operations", async () => {
    const store = createStore()
    store.deleteOldestBookmark.mockResolvedValue({ selectedIds: ["old-a", "old-b"], deleted: 2 })
    store.clearBookmarkBefore.mockResolvedValue(3)
    store.clearAll.mockResolvedValue(4)
    const service = new ReaderLibraryService(store)

    await expect(service.removeOldestBookmarks(2)).resolves.toEqual({
      selectedIds: ["old-a", "old-b"],
      deleted: 2,
      missingIds: [],
    })
    await expect(service.clearBookmarksBefore(100, 20)).resolves.toBe(3)
    await expect(service.clearAll("recents")).resolves.toBe(4)
    await expect(service.clearAll("bookmarks")).resolves.toBe(4)
    expect(store.deleteOldestBookmark).toHaveBeenCalledWith(2)
    expect(store.clearBookmarkBefore).toHaveBeenCalledWith(100, 20)
    expect(store.clearAll.mock.calls).toEqual([["recents"], ["bookmarks"]])
    await expect(service.removeOldestBookmarks(0)).rejects.toThrow("1 to 500")
  })

  it("[neoview.bookmark.batch-contract] updates list memberships through one bounded shared command", async () => {
    const store = createStore()
    store.listBookmarkLists.mockResolvedValue([customList])
    store.updateBookmarkBatch.mockImplementation(async (updates) => ({
      items: updates.filter((update) => update.id !== "missing")
        .map((update) => bookmark(update.id, update.listIds ?? ["default"], update.starred ?? false)),
      missingIds: updates.filter((update) => update.id === "missing").map((update) => update.id),
    }))
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
    expect(store.updateBookmarkBatch).toHaveBeenCalledWith([
      { id: "one", listIds: ["custom", "default"] },
      { id: "two", starred: true, listIds: ["custom"] },
      { id: "missing", starred: false },
    ], 300)
    expect(store.updateBookmark).not.toHaveBeenCalled()
    await expect(service.updateBookmarks([{ id: "one", starred: true }, { id: "one", starred: false }])).rejects.toThrow("duplicate")
    await expect(service.updateBookmarks([{ id: "one", listIds: ["favorites"] }])).rejects.toThrow("cannot be persisted")
    await expect(service.updateBookmarks([])).rejects.toThrow("1 to 500")
  })

  it("[neoview.bookmark.batch-delete] deletes a bounded identity batch and reports missing rows", async () => {
    const store = createStore()
    store.deleteBookmarkBatch.mockResolvedValue({ deleted: 2, missingIds: ["missing"] })
    const service = new ReaderLibraryService(store)

    await expect(service.removeBookmarks(["one", "missing", "two"])).resolves.toEqual({ deleted: 2, missingIds: ["missing"] })
    expect(store.deleteBookmarkBatch).toHaveBeenCalledWith(["one", "missing", "two"])
    expect(store.deleteBookmark).not.toHaveBeenCalled()
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
    deleteRecentBatch: vi.fn<ReaderLibraryStore["deleteRecentBatch"]>(),
    deleteOldestRecent: vi.fn<ReaderLibraryStore["deleteOldestRecent"]>(),
    clearRecentBefore: vi.fn<ReaderLibraryStore["clearRecentBefore"]>(),
    clearByPathPrefix: vi.fn<ReaderLibraryStore["clearByPathPrefix"]>(),
    clearAll: vi.fn<ReaderLibraryStore["clearAll"]>(),
    listBookmarks: vi.fn<ReaderLibraryStore["listBookmarks"]>(),
    findBookmarkByPath: vi.fn<ReaderLibraryStore["findBookmarkByPath"]>(),
    upsertBookmark: vi.fn<(bookmark: ReaderBookmarkRecord) => Promise<void>>(async () => undefined),
    updateBookmark: vi.fn<ReaderLibraryStore["updateBookmark"]>(),
    updateBookmarkBatch: vi.fn<ReaderLibraryStore["updateBookmarkBatch"]>(),
    deleteBookmark: vi.fn<ReaderLibraryStore["deleteBookmark"]>(),
    deleteBookmarkBatch: vi.fn<ReaderLibraryStore["deleteBookmarkBatch"]>(),
    deleteOldestBookmark: vi.fn<ReaderLibraryStore["deleteOldestBookmark"]>(),
    clearBookmarkBefore: vi.fn<ReaderLibraryStore["clearBookmarkBefore"]>(),
    listBookmarkLists: vi.fn<ReaderLibraryStore["listBookmarkLists"]>(),
    upsertBookmarkList: vi.fn<ReaderLibraryStore["upsertBookmarkList"]>(),
    deleteBookmarkList: vi.fn<ReaderLibraryStore["deleteBookmarkList"]>(),
    close: vi.fn(async () => undefined),
    [Symbol.asyncDispose]: vi.fn(async () => undefined),
  }
}

function playlistStore() {
  return {
    listPlaylists: vi.fn(),
    getPlaylist: vi.fn(),
    upsertPlaylist: vi.fn(),
    deletePlaylist: vi.fn(),
    listPlaylistEntries: vi.fn(),
    appendPlaylistEntries: vi.fn(),
    deletePlaylistEntries: vi.fn(),
    replacePlaylistEntryOrder: vi.fn(),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
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
