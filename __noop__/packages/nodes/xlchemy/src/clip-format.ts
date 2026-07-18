const CLIP_HEADER = Buffer.from("CSFCHUNK", "ascii")
const CHUNK_MARKER = Buffer.from("CHNK", "ascii")
const BLOCK_DATA_BEGIN = Buffer.from("BlockDataBeginChunk", "utf16le").swap16()
const BLOCK_DATA_END = Buffer.from("BlockDataEndChunk", "utf16le").swap16()
const BLOCK_STATUS = Buffer.from("BlockStatus", "utf16le").swap16()
const BLOCK_CHECKSUM = Buffer.from("BlockCheckSum", "utf16le").swap16()

export interface ClipChunk {
  name: string
  data: Buffer
  offset: number
}

export interface ClipExternalChunk {
  id: string
  bitmapBlocks?: Array<Buffer | undefined>
  data?: Buffer
}

export function parseClipChunks(input: Uint8Array): ClipChunk[] {
  const data = Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  if (data.length < 28 || !data.subarray(0, 8).equals(CLIP_HEADER)) throw new Error("Invalid CLIP header: expected CSFCHUNK.")
  const chunks: ClipChunk[] = []
  let offset = 24
  while (offset < data.length) {
    if (offset + 16 > data.length || !data.subarray(offset, offset + 4).equals(CHUNK_MARKER)) throw new Error(`Invalid CLIP chunk marker at offset ${offset}.`)
    const name = data.toString("ascii", offset + 4, offset + 8)
    const reserved = data.readUInt32BE(offset + 8)
    const size = data.readUInt32BE(offset + 12)
    const end = offset + 16 + size
    if (reserved !== 0) throw new Error(`Unsupported CLIP chunk header flags for ${name}.`)
    if (end > data.length) throw new Error(`Truncated CLIP chunk ${name}.`)
    chunks.push({ name, data: data.subarray(offset + 16, end), offset })
    offset = end
  }
  return chunks
}

export function extractClipSqlite(chunks: ClipChunk[]): Buffer {
  const chunk = chunks.find((item) => item.name === "SQLi")
  if (!chunk) throw new Error("CLIP file does not contain an embedded SQLite database.")
  return chunk.data
}

export function parseClipExternalChunks(chunks: ClipChunk[]): Map<string, ClipExternalChunk> {
  const output = new Map<string, ClipExternalChunk>()
  for (const chunk of chunks) {
    if (chunk.name !== "Exta") continue
    if (chunk.data.length < 16) throw new Error("Truncated CLIP Exta chunk.")
    const idLength = Number(chunk.data.readBigUInt64BE(0))
    if (!Number.isSafeInteger(idLength) || idLength <= 0 || idLength + 16 > chunk.data.length) throw new Error("Invalid CLIP external chunk identifier length.")
    const idBytes = chunk.data.subarray(8, 8 + idLength)
    const id = idBytes.toString("ascii")
    const payloadSize = Number(chunk.data.readBigUInt64BE(8 + idLength))
    const payload = chunk.data.subarray(16 + idLength)
    if (payloadSize !== payload.length) throw new Error(`Invalid CLIP external chunk size for ${id}.`)
    const bitmapBlocks = payload.subarray(8, 8 + BLOCK_DATA_BEGIN.length).equals(BLOCK_DATA_BEGIN) ? parseBitmapBlocks(payload) : undefined
    output.set(id, bitmapBlocks ? { id, bitmapBlocks } : { id, data: payload })
  }
  return output
}

export function parseBitmapBlocks(data: Buffer): Array<Buffer | undefined> {
  const blocks: Array<Buffer | undefined> = []
  let offset = 0
  while (offset < data.length) {
    let blockSize: number
    if (data.subarray(offset + 4, offset + 4 + BLOCK_STATUS.length).equals(BLOCK_STATUS)) {
      const statusCount = data.readUInt32BE(offset + 30)
      blockSize = statusCount * 4 + 12 + BLOCK_STATUS.length + 4
    } else if (data.subarray(offset + 4, offset + 4 + BLOCK_CHECKSUM.length).equals(BLOCK_CHECKSUM)) {
      blockSize = 4 + BLOCK_CHECKSUM.length + 12 + blocks.length * 4
    } else if (data.subarray(offset + 8, offset + 8 + BLOCK_DATA_BEGIN.length).equals(BLOCK_DATA_BEGIN)) {
      blockSize = data.readUInt32BE(offset)
      if (blockSize < 28 || offset + blockSize > data.length) throw new Error("Invalid CLIP bitmap block size.")
      const endMarker = Buffer.concat([Buffer.from([0, 0, 0, 17]), BLOCK_DATA_END])
      if (!data.subarray(offset + blockSize - endMarker.length, offset + blockSize).equals(endMarker)) throw new Error("Invalid CLIP bitmap block terminator.")
      const block = data.subarray(offset + 8 + BLOCK_DATA_BEGIN.length, offset + blockSize - endMarker.length)
      const hasData = block.readUInt32BE(16)
      if (hasData > 1) throw new Error("Invalid CLIP bitmap presence flag.")
      if (hasData) {
        const payloadLength = block.readUInt32BE(20)
        if (block.length !== payloadLength + 24) throw new Error("Invalid CLIP bitmap payload length.")
        blocks.push(block.subarray(28))
      } else blocks.push(undefined)
    } else throw new Error(`Unknown CLIP bitmap section at offset ${offset}.`)
    if (blockSize <= 0 || offset + blockSize > data.length) throw new Error("Truncated CLIP bitmap section.")
    offset += blockSize
  }
  return blocks
}
