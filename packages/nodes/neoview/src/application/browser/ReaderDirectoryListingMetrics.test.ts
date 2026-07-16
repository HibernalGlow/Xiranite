import { describe, expect, it } from "vitest"

import { readerDirectoryListingPayloadBytes, stringPayloadBytes } from "./ReaderDirectoryListingMetrics.js"

describe("ReaderDirectoryListingMetrics", () => {
  it("[neoview.folder.listing-payload-bytes] measures UTF-8 listing fields without serializing entries", () => {
    const encoder = new TextEncoder()
    const text = ["C:/书", "图页.jpeg", "C:/书/图页.jpeg", "file", "标签"]
      .reduce((bytes, value) => bytes + encoder.encode(value).byteLength, 0)
    expect(readerDirectoryListingPayloadBytes({
      path: "C:/书",
      entries: [{
        name: "图页.jpeg",
        path: "C:/书/图页.jpeg",
        kind: "file",
        readerSupported: true,
        size: 42,
        tags: ["标签"],
      }],
    })).toBe(text + 1 + 8)
    expect(stringPayloadBytes(["一", "two"])).toBe(encoder.encode("一two").byteLength)
  })
})
