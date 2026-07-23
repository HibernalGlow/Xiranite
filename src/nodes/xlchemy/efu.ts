import { parse } from "csv-parse/browser/esm/sync"
import type { XlchemyEfuAnalysis } from "./types"

const IMAGE_EXTENSIONS = new Set(["jxl", "jpg", "jpeg", "jfif", "jif", "jpe", "png", "apng", "gif", "webp", "jp2", "bmp", "ico", "tiff", "tif", "avif", "psd", "psb", "clip"])
const SIZE_SAMPLE_LIMIT = 2_048
const FOLDER_LIMIT = 32

/** Decode the encodings emitted by Everything's EFU exporter. */
export function decodeEfuBytes(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (view[0] === 0xff && view[1] === 0xfe) return new TextDecoder("utf-16le").decode(view)
  if (view[0] === 0xfe && view[1] === 0xff) return new TextDecoder("utf-16be").decode(view)
  return new TextDecoder("utf-8").decode(view)
}

/**
 * Read an Everything File List (EFU) as paths.
 *
 * EFU is CSV with a `Filename` column. csv-parse handles quoted commas,
 * embedded newlines, BOMs, and variable optional columns for us.
 */
export function parseEfuText(text: string): string[] {
  const rows = parse(text, {
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as unknown[][]
  const header = rows.shift() ?? []
  const filenameIndex = header.findIndex((value) => String(value).trim().toLowerCase() === "filename")
  if (filenameIndex < 0) throw new Error("EFU 文件缺少 Filename 列。")
  return rows
    .map((row) => String(row[filenameIndex] ?? "").trim())
    .filter(Boolean)
}

export function parseEfuBytes(bytes: ArrayBuffer | Uint8Array): string[] {
  return parseEfuText(decodeEfuBytes(bytes))
}

/** Stream an EFU into a bounded aggregate suitable for card state. */
export async function analyzeEfuUrl(url: string): Promise<XlchemyEfuAnalysis> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`读取 EFU 失败：HTTP ${response.status}`)
  if (!response.body) throw new Error("读取 EFU 失败：响应不支持流式读取。")

  const formats = new Map<string, { count: number; size: number }>()
  const folders = new Map<string, { count: number; size: number }>()
  const sizeSample: number[] = []
  let totalFiles = 0, totalSize = 0, minSize = Number.POSITIVE_INFINITY, maxSize = 0
  let header: string[] | undefined, filenameIndex = -1, sizeIndex = -1

  for await (const line of decodeResponseLines(response.body)) {
    if (!line) continue
    const row = parseCsvLine(line)
    if (!header) {
      header = row
      filenameIndex = header.findIndex((value) => value.trim().toLowerCase() === "filename")
      sizeIndex = header.findIndex((value) => value.trim().toLowerCase() === "size")
      if (filenameIndex < 0) throw new Error("EFU 文件缺少 Filename 列。")
      continue
    }
    const filename = row[filenameIndex]?.trim()
    if (!filename) continue
    const normalized = filename.replace(/\\/g, "/")
    const name = normalized.slice(normalized.lastIndexOf("/") + 1)
    const dot = name.lastIndexOf(".")
    const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : "unknown"
    if (!IMAGE_EXTENSIONS.has(extension)) continue
    const parsedSize = sizeIndex >= 0 ? Number(row[sizeIndex]) : 0
    const size = Number.isFinite(parsedSize) && parsedSize > 0 ? parsedSize : 0
    const folder = analysisFolder(normalized)

    totalFiles += 1
    totalSize += size
    minSize = Math.min(minSize, size)
    maxSize = Math.max(maxSize, size)
    addDistribution(formats, extension, size)
    addBoundedDistribution(folders, folder, size, FOLDER_LIMIT)
    addSizeSample(sizeSample, size, totalFiles)
  }

  if (!header) throw new Error("EFU 文件为空。")
  sizeSample.sort((a, b) => a - b)
  return {
    totalFiles,
    totalSize,
    minSize: totalFiles ? minSize : 0,
    medianSize: sizeSample[Math.floor(sizeSample.length / 2)] ?? 0,
    maxSize,
    formats: sortedDistribution(formats),
    folders: sortedDistribution(folders).slice(0, 6),
  }
}

async function* decodeResponseLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader()
  let decoder: TextDecoder | undefined, prefix = new Uint8Array(), pending = ""
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      let bytes = value
      if (!decoder) {
        prefix = concatBytes(prefix, bytes)
        if (prefix.length < 2) continue
        decoder = new TextDecoder(prefix[0] === 0xff && prefix[1] === 0xfe ? "utf-16le" : prefix[0] === 0xfe && prefix[1] === 0xff ? "utf-16be" : "utf-8")
        bytes = prefix
      }
      pending += decoder.decode(bytes, { stream: true })
      let newline = pending.indexOf("\n")
      while (newline >= 0) {
        yield pending.slice(0, newline).replace(/\r$/, "")
        pending = pending.slice(newline + 1)
        newline = pending.indexOf("\n")
      }
    }
    pending += decoder?.decode() ?? ""
    if (pending) yield pending.replace(/\r$/, "")
  } finally {
    reader.releaseLock()
  }
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let value = "", quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1 }
      else quoted = !quoted
    } else if (char === "," && !quoted) { fields.push(value); value = "" }
    else value += char
  }
  fields.push(value)
  return fields
}

function addDistribution(values: Map<string, { count: number; size: number }>, key: string, size: number) {
  const current = values.get(key) ?? { count: 0, size: 0 }
  current.count += 1; current.size += size; values.set(key, current)
}

function addBoundedDistribution(values: Map<string, { count: number; size: number }>, key: string, size: number, limit: number) {
  if (values.has(key) || values.size < limit) { addDistribution(values, key, size); return }
}

function addSizeSample(sample: number[], size: number, count: number) {
  if (sample.length < SIZE_SAMPLE_LIMIT) { sample.push(size); return }
  const slot = ((count * 2_654_435_761) >>> 0) % count
  if (slot < SIZE_SAMPLE_LIMIT) sample[slot] = size
}

function sortedDistribution(values: Map<string, { count: number; size: number }>) {
  return [...values.entries()].map(([key, value]) => ({ key, ...value })).sort((a, b) => b.size - a.size || b.count - a.count)
}

function concatBytes(left: Uint8Array, right: Uint8Array) {
  if (!left.length) return right
  const output = new Uint8Array(left.length + right.length)
  output.set(left); output.set(right, left.length)
  return output
}

function analysisFolder(path: string) {
  const directory = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""
  const parts = directory.split("/").filter(Boolean)
  return /^[a-z]:$/i.test(parts[0] ?? "") ? parts[1] ?? parts[0] ?? "/" : parts[0] ?? "/"
}
