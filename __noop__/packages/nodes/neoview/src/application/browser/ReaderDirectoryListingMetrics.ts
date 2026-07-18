import type { ReaderDirectoryEntry, ReaderDirectoryListing } from "../../ports/ReaderDirectoryListingProvider.js"

const encoder = new TextEncoder()
const NUMBER_BYTES = 8
const BOOLEAN_BYTES = 1

export function readerDirectoryListingPayloadBytes(listing: ReaderDirectoryListing): number {
  let bytes = textBytes(listing.path) + optionalTextBytes(listing.parentPath)
  for (const entry of listing.entries) bytes = safeAdd(bytes, readerDirectoryEntryPayloadBytes(entry))
  return bytes
}

export function readerDirectoryEntryPayloadBytes(entry: ReaderDirectoryEntry): number {
  let bytes = textBytes(entry.name) + textBytes(entry.path) + textBytes(entry.kind) + BOOLEAN_BYTES
  for (const value of [entry.modifiedAt, entry.size, entry.rating, entry.collectTagCount, entry.width, entry.height, entry.pageCount]) {
    if (value !== undefined) bytes += NUMBER_BYTES
  }
  for (const tag of entry.tags ?? []) bytes = safeAdd(bytes, textBytes(tag))
  return bytes
}

export function stringPayloadBytes(values: Iterable<string>): number {
  let bytes = 0
  for (const value of values) bytes = safeAdd(bytes, textBytes(value))
  return bytes
}

function optionalTextBytes(value: string | undefined): number {
  return value === undefined ? 0 : textBytes(value)
}

function textBytes(value: string): number {
  return encoder.encode(value).byteLength
}

function safeAdd(left: number, right: number): number {
  const result = left + right
  if (!Number.isSafeInteger(result)) throw new RangeError("Reader directory payload exceeds the safe integer range.")
  return result
}
