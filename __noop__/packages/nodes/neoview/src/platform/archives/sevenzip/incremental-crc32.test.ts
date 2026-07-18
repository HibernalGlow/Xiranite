import { describe, expect, it } from "vitest"

import { appendCrc32, appendPortableCrc32 } from "./incremental-crc32.js"

describe("incremental CRC32", () => {
  it("[neoview.sevenzip.solid-crc] matches a known checksum across arbitrary chunk boundaries", () => {
    const bytes = new TextEncoder().encode("123456789")
    expect(appendCrc32(bytes)).toBe(0xcbf43926)
    const first = appendCrc32(bytes.subarray(0, 2))
    const second = appendCrc32(bytes.subarray(2, 7), first)
    expect(appendCrc32(bytes.subarray(7), second)).toBe(0xcbf43926)
    expect(appendPortableCrc32(bytes)).toBe(0xcbf43926)
    expect(appendPortableCrc32(bytes.subarray(4), appendPortableCrc32(bytes.subarray(0, 4)))).toBe(0xcbf43926)
  })
})
