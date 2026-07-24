export function isAnimatedPng(bytes: Uint8Array): boolean {
  if (!matches(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) throw new Error("Invalid PNG signature.")
  let offset = 8
  while (offset + 12 <= bytes.byteLength) {
    const length = uint32be(bytes, offset)
    if (length > bytes.byteLength - offset - 12) throw new Error("Truncated PNG chunk.")
    const type = ascii(bytes, offset + 4, 4)
    if (type === "acTL") return true
    if (type === "IDAT" || type === "IEND") return false
    offset += length + 12
  }
  throw new Error("PNG image data was not found.")
}

export function isAnimatedAvif(bytes: Uint8Array): boolean {
  let offset = 0
  while (offset + 8 <= bytes.byteLength) {
    const size = uint32be(bytes, offset)
    if (size < 8 || size > bytes.byteLength - offset) throw new Error("Truncated AVIF box.")
    if (ascii(bytes, offset + 4, 4) === "ftyp") {
      if (size < 16) throw new Error("Invalid AVIF ftyp box.")
      if (ascii(bytes, offset + 8, 4) === "avis") return true
      for (let brandOffset = offset + 16; brandOffset + 4 <= offset + size; brandOffset += 4) {
        const brand = ascii(bytes, brandOffset, 4)
        if (brand === "avis" || brand === "msf1") return true
      }
      return false
    }
    offset += size
  }
  throw new Error("AVIF ftyp box was not found.")
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

function matches(bytes: Uint8Array, offset: number, expected: number[]): boolean {
  return expected.every((value, index) => bytes[offset + index] === value)
}

function uint32be(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.byteLength) throw new Error("Truncated image container.")
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false)
}
