import { describe, expect, it, vi } from "vitest"
import { ReaderFolderRatingService } from "./ReaderFolderRatingService.js"

describe("ReaderFolderRatingService", () => {
  it("rebuilds only on command and atomically replaces the cache", async () => {
    const catalog = { listEmmRatingRecords: vi.fn(async () => [{ path: "D:/books/a.cbz", rating: 4 }]) }
    const cache = { loadFolderRatingCache: vi.fn(async () => ({ entries: [] })), replaceFolderRatingCache: vi.fn(async () => undefined), clearFolderRatingCache: vi.fn(async () => undefined) }
    const service = new ReaderFolderRatingService(catalog, cache, () => 123)
    await expect(service.rebuild()).resolves.toMatchObject({ updatedAt: 123, entries: [{ path: "D:/books", averageRating: 4 }] })
    expect(cache.replaceFolderRatingCache).toHaveBeenCalledWith(expect.any(Array), 123)
  })
})
