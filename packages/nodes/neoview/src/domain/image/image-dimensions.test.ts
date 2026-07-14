import { describe, expect, it } from "vitest"

import { parseImageDimensions } from "./image-dimensions.js"

describe("parseImageDimensions", () => {
  it("[neoview.image.probe-formats] parses PNG, GIF, BMP, WebP and AVIF headers", () => {
    expect(parseImageDimensions(png(640, 480))).toMatchObject({ status: "found", format: "png", dimensions: { width: 640, height: 480 } })
    expect(parseImageDimensions(gif(320, 240))).toMatchObject({ status: "found", format: "gif", dimensions: { width: 320, height: 240 } })
    expect(parseImageDimensions(bmp(800, 600))).toMatchObject({ status: "found", format: "bmp", dimensions: { width: 800, height: 600 } })
    expect(parseImageDimensions(webpVp8x(1024, 768))).toMatchObject({ status: "found", format: "webp", dimensions: { width: 1024, height: 768 } })
    expect(parseImageDimensions(avif(1920, 1080))).toMatchObject({ status: "found", format: "avif", dimensions: { width: 1920, height: 1080 } })
  })

  it("[neoview.image.probe-formats] trusts a recognized signature over a misleading MIME hint", () => {
    expect(parseImageDimensions(png(17, 23), "image/jpeg")).toMatchObject({
      status: "found",
      format: "png",
      dimensions: { width: 17, height: 23 },
    })
  })

  it("[neoview.image.probe-orientation] applies JPEG EXIF and TIFF orientation to display dimensions", () => {
    expect(parseImageDimensions(jpegWithOrientation(200, 100, 6))).toMatchObject({
      status: "found",
      format: "jpeg",
      dimensions: { width: 100, height: 200 },
      orientation: 6,
    })
    expect(parseImageDimensions(tiff(300, 900, 8))).toMatchObject({
      status: "found",
      format: "tiff",
      dimensions: { width: 900, height: 300 },
      orientation: 8,
    })
  })

  it("[neoview.image.probe-errors] distinguishes partial, unsupported and corrupt headers", () => {
    expect(parseImageDimensions(png(10, 20).subarray(0, 12), "image/png")).toEqual({ status: "need-more" })
    expect(parseImageDimensions(Uint8Array.of(0xff, 0xd8, 0xff, 0xda), "image/jpeg")).toMatchObject({ status: "invalid" })
    expect(parseImageDimensions(Uint8Array.of(0xff, 0x0a), "image/jxl")).toEqual({ status: "unsupported" })
    expect(parseImageDimensions(new Uint8Array(32))).toEqual({ status: "unsupported" })
  })
})

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  writeU32BE(bytes, 16, width)
  writeU32BE(bytes, 20, height)
  return bytes
}

function gif(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(10)
  bytes.set(new TextEncoder().encode("GIF89a"))
  writeU16LE(bytes, 6, width)
  writeU16LE(bytes, 8, height)
  return bytes
}

function bmp(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(26)
  bytes.set(new TextEncoder().encode("BM"))
  writeU32LE(bytes, 14, 40)
  writeU32LE(bytes, 18, width)
  writeU32LE(bytes, 22, height)
  return bytes
}

function webpVp8x(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30)
  bytes.set(new TextEncoder().encode("RIFF"), 0)
  writeU32LE(bytes, 4, 22)
  bytes.set(new TextEncoder().encode("WEBPVP8X"), 8)
  writeU32LE(bytes, 16, 10)
  writeU24LE(bytes, 24, width - 1)
  writeU24LE(bytes, 27, height - 1)
  return bytes
}

function avif(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(44)
  writeU32BE(bytes, 0, 16)
  bytes.set(new TextEncoder().encode("ftypavif"), 4)
  writeU32BE(bytes, 16, 28)
  bytes.set(new TextEncoder().encode("ipco"), 20)
  writeU32BE(bytes, 24, 20)
  bytes.set(new TextEncoder().encode("ispe"), 28)
  writeU32BE(bytes, 36, width)
  writeU32BE(bytes, 40, height)
  return bytes
}

function jpegWithOrientation(width: number, height: number, orientation: number): Uint8Array {
  const tiffBytes = tiff(0, 0, orientation, false)
  const appPayload = new Uint8Array(6 + tiffBytes.length)
  appPayload.set(new TextEncoder().encode("Exif\0\0"))
  appPayload.set(tiffBytes, 6)
  const appLength = appPayload.length + 2
  const bytes = new Uint8Array(2 + 4 + appPayload.length + 13)
  bytes.set([0xff, 0xd8, 0xff, 0xe1, appLength >> 8, appLength & 0xff], 0)
  bytes.set(appPayload, 6)
  const sof = 6 + appPayload.length
  bytes.set([0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x01, 0x01, 0x11, 0x00], sof)
  return bytes
}

function tiff(width: number, height: number, orientation: number, includeDimensions = true): Uint8Array {
  const entries = includeDimensions ? 3 : 1
  const bytes = new Uint8Array(8 + 2 + entries * 12 + 4)
  bytes.set(new TextEncoder().encode("II"), 0)
  writeU16LE(bytes, 2, 42)
  writeU32LE(bytes, 4, 8)
  writeU16LE(bytes, 8, entries)
  let offset = 10
  if (includeDimensions) {
    writeTiffLong(bytes, offset, 256, width)
    offset += 12
    writeTiffLong(bytes, offset, 257, height)
    offset += 12
  }
  writeU16LE(bytes, offset, 274)
  writeU16LE(bytes, offset + 2, 3)
  writeU32LE(bytes, offset + 4, 1)
  writeU16LE(bytes, offset + 8, orientation)
  return bytes
}

function writeTiffLong(bytes: Uint8Array, offset: number, tag: number, value: number) {
  writeU16LE(bytes, offset, tag)
  writeU16LE(bytes, offset + 2, 4)
  writeU32LE(bytes, offset + 4, 1)
  writeU32LE(bytes, offset + 8, value)
}

function writeU16LE(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
}

function writeU24LE(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
  bytes[offset + 2] = (value >>> 16) & 0xff
}

function writeU32LE(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
  bytes[offset + 2] = (value >>> 16) & 0xff
  bytes[offset + 3] = (value >>> 24) & 0xff
}

function writeU32BE(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = (value >>> 24) & 0xff
  bytes[offset + 1] = (value >>> 16) & 0xff
  bytes[offset + 2] = (value >>> 8) & 0xff
  bytes[offset + 3] = value & 0xff
}
