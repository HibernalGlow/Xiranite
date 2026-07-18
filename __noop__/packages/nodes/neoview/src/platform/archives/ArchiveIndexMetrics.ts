import type { ArchiveEntry } from "../../ports/ArchiveProvider.js"

const encoder = new TextEncoder()
const NUMBER_BYTES = 8
const BOOLEAN_BYTES = 1

export function archiveIndexPayloadBytes(entries: readonly ArchiveEntry[]): number {
  let bytes = 0
  for (const entry of entries) {
    bytes += textBytes(entry.id)
    bytes += textBytes(entry.path)
    bytes += textBytes(entry.kind)
    bytes += NUMBER_BYTES
    if (entry.sourceIndex !== undefined) bytes += NUMBER_BYTES
    if (entry.compressedSize !== undefined) bytes += NUMBER_BYTES
    if (entry.compressionMethod !== undefined) bytes += textBytes(entry.compressionMethod)
    if (entry.crc32 !== undefined) bytes += NUMBER_BYTES
    if (entry.modifiedAt !== undefined) bytes += textBytes(entry.modifiedAt)
    if (entry.encrypted !== undefined) bytes += BOOLEAN_BYTES
    if (entry.zip64 !== undefined) bytes += BOOLEAN_BYTES
    if (!Number.isSafeInteger(bytes)) throw new RangeError("Archive index payload exceeds the safe integer range.")
  }
  return bytes
}

function textBytes(value: string): number {
  return encoder.encode(value).byteLength
}
