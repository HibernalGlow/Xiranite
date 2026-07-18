import { describe, expect, it } from "vitest"

import { WeightedLruPresentationCache } from "./WeightedLruPresentationCache.js"

describe("WeightedLruPresentationCache", () => {
  it("[neoview.cache.weighted-lru] accounts actual bytes, touches hits and trims to the soft target", () => {
    const cache = new WeightedLruPresentationCache({ maxBytes: 10, maxEntryBytes: 6, trimRatio: 0.8 })
    expect(cache.set("a", value(4))).toBe(true)
    expect(cache.set("b", value(4))).toBe(true)
    expect(cache.get("a")).toBeDefined()
    expect(cache.set("c", value(4))).toBe(true)

    expect(cache.get("b")).toBeUndefined()
    expect(cache.get("a")).toBeDefined()
    expect(cache.get("c")).toBeDefined()
    expect(cache.snapshot()).toMatchObject({ entries: 2, bytes: 8, hits: 3, misses: 1, evictions: 1 })
  })

  it("[neoview.cache.byte-budget] rejects oversized entries and keeps replacement accounting exact", () => {
    const cache = new WeightedLruPresentationCache({ maxBytes: 12, maxEntryBytes: 6 })
    expect(cache.set("oversized", value(7))).toBe(false)
    expect(cache.set("page", value(6))).toBe(true)
    expect(cache.set("page", value(2))).toBe(true)
    expect(cache.snapshot()).toMatchObject({ entries: 1, bytes: 2 })
    cache.clear()
    expect(cache.snapshot()).toMatchObject({ entries: 0, bytes: 0 })
  })

  it("[neoview.cache.soft-trim] delegates LRU eviction to lru-cache and continues to the configured soft target", () => {
    const cache = new WeightedLruPresentationCache({ maxBytes: 10, maxEntryBytes: 4, trimRatio: 0.8 })
    for (const key of ["a", "b", "c", "d"]) expect(cache.set(key, value(2))).toBe(true)
    expect(cache.set("e", value(3))).toBe(true)

    expect(cache.snapshot()).toMatchObject({ entries: 3, bytes: 7, evictions: 2 })
    expect(cache.get("a")).toBeUndefined()
    expect(cache.get("b")).toBeUndefined()
    expect(cache.get("c")).toBeDefined()
    expect(cache.get("e")).toBeDefined()
  })

  it("[neoview.memory-pressure.l2-trim] releases least-recently-used bytes to an explicit pressure target", () => {
    const cache = new WeightedLruPresentationCache({ maxBytes: 16, maxEntryBytes: 4 })
    for (const key of ["a", "b", "c", "d"]) cache.set(key, value(4))
    expect(cache.get("b")).toBeDefined()
    cache.trimTo(8)
    expect(cache.snapshot()).toMatchObject({ entries: 2, bytes: 8, evictions: 2 })
    expect(cache.get("a")).toBeUndefined()
    expect(cache.get("c")).toBeUndefined()
    expect(cache.get("b")).toBeDefined()
    expect(cache.get("d")).toBeDefined()
    cache.trimTo(0)
    expect(cache.snapshot()).toMatchObject({ entries: 0, bytes: 0, evictions: 4 })
  })

  it("[neoview.cache.presentation-lease] preserves leased entries across eviction and releases them back to the same LRU", () => {
    const cache = new WeightedLruPresentationCache({ maxBytes: 8, maxEntryBytes: 4, trimRatio: 1 })
    cache.set("current", value(4))
    cache.set("old", value(4))
    const first = cache.pin("current")!
    const second = cache.pin("current")!
    expect(first.value.bytes).toHaveLength(4)
    cache.set("next", value(4))
    expect(cache.get("old")).toBeUndefined()
    expect(cache.snapshot()).toMatchObject({ pinnedEntries: 1, pinnedBytes: 4, activeLeases: 2 })
    first.release()
    first.release()
    expect(cache.snapshot()).toMatchObject({ pinnedEntries: 1, activeLeases: 1 })
    second.release()
    expect(cache.snapshot()).toMatchObject({ pinnedEntries: 0, pinnedBytes: 0, activeLeases: 0, entries: 2, bytes: 8 })
  })

  it("[neoview.cache.presentation-lease-pressure] keeps active bytes readable but drops them after release when pressure clears the cache", () => {
    const cache = new WeightedLruPresentationCache({ maxBytes: 8, maxEntryBytes: 4 })
    cache.set("current", value(4))
    const lease = cache.pin("current")!
    cache.clear()
    expect(cache.get("current")).toBeDefined()
    expect(cache.snapshot()).toMatchObject({ entries: 1, bytes: 4, pinnedEntries: 1, activeLeases: 1 })
    lease.release()
    expect(cache.snapshot()).toMatchObject({ entries: 0, bytes: 0, pinnedEntries: 0, activeLeases: 0 })
  })
})

function value(size: number) {
  return { bytes: new Uint8Array(size), contentType: "image/webp" }
}
