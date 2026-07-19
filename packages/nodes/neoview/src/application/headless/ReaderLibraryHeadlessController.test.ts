import { describe, expect, it, vi } from "vitest"

import type { ReaderLibraryStore } from "../../ports/ReaderLibraryStore.js"
import type { ReaderLibraryStatisticsStore } from "../../ports/ReaderLibraryStatisticsStore.js"
import type { ReaderPlaylistStore } from "../../ports/ReaderPlaylistStore.js"
import { ReaderLibraryService } from "../library/ReaderLibraryService.js"
import { ReaderLibraryHeadlessController } from "./ReaderLibraryHeadlessController.js"

describe("ReaderLibraryHeadlessController", () => {
  it("[neoview.library.headless] [neoview.history.cleanup-headless] [neoview.bookmark.batch-headless] [neoview.folder.filter-library-headless] [neoview.playlist.headless] resolves paths once and delegates all state to ReaderLibraryService", async () => {
    const store = fakeStore()
    vi.mocked(store.updateBookmark).mockResolvedValue({
      id: "bookmark-1",
      source: { kind: "archive", path: "DEMO.CBZ" },
      name: "demo.cbz",
      kind: "file",
      starred: false,
      createdAt: 100,
      updatedAt: 100,
      listIds: ["default"],
    })
    const resolveSource = vi.fn(async (path: string) => ({
      source: { kind: "archive" as const, path: path.toUpperCase() },
      displayName: "demo.cbz",
    }))
    const controller = new ReaderLibraryHeadlessController(
      new ReaderLibraryService(store, () => 100, () => "bookmark-1"),
      resolveSource,
    )

    await expect(controller.savePathBookmark({ path: " demo.cbz ", listIds: ["default"] })).resolves.toMatchObject({
      id: "bookmark-1", name: "demo.cbz", source: { kind: "archive", path: "DEMO.CBZ" },
    })
    expect(resolveSource).toHaveBeenCalledWith("demo.cbz")
    await expect(controller.updateBookmark("bookmark-1", { starred: false, listIds: ["default"] })).resolves.toMatchObject({ starred: false })
    expect(store.updateBookmark).toHaveBeenCalledWith("bookmark-1", { starred: false, listIds: ["default"], updatedAt: 100 })
    await controller.updateBookmarks([{ id: "bookmark-1", listIds: ["default"] }])
    expect(store.updateBookmarkBatch).toHaveBeenCalledWith([{ id: "bookmark-1", listIds: ["default"] }], 100)
    await controller.removeBookmarks(["bookmark-1"])
    expect(store.deleteBookmarkBatch).toHaveBeenCalledWith(["bookmark-1"])
    await expect(controller.statistics()).resolves.toEqual({ recentCount: 4, bookmarkCount: 3, bookmarkListCount: 2, mediaProgressCount: 1 })
    await controller.listPlaylists()
    await controller.savePlaylist({ id: "playlist-1", name: "Queue" })
    await controller.listPlaylistEntries("playlist-1")
    await controller.appendPlaylistEntries("playlist-1", [{
      id: "entry-1",
      name: "Demo",
      source: { kind: "archive", path: "DEMO.CBZ" },
    }])
    await controller.removePlaylistEntries("playlist-1", ["entry-1"])
    await controller.reorderPlaylistEntries("playlist-1", [])
    await controller.removePlaylist("playlist-1")
    expect(store.getLibraryStatistics).toHaveBeenCalledOnce()
    expect(store.listPlaylists).toHaveBeenCalled()
    expect(store.upsertPlaylist).toHaveBeenCalledWith(expect.objectContaining({ id: "playlist-1", name: "Queue" }))
    expect(store.listPlaylistEntries).toHaveBeenCalledWith("playlist-1")
    expect(store.appendPlaylistEntries).toHaveBeenCalledWith("playlist-1", expect.arrayContaining([expect.objectContaining({ id: "entry-1" })]), 100)
    expect(store.deletePlaylistEntries).toHaveBeenCalledWith("playlist-1", ["entry-1"], 100)
    expect(store.replacePlaylistEntryOrder).toHaveBeenCalledWith("playlist-1", [], 100)
    expect(store.deletePlaylist).toHaveBeenCalledWith("playlist-1")
    await controller.listRecent(20, 5, "video")
    expect(store.listRecent).toHaveBeenCalledWith({ limit: 20, offset: 5, filter: "video" })
    await controller.listBookmarks("reading", 10, 2, "archive")
    expect(store.listBookmarks).toHaveBeenCalledWith({ listId: "reading", limit: 10, offset: 2, filter: "archive" })
    await controller.clearByFolder("bookmarks", "D:\\Books")
    expect(store.clearByPathPrefix).toHaveBeenCalledWith("bookmarks", "d:/books")
    await controller.removeOldestRecents(3)
    await controller.removeOldestBookmarks(2)
    await controller.clearBookmarksBefore(100, 20)
    await controller.clearAll("recents")
    expect(store.deleteOldestBookmark).toHaveBeenCalledWith(2)
    expect(store.deleteOldestRecent).toHaveBeenCalledWith(3)
    expect(store.clearBookmarkBefore).toHaveBeenCalledWith(100, 20)
    expect(store.clearAll).toHaveBeenCalledWith("recents")
    await controller.close()
    await controller.close()
    expect(store.close).toHaveBeenCalledOnce()
    expect(() => controller.listBookmarkLists()).toThrow("closed")
  })
})

function fakeStore(): ReaderLibraryStore & ReaderLibraryStatisticsStore & ReaderPlaylistStore {
  return {
    listRecent: vi.fn(async () => []),
    deleteRecent: vi.fn(async () => false),
    deleteRecentBatch: vi.fn(async () => ({ deleted: 0, missingIds: [] })),
    deleteOldestRecent: vi.fn(async () => ({ selectedIds: [], deleted: 0 })),
    clearRecentBefore: vi.fn(async () => 0),
    clearByPathPrefix: vi.fn(async () => 0),
    clearAll: vi.fn(async () => 0),
    listBookmarks: vi.fn(async () => []),
    findBookmarkByPath: vi.fn(async () => undefined),
    upsertBookmark: vi.fn(async () => undefined),
    updateBookmark: vi.fn(async () => undefined),
    updateBookmarkBatch: vi.fn(async () => ({ items: [], missingIds: [] })),
    deleteBookmark: vi.fn(async () => false),
    deleteBookmarkBatch: vi.fn(async () => ({ deleted: 0, missingIds: [] })),
    deleteOldestBookmark: vi.fn(async () => ({ selectedIds: [], deleted: 0 })),
    clearBookmarkBefore: vi.fn(async () => 0),
    listBookmarkLists: vi.fn(async () => []),
    upsertBookmarkList: vi.fn(async () => undefined),
    deleteBookmarkList: vi.fn(async () => false),
    getLibraryStatistics: vi.fn(async () => ({ recentCount: 4, bookmarkCount: 3, bookmarkListCount: 2, mediaProgressCount: 1 })),
    listPlaylists: vi.fn(async () => []),
    getPlaylist: vi.fn(async (id: string) => id === "playlist-1" ? { id, name: "Queue", createdAt: 100, updatedAt: 100 } : undefined),
    upsertPlaylist: vi.fn(async () => undefined),
    deletePlaylist: vi.fn(async () => true),
    listPlaylistEntries: vi.fn(async () => []),
    appendPlaylistEntries: vi.fn(async () => undefined),
    deletePlaylistEntries: vi.fn(async () => 1),
    replacePlaylistEntryOrder: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    [Symbol.asyncDispose]: vi.fn(async () => undefined),
  }
}
