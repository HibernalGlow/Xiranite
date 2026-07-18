import { describe, expect, it, vi } from "vitest"

import type { ReaderPresentationDiskCache } from "../../ports/ReaderPresentationDiskCache.js"
import { ReaderCacheService } from "./ReaderCacheService.js"

describe("ReaderCacheService", () => {
  it("[neoview.cache.shared-service] normalizes disabled and enabled maintenance results", async () => {
    const disabled = new ReaderCacheService()
    expect(await disabled.status()).toEqual({ enabled: false })
    expect(await disabled.cleanup()).toEqual({ enabled: false })
    expect(await disabled.clear()).toEqual({ enabled: false })

    const cache = fakeCache()
    const service = new ReaderCacheService(cache.value)
    expect(await service.status()).toMatchObject({ enabled: true, entries: 2, bytes: 20 })
    expect(await service.cleanup("budget")).toMatchObject({ enabled: true, reason: "budget", removedEntries: 1 })
    expect(await service.clear()).toMatchObject({ enabled: true, reason: "explicit", entries: 0 })
    expect(cache.cleanup).toHaveBeenCalledWith("budget")
    expect(cache.clear).toHaveBeenCalledOnce()
  })

  it("[neoview.cache.shared-lifecycle] only closes an explicitly owned adapter", async () => {
    const external = fakeCache()
    await new ReaderCacheService(external.value)[Symbol.asyncDispose]()
    expect(external.close).not.toHaveBeenCalled()

    const owned = fakeCache()
    const service = new ReaderCacheService(owned.value, { ownsPresentationCache: true })
    await service.close()
    await service.close()
    expect(owned.close).toHaveBeenCalledOnce()
    await expect(service.status()).rejects.toThrow("closed")
  })
})

function fakeCache() {
  const snapshot = {
    entries: 2, bytes: 20, maxBytes: 100, maxEntryBytes: 20, activeLeases: 0,
    hits: 3, misses: 1, writes: 2, rejectedWrites: 0, evictions: 0, integrityFailures: 0,
  }
  const cleanup = vi.fn(async (reason = "age" as const) => ({
    ...snapshot, reason, removedEntries: 1, removedBytes: 10, durationMs: 1,
  }))
  const clear = vi.fn(async () => ({
    ...snapshot, entries: 0, bytes: 0, reason: "explicit" as const, removedEntries: 2, removedBytes: 20, durationMs: 1,
  }))
  const close = vi.fn(async () => undefined)
  const value: ReaderPresentationDiskCache = {
    maxEntryBytes: 20,
    acquire: vi.fn(async () => undefined),
    put: vi.fn(async () => true),
    invalidate: vi.fn(async () => undefined),
    snapshot: vi.fn(async () => snapshot),
    cleanup,
    clear,
    close,
    [Symbol.asyncDispose]: close,
  }
  return { value, cleanup, clear, close }
}
