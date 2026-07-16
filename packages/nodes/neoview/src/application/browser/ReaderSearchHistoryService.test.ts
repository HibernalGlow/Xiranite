import { describe, expect, it, vi } from "vitest"

import type { ReaderSearchHistoryStore } from "../../ports/ReaderSearchHistoryStore.js"
import { ReaderSearchHistoryService } from "./ReaderSearchHistoryService.js"

describe("ReaderSearchHistoryService", () => {
  it("[neoview.folder.search-history-service] normalizes queries and bounds persisted history", async () => {
    const store = fakeStore()
    const service = new ReaderSearchHistoryService(store, () => 123, 20)

    await expect(service.record("folder", "  cover art  ")).resolves.toEqual({
      scope: "folder",
      query: "cover art",
      usedAt: 123,
      useCount: 1,
    })
    expect(store.recordSearchHistory).toHaveBeenCalledWith(
      { scope: "folder", query: "cover art", usedAt: 123 },
      20,
    )
    await service.list("folder", 100)
    expect(store.listSearchHistory).toHaveBeenCalledWith("folder", 20)
  })

  it("[neoview.folder.search-history-validation] rejects unsupported scopes and invalid values before storage", async () => {
    const store = fakeStore()
    const service = new ReaderSearchHistoryService(store, () => -1)

    expect(() => service.record("folder", " ")).toThrow("1..512")
    expect(() => service.record("folder", "valid")).toThrow("clock")
    expect(() => service.list("folder", 0)).toThrow("1 to 100")
    expect(() => service.list("unsupported" as "folder")).toThrow("Unsupported")
    expect(store.recordSearchHistory).not.toHaveBeenCalled()
  })
})

function fakeStore(): ReaderSearchHistoryStore & {
  listSearchHistory: ReturnType<typeof vi.fn>
  recordSearchHistory: ReturnType<typeof vi.fn>
} {
  return {
    listSearchHistory: vi.fn(async () => []),
    recordSearchHistory: vi.fn(async (record) => ({ ...record, useCount: 1 })),
    deleteSearchHistory: vi.fn(async () => false),
    clearSearchHistory: vi.fn(async () => 0),
    close: vi.fn(async () => undefined),
    [Symbol.asyncDispose]: vi.fn(async () => undefined),
  }
}
