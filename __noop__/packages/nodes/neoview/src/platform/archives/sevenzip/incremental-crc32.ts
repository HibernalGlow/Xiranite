const TABLE = createCrc32Table()

interface BunCrc32Runtime {
  Bun?: {
    hash?: {
      crc32?(data: Uint8Array, previous?: number): number
    }
  }
}

export function appendCrc32(data: Uint8Array, previous = 0): number {
  const native = (globalThis as BunCrc32Runtime).Bun?.hash?.crc32
  if (native) return native(data, previous) >>> 0
  return appendPortableCrc32(data, previous)
}

export function appendPortableCrc32(data: Uint8Array, previous = 0): number {
  let crc = (previous ^ 0xffffffff) >>> 0
  for (let index = 0; index < data.byteLength; index += 1) {
    crc = (crc >>> 8) ^ TABLE[(crc ^ data[index]!) & 0xff]!
  }
  return (crc ^ 0xffffffff) >>> 0
}

function createCrc32Table(): Uint32Array {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
}
