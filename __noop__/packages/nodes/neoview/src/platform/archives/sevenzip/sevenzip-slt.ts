import { normalizeArchivePath } from "../../../domain/archive/archive-path.js"
import type { ArchiveEntry } from "../../../ports/ArchiveProvider.js"

const MAX_ENTRIES = 100_000
const MAX_ENTRY_BYTES = 8 * 1024 * 1024 * 1024
const MAX_TOTAL_BYTES = 64 * 1024 * 1024 * 1024

export interface SevenZipArchiveIndex {
  archiveType?: string
  solid: boolean
  entries: readonly ArchiveEntry[]
}

export function parseSevenZipSlt(output: string): SevenZipArchiveIndex {
  const normalized = output.replaceAll("\r\n", "\n")
  const separator = normalized.split("\n").findIndex((line) => line.trim() === "----------")
  if (separator < 0) throw new Error("7-Zip technical listing has no archive/entry separator.")
  const lines = normalized.split("\n")
  const archive = parseProperties(lines.slice(0, separator))
  const records = splitRecords(lines.slice(separator + 1))
  if (records.length > MAX_ENTRIES) throw new Error(`Archive contains too many entries: ${records.length}.`)

  const entries: ArchiveEntry[] = []
  const paths = new Set<string>()
  let totalBytes = 0
  const blocks = new Map<string, number>()
  for (const [index, record] of records.entries()) {
    const rawPath = required(record, "Path")
    if (rawPath.includes("\r") || rawPath.includes("\n") || rawPath.includes("\0")) {
      throw new Error(`Unsafe archive entry path: ${rawPath}`)
    }
    const path = normalizeArchivePath(rawPath)
    if (paths.has(path)) throw new Error(`Duplicate archive entry path: ${path}`)
    paths.add(path)
    const directory = record.get("Folder") === "+" || record.get("Attributes")?.trim().startsWith("D") === true
    const size = parseSize(record.get("Size"), "Size", directory ? 0 : undefined)
    if (size > MAX_ENTRY_BYTES) throw new Error(`Archive entry exceeds the size limit: ${path}.`)
    totalBytes += size
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_TOTAL_BYTES) {
      throw new Error("Archive total uncompressed size exceeds the limit.")
    }
    const block = record.get("Block")?.trim()
    if (!directory && block) blocks.set(block, (blocks.get(block) ?? 0) + 1)
    entries.push({
      id: `sevenzip-${index}`,
      sourceIndex: index,
      path,
      kind: directory ? "directory" : "file",
      uncompressedSize: size,
      compressedSize: optionalSize(record.get("Packed Size"), "Packed Size"),
      compressionMethod: optionalText(record.get("Method")),
      crc32: optionalCrc32(record.get("CRC")),
      modifiedAt: optionalText(record.get("Modified")),
      encrypted: record.get("Encrypted") === "+",
    })
  }

  const solid = archive.get("Solid") === "+" || [...blocks.values()].some((count) => count > 1)
  return {
    archiveType: optionalText(archive.get("Type")),
    solid,
    entries,
  }
}

function splitRecords(lines: string[]): Map<string, string>[] {
  const records: Map<string, string>[] = []
  let current: string[] = []
  const flush = () => {
    const record = parseProperties(current)
    if (record.size) records.push(record)
    current = []
  }
  for (const line of lines) {
    if (!line.trim()) flush()
    else current.push(line)
  }
  flush()
  return records
}

function parseProperties(lines: string[]): Map<string, string> {
  const properties = new Map<string, string>()
  for (const line of lines) {
    const separator = line.indexOf(" = ")
    if (separator <= 0) continue
    properties.set(line.slice(0, separator).trim(), line.slice(separator + 3))
  }
  return properties
}

function required(record: ReadonlyMap<string, string>, key: string): string {
  const value = record.get(key)
  if (!value) throw new Error(`7-Zip entry is missing ${key}.`)
  return value
}

function parseSize(value: string | undefined, name: string, fallback?: number): number {
  if ((!value || !value.trim()) && fallback !== undefined) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid 7-Zip ${name}: ${value ?? ""}.`)
  return parsed
}

function optionalSize(value: string | undefined, name: string): number | undefined {
  return value?.trim() ? parseSize(value, name) : undefined
}

function optionalCrc32(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined
  if (!/^[0-9A-Fa-f]{8}$/.test(value)) throw new Error(`Invalid 7-Zip CRC: ${value}.`)
  return Number.parseInt(value, 16) >>> 0
}

function optionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}
