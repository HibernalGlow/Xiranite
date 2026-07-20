import { describe, expect, it, vi } from "vitest"

import { ReaderLibraryService } from "../../application/library/ReaderLibraryService.js"
import { ReaderLibraryCleanupService } from "../../application/library/ReaderLibraryCleanupService.js"
import type { ReaderLibraryStore } from "../../ports/ReaderLibraryStore.js"
import { ReaderLibraryHttpController } from "./ReaderLibraryHttpController.js"

describe("ReaderLibraryHttpController", () => {
  it("[neoview.library.http] [neoview.folder.filter-library-http] exposes bounded shared recents and bookmark commands", async () => {
    const store = createStore()
    store.listRecent.mockResolvedValue([])
    store.listBookmarks.mockResolvedValue([])
    store.listBookmarkLists.mockResolvedValue([])
    store.updateBookmark.mockResolvedValue({
      id: "generated",
      source: { kind: "archive", path: "D:/demo.cbz" },
      name: "Demo",
      kind: "file",
      starred: false,
      createdAt: 200,
      updatedAt: 200,
      listIds: ["default"],
    })
    store.deleteRecent.mockResolvedValue(true)
    store.clearRecentBefore.mockResolvedValue(3)
    store.findBookmarkByPath
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        id: "generated",
        source: { kind: "archive", path: "D:/demo.cbz" },
        name: "Demo",
        kind: "file",
        starred: false,
        createdAt: 200,
        updatedAt: 200,
        listIds: ["default"],
      })
    const service = new ReaderLibraryService(store, () => 200, () => "generated")
    const controller = new ReaderLibraryHttpController(service, new ReaderLibraryCleanupService(service, {
      check: vi.fn(async () => "missing"),
    }))

    const recent = (await controller.handle(request("/reader/library/recents?limit=900&offset=2")))!
    expect(await recent.json()).toEqual({ items: [] })
    expect(store.listRecent).toHaveBeenCalledWith({ limit: 500, offset: 2 })
    expect((await controller.handle(request("/reader/library/recents?limit=20&offset=3&filter=video")))?.status).toBe(200)
    expect(store.listRecent).toHaveBeenLastCalledWith({ limit: 20, offset: 3, filter: "video" })
    expect((await controller.handle(request("/reader/library/recents?filter=invalid")))?.status).toBe(400)
    store.listRecent.mockResolvedValueOnce([
      { bookId: "progress", source: { kind: "archive", path: "D:/books/progress.cbz" }, displayName: "Progress", pageIndex: 1, pageCount: 4, updatedAt: 12 },
    ])
    const folderProgress = (await controller.handle(request("/reader/library/progress/folder?path=D%3A%2Fbooks")))!
    await expect(folderProgress.json()).resolves.toMatchObject({ bookCount: 1, readPages: 2, totalPages: 4, progressPercent: 50 })
    expect((await controller.handle(request("/reader/library/progress/folder")))?.status).toBe(400)
    expect((await controller.handle(request("/reader/library/recents/book-1", { method: "DELETE" })))?.status).toBe(204)
    store.deleteRecentBatch.mockResolvedValue({ deleted: 1, missingIds: ["missing"] })
    const recentBatch = (await controller.handle(jsonRequest("/reader/library/recents/batch", { ids: ["one", "missing"] }, "DELETE")))!
    await expect(recentBatch.json()).resolves.toEqual({ deleted: 1, missingIds: ["missing"] })
    expect((await controller.handle(jsonRequest("/reader/library/recents/batch", { ids: [] }, "DELETE")))?.status).toBe(400)
    const cleanup = (await controller.handle(jsonRequest("/reader/library/recents/cleanup", { before: 100, limit: 20 })))!
    expect(await cleanup.json()).toEqual({ deleted: 3 })
    store.clearByPathPrefix.mockResolvedValueOnce(4)
    const folderCleanup = (await controller.handle(jsonRequest("/reader/library/recents/cleanup", { kind: "folder", path: "D:/Books" })))!
    await expect(folderCleanup.json()).resolves.toEqual({ deleted: 4 })
    expect(store.clearByPathPrefix).toHaveBeenLastCalledWith("recents", "d:/books")
    store.clearAll.mockResolvedValueOnce(7)
    const clearAllRecents = (await controller.handle(jsonRequest("/reader/library/recents/cleanup", { kind: "all", confirmed: true })))!
    await expect(clearAllRecents.json()).resolves.toEqual({ deleted: 7 })
    expect(store.clearAll).toHaveBeenLastCalledWith("recents")
    expect((await controller.handle(jsonRequest("/reader/library/recents/cleanup", { kind: "all", confirmed: false })))?.status).toBe(400)
    await controller.handle(jsonRequest("/reader/library/recents/cleanup", { before: 100, limit: 501 }))
    expect(store.clearRecentBefore).toHaveBeenLastCalledWith(100, 500)

    const created = (await controller.handle(jsonRequest("/reader/library/bookmarks", {
      source: { kind: "archive", path: "D:/demo.cbz" },
      name: "Demo",
      listIds: ["default"],
    })))!
    expect(created.status).toBe(201)
    expect(await created.json()).toMatchObject({ id: "generated", name: "Demo", listIds: ["default"] })
    const repeated = (await controller.handle(jsonRequest("/reader/library/bookmarks", {
      source: { kind: "archive", path: "d:\\DEMO.cbz" },
      name: "Renamed",
      listIds: ["reading"],
    })))!
    await expect(repeated.json()).resolves.toMatchObject({ id: "generated", name: "Renamed", listIds: ["default", "reading"] })
    const updated = (await controller.handle(jsonRequest("/reader/library/bookmarks/generated", {
      starred: false,
      listIds: ["default"],
    }, "PATCH")))!
    expect(updated.status).toBe(200)
    await expect(updated.json()).resolves.toMatchObject({ id: "generated", starred: false, listIds: ["default"] })
    expect(store.updateBookmark).toHaveBeenCalledWith("generated", { starred: false, listIds: ["default"], updatedAt: 200 })
    store.updateBookmarkBatch.mockImplementation(async (updates, updatedAt) => ({
      items: updates.filter((update) => update.id !== "missing").map((update) => ({
        id: update.id,
        source: { kind: "archive", path: `D:/${update.id}.cbz` },
        name: update.id,
        kind: "file",
        starred: update.starred ?? false,
        createdAt: 1,
        updatedAt,
        listIds: update.listIds ?? ["default"],
      })),
      missingIds: updates.filter((update) => update.id === "missing").map((update) => update.id),
    }))
    const batch = (await controller.handle(jsonRequest("/reader/library/bookmarks/batch", {
      updates: [{ id: "one", listIds: ["default"] }, { id: "missing", starred: false }],
    }, "PATCH")))!
    await expect(batch.json()).resolves.toMatchObject({ items: [{ id: "one" }], missingIds: ["missing"] })
    store.deleteBookmarkBatch.mockResolvedValue({ deleted: 1, missingIds: ["missing"] })
    const deleted = (await controller.handle(jsonRequest("/reader/library/bookmarks/batch", { ids: ["one", "missing"] }, "DELETE")))!
    await expect(deleted.json()).resolves.toEqual({ deleted: 1, missingIds: ["missing"] })
    store.clearByPathPrefix.mockResolvedValueOnce(2)
    const bookmarkCleanup = (await controller.handle(jsonRequest("/reader/library/bookmarks/cleanup", { kind: "folder", path: "D:\\Books" })))!
    await expect(bookmarkCleanup.json()).resolves.toEqual({ deleted: 2 })
    expect(store.clearByPathPrefix).toHaveBeenLastCalledWith("bookmarks", "d:/books")
    expect((await controller.handle(jsonRequest("/reader/library/bookmarks/cleanup", { kind: "folder", path: "D:/Books", future: true })))?.status).toBe(400)
    store.deleteOldestBookmark.mockResolvedValueOnce({ selectedIds: ["old-a", "old-b"], deleted: 2 })
    const oldestBookmarks = (await controller.handle(jsonRequest("/reader/library/bookmarks/cleanup", { kind: "oldest", limit: 2 })))!
    await expect(oldestBookmarks.json()).resolves.toEqual({ selectedIds: ["old-a", "old-b"], deleted: 2, missingIds: [] })
    store.clearBookmarkBefore.mockResolvedValueOnce(3)
    const datedBookmarks = (await controller.handle(jsonRequest("/reader/library/bookmarks/cleanup", { kind: "before", before: 100, limit: 20 })))!
    await expect(datedBookmarks.json()).resolves.toEqual({ deleted: 3 })
    store.clearAll.mockResolvedValueOnce(5)
    const clearAllBookmarks = (await controller.handle(jsonRequest("/reader/library/bookmarks/cleanup", { kind: "all", confirmed: true })))!
    await expect(clearAllBookmarks.json()).resolves.toEqual({ deleted: 5 })
    expect(store.clearAll).toHaveBeenLastCalledWith("bookmarks")
    expect((await controller.handle(jsonRequest("/reader/library/bookmarks/cleanup", { kind: "all" })))?.status).toBe(400)
    expect((await controller.handle(jsonRequest("/reader/library/bookmarks/batch", { updates: [] }, "PATCH")))?.status).toBe(400)
    expect((await controller.handle(jsonRequest("/reader/library/bookmarks/generated", { starred: false, future: true }, "PATCH")))?.status).toBe(400)
    expect((await controller.handle(jsonRequest("/reader/library/bookmarks/generated", { listIds: ["favorites"] }, "PATCH")))?.status).toBe(400)
    store.updateBookmark.mockResolvedValueOnce(undefined)
    expect((await controller.handle(jsonRequest("/reader/library/bookmarks/missing", { starred: false }, "PATCH")))?.status).toBe(404)
    const aborted = new AbortController()
    aborted.abort()
    await expect(controller.handle(request("/reader/library/bookmarks/generated", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ starred: false }),
      signal: aborted.signal,
    }))).rejects.toMatchObject({ name: "AbortError" })
    expect((await controller.handle(request("/reader/library/bookmarks?listId=favorites&filter=archive")))?.status).toBe(200)
    expect(store.listBookmarks).toHaveBeenLastCalledWith({ limit: 100, offset: 0, listId: "favorites", filter: "archive" })
    expect((await controller.handle(request("/reader/library/bookmarks?filter=invalid")))?.status).toBe(400)
    expect((await controller.handle(request("/reader/library/bookmark-lists")))?.status).toBe(200)
    store.listRecent.mockResolvedValueOnce([{ bookId: "missing", source: { kind: "archive", path: "D:/missing.cbz" }, displayName: "Missing", pageIndex: 0, pageCount: 1, updatedAt: 1 }])
    store.listBookmarks.mockResolvedValueOnce([])
    store.deleteRecent.mockResolvedValueOnce(true)
    const invalid = (await controller.handle(jsonRequest("/reader/library/cleanup-invalid", {
      kind: "both", scanLimit: 20, deleteLimit: 10, concurrency: 2,
    })))!
    await expect(invalid.json()).resolves.toMatchObject({ scanned: 1, missing: 1, deleted: 1 })
  })

  it("[neoview.history.cleanup-oldest-http] exposes strict oldest-count cleanup with exact selected identities", async () => {
    const store = createStore()
    store.deleteOldestRecent.mockResolvedValue({ selectedIds: ["old-a", "old-b"], deleted: 2 })
    const controller = new ReaderLibraryHttpController(new ReaderLibraryService(store))

    const response = (await controller.handle(jsonRequest("/reader/library/recents/cleanup", { kind: "oldest", limit: 2 })))!
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      selectedIds: ["old-a", "old-b"],
      deleted: 2,
      missingIds: [],
    })
    expect(store.deleteOldestRecent).toHaveBeenCalledWith(2)
    expect(store.listRecent).not.toHaveBeenCalled()
    expect(store.deleteRecent).not.toHaveBeenCalled()
    expect((await controller.handle(jsonRequest("/reader/library/recents/cleanup", { kind: "oldest", limit: 0 })))?.status).toBe(400)
    expect((await controller.handle(jsonRequest("/reader/library/recents/cleanup", { kind: "oldest", limit: 501 })))?.status).toBe(400)
    expect((await controller.handle(jsonRequest("/reader/library/recents/cleanup", { kind: "future", limit: 2 })))?.status).toBe(400)
    expect((await controller.handle(jsonRequest("/reader/library/recents/cleanup", { kind: "oldest", limit: 2, before: 10 })))?.status).toBe(400)
  })

  it("[neoview.library.playlist-http] exposes shared statistics and strict ordered playlist mutations", async () => {
    const store = Object.assign(createStore(), playlistStore(), {
      getLibraryStatistics: vi.fn(async () => ({ recentCount: 1, bookmarkCount: 2, bookmarkListCount: 3, mediaProgressCount: 4 })),
    })
    store.listPlaylists.mockResolvedValue([])
    store.getPlaylist.mockResolvedValue({ id: "reading", name: "Reading", createdAt: 10, updatedAt: 10 })
    store.listPlaylistEntries.mockResolvedValue([])
    store.deletePlaylist.mockResolvedValue(true)
    const controller = new ReaderLibraryHttpController(new ReaderLibraryService(store, () => 20, (() => {
      const ids = ["reading", "entry-1"]
      return () => ids.shift()!
    })()))

    await expect((await controller.handle(request("/reader/library/statistics")))!.json()).resolves.toEqual({ recentCount: 1, bookmarkCount: 2, bookmarkListCount: 3, mediaProgressCount: 4 })
    const created = (await controller.handle(jsonRequest("/reader/library/playlists", { name: "Reading" })))!
    expect(created.status).toBe(201)
    await expect(created.json()).resolves.toMatchObject({ id: "reading", name: "Reading" })
    const appended = (await controller.handle(jsonRequest("/reader/library/playlists/reading/items", {
      entries: [{ source: { kind: "archive", path: "D:/books/demo.cbz" }, name: "Demo" }],
    })))!
    expect(appended.status).toBe(201)
    expect(store.appendPlaylistEntries).toHaveBeenCalledWith("reading", [expect.objectContaining({ id: "entry-1", position: 0 })], 20)
    store.listPlaylistEntries.mockResolvedValue([{ id: "entry-1", playlistId: "reading", source: { kind: "archive", path: "D:/books/demo.cbz" }, name: "Demo", position: 0, createdAt: 20 }])
    expect((await controller.handle(jsonRequest("/reader/library/playlists/reading/items/order", { ids: ["entry-1"] }, "PUT")))?.status).toBe(204)
    expect(store.replacePlaylistEntryOrder).toHaveBeenCalledWith("reading", ["entry-1"], 20)
    expect((await controller.handle(jsonRequest("/reader/library/playlists/reading/items", { entries: [] })))?.status).toBe(400)
    expect((await controller.handle(request("/reader/library/playlists/reading", { method: "DELETE" })))?.status).toBe(204)
  })
})

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
    upsertBookmark: vi.fn<ReaderLibraryStore["upsertBookmark"]>(async () => undefined),
    updateBookmark: vi.fn<ReaderLibraryStore["updateBookmark"]>(),
    updateBookmarkBatch: vi.fn<ReaderLibraryStore["updateBookmarkBatch"]>(),
    deleteBookmark: vi.fn<ReaderLibraryStore["deleteBookmark"]>(),
    deleteBookmarkBatch: vi.fn<ReaderLibraryStore["deleteBookmarkBatch"]>(),
    deleteOldestBookmark: vi.fn<ReaderLibraryStore["deleteOldestBookmark"]>(),
    clearBookmarkBefore: vi.fn<ReaderLibraryStore["clearBookmarkBefore"]>(),
    listBookmarkLists: vi.fn<ReaderLibraryStore["listBookmarkLists"]>(),
    upsertBookmarkList: vi.fn<ReaderLibraryStore["upsertBookmarkList"]>(async () => undefined),
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

function request(path: string, init?: RequestInit): Request {
  return new Request(`http://127.0.0.1:41000${path}`, init)
}

function jsonRequest(path: string, body: unknown, method = "POST"): Request {
  return request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}
