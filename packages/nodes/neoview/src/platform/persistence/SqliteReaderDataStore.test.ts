import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { inspectLegacyThumbnailDatabase } from "../thumbnails/LegacyThumbnailDatabaseInspector.js"
import { SqliteReaderDataStore } from "./SqliteReaderDataStore.js"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("SqliteReaderDataStore", () => {
  it("[neoview.book-settings.sqlite] stores revisioned nullable overrides without modifying legacy metadata", async () => {
    const { path } = await fixture()
    const store = await SqliteReaderDataStore.open(path)
    await expect(store.getBookSettings("book-1")).resolves.toBeUndefined()
    await expect(store.saveBookSettings("book-1", {
      favorite: false,
      rating: 4,
      direction: "right-to-left",
      pageMode: "double",
      horizontalBook: true,
    }, 0, 100)).resolves.toEqual({
      bookId: "book-1",
      overrides: { favorite: false, rating: 4, direction: "right-to-left", pageMode: "double", horizontalBook: true },
      revision: 1,
      updatedAt: 100,
    })
    await expect(store.saveBookSettings("book-1", { favorite: true }, 0, 200)).resolves.toBeUndefined()
    await expect(store.saveBookSettings("book-1", {}, 1, 300)).resolves.toMatchObject({ revision: 2, overrides: {} })
    await store.close()

    const reopened = await SqliteReaderDataStore.open(path)
    await expect(reopened.getBookSettings("book-1")).resolves.toEqual({
      bookId: "book-1",
      overrides: {},
      revision: 2,
      updatedAt: 300,
    })
    await reopened.close()
    await expect(inspectLegacyThumbnailDatabase(path)).resolves.toMatchObject({ metadataVersion: "2.4", userVersion: 7, journalMode: "wal" })
  })

  it("[neoview.book-settings.legacy-transaction] imports merge or overwrite in one canonical store transaction", async () => {
    const { path } = await fixture()
    const store = await SqliteReaderDataStore.open(path)
    await store.saveBookSettings("book-1", { favorite: true, direction: "left-to-right" }, 0, 1)
    await expect(store.importBookSettings([
      { bookId: "book-1", overrides: { favorite: false, rating: 3, pageMode: "double" } },
      { bookId: "book-2", overrides: { horizontalBook: true } },
    ], "merge", 2)).resolves.toEqual({ inserted: 1, updated: 1, unchanged: 0 })
    await expect(store.getBookSettings("book-1")).resolves.toMatchObject({
      revision: 2,
      overrides: { favorite: true, rating: 3, direction: "left-to-right", pageMode: "double" },
    })
    await expect(store.importBookSettings([
      { bookId: "book-1", overrides: { favorite: false, rating: 3, pageMode: "double" } },
    ], "merge", 3)).resolves.toEqual({ inserted: 0, updated: 0, unchanged: 1 })
    await expect(store.importBookSettings([
      { bookId: "book-1", overrides: { favorite: false, pageMode: "single" } },
    ], "overwrite", 4)).resolves.toEqual({ inserted: 0, updated: 1, unchanged: 0 })
    await expect(store.getBookSettings("book-1")).resolves.toMatchObject({
      revision: 3,
      overrides: { favorite: false, pageMode: "single" },
    })
    await store.close()
  })

  it("[neoview.progress.sqlite] [neoview.library.sqlite] reuses progress for recents and preserves the legacy database", async () => {
    const { path } = await fixture()
    const store = await SqliteReaderDataStore.open(path)
    await store.save({
      bookId: "older",
      source: { kind: "directory", path: "D:/old" },
      displayName: "Old",
      pageIndex: 1,
      pageCount: 10,
      updatedAt: 100,
    })
    await store.save({
      bookId: "newer",
      source: { kind: "archive", path: "D:/new.cbz" },
      displayName: "New",
      pageIndex: 2,
      pageCount: 20,
      updatedAt: 200,
    })

    await expect(store.get("newer")).resolves.toEqual({
      bookId: "newer",
      source: { kind: "archive", path: "D:/new.cbz" },
      displayName: "New",
      pageIndex: 2,
      pageCount: 20,
      updatedAt: 200,
    })
    await expect(store.listRecent({ limit: 1, offset: 0 })).resolves.toEqual([
      expect.objectContaining({ bookId: "newer", displayName: "New", pageIndex: 2 }),
    ])
    await expect(store.clearRecentBefore(150, 10)).resolves.toBe(1)
    await expect(store.deleteRecent("newer")).resolves.toBe(true)
    await store.close()
    await store.close()

    const report = await inspectLegacyThumbnailDatabase(path)
    expect(report).toMatchObject({ compatibility: "current", metadataVersion: "2.4", userVersion: 7 })
    const verified = await openFixtureDatabase(path)
    expect(verified.get("SELECT category, value, emm_json FROM thumbs WHERE key = 'D:/cover.jpg'"))
      .toEqual({ category: "file", value: Uint8Array.of(0), emm_json: "legacy" })
    verified.close()
  })

  it("[neoview.folder.filter.type] [neoview.folder.filter-library-sqlite] filters virtual library sources before pagination and composes bookmark memberships", async () => {
    const { path } = await fixture()
    const store = await SqliteReaderDataStore.open(path)
    const recentSources = [
      ["image", { kind: "image", path: "D:/cover.jpg" }, 600],
      ["video", { kind: "media", path: "D:/clip.mp4" }, 500],
      ["directory", { kind: "directory", path: "D:/books" }, 400],
      ["epub", { kind: "document", path: "D:/book.epub", format: "epub" }, 300],
      ["archive", { kind: "archive", path: "D:/book.cbz" }, 200],
      ["pdf", { kind: "document", path: "D:/book.pdf", format: "pdf" }, 100],
    ] as const
    for (const [bookId, source, updatedAt] of recentSources) {
      await store.save({ bookId, source, displayName: bookId, pageIndex: 0, pageCount: 1, updatedAt })
    }

    await expect(store.listRecent({ filter: "archive", limit: 1, offset: 0 })).resolves.toEqual([
      expect.objectContaining({ bookId: "epub" }),
    ])
    await expect(store.listRecent({ filter: "archive", limit: 1, offset: 1 })).resolves.toEqual([
      expect.objectContaining({ bookId: "archive" }),
    ])
    await expect(store.listRecent({ filter: "video", limit: 10, offset: 0 })).resolves.toEqual([
      expect.objectContaining({ bookId: "video" }),
    ])
    await expect(store.listRecent({ filter: "directory", limit: 10, offset: 0 })).resolves.toEqual([
      expect.objectContaining({ bookId: "directory" }),
    ])

    await store.upsertBookmarkList({ id: "reading", name: "Reading", isFavorite: false, createdAt: 1, updatedAt: 1 })
    for (const [id, source, updatedAt] of [
      ["bookmark-image", { kind: "image", path: "D:/bookmark.jpg" }, 500],
      ["bookmark-video", { kind: "media", path: "D:/bookmark.mp4" }, 400],
      ["bookmark-directory", { kind: "directory", path: "D:/bookmark" }, 300],
      ["bookmark-epub", { kind: "document", path: "D:/bookmark.epub", format: "epub" }, 200],
      ["bookmark-archive", { kind: "archive", path: "D:/bookmark.cbz" }, 100],
    ] as const) {
      await store.upsertBookmark({
        id,
        source,
        name: id,
        kind: source.kind === "directory" ? "folder" : "file",
        starred: false,
        createdAt: updatedAt,
        updatedAt,
        listIds: ["reading"],
      })
    }
    await expect(store.listBookmarks({ listId: "reading", filter: "archive", limit: 1, offset: 0 })).resolves.toEqual([
      expect.objectContaining({ id: "bookmark-epub" }),
    ])
    await expect(store.listBookmarks({ listId: "reading", filter: "archive", limit: 1, offset: 1 })).resolves.toEqual([
      expect.objectContaining({ id: "bookmark-archive" }),
    ])
    await expect(store.listBookmarks({ listId: "reading", filter: "video", limit: 10, offset: 0 })).resolves.toEqual([
      expect.objectContaining({ id: "bookmark-video" }),
    ])
    await store.close()
  })

  it("[neoview.history.cleanup-oldest-sqlite] atomically deletes a bounded oldest set with stable ties", async () => {
    const { path } = await fixture()
    const store = await SqliteReaderDataStore.open(path)
    for (const [bookId, updatedAt] of [["newest", 300], ["z-old", 100], ["a-old", 100], ["middle", 200]] as const) {
      await store.save({
        bookId,
        source: { kind: "archive", path: `D:/books/${bookId}.cbz` },
        displayName: bookId,
        pageIndex: 0,
        pageCount: 1,
        updatedAt,
      })
    }

    await expect(store.deleteOldestRecent(2)).resolves.toEqual({
      selectedIds: ["a-old", "z-old"],
      deleted: 2,
    })
    await expect(store.listRecent({ limit: 10, offset: 0 })).resolves.toEqual([
      expect.objectContaining({ bookId: "newest" }),
      expect.objectContaining({ bookId: "middle" }),
    ])
    await expect(store.deleteOldestRecent(500)).resolves.toEqual({
      selectedIds: ["middle", "newest"],
      deleted: 2,
    })
    await expect(store.deleteOldestRecent(1)).resolves.toEqual({ selectedIds: [], deleted: 0 })
    await expect(store.deleteOldestRecent(0)).rejects.toThrow("limit is invalid")
    await store.close()

    await expect(inspectLegacyThumbnailDatabase(path)).resolves.toMatchObject({
      metadataVersion: "2.4",
      userVersion: 7,
      journalMode: "wal",
    })
  })

  it("[neoview.library.batch-delete-sqlite] deletes recent and bookmark identity sets in one store operation", async () => {
    const { path } = await fixture()
    const store = await SqliteReaderDataStore.open(path)
    for (const bookId of ["recent-one", "recent-two"]) {
      await store.save({
        bookId,
        source: { kind: "archive", path: `D:/books/${bookId}.cbz` },
        displayName: bookId,
        pageIndex: 0,
        pageCount: 1,
        updatedAt: 1,
      })
    }
    await store.upsertBookmarkList({ id: "reading", name: "Reading", isFavorite: false, createdAt: 1, updatedAt: 1 })
    await store.upsertBookmark(bookmark("bookmark-one", false, ["reading"]))
    await store.upsertBookmark(bookmark("bookmark-two", false, ["default"]))

    await expect(store.deleteRecentBatch(["recent-two", "missing", "recent-one"])).resolves.toEqual({
      deleted: 2,
      missingIds: ["missing"],
    })
    await expect(store.deleteBookmarkBatch(["missing-a", "bookmark-one", "missing-b"])).resolves.toEqual({
      deleted: 1,
      missingIds: ["missing-a", "missing-b"],
    })
    await expect(store.listRecent({ limit: 10, offset: 0 })).resolves.toEqual([])
    await expect(store.listBookmarks({ listId: "reading", limit: 10, offset: 0 })).resolves.toEqual([])
    await expect(store.listBookmarks({ limit: 10, offset: 0 })).resolves.toEqual([
      expect.objectContaining({ id: "bookmark-two" }),
    ])
    await expect(store.deleteRecentBatch([])).rejects.toThrow("batch delete is invalid")
    await expect(store.deleteBookmarkBatch(["same", "same"])).rejects.toThrow("duplicate")
    await store.close()
  })

  it("[neoview.library.bookmarks] stores normalized lists and filters synthetic views", async () => {
    const { path } = await fixture()
    const store = await SqliteReaderDataStore.open(path)
    await store.upsertBookmarkList({ id: "reading", name: "Reading", isFavorite: true, createdAt: 1, updatedAt: 1 })
    await store.upsertBookmark(bookmark("one", false, ["default"]))
    await store.upsertBookmark(bookmark("two", false, ["reading", "missing"]))

    await expect(store.listBookmarkLists()).resolves.toEqual([
      { id: "reading", name: "Reading", isFavorite: true, createdAt: 1, updatedAt: 1 },
    ])
    await expect(store.findBookmarkByPath("d:\\ONE.jpg")).resolves.toMatchObject({ id: "one", listIds: ["default"] })
    await expect(store.listBookmarks({ listId: "default", limit: 10, offset: 0 })).resolves.toEqual([
      expect.objectContaining({ id: "one", listIds: ["default"] }),
    ])
    await expect(store.listBookmarks({ listId: "favorites", limit: 10, offset: 0 })).resolves.toEqual([
      expect.objectContaining({ id: "two", starred: false, listIds: ["reading"] }),
    ])
    await expect(store.listBookmarks({ listId: "reading", limit: 10, offset: 0 })).resolves.toHaveLength(1)
    await expect(store.deleteBookmarkList("reading")).resolves.toBe(true)
    await expect(store.listBookmarks({ listId: "default", limit: 10, offset: 0 })).resolves.toHaveLength(2)
    await expect(store.deleteBookmark("one")).resolves.toBe(true)
    await store.close()
  })

  it("[neoview.library.bookmark-update-sqlite] atomically clears starred and replaces memberships", async () => {
    const { path } = await fixture()
    const store = await SqliteReaderDataStore.open(path)
    await store.upsertBookmarkList({ id: "reading", name: "Reading", isFavorite: false, createdAt: 1, updatedAt: 1 })
    await store.upsertBookmark({ ...bookmark("one", true, ["default", "reading"]), updatedAt: 10 })

    await expect(store.updateBookmark("one", { starred: false, listIds: ["reading"], updatedAt: 20 })).resolves.toMatchObject({
      id: "one",
      starred: false,
      updatedAt: 20,
      listIds: ["reading"],
    })
    await expect(store.listBookmarks({ listId: "default", limit: 10, offset: 0 })).resolves.toEqual([])
    await expect(store.listBookmarks({ listId: "reading", limit: 10, offset: 0 })).resolves.toHaveLength(1)
    await expect(store.updateBookmark("missing", { starred: false, updatedAt: 30 })).resolves.toBeUndefined()
    await expect(store.updateBookmark("one", { listIds: ["unknown"], updatedAt: 30 })).rejects.toThrow("unknown list")
    await expect(store.listBookmarks({ listId: "reading", limit: 10, offset: 0 })).resolves.toHaveLength(1)
    await store.close()
  })

  it("[neoview.library.bookmark-batch-update-sqlite] applies heterogeneous updates in one transaction and preserves request order", async () => {
    const { path } = await fixture()
    const store = await SqliteReaderDataStore.open(path)
    await store.upsertBookmarkList({ id: "reading", name: "Reading", isFavorite: false, createdAt: 1, updatedAt: 1 })
    await store.upsertBookmark({ ...bookmark("one", false, ["default"]), updatedAt: 10 })
    await store.upsertBookmark({ ...bookmark("two", true, ["reading"]), updatedAt: 10 })

    await expect(store.updateBookmarkBatch([
      { id: "two", starred: false },
      { id: "missing", starred: true },
      { id: "one", listIds: ["reading"], starred: true },
    ], 20)).resolves.toEqual({
      items: [
        expect.objectContaining({ id: "two", starred: false, listIds: ["reading"], updatedAt: 20 }),
        expect.objectContaining({ id: "one", starred: true, listIds: ["reading"], updatedAt: 20 }),
      ],
      missingIds: ["missing"],
    })
    await expect(store.listBookmarks({ listId: "default", limit: 10, offset: 0 })).resolves.toEqual([])
    await expect(store.updateBookmarkBatch([
      { id: "one", listIds: ["unknown"] },
      { id: "two", starred: true },
    ], 30)).rejects.toThrow("unknown lists")
    await expect(store.listBookmarks({ limit: 10, offset: 0 })).resolves.toEqual([
      expect.objectContaining({ id: "one", starred: true, updatedAt: 20 }),
      expect.objectContaining({ id: "two", starred: false, updatedAt: 20 }),
    ])
    await store.close()
  })

  it("[neoview.library.cleanup-folder-sqlite] preserves legacy case-insensitive raw prefix semantics for both collections", async () => {
    const { path } = await fixture()
    const store = await SqliteReaderDataStore.open(path)
    for (const [bookId, sourcePath] of [["book", "D:\\Books\\one.cbz"], ["bookshelf", "D:/Bookshelf/two.cbz"], ["other", "D:/Other/three.cbz"]] as const) {
      await store.save({
        bookId,
        source: { kind: "archive", path: sourcePath },
        displayName: bookId,
        pageIndex: 0,
        pageCount: 1,
        updatedAt: 1,
      })
    }
    await store.upsertBookmarkList({ id: "reading", name: "Reading", isFavorite: false, createdAt: 1, updatedAt: 1 })
    await store.upsertBookmark({ ...bookmark("book-mark", false, ["reading"]), source: { kind: "archive", path: "D:/BOOKS/four.cbz" } })
    await store.upsertBookmark({ ...bookmark("other-mark", false, ["default"]), source: { kind: "archive", path: "D:/Other/five.cbz" } })

    await expect(store.clearByPathPrefix("recents", "d:/books")).resolves.toBe(2)
    await expect(store.clearByPathPrefix("bookmarks", "d:/books")).resolves.toBe(1)
    await expect(store.listRecent({ limit: 10, offset: 0 })).resolves.toEqual([
      expect.objectContaining({ bookId: "other" }),
    ])
    await expect(store.listBookmarks({ listId: "reading", limit: 10, offset: 0 })).resolves.toEqual([])
    await expect(store.listBookmarks({ limit: 10, offset: 0 })).resolves.toEqual([
      expect.objectContaining({ id: "other-mark" }),
    ])
    await expect(store.clearByPathPrefix("recents", "")).rejects.toThrow("path-prefix cleanup is invalid")
    await store.close()
  })

  it("[neoview.history.cleanup-state-sqlite] removes media and path-stack state through every history deletion path", async () => {
    const { path } = await fixture()
    const store = await SqliteReaderDataStore.open(path)
    const entries = [
      ["single", "D:/Single/one.cbz", 10],
      ["batch", "D:/Batch/two.cbz", 20],
      ["oldest", "D:/Oldest/three.cbz", 30],
      ["folder", "D:/Books/four.cbz", 40],
      ["dated", "D:/Dated/five.cbz", 50],
      ["remaining", "D:/Remaining/six.cbz", 60],
    ] as const
    for (const [bookId, sourcePath, updatedAt] of entries) {
      await store.save({
        bookId,
        source: { kind: "archive", path: sourcePath },
        displayName: bookId,
        pageIndex: 0,
        pageCount: 1,
        updatedAt,
      })
    }
    await store.importData({
      progress: [],
      bookmarks: [],
      bookmarkLists: [],
      pathStacks: entries.map(([bookId, sourcePath, updatedAt]) => ({ bookId, pathStack: [{ path: sourcePath }], updatedAt })),
      mediaProgress: entries.map(([bookId, , updatedAt]) => ({ bookId, position: 1, duration: 10, completed: false, updatedAt })),
    }, "merge")

    await expect(store.deleteRecent("single")).resolves.toBe(true)
    await expect(store.deleteRecentBatch(["batch"])).resolves.toEqual({ deleted: 1, missingIds: [] })
    await expect(store.deleteOldestRecent(1)).resolves.toEqual({ selectedIds: ["oldest"], deleted: 1 })
    await expect(store.clearByPathPrefix("recents", "d:/books")).resolves.toBe(1)
    await expect(store.clearRecentBefore(55, 10)).resolves.toBe(1)
    await expect(store.clearAll("recents")).resolves.toBe(1)
    for (const [bookId] of entries) await expect(store.getMediaProgress(bookId)).resolves.toBeUndefined()
    await expect(store.listRecent({ limit: 10, offset: 0 })).resolves.toEqual([])
    await store.close()

    const verified = await openFixtureDatabase(path)
    expect(verified.get("SELECT COUNT(*) AS count FROM xr_reader_path_stacks")).toEqual({ count: 0 })
    expect(verified.get("SELECT COUNT(*) AS count FROM xr_reader_media_progress")).toEqual({ count: 0 })
    verified.close()
  })

  it("[neoview.bookmark.advanced-cleanup-sqlite] clears oldest, dated and all rows while preserving custom lists", async () => {
    const { path } = await fixture()
    const store = await SqliteReaderDataStore.open(path)
    await store.upsertBookmarkList({ id: "reading", name: "Reading", isFavorite: false, createdAt: 1, updatedAt: 1 })
    for (const [id, createdAt] of [["old-a", 10], ["old-b", 20], ["dated", 30], ["remaining", 40]] as const) {
      await store.upsertBookmark({ ...bookmark(id, false, ["reading"]), createdAt, updatedAt: createdAt })
    }

    await expect(store.deleteOldestBookmark(1)).resolves.toEqual({ selectedIds: ["old-a"], deleted: 1 })
    await expect(store.clearBookmarkBefore(35, 10)).resolves.toBe(2)
    await expect(store.listBookmarks({ limit: 10, offset: 0 })).resolves.toEqual([
      expect.objectContaining({ id: "remaining" }),
    ])
    await expect(store.clearAll("bookmarks")).resolves.toBe(1)
    await expect(store.listBookmarks({ limit: 10, offset: 0 })).resolves.toEqual([])
    await expect(store.listBookmarkLists()).resolves.toEqual([
      expect.objectContaining({ id: "reading" }),
    ])
    await expect(store.deleteOldestBookmark(0)).rejects.toThrow("limit is invalid")
    await expect(store.clearBookmarkBefore(-1, 10)).rejects.toThrow("date cleanup is invalid")
    await store.close()
  })

  it("[neoview.file-operations.undo-sqlite] persists and bounds guarded receipts without changing legacy metadata", async () => {
    const { path } = await fixture()
    const store = await SqliteReaderDataStore.open(path)
    await store.saveFileUndoTransaction(undoTransaction("older", 1, "D:/older"), 1)
    await store.saveFileUndoTransaction(undoTransaction("newer", 2, "D:/newer"), 1)
    await expect(store.loadFileUndoTransactions(50)).resolves.toEqual([undoTransaction("newer", 2, "D:/newer")])
    await expect(store.removeFileUndoTransaction("newer")).resolves.toBe(true)
    await expect(store.loadFileUndoTransactions(50)).resolves.toEqual([])
    await store.close()

    const verified = await openFixtureDatabase(path)
    expect(verified.get("PRAGMA user_version")).toEqual({ user_version: 7 })
    expect(verified.get("PRAGMA journal_mode")).toEqual({ journal_mode: "wal" })
    expect(verified.get("SELECT value FROM metadata WHERE key = 'version'")).toEqual({ value: "2.4" })
    expect(verified.get("SELECT category, value FROM thumbs WHERE key = 'D:/cover.jpg'")).toEqual({ category: "file", value: Uint8Array.of(0) })
    verified.close()
  })

  it("[neoview.media-progress.sqlite] persists runtime playback state without modifying legacy schema metadata", async () => {
    const { path } = await fixture()
    const store = await SqliteReaderDataStore.open(path)
    await store.saveMediaProgress({
      bookId: "video-book",
      position: 12.5,
      duration: 100,
      completed: false,
      updatedAt: 200,
    })
    await store.saveMediaProgress({
      bookId: "video-book",
      position: 1,
      duration: 100,
      completed: false,
      updatedAt: 100,
    })
    await expect(store.getMediaProgress("video-book")).resolves.toEqual({
      bookId: "video-book",
      position: 12.5,
      duration: 100,
      completed: false,
      updatedAt: 200,
    })
    await expect(store.saveMediaProgress({
      bookId: "video-book",
      position: 101,
      duration: 100,
      completed: false,
      updatedAt: 300,
    })).rejects.toThrow("position/duration")
    await store.close()

    const report = await inspectLegacyThumbnailDatabase(path)
    expect(report).toMatchObject({ compatibility: "current", metadataVersion: "2.4", userVersion: 7 })
  })

  it("[neoview.reader-data.sqlite-import] atomically merges newer rows and preserves migration-only data", async () => {
    const { path } = await fixture()
    const store = await SqliteReaderDataStore.open(path)
    const batch = {
      progress: [{
        bookId: "book-import",
        source: { kind: "archive", path: "D:/outer.cbz", entryPaths: ["nested.cbz"] } as const,
        displayName: "Nested",
        pageIndex: 4,
        pageCount: 10,
        updatedAt: 200,
      }],
      bookmarkLists: [{ id: "reading", name: "Reading", isFavorite: true, createdAt: 100, updatedAt: 100 }],
      bookmarks: [{
        id: "bookmark-import",
        source: { kind: "path", path: "D:/outer.cbz" } as const,
        name: "Outer",
        kind: "file" as const,
        starred: false,
        createdAt: 100,
        updatedAt: 100,
        listIds: ["default", "reading"],
      }],
      pathStacks: [{
        bookId: "book-import",
        pathStack: [{ path: "D:/outer.cbz" }, { path: "D:/outer.cbz", innerPath: "nested.cbz" }],
        updatedAt: 200,
      }],
      mediaProgress: [{ bookId: "book-import", position: 12, duration: 30, completed: false, updatedAt: 200 }],
    }
    await expect(store.importData(batch, "merge")).resolves.toEqual({
      progress: 1, bookmarks: 1, bookmarkLists: 1, pathStacks: 1, mediaProgress: 1,
    })
    await expect(store.importData(batch, "merge")).resolves.toEqual({
      progress: 0, bookmarks: 0, bookmarkLists: 0, pathStacks: 0, mediaProgress: 0,
    })
    await store.close()

    const database = await openFixtureDatabase(path)
    expect(database.get("SELECT page_index, updated_at FROM xr_reader_progress WHERE book_id = 'book-import'"))
      .toEqual({ page_index: 4, updated_at: 200 })
    expect(database.get("SELECT path_stack_json FROM xr_reader_path_stacks WHERE book_id = 'book-import'"))
      .toEqual({ path_stack_json: JSON.stringify(batch.pathStacks[0]!.pathStack) })
    expect(database.get("SELECT position, duration, completed FROM xr_reader_media_progress WHERE book_id = 'book-import'"))
      .toEqual({ position: 12, duration: 30, completed: 0 })
    expect(database.get("SELECT COUNT(*) AS count FROM xr_reader_bookmark_memberships WHERE bookmark_id = 'bookmark-import'"))
      .toEqual({ count: 2 })
    database.close()
  })

  it("[neoview.folder.sort-sqlite] persists global, tab and normalized folder rules without touching legacy rows", async () => {
    const { path } = await fixture()
    const store = await SqliteReaderDataStore.open(path)
    const globalSort = { field: "date" as const, order: "desc" as const, directoriesFirst: true }
    const tabSort = { field: "size" as const, order: "desc" as const, directoriesFirst: true }
    const folderSort = { field: "type" as const, order: "asc" as const, directoriesFirst: true }
    await store.setGlobalDefault(globalSort)
    await store.setTabDefault("tab-1", tabSort)
    await store.setFolderRule("d:/books", "D:/Books", folderSort, 100)
    await expect(store.getGlobalDefault()).resolves.toEqual(globalSort)
    await expect(store.getTabDefault("tab-1")).resolves.toEqual(tabSort)
    await expect(store.getFolderRule("d:/books")).resolves.toEqual(folderSort)
    await expect(store.clearFolderRules("d:/books")).resolves.toBe(1)
    await expect(store.getFolderRule("d:/books")).resolves.toBeUndefined()
    await store.close()

    const verified = await openFixtureDatabase(path)
    expect(verified.get("SELECT COUNT(*) AS count FROM thumbs WHERE key = 'D:/cover.jpg'")).toEqual({ count: 1 })
    expect(verified.get("SELECT COUNT(*) AS count FROM xr_reader_folder_sort_defaults")).toEqual({ count: 2 })
    verified.close()
  })

  it("[neoview.folder.search-history-sqlite] deduplicates, bounds and removes scoped history without changing legacy schema", async () => {
    const { path } = await fixture()
    const before = await openFixtureDatabase(path)
    const legacyObjects = before.all("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
    const journalMode = before.get("PRAGMA journal_mode")
    before.close()

    const store = await SqliteReaderDataStore.open(path)
    await store.recordSearchHistory({ scope: "folder", query: "a", usedAt: 100 }, 20)
    await store.recordSearchHistory({ scope: "folder", query: "b", usedAt: 200 }, 20)
    await expect(store.recordSearchHistory({ scope: "folder", query: "a", usedAt: 300 }, 20)).resolves.toEqual({
      scope: "folder", query: "a", usedAt: 300, useCount: 2,
    })
    await expect(store.listSearchHistory("folder", 20)).resolves.toEqual([
      { scope: "folder", query: "a", usedAt: 300, useCount: 2 },
      { scope: "folder", query: "b", usedAt: 200, useCount: 1 },
    ])
    for (let index = 0; index < 25; index += 1) {
      await store.recordSearchHistory({ scope: "file", query: `query-${index}`, usedAt: 1_000 + index }, 20)
    }
    const bounded = await store.listSearchHistory("file", 100)
    expect(bounded).toHaveLength(20)
    expect(bounded[0]?.query).toBe("query-24")
    expect(bounded.at(-1)?.query).toBe("query-5")
    await expect(store.deleteSearchHistory("folder", "b")).resolves.toBe(true)
    await expect(store.clearSearchHistory("file")).resolves.toBe(20)
    await expect(store.listSearchHistory("file", 20)).resolves.toEqual([])
    await store.close()

    const verified = await openFixtureDatabase(path)
    expect(verified.get("SELECT category, hex(value) AS value, emm_json FROM thumbs WHERE key = 'D:/cover.jpg'"))
      .toEqual({ category: "file", value: "00", emm_json: "legacy" })
    expect(verified.get("SELECT value FROM metadata WHERE key = 'version'")).toEqual({ value: "2.4" })
    expect(verified.get("PRAGMA user_version")).toEqual({ user_version: 7 })
    expect(verified.get("PRAGMA journal_mode")).toEqual(journalMode)
    const afterObjects = verified.all("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE 'xr_%' ORDER BY type, name")
    expect(afterObjects).toEqual(legacyObjects)
    expect(verified.all("SELECT type, name FROM sqlite_master WHERE name IN ('xr_reader_search_history', 'xr_reader_search_history_scope_used_idx') ORDER BY type, name"))
      .toEqual([
        { type: "index", name: "xr_reader_search_history_scope_used_idx" },
        { type: "table", name: "xr_reader_search_history" },
      ])
    verified.close()
  })

  it("[neoview.folder.emm-sqlite-batch] reads legacy EMM business columns without decoding thumbnail blobs", async () => {
    const { path } = await fixture()
    const seeded = await openFixtureDatabase(path)
    seeded.exec(`
      UPDATE thumbs SET rating_data = '{"value":4.7}', emm_json = '{"rating":3.0,"tags":[]}', manual_tags = '[{"namespace":"manual","tag":"keep","timestamp":1}]' WHERE key = 'D:/cover.jpg';
      INSERT INTO thumbs (key, category, value, emm_json) VALUES ('D:/other.cbz', 'file', X'00', '{"rating":2.5,"tags":[]}');
    `)
    seeded.close()
    const store = await SqliteReaderDataStore.open(path)
    expect(store.directoryEmmAvailable).toBe(true)
    await expect(store.readDirectoryEmmRecords(["D:/cover.jpg", "D:/other.cbz", "D:/missing.cbz"])).resolves.toEqual(new Map([
      ["D:/cover.jpg", { ratingData: '{"value":4.7}', emmJson: '{"rating":3.0,"tags":[]}', manualTags: '[{"namespace":"manual","tag":"keep","timestamp":1}]' }],
      ["D:/other.cbz", { ratingData: undefined, emmJson: '{"rating":2.5,"tags":[]}', manualTags: undefined }],
    ]))
    await store.close()
  })

  it("[neoview.folder.emm-tag-sqlite] samples deduplicated valid tags with SQLite JSON1 without changing legacy rows", async () => {
    const { path } = await fixture()
    const seeded = await openFixtureDatabase(path)
    seeded.exec(`
      UPDATE thumbs SET emm_json = '{"tags":[{"namespace":"artist","tag":"Alice"},{"namespace":"female","tag":"glasses"}]}' WHERE key = 'D:/cover.jpg';
      INSERT INTO thumbs (key, category, value, emm_json) VALUES
        ('D:/two.cbz', 'file', X'00', '{"tags":[{"namespace":"ARTIST","tag":"alice"},{"namespace":"language","tag":"chinese"}]}'),
        ('D:/bad.cbz', 'file', X'00', 'not-json'),
        ('D:/empty.cbz', 'file', X'00', '{"tags":[{"namespace":"","tag":"ignored"}]}');
    `)
    const before = seeded.all("SELECT key, emm_json FROM thumbs ORDER BY key")
    seeded.close()

    const store = await SqliteReaderDataStore.open(path)
    const tags = await store.sampleEmmTags(10)
    expect(tags).toHaveLength(3)
    expect(tags.map((value) => `${value.category.toLocaleLowerCase()}:${value.tag.toLocaleLowerCase()}`).sort()).toEqual([
      "artist:alice",
      "female:glasses",
      "language:chinese",
    ])
    await expect(store.sampleEmmTags(65)).rejects.toThrow("1 to 64")
    await store.close()

    const verified = await openFixtureDatabase(path)
    expect(verified.all("SELECT key, emm_json FROM thumbs ORDER BY key")).toEqual(before)
    verified.close()
  })

  it("[neoview.emm.override-sqlite] merges revisioned xr_ overrides without modifying legacy thumbs metadata", async () => {
    const { path } = await fixture()
    const seeded = await openFixtureDatabase(path)
    seeded.exec(`UPDATE thumbs SET rating_data = '{"value":2,"source":"emm"}', emm_json = '{"translated_title":"旧译名","rating":2}', manual_tags = '[]' WHERE key = 'D:/cover.jpg'`)
    const before = seeded.get("SELECT rating_data, emm_json, manual_tags FROM thumbs WHERE key = 'D:/cover.jpg'")
    seeded.close()

    const store = await SqliteReaderDataStore.open(path)
    await expect(store.saveEmmOverride("D:/cover.jpg", {
      rating: 5,
      translatedTitle: "新译名",
      manualTags: [{ namespace: "artist", tag: "Alice" }],
    }, 0, 123)).resolves.toEqual({
      path: "D:/cover.jpg",
      overrides: { rating: 5, translatedTitle: "新译名", manualTags: [{ namespace: "artist", tag: "Alice" }] },
      revision: 1,
      updatedAt: 123,
    })
    await expect(store.saveEmmOverride("D:/cover.jpg", { rating: 4 }, 0, 124)).resolves.toBeUndefined()
    const merged = await store.readDirectoryEmmRecords(["D:/cover.jpg"])
    expect(JSON.parse(merged.get("D:/cover.jpg")!.ratingData!)).toEqual({ value: 5, source: "manual", timestamp: 123 })
    expect(JSON.parse(merged.get("D:/cover.jpg")!.manualTags!)).toEqual([{ namespace: "artist", tag: "Alice" }])
    expect(JSON.parse(merged.get("D:/cover.jpg")!.emmJson!)).toEqual({ translated_title: "新译名", rating: 2 })
    await store.close()

    const verified = await openFixtureDatabase(path)
    expect(verified.get("SELECT rating_data, emm_json, manual_tags FROM thumbs WHERE key = 'D:/cover.jpg'")).toEqual(before)
    expect(verified.get("SELECT value FROM metadata WHERE key = 'version'")).toEqual({ value: "2.4" })
    expect(verified.get("PRAGMA user_version")).toEqual({ user_version: 7 })
    expect(verified.get("SELECT revision FROM xr_reader_emm_overrides WHERE path_key = 'd:/cover.jpg'")).toEqual({ revision: 1 })
    verified.close()
  })

  it("[neoview.emm.override-no-legacy] remains available through xr_ storage when legacy thumbs has no EMM columns", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-reader-emm-xr-only-"))
    directories.push(directory)
    const path = join(directory, "thumbnails.db")
    const database = await openFixtureDatabase(path)
    database.exec("CREATE TABLE unrelated (id INTEGER PRIMARY KEY)")
    database.close()
    const store = await SqliteReaderDataStore.open(path)
    expect(store.directoryEmmAvailable).toBe(true)
    await store.saveEmmOverride("D:/book.cbz", { rating: 4 }, 0, 100)
    const result = await store.readDirectoryEmmRecords(["D:/book.cbz"])
    expect(JSON.parse(result.get("D:/book.cbz")!.ratingData!)).toEqual({ value: 4, source: "manual", timestamp: 100 })
    await store.close()
  })

  it("[neoview.folder.emm-legacy-columns] reads older EMM rows without adding manual_tags", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-reader-emm-legacy-"))
    directories.push(directory)
    const path = join(directory, "thumbnails.db")
    const database = await openFixtureDatabase(path)
    database.exec(`
      CREATE TABLE thumbs (key TEXT PRIMARY KEY, rating_data TEXT, emm_json TEXT);
      INSERT INTO thumbs (key, rating_data, emm_json) VALUES ('D:/old.cbz', '{"value":4.1}', '{"tags":[]}');
    `)
    database.close()
    const store = await SqliteReaderDataStore.open(path)
    await expect(store.readDirectoryEmmRecords(["D:/old.cbz"])).resolves.toEqual(new Map([
      ["D:/old.cbz", { ratingData: '{"value":4.1}', emmJson: '{"tags":[]}', manualTags: undefined }],
    ]))
    await store.close()
    const verified = await openFixtureDatabase(path)
    expect(verified.get("SELECT COUNT(*) AS count FROM pragma_table_info('thumbs') WHERE name = 'manual_tags'")).toEqual({ count: 0 })
    verified.close()
  })

  it("[neoview.book-information.emm-sqlite] reads translated titles from a key plus emm_json legacy schema", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-reader-book-emm-legacy-"))
    directories.push(directory)
    const path = join(directory, "thumbnails.db")
    const database = await openFixtureDatabase(path)
    database.exec(`
      CREATE TABLE thumbs (key TEXT PRIMARY KEY, emm_json TEXT);
      INSERT INTO thumbs (key, emm_json) VALUES ('D:\\books\\demo.cbz', '{"translated_title":"译名"}');
    `)
    database.close()

    const store = await SqliteReaderDataStore.open(path)
    expect(store.directoryEmmAvailable).toBe(true)
    await expect(store.readDirectoryEmmRecords(["D:\\books\\demo.cbz"])).resolves.toEqual(new Map([
      ["D:\\books\\demo.cbz", { ratingData: undefined, emmJson: '{"translated_title":"译名"}', manualTags: undefined }],
    ]))
    await store.close()

    const verified = await openFixtureDatabase(path)
    expect(verified.all("PRAGMA table_info(thumbs)").map((column) => column.name)).toEqual(["key", "emm_json"])
    verified.close()
  })
})

function bookmark(id: string, starred: boolean, listIds: readonly string[]) {
  return {
    id,
    source: { kind: "image", path: `D:/${id}.jpg` } as const,
    name: id,
    kind: "file" as const,
    starred,
    createdAt: 100,
    updatedAt: id === "one" ? 100 : 200,
    listIds,
  }
}

async function fixture(): Promise<{ path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "xiranite-reader-library-"))
  directories.push(directory)
  const path = join(directory, "thumbnails.db")
  const database = await openFixtureDatabase(path)
  database.exec(CURRENT_SCHEMA_SQL)
  database.close()
  return { path }
}

const CURRENT_SCHEMA_SQL = `
  PRAGMA journal_mode = WAL;
  PRAGMA user_version = 7;
  CREATE TABLE thumbs (
    key TEXT NOT NULL PRIMARY KEY, size INTEGER, date TEXT, ghash INTEGER,
    category TEXT DEFAULT 'file', value BLOB, emm_json TEXT, rating_data TEXT,
    ai_translation TEXT, manual_tags TEXT
  );
  CREATE INDEX idx_thumbs_key ON thumbs(key);
  CREATE INDEX idx_thumbs_category ON thumbs(category);
  CREATE INDEX idx_thumbs_date ON thumbs(date);
  CREATE TABLE failed_thumbnails (
    key TEXT NOT NULL PRIMARY KEY, reason TEXT NOT NULL, retry_count INTEGER DEFAULT 0,
    last_attempt TEXT, error_message TEXT
  );
  CREATE INDEX idx_failed_reason ON failed_thumbnails(reason);
  CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT);
  INSERT INTO metadata VALUES ('version', '2.4');
  INSERT INTO thumbs (key, category, value, emm_json) VALUES ('D:/cover.jpg', 'file', X'00', 'legacy');
`

interface FixtureDatabase {
  exec(sql: string): void
  get(sql: string): Record<string, unknown> | undefined
  all(sql: string): Record<string, unknown>[]
  close(): void
}

function undoTransaction(id: string, createdAt: number, path: string) {
  const original = { kind: "copy" as const, sourcePath: `${path}-source`, destinationPath: path, overwrite: false }
  return {
    id,
    createdAt,
    entries: [{
      index: 0,
      receipt: {
        original,
        inverse: { kind: "delete" as const, sourcePath: path },
        guard: { path, kind: "file" as const, size: 1, mtimeMs: 1, ctimeMs: 1, device: 1, inode: 1 },
      },
    }],
  }
}

async function openFixtureDatabase(path: string): Promise<FixtureDatabase> {
  if (process.versions.bun) {
    const moduleName = "bun:sqlite"
    const sqlite = await import(moduleName) as unknown as {
      Database: new (path: string, options: { create: boolean; strict: boolean }) => {
        exec(sql: string): void
        query(sql: string): { get(): Record<string, unknown> | null }
        close(): void
      }
    }
    const database = new sqlite.Database(path, { create: true, strict: true })
    return {
      exec: (sql) => database.exec(sql),
      get: (sql) => database.query(sql).get() ?? undefined,
      all: (sql) => database.query(sql).all() as Record<string, unknown>[],
      close: () => database.close(),
    }
  }
  const moduleName = "node:sqlite"
  const sqlite = await import(moduleName) as typeof import("node:sqlite")
  const database = new sqlite.DatabaseSync(path)
  return {
    exec: (sql) => database.exec(sql),
    get: (sql) => database.prepare(sql).get() as Record<string, unknown> | undefined,
    all: (sql) => database.prepare(sql).all() as Record<string, unknown>[],
    close: () => database.close(),
  }
}
