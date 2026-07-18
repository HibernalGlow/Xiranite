const LZ4_MAGIC = Uint8Array.of(0x4c, 0x5a, 0x34, 0x00)
export const DEFAULT_MAX_THUMBNAIL_BYTES = 16 * 1024 * 1024

export interface DecodedThumbnailBlob {
  bytes: Uint8Array
  compressed: boolean
  contentType?: string
}

export async function decodeLegacyThumbnailBlob(
  blob: Uint8Array,
  maxBytes = DEFAULT_MAX_THUMBNAIL_BYTES,
): Promise<DecodedThumbnailBlob> {
  assertLimit(maxBytes)
  if (!hasLz4Magic(blob)) {
    if (blob.byteLength > maxBytes) throw new Error(`Thumbnail blob exceeds ${maxBytes} bytes.`)
    return { bytes: blob, compressed: false, contentType: detectImageContentType(blob) }
  }
  if (blob.byteLength < 9) throw new Error("Compressed thumbnail blob is truncated.")
  if (blob.byteLength > maxBytes + 64 * 1024) throw new Error(`Compressed thumbnail blob exceeds the ${maxBytes}-byte output budget.`)
  const expectedBytes = new DataView(blob.buffer, blob.byteOffset + LZ4_MAGIC.byteLength, 4).getUint32(0, true)
  if (expectedBytes === 0 || expectedBytes > maxBytes) {
    throw new Error(`Compressed thumbnail declares an invalid ${expectedBytes}-byte output.`)
  }
  const { decompressBlock } = await import("lz4js")
  const decoded = new Uint8Array(expectedBytes)
  const decodedBytes = decompressBlock(
    blob,
    decoded,
    LZ4_MAGIC.byteLength + 4,
    blob.byteLength - LZ4_MAGIC.byteLength - 4,
    0,
  )
  if (decodedBytes !== expectedBytes) {
    throw new Error(`LZ4 thumbnail length mismatch: expected ${expectedBytes}, received ${decodedBytes}.`)
  }
  return { bytes: decoded, compressed: true, contentType: detectImageContentType(decoded) }
}

export function detectImageContentType(bytes: Uint8Array): string | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png"
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg"
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && ascii(bytes, 8, 12) === "WEBP") return "image/webp"
  if (ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12)
    if (brand === "avif" || brand === "avis") return "image/avif"
  }
  if (startsWith(bytes, [0xff, 0x0a]) || startsWith(bytes, [0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20])) return "image/jxl"
  return undefined
}

function hasLz4Magic(bytes: Uint8Array): boolean {
  return startsWith(bytes, LZ4_MAGIC)
}

function startsWith(bytes: Uint8Array, prefix: ArrayLike<number>): boolean {
  if (bytes.byteLength < prefix.length) return false
  for (let index = 0; index < prefix.length; index += 1) {
    if (bytes[index] !== prefix[index]) return false
  }
  return true
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  if (bytes.byteLength < end) return ""
  return String.fromCharCode(...bytes.subarray(start, end))
}

function assertLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 256 * 1024 * 1024) {
    throw new RangeError("Thumbnail byte limit must be an integer from 1 to 268435456.")
  }
}
