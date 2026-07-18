import { describe, expect, it } from "vitest"

import { buildPresentationCacheKey } from "./PresentationCacheKey.js"

describe("buildPresentationCacheKey", () => {
  it("[neoview.cache.typed-key] includes every revision dimension without exposing source paths", () => {
    const input = {
      cacheKind: "presentation-transform" as const,
      sourceIdentity: "D:/private/books/demo.cbz",
      sourceRevision: "size:10:mtime:20",
      entryIdentity: "chapter/page-001.jpg",
      producerVersion: "sharp-0.35.3-jxl",
      transformProfile: "1920:auto:1:inside:webp:82",
    }
    const key = buildPresentationCacheKey(input)
    expect(key).toMatch(/^neoview:presentation:v1:[A-Za-z0-9_-]{43}$/)
    expect(key).not.toContain("private")
    expect(key).not.toContain("page-001")
    expect(buildPresentationCacheKey(input)).toBe(key)
    expect(buildPresentationCacheKey({ ...input, sourceRevision: "size:11:mtime:20" })).not.toBe(key)
    expect(buildPresentationCacheKey({ ...input, producerVersion: "wic-v2" })).not.toBe(key)
    expect(buildPresentationCacheKey({ ...input, transformProfile: "960:auto:1:inside:webp:82" })).not.toBe(key)
  })
})
