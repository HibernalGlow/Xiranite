import { describe, expect, it } from "vitest"

import { legacyEmmBookPathKey, parseLegacyEmmBookMetadata } from "./LegacyEmmBookMetadataCodec.js"

describe("LegacyEmmBookMetadataCodec", () => {
  it("[neoview.book-information.emm-codec] [neoview.emm-tags.codec] exposes bounded titles and stable tags", () => {
    expect(parseLegacyEmmBookMetadata(JSON.stringify({
      title: "Original",
      translated_title: "  译名  ",
      tags: [
        { namespace: "artist", tag: "Alice" },
        { category: "female", tag: "glasses" },
        { namespace: "ARTIST", tag: "alice" },
        "fallback",
      ],
    }), JSON.stringify([
      { namespace: "manual", tag: "favorite" },
      { namespace: "artist", tag: "Alice" },
    ]))).toEqual({
      translatedTitle: "译名",
      tags: [
        { namespace: "artist", tag: "Alice" },
        { namespace: "female", tag: "glasses" },
        { namespace: "other", tag: "fallback" },
        { namespace: "manual", tag: "favorite" },
      ],
    })
    expect(parseLegacyEmmBookMetadata(JSON.stringify({
      tags: { artist: ["Alice"], female: ["glasses", "long_hair"] },
    }))).toEqual({
      tags: [
        { namespace: "artist", tag: "Alice" },
        { namespace: "female", tag: "glasses" },
        { namespace: "female", tag: "long_hair" },
      ],
    })
    expect(parseLegacyEmmBookMetadata('{"translated_title":')).toBeUndefined()
    expect(parseLegacyEmmBookMetadata(JSON.stringify({ translated_title: [] }))).toEqual({ tags: [] })
    expect(parseLegacyEmmBookMetadata(JSON.stringify({ translated_title: " ".repeat(5) }))).toEqual({ tags: [] })
    expect(parseLegacyEmmBookMetadata(JSON.stringify({ translated_title: "x".repeat(4_097) }))).toEqual({ tags: [] })
    expect(parseLegacyEmmBookMetadata(JSON.stringify({
      tags: Array.from({ length: 300 }, (_, index) => ({ namespace: "tag", tag: String(index) })),
    }))?.tags).toHaveLength(256)
  })

  it("[neoview.book-information.emm-path] preserves the frozen legacy Windows path identity", () => {
    expect(legacyEmmBookPathKey("D:/library/book.cbz/")).toBe("D:\\library\\book.cbz")
    expect(legacyEmmBookPathKey("d:library/book.cbz")).toBe("d:\\library\\book.cbz")
    expect(legacyEmmBookPathKey("D:/")).toBe("D:\\")
    expect(legacyEmmBookPathKey("\\\\server\\share\\book.cbz")).toBe("\\\\server\\share\\book.cbz")
  })
})
