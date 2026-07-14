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
})

function value(size: number) {
  return { bytes: new Uint8Array(size), contentType: "image/webp" }
}
