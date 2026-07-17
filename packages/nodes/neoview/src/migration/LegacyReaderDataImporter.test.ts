import { describe, expect, it, vi } from "vitest"

import type { ReaderDataStore } from "../ports/ReaderDataStore.js"
import { LegacyReaderDataCodec } from "./LegacyReaderDataCodec.js"
import { LegacyReaderDataImporter } from "./LegacyReaderDataImporter.js"

describe("LegacyReaderDataImporter", () => {
  it("[neoview.reader-data.import] materializes one atomic batch and preserves media/path-stack data", async () => {
    const decoded = new LegacyReaderDataCodec().decode({
      extended: {
        history: [{
          pathStack: [{ path: "D:/outer.cbz" }, { path: "D:/outer.cbz", innerPath: "nested.cbz" }],
          displayName: "Nested",
          currentIndex: 500,
          totalItems: 1000,
          timestamp: 20,
          contentType: "video",
          videoProgress: { position: 50, duration: 100, completed: false },
        }],
        bookmarks: [{ id: "b1", path: "D:/missing", name: "Missing", listIds: ["favorites", "default"], createdAt: 10 }],
      },
    })
    const store = dataStore()
    store.importData.mockResolvedValue({ progress: 1, bookmarks: 1, bookmarkLists: 0, pathStacks: 1, mediaProgress: 1 })
    const importer = new LegacyReaderDataImporter(store, async (source) => ({
      bookId: source.kind === "archive" ? "archive-book" : "bookmark-book",
      source,
      canonical: source.kind === "archive",
    }))

    const result = await importer.import(decoded, "merge")
    expect(result).toMatchObject({ applied: { progress: 1, mediaProgress: 1 }, unresolvedSources: 1 })
    expect(store.importData).toHaveBeenCalledWith({
      progress: [expect.objectContaining({ bookId: "archive-book", pageIndex: 0, pageCount: 1 })],
      bookmarks: [expect.objectContaining({ id: "b1", starred: true, listIds: ["default"] })],
      bookmarkLists: [],
      pathStacks: [expect.objectContaining({ bookId: "archive-book", pathStack: expect.any(Array) })],
      mediaProgress: [{ bookId: "archive-book", position: 50, duration: 100, completed: false, updatedAt: 20 }],
    }, "merge")
  })
})

function dataStore() {
  return {
    importData: vi.fn<ReaderDataStore["importData"]>(),
    get: vi.fn(), save: vi.fn(), listRecent: vi.fn(), deleteRecent: vi.fn(), deleteRecentBatch: vi.fn(), deleteOldestRecent: vi.fn(), clearRecentBefore: vi.fn(), clearByPathPrefix: vi.fn(),
    listBookmarks: vi.fn(), upsertBookmark: vi.fn(), updateBookmarkBatch: vi.fn(), deleteBookmark: vi.fn(), deleteBookmarkBatch: vi.fn(), listBookmarkLists: vi.fn(),
    upsertBookmarkList: vi.fn(), deleteBookmarkList: vi.fn(), close: vi.fn(), [Symbol.asyncDispose]: vi.fn(),
  }
}
