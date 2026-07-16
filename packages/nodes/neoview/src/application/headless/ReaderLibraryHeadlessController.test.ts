import { describe, expect, it, vi } from "vitest"

import type { ReaderLibraryStore } from "../../ports/ReaderLibraryStore.js"
import { ReaderLibraryService } from "../library/ReaderLibraryService.js"
import { ReaderLibraryHeadlessController } from "./ReaderLibraryHeadlessController.js"

describe("ReaderLibraryHeadlessController", () => {
  it("[neoview.library.headless] resolves paths once and delegates all state to ReaderLibraryService", async () => {
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
    await controller.listRecent(20, 5)
    expect(store.listRecent).toHaveBeenCalledWith({ limit: 20, offset: 5 })
    await controller.close()
    await controller.close()
    expect(store.close).toHaveBeenCalledOnce()
    expect(() => controller.listBookmarkLists()).toThrow("closed")
  })
})

function fakeStore(): ReaderLibraryStore {
  return {
    listRecent: vi.fn(async () => []),
    deleteRecent: vi.fn(async () => false),
    clearRecentBefore: vi.fn(async () => 0),
    listBookmarks: vi.fn(async () => []),
    findBookmarkByPath: vi.fn(async () => undefined),
    upsertBookmark: vi.fn(async () => undefined),
    updateBookmark: vi.fn(async () => undefined),
    deleteBookmark: vi.fn(async () => false),
    listBookmarkLists: vi.fn(async () => []),
    upsertBookmarkList: vi.fn(async () => undefined),
    deleteBookmarkList: vi.fn(async () => false),
    close: vi.fn(async () => undefined),
    [Symbol.asyncDispose]: vi.fn(async () => undefined),
  }
}
