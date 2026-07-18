import { describe, expect, it, vi } from "vitest"

import { ReaderEmmTagSuggestionService } from "./ReaderEmmTagSuggestionService.js"

describe("ReaderEmmTagSuggestionService", () => {
  it("[neoview.folder.emm-tag-suggestions] combines at most three randomized favorites with deduplicated catalog tags", async () => {
    const sampleEmmTags = vi.fn(async () => [
      { category: "artist", tag: "Alice" },
      { category: "ARTIST", tag: "alice" },
      { category: "female", tag: "glasses" },
      { category: "language", tag: "chinese" },
    ])
    const service = new ReaderEmmTagSuggestionService({ sampleEmmTags }, {
      load: async () => ({ tags: [
        { category: "artist", tag: "Alice" },
        { category: "group", tag: "Circle" },
        { category: "parody", tag: "Series" },
        { category: "character", tag: "Hero" },
      ] }),
    }, () => 0)

    await expect(service.suggest(5)).resolves.toEqual([
      { category: "artist", tag: "Alice", favorite: true },
      { category: "character", tag: "Hero", favorite: true },
      { category: "parody", tag: "Series", favorite: true },
      { category: "female", tag: "glasses", favorite: false },
      { category: "language", tag: "chinese", favorite: false },
    ])
    expect(sampleEmmTags).toHaveBeenCalledWith(7, undefined)
  })

  it("[neoview.folder.emm-tag-suggestions] validates bounds and tolerates an unavailable favorite source", async () => {
    const service = new ReaderEmmTagSuggestionService({ sampleEmmTags: async () => [{ category: "artist", tag: "Alice" }] }, {
      load: async () => { throw new Error("setting unavailable") },
    })
    await expect(service.suggest(1)).resolves.toEqual([{ category: "artist", tag: "Alice", favorite: false }])
    await expect(service.suggest(33)).rejects.toThrow("1 to 32")
  })

  it("[neoview.folder.emm-tag-translation] enriches requested tags and degrades when translation fails", async () => {
    const catalog = { sampleEmmTags: async () => [{ category: "artist", tag: "alice" }] }
    const favorites = { load: async () => ({ tags: [] }) }
    const service = new ReaderEmmTagSuggestionService(catalog, favorites, () => 0, {
      translate: async () => new Map([["artist\0alice", "爱丽丝"]]),
      key: (value) => `${value.category}\0${value.tag}`,
    })
    await expect(service.suggest(1)).resolves.toEqual([
      { category: "artist", tag: "alice", favorite: false, translatedTag: "爱丽丝" },
    ])

    const fallback = new ReaderEmmTagSuggestionService(catalog, favorites, () => 0, {
      translate: async () => { throw new Error("bad dictionary") },
      key: () => "unused",
    })
    await expect(fallback.suggest(1)).resolves.toEqual([{ category: "artist", tag: "alice", favorite: false }])
  })
})
