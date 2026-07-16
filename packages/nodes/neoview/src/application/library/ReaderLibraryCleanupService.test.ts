import { describe, expect, it, vi } from "vitest"

import type { ReaderLibraryStore } from "../../ports/ReaderLibraryStore.js"
import { ReaderLibraryService } from "./ReaderLibraryService.js"
import { ReaderLibraryCleanupService } from "./ReaderLibraryCleanupService.js"

describe("ReaderLibraryCleanupService", () => {
  it("[neoview.library.cleanup-invalid] removes only confirmed missing paths within explicit budgets", async () => {
    const store = fakeStore()
    store.listRecent.mockResolvedValue([
      recent("missing-recent", "D:/missing.cbz"),
      recent("unknown-recent", "Z:/offline.cbz"),
    ])
    store.listBookmarks.mockResolvedValue([
      bookmark("missing-bookmark", "D:/gone.jpg"),
      bookmark("present-bookmark", "D:/cover.jpg"),
    ])
    store.deleteRecent.mockResolvedValue(true)
    store.deleteBookmark.mockResolvedValue(true)
    const status = new Map([
      ["D:/missing.cbz", "missing"], ["Z:/offline.cbz", "unknown"],
      ["D:/gone.jpg", "missing"], ["D:/cover.jpg", "present"],
    ] as const)
    const cleanup = new ReaderLibraryCleanupService(new ReaderLibraryService(store), {
      check: vi.fn(async (path: string) => status.get(path) ?? "unknown"),
    })

    await expect(cleanup.cleanupInvalid({ kind: "both", scanLimit: 10, deleteLimit: 1, concurrency: 2 })).resolves.toEqual({
      kind: "both", scanned: 4, missing: 2, unknown: 1, deleted: 1, truncated: true,
    })
    expect(store.deleteRecent).toHaveBeenCalledWith("missing-recent")
    expect(store.deleteBookmark).not.toHaveBeenCalled()
  })

  it("[neoview.library.cleanup-cancel] rejects an aborted cleanup before listing or deletion", async () => {
    const store = fakeStore()
    const abort = new AbortController()
    abort.abort(new Error("cancelled"))
    const cleanup = new ReaderLibraryCleanupService(new ReaderLibraryService(store), { check: vi.fn() })
    await expect(cleanup.cleanupInvalid({ signal: abort.signal })).rejects.toThrow("cancelled")
    expect(store.listRecent).not.toHaveBeenCalled()
  })
})

function recent(bookId: string, path: string) {
  return { bookId, source: { kind: "archive" as const, path }, displayName: bookId, pageIndex: 0, pageCount: 1, updatedAt: 1 }
}

function bookmark(id: string, path: string) {
  return { id, source: { kind: "image" as const, path }, name: id, kind: "file" as const, starred: false, createdAt: 1, updatedAt: 1, listIds: ["default"] }
}

function fakeStore() {
  return {
    listRecent: vi.fn<ReaderLibraryStore["listRecent"]>(async () => []),
    deleteRecent: vi.fn<ReaderLibraryStore["deleteRecent"]>(async () => false),
    clearRecentBefore: vi.fn<ReaderLibraryStore["clearRecentBefore"]>(async () => 0),
    listBookmarks: vi.fn<ReaderLibraryStore["listBookmarks"]>(async () => []),
    findBookmarkByPath: vi.fn<ReaderLibraryStore["findBookmarkByPath"]>(async () => undefined),
    upsertBookmark: vi.fn<ReaderLibraryStore["upsertBookmark"]>(async () => undefined),
    deleteBookmark: vi.fn<ReaderLibraryStore["deleteBookmark"]>(async () => false),
    listBookmarkLists: vi.fn<ReaderLibraryStore["listBookmarkLists"]>(async () => []),
    upsertBookmarkList: vi.fn<ReaderLibraryStore["upsertBookmarkList"]>(async () => undefined),
    deleteBookmarkList: vi.fn<ReaderLibraryStore["deleteBookmarkList"]>(async () => false),
    close: vi.fn(async () => undefined),
    [Symbol.asyncDispose]: vi.fn(async () => undefined),
  }
}
