import { describe, expect, it } from "vitest"

import { archiveIndexPayloadBytes } from "./ArchiveIndexMetrics.js"

describe("archiveIndexPayloadBytes", () => {
  it("[neoview.archive.index-payload-bytes] measures UTF-8 descriptor payload without serializing the index", () => {
    expect(archiveIndexPayloadBytes([{
      id: "zip-1",
      sourceIndex: 1,
      path: "日本語/页.jpg",
      kind: "file",
      uncompressedSize: 10,
      compressedSize: 8,
      compressionMethod: "deflate",
      crc32: 42,
      modifiedAt: "2026-01-01T00:00:00.000Z",
      encrypted: false,
      zip64: true,
    }])).toBe(
      new TextEncoder().encode("zip-1日本語/页.jpgfiledeflate2026-01-01T00:00:00.000Z").byteLength
      + 4 * 8
      + 2,
    )
    expect(archiveIndexPayloadBytes([])).toBe(0)
  })
})
