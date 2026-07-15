import type { PageDimensions } from "../page/page.js"
import { JXLStream } from "image-size/types/jxl-stream"

export type ProbedImageFormat = "avif" | "bmp" | "gif" | "jpeg" | "jxl" | "png" | "tiff" | "webp"

export type ImageDimensionParseResult =
  | { status: "found"; format: ProbedImageFormat; dimensions: PageDimensions; orientation?: number }
  | { status: "need-more" }
  | { status: "unsupported" }
  | { status: "invalid"; message: string }

const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
const MAX_IMAGE_DIMENSION = 1_000_000
const BMFF_CONTAINER_BOXES = new Set(["ipco", "iprp", "meta", "moov"])

export function parseImageDimensions(bytes: Uint8Array, mimeType?: string): ImageDimensionParseResult {
  const format = detectFormat(bytes, mimeType)
  if (format === "need-more" || format === "unsupported") return { status: format }
  switch (format) {
    case "png": return parsePng(bytes)
    case "gif": return parseGif(bytes)
    case "jpeg": return parseJpeg(bytes)
    case "webp": return parseWebp(bytes)
    case "bmp": return parseBmp(bytes)
    case "tiff": return parseTiff(bytes)
    case "avif": return parseAvif(bytes)
    case "jxl": return parseJxlStream(bytes)
  }
}

function detectFormat(bytes: Uint8Array, mimeType?: string): ProbedImageFormat | "need-more" | "unsupported" {
  const normalizedMime = mimeType?.toLowerCase().split(";", 1)[0]
  if (bytes.length >= 2 && JXLStream.validate(bytes)) return "jxl"
  if (bytes.length >= 8 && matches(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png"
  if (bytes.length >= 6 && (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a")) return "gif"
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg"
  if (bytes.length >= 2 && ascii(bytes, 0, 2) === "BM") return "bmp"
  if (bytes.length >= 4 && ((ascii(bytes, 0, 2) === "II" && readU16LE(bytes, 2) === 42) || (ascii(bytes, 0, 2) === "MM" && readU16BE(bytes, 2) === 42))) return "tiff"
  if (bytes.length < 12) return "need-more"
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "webp"
  if (isAvifFtyp(bytes)) return "avif"
  if (normalizedMime === "image/png") return "png"
  if (normalizedMime === "image/gif") return "gif"
  if (normalizedMime === "image/jpeg") return "jpeg"
  if (normalizedMime === "image/webp") return "webp"
  if (normalizedMime === "image/bmp") return "bmp"
  if (normalizedMime === "image/tiff") return "tiff"
  if (normalizedMime === "image/avif") return "avif"
  if (normalizedMime === "image/jxl") return "unsupported"
  return "unsupported"
}

function parseJxlStream(bytes: Uint8Array): ImageDimensionParseResult {
  try {
    const value = JXLStream.calculate(bytes)
    return dimensions("jxl", value.width, value.height)
  } catch (error) {
    return error instanceof Error && error.message === "Reached end of input"
      ? { status: "need-more" }
      : invalid(`Invalid JXL codestream: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function parsePng(bytes: Uint8Array): ImageDimensionParseResult {
  if (bytes.length < 24) return { status: "need-more" }
  if (!matches(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) || ascii(bytes, 12, 4) !== "IHDR") {
    return invalid("Invalid PNG signature or IHDR chunk.")
  }
  return dimensions("png", readU32BE(bytes, 16), readU32BE(bytes, 20))
}

function parseGif(bytes: Uint8Array): ImageDimensionParseResult {
  if (bytes.length < 10) return { status: "need-more" }
  const signature = ascii(bytes, 0, 6)
  if (signature !== "GIF87a" && signature !== "GIF89a") return invalid("Invalid GIF signature.")
  return dimensions("gif", readU16LE(bytes, 6), readU16LE(bytes, 8))
}

function parseBmp(bytes: Uint8Array): ImageDimensionParseResult {
  if (bytes.length < 22) return { status: "need-more" }
  if (ascii(bytes, 0, 2) !== "BM") return invalid("Invalid BMP signature.")
  const dibSize = readU32LE(bytes, 14)
  if (dibSize === 12) {
    if (bytes.length < 22) return { status: "need-more" }
    return dimensions("bmp", readU16LE(bytes, 18), readU16LE(bytes, 20))
  }
  if (dibSize < 40) return invalid(`Unsupported BMP DIB header: ${dibSize}.`)
  if (bytes.length < 26) return { status: "need-more" }
  const width = readI32LE(bytes, 18)
  const height = Math.abs(readI32LE(bytes, 22))
  return dimensions("bmp", width, height)
}

function parseJpeg(bytes: Uint8Array): ImageDimensionParseResult {
  if (bytes.length < 4) return { status: "need-more" }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return invalid("Invalid JPEG SOI marker.")
  let offset = 2
  let orientation: number | undefined
  while (offset < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1
    if (offset + 1 >= bytes.length) return { status: "need-more" }
    while (offset + 1 < bytes.length && bytes[offset + 1] === 0xff) offset += 1
    const marker = bytes[offset + 1]!
    if (marker === 0x00) {
      offset += 2
      continue
    }
    if (marker === 0xd9 || marker === 0xda) return invalid("JPEG ended before a supported SOF marker.")
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    if (offset + 3 >= bytes.length) return { status: "need-more" }
    const segmentLength = readU16BE(bytes, offset + 2)
    if (segmentLength < 2) return invalid("Invalid JPEG segment length.")
    const segmentEnd = offset + 2 + segmentLength
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (offset + 8 >= bytes.length) return { status: "need-more" }
      const height = readU16BE(bytes, offset + 5)
      const width = readU16BE(bytes, offset + 7)
      return orientedDimensions("jpeg", width, height, orientation)
    }
    if (segmentEnd > bytes.length) return { status: "need-more" }
    if (marker === 0xe1 && ascii(bytes, offset + 4, 6) === "Exif\0\0") {
      orientation = parseTiffFields(bytes.subarray(offset + 10), false).orientation
    }
    offset = segmentEnd
  }
  return { status: "need-more" }
}

function parseWebp(bytes: Uint8Array): ImageDimensionParseResult {
  if (bytes.length < 20) return { status: "need-more" }
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return invalid("Invalid WebP RIFF header.")
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4)
    const size = readU32LE(bytes, offset + 4)
    const data = offset + 8
    if (type === "VP8X") {
      if (data + 10 > bytes.length) return { status: "need-more" }
      return dimensions("webp", 1 + readU24LE(bytes, data + 4), 1 + readU24LE(bytes, data + 7))
    }
    if (type === "VP8L") {
      if (data + 5 > bytes.length) return { status: "need-more" }
      if (bytes[data] !== 0x2f) return invalid("Invalid WebP lossless signature.")
      const b1 = bytes[data + 1]!
      const b2 = bytes[data + 2]!
      const b3 = bytes[data + 3]!
      const b4 = bytes[data + 4]!
      return dimensions("webp", 1 + b1 + ((b2 & 0x3f) << 8), 1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10))
    }
    if (type === "VP8 ") {
      if (data + 10 > bytes.length) return { status: "need-more" }
      if (!matches(bytes, data + 3, [0x9d, 0x01, 0x2a])) return invalid("Invalid WebP lossy frame header.")
      return dimensions("webp", readU16LE(bytes, data + 6) & 0x3fff, readU16LE(bytes, data + 8) & 0x3fff)
    }
    const next = data + size + (size & 1)
    if (next > bytes.length) return { status: "need-more" }
    offset = next
  }
  return { status: "need-more" }
}

function parseTiff(bytes: Uint8Array): ImageDimensionParseResult {
  const fields = parseTiffFields(bytes, true)
  if (fields.status) return fields.status
  if (fields.width === undefined || fields.height === undefined) return invalid("TIFF IFD has no width or height.")
  return orientedDimensions("tiff", fields.width, fields.height, fields.orientation)
}

function parseTiffFields(bytes: Uint8Array, requireDimensions: boolean): {
  width?: number
  height?: number
  orientation?: number
  status?: ImageDimensionParseResult
} {
  if (bytes.length < 8) return { status: { status: "need-more" } }
  const byteOrder = ascii(bytes, 0, 2)
  const littleEndian = byteOrder === "II"
  if (!littleEndian && byteOrder !== "MM") return { status: invalid("Invalid TIFF byte order.") }
  const read16 = littleEndian ? readU16LE : readU16BE
  const read32 = littleEndian ? readU32LE : readU32BE
  if (read16(bytes, 2) !== 42) return { status: invalid("Invalid TIFF magic.") }
  const ifdOffset = read32(bytes, 4)
  if (ifdOffset + 2 > bytes.length) return { status: { status: "need-more" } }
  const count = read16(bytes, ifdOffset)
  const end = ifdOffset + 2 + count * 12
  if (end > bytes.length) return { status: { status: "need-more" } }
  let width: number | undefined
  let height: number | undefined
  let orientation: number | undefined
  for (let index = 0; index < count; index += 1) {
    const entry = ifdOffset + 2 + index * 12
    const tag = read16(bytes, entry)
    if (tag !== 256 && tag !== 257 && tag !== 274) continue
    const type = read16(bytes, entry + 2)
    const valueCount = read32(bytes, entry + 4)
    if (valueCount !== 1 || (type !== 3 && type !== 4)) continue
    const value = type === 3 ? read16(bytes, entry + 8) : read32(bytes, entry + 8)
    if (tag === 256) width = value
    else if (tag === 257) height = value
    else orientation = value
  }
  if (requireDimensions && (width === undefined || height === undefined)) {
    return { status: invalid("TIFF IFD has no scalar dimensions.") }
  }
  return { width, height, orientation }
}

function parseAvif(bytes: Uint8Array): ImageDimensionParseResult {
  if (bytes.length < 20) return { status: "need-more" }
  if (!isAvifFtyp(bytes)) return invalid("Invalid AVIF file type box.")
  return findAvifDimensions(bytes, 0, bytes.length, 0)
}

function findAvifDimensions(bytes: Uint8Array, start: number, end: number, depth: number): ImageDimensionParseResult {
  if (depth > 8) return invalid("AVIF box nesting exceeds the probe limit.")
  let offset = start
  while (offset + 8 <= end) {
    let size = readU32BE(bytes, offset)
    const type = ascii(bytes, offset + 4, 4)
    let headerSize = 8
    if (size === 1) {
      if (offset + 16 > end) return { status: "need-more" }
      const high = readU32BE(bytes, offset + 8)
      const low = readU32BE(bytes, offset + 12)
      const extended = high * 0x100000000 + low
      if (!Number.isSafeInteger(extended)) return invalid("AVIF box size exceeds the safe integer range.")
      size = extended
      headerSize = 16
    } else if (size === 0) {
      size = end - offset
    }
    if (size < headerSize) return invalid(`Invalid AVIF ${type} box size.`)
    const boxEnd = offset + size
    if (boxEnd > end) return { status: "need-more" }
    if (type === "ispe") {
      if (size < headerSize + 12) return invalid("Invalid AVIF ispe box.")
      return dimensions("avif", readU32BE(bytes, offset + headerSize + 4), readU32BE(bytes, offset + headerSize + 8))
    }
    if (BMFF_CONTAINER_BOXES.has(type)) {
      const childStart = offset + headerSize + (type === "meta" ? 4 : 0)
      if (childStart > boxEnd) return invalid(`Invalid AVIF ${type} container.`)
      const nested = findAvifDimensions(bytes, childStart, boxEnd, depth + 1)
      if (nested.status === "found" || nested.status === "invalid") return nested
    }
    offset = boxEnd
  }
  return { status: "need-more" }
}

function isAvifFtyp(bytes: Uint8Array): boolean {
  if (bytes.length < 16 || ascii(bytes, 4, 4) !== "ftyp") return false
  const size = readU32BE(bytes, 0)
  if (size < 16 || size > bytes.length) return false
  for (let offset = 8; offset + 4 <= size; offset += offset === 8 ? 8 : 4) {
    const brand = ascii(bytes, offset, 4)
    if (brand === "avif" || brand === "avis") return true
  }
  return false
}

function orientedDimensions(
  format: ProbedImageFormat,
  width: number,
  height: number,
  orientation?: number,
): ImageDimensionParseResult {
  const swapped = orientation !== undefined && orientation >= 5 && orientation <= 8
  const result = dimensions(format, swapped ? height : width, swapped ? width : height)
  return result.status === "found" ? { ...result, orientation } : result
}

function dimensions(format: ProbedImageFormat, width: number, height: number): ImageDimensionParseResult {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height)
    && width > 0 && height > 0
    && width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION
    ? { status: "found", format, dimensions: { width, height } }
    : invalid(`Invalid ${format} dimensions: ${width}x${height}.`)
}

function invalid(message: string): ImageDimensionParseResult {
  return { status: "invalid", message }
}

function matches(bytes: Uint8Array, offset: number, values: readonly number[]): boolean {
  return values.every((value, index) => bytes[offset + index] === value)
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let output = ""
  for (let index = 0; index < length && offset + index < bytes.length; index += 1) output += String.fromCharCode(bytes[offset + index]!)
  return output
}

function readU16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)
}

function readU16LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)
}

function readU24LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16)
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] ?? 0) * 0x1000000) + ((bytes[offset + 1] ?? 0) << 16) + ((bytes[offset + 2] ?? 0) << 8) + (bytes[offset + 3] ?? 0)) >>> 0
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) + ((bytes[offset + 1] ?? 0) << 8) + ((bytes[offset + 2] ?? 0) << 16) + ((bytes[offset + 3] ?? 0) * 0x1000000)) >>> 0
}

function readI32LE(bytes: Uint8Array, offset: number): number {
  return readU32LE(bytes, offset) | 0
}
