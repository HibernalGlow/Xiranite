import { describe, expect, it } from "vitest"

import { legacyEmmBookPathKey, parseLegacyEmmBookMetadata } from "./LegacyEmmBookMetadataCodec.js"

describe("LegacyEmmBookMetadataCodec", () => {
  it("[neoview.book-information.emm-codec] exposes only a bounded translated title", () => {
    expect(parseLegacyEmmBookMetadata(JSON.stringify({
      title: "Original",
      translated_title: "  译名  ",
      tags: [{ namespace: "artist", tag: "hidden" }],
    }))).toEqual({ translatedTitle: "译名" })
    expect(parseLegacyEmmBookMetadata('{"translated_title":')).toBeUndefined()
    expect(parseLegacyEmmBookMetadata(JSON.stringify({ translated_title: [] }))).toBeUndefined()
    expect(parseLegacyEmmBookMetadata(JSON.stringify({ translated_title: " ".repeat(5) }))).toBeUndefined()
    expect(parseLegacyEmmBookMetadata(JSON.stringify({ translated_title: "x".repeat(4_097) }))).toBeUndefined()
  })

  it("[neoview.book-information.emm-path] preserves the frozen legacy Windows path identity", () => {
    expect(legacyEmmBookPathKey("D:/library/book.cbz/")).toBe("D:\\library\\book.cbz")
    expect(legacyEmmBookPathKey("d:library/book.cbz")).toBe("d:\\library\\book.cbz")
    expect(legacyEmmBookPathKey("D:/")).toBe("D:\\")
    expect(legacyEmmBookPathKey("\\\\server\\share\\book.cbz")).toBe("\\\\server\\share\\book.cbz")
  })
})
