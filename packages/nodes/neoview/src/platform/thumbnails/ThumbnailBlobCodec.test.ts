import { describe, expect, it } from "vitest"
import { decodeLegacyThumbnailBlob, detectImageContentType } from "./ThumbnailBlobCodec.js"

describe("decodeLegacyThumbnailBlob", () => {
  it("[neoview.thumbnail.blob] preserves raw image blobs without copying", async () => {
    const webp = Uint8Array.from(Buffer.from("524946460400000057454250", "hex"))
    const decoded = await decodeLegacyThumbnailBlob(webp)
    expect(decoded).toEqual({ bytes: webp, compressed: false, contentType: "image/webp" })
    expect(decoded.bytes).toBe(webp)
  })

  it("[neoview.thumbnail.blob] decodes the Rust LZ4 magic plus size-prepended block", async () => {
    const png = Uint8Array.from(Buffer.from("89504e470d0a1a0a0001020304050607", "hex"))
    const compressed = Uint8Array.from(Buffer.from("10000000f00189504e470d0a1a0a0001020304050607", "hex"))
    const stored = new Uint8Array(4 + compressed.byteLength)
    stored.set([0x4c, 0x5a, 0x34, 0x00])
    stored.set(compressed, 4)
    const decoded = await decodeLegacyThumbnailBlob(stored)
    expect(decoded.compressed).toBe(true)
    expect(decoded.contentType).toBe("image/png")
    expect(decoded.bytes).toEqual(png)
  })

  it("rejects truncated, oversized and corrupt compressed blobs before use", async () => {
    await expect(decodeLegacyThumbnailBlob(Uint8Array.of(0x4c, 0x5a, 0x34, 0x00, 1))).rejects.toThrow("truncated")
    const oversized = Uint8Array.of(0x4c, 0x5a, 0x34, 0x00, 0xff, 0xff, 0xff, 0x7f, 0x00)
    await expect(decodeLegacyThumbnailBlob(oversized, 1024)).rejects.toThrow("invalid")
    const corrupt = Uint8Array.of(0x4c, 0x5a, 0x34, 0x00, 0x04, 0, 0, 0, 0xff)
    await expect(decodeLegacyThumbnailBlob(corrupt)).rejects.toThrow()
    await expect(decodeLegacyThumbnailBlob(new Uint8Array(1025), 1024)).rejects.toThrow("exceeds")
  })
})

describe("detectImageContentType", () => {
  it("recognizes thumbnail image signatures without trusting a file extension", () => {
    expect(detectImageContentType(Uint8Array.of(0xff, 0xd8, 0xff))).toBe("image/jpeg")
    expect(detectImageContentType(Uint8Array.from(Buffer.from("474946383961", "hex")))).toBe("image/gif")
    expect(detectImageContentType(Uint8Array.from(Buffer.from("0000000c6674797061766966", "hex")))).toBe("image/avif")
    expect(detectImageContentType(Uint8Array.of(0xff, 0x0a))).toBe("image/jxl")
    expect(detectImageContentType(Uint8Array.of(1, 2, 3))).toBeUndefined()
  })
})
