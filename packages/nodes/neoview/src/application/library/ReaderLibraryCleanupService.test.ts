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

  it("[neoview.library.cleanup-cancel-after-list] does not start the second collection after cancellation", async () => {
    const store = fakeStore()
    const pending = deferred<ReturnType<typeof recent>[]> ()
    store.listRecent.mockReturnValue(pending.promise)
    const controller = new AbortController()
    const cleanup = new ReaderLibraryCleanupService(new ReaderLibraryService(store), { check: vi.fn() })
    const operation = cleanup.cleanupInvalid({ kind: "both", signal: controller.signal })

    controller.abort(new DOMException("cancelled", "AbortError"))
    pending.resolve([])
    await expect(operation).rejects.toMatchObject({ name: "AbortError" })
    expect(store.listBookmarks).not.toHaveBeenCalled()
  })

  it("[neoview.library.cleanup-cancel-after-check] does not delete a result returned after cancellation", async () => {
    const store = fakeStore()
    store.listRecent.mockResolvedValue([recent("missing", "D:/missing.cbz")])
    const controller = new AbortController()
    const check = vi.fn(async () => {
      controller.abort(new DOMException("cancelled", "AbortError"))
      return "missing" as const
    })
    const cleanup = new ReaderLibraryCleanupService(new ReaderLibraryService(store), { check })

    await expect(cleanup.cleanupInvalid({ kind: "recents", signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" })
    expect(store.deleteRecent).not.toHaveBeenCalled()
  })

  it("[neoview.library.cleanup-cancel-during-delete] reports cancellation after the store delete settles", async () => {
    const store = fakeStore()
    store.listRecent.mockResolvedValue([recent("missing", "D:/missing.cbz")])
    store.deleteRecent.mockImplementation(async () => {
      controller.abort(new DOMException("cancelled", "AbortError"))
      return true
    })
    const controller = new AbortController()
    const cleanup = new ReaderLibraryCleanupService(new ReaderLibraryService(store), {
      check: vi.fn(async () => "missing" as const),
    })

    await expect(cleanup.cleanupInvalid({ kind: "recents", signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" })
    expect(store.deleteRecent).toHaveBeenCalledWith("missing")
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
    deleteRecentBatch: vi.fn<ReaderLibraryStore["deleteRecentBatch"]>(async () => ({ deleted: 0, missingIds: [] })),
    deleteOldestRecent: vi.fn<ReaderLibraryStore["deleteOldestRecent"]>(async () => ({ selectedIds: [], deleted: 0 })),
    clearRecentBefore: vi.fn<ReaderLibraryStore["clearRecentBefore"]>(async () => 0),
    clearByPathPrefix: vi.fn<ReaderLibraryStore["clearByPathPrefix"]>(async () => 0),
    clearAll: vi.fn<ReaderLibraryStore["clearAll"]>(async () => 0),
    listBookmarks: vi.fn<ReaderLibraryStore["listBookmarks"]>(async () => []),
    findBookmarkByPath: vi.fn<ReaderLibraryStore["findBookmarkByPath"]>(async () => undefined),
    upsertBookmark: vi.fn<ReaderLibraryStore["upsertBookmark"]>(async () => undefined),
    updateBookmark: vi.fn<ReaderLibraryStore["updateBookmark"]>(async () => undefined),
    updateBookmarkBatch: vi.fn<ReaderLibraryStore["updateBookmarkBatch"]>(async () => ({ items: [], missingIds: [] })),
    deleteBookmark: vi.fn<ReaderLibraryStore["deleteBookmark"]>(async () => false),
    deleteBookmarkBatch: vi.fn<ReaderLibraryStore["deleteBookmarkBatch"]>(async () => ({ deleted: 0, missingIds: [] })),
    deleteOldestBookmark: vi.fn<ReaderLibraryStore["deleteOldestBookmark"]>(async () => ({ selectedIds: [], deleted: 0 })),
    clearBookmarkBefore: vi.fn<ReaderLibraryStore["clearBookmarkBefore"]>(async () => 0),
    listBookmarkLists: vi.fn<ReaderLibraryStore["listBookmarkLists"]>(async () => []),
    upsertBookmarkList: vi.fn<ReaderLibraryStore["upsertBookmarkList"]>(async () => undefined),
    deleteBookmarkList: vi.fn<ReaderLibraryStore["deleteBookmarkList"]>(async () => false),
    close: vi.fn(async () => undefined),
    [Symbol.asyncDispose]: vi.fn(async () => undefined),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
