import { decodeEfuBytes, parseEfuRecords, streamEfuRecords } from "@xiranite/shared/efu"
import type { XlchemyEfuAnalysis } from "./types"

const IMAGE_EXTENSIONS = new Set(["jxl", "jpg", "jpeg", "jfif", "jif", "jpe", "png", "apng", "gif", "webp", "jp2", "bmp", "ico", "tiff", "tif", "avif", "psd", "psb", "clip"])
const SIZE_SAMPLE_LIMIT = 2_048
const FOLDER_LIMIT = 32

export { decodeEfuBytes }

/**
 * Read an Everything File List (EFU) as paths.
 *
 * EFU is CSV with a `Filename` column. csv-parse handles quoted commas,
 * embedded newlines, BOMs, and variable optional columns for us.
 */
export function parseEfuText(text: string): string[] {
  return parseEfuRecords(text).map((record) => record.filename)
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

  for await (const record of streamEfuRecords(response.body)) {
    const filename = record.filename
    const normalized = filename.replace(/\\/g, "/")
    const name = normalized.slice(normalized.lastIndexOf("/") + 1)
    const dot = name.lastIndexOf(".")
    const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : "unknown"
    if (!IMAGE_EXTENSIONS.has(extension)) continue
    const parsedSize = Number(record.size ?? 0)
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

function analysisFolder(path: string) {
  const directory = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""
  const parts = directory.split("/").filter(Boolean)
  return /^[a-z]:$/i.test(parts[0] ?? "") ? parts[1] ?? parts[0] ?? "/" : parts[0] ?? "/"
}
