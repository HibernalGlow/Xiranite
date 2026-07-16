import { describe, expect, it, vi } from "vitest"

import { ReaderLibraryService } from "../../application/library/ReaderLibraryService.js"
import { ReaderLibraryCleanupService } from "../../application/library/ReaderLibraryCleanupService.js"
import type { ReaderLibraryStore } from "../../ports/ReaderLibraryStore.js"
import { ReaderLibraryHttpController } from "./ReaderLibraryHttpController.js"

describe("ReaderLibraryHttpController", () => {
  it("[neoview.library.http] exposes bounded shared recents and bookmark commands", async () => {
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
    expect((await controller.handle(request("/reader/library/recents/book-1", { method: "DELETE" })))?.status).toBe(204)
    const cleanup = (await controller.handle(jsonRequest("/reader/library/recents/cleanup", { before: 100, limit: 20 })))!
    expect(await cleanup.json()).toEqual({ deleted: 3 })

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
    store.updateBookmark.mockImplementation(async (id, update) => id === "missing" ? undefined : ({
      id,
      source: { kind: "archive", path: `D:/${id}.cbz` },
      name: id,
      kind: "file",
      starred: update.starred ?? false,
      createdAt: 1,
      updatedAt: update.updatedAt,
      listIds: update.listIds ?? ["default"],
    }))
    const batch = (await controller.handle(jsonRequest("/reader/library/bookmarks/batch", {
      updates: [{ id: "one", listIds: ["default"] }, { id: "missing", starred: false }],
    }, "PATCH")))!
    await expect(batch.json()).resolves.toMatchObject({ items: [{ id: "one" }], missingIds: ["missing"] })
    store.deleteBookmark.mockImplementation(async (id) => id !== "missing")
    const deleted = (await controller.handle(jsonRequest("/reader/library/bookmarks/batch", { ids: ["one", "missing"] }, "DELETE")))!
    await expect(deleted.json()).resolves.toEqual({ deleted: 1, missingIds: ["missing"] })
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
    expect((await controller.handle(request("/reader/library/bookmarks?listId=favorites")))?.status).toBe(200)
    expect((await controller.handle(request("/reader/library/bookmark-lists")))?.status).toBe(200)
    store.listRecent.mockResolvedValueOnce([{ bookId: "missing", source: { kind: "archive", path: "D:/missing.cbz" }, displayName: "Missing", pageIndex: 0, pageCount: 1, updatedAt: 1 }])
    store.listBookmarks.mockResolvedValueOnce([])
    store.deleteRecent.mockResolvedValueOnce(true)
    const invalid = (await controller.handle(jsonRequest("/reader/library/cleanup-invalid", {
      kind: "both", scanLimit: 20, deleteLimit: 10, concurrency: 2,
    })))!
    await expect(invalid.json()).resolves.toMatchObject({ scanned: 1, missing: 1, deleted: 1 })
  })
})

function createStore() {
  return {
    listRecent: vi.fn<ReaderLibraryStore["listRecent"]>(),
    deleteRecent: vi.fn<ReaderLibraryStore["deleteRecent"]>(),
    clearRecentBefore: vi.fn<ReaderLibraryStore["clearRecentBefore"]>(),
    listBookmarks: vi.fn<ReaderLibraryStore["listBookmarks"]>(),
    findBookmarkByPath: vi.fn<ReaderLibraryStore["findBookmarkByPath"]>(),
    upsertBookmark: vi.fn<ReaderLibraryStore["upsertBookmark"]>(async () => undefined),
    updateBookmark: vi.fn<ReaderLibraryStore["updateBookmark"]>(),
    deleteBookmark: vi.fn<ReaderLibraryStore["deleteBookmark"]>(),
    listBookmarkLists: vi.fn<ReaderLibraryStore["listBookmarkLists"]>(),
    upsertBookmarkList: vi.fn<ReaderLibraryStore["upsertBookmarkList"]>(async () => undefined),
    deleteBookmarkList: vi.fn<ReaderLibraryStore["deleteBookmarkList"]>(),
    close: vi.fn(async () => undefined),
    [Symbol.asyncDispose]: vi.fn(async () => undefined),
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
