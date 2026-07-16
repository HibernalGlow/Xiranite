import { describe, expect, it, vi } from "vitest"

import { ReaderLibraryService } from "../../application/library/ReaderLibraryService.js"
import type { ReaderLibraryStore } from "../../ports/ReaderLibraryStore.js"
import { ReaderLibraryHttpController } from "./ReaderLibraryHttpController.js"

describe("ReaderLibraryHttpController", () => {
  it("[neoview.library.http] exposes bounded shared recents and bookmark commands", async () => {
    const store = createStore()
    store.listRecent.mockResolvedValue([])
    store.listBookmarks.mockResolvedValue([])
    store.listBookmarkLists.mockResolvedValue([])
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
    const controller = new ReaderLibraryHttpController(service)

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
    expect((await controller.handle(request("/reader/library/bookmarks?listId=favorites")))?.status).toBe(200)
    expect((await controller.handle(request("/reader/library/bookmark-lists")))?.status).toBe(200)
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

function jsonRequest(path: string, body: unknown): Request {
  return request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}
