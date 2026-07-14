import type { CzkawkaEntry, CzkawkaGroup, CzkawkaTool } from "./core.js"
import { calculateCzkawkaSelectionStats } from "./selection-assistant.js"

export type CzkawkaSimilarityLevel = "original" | "very-high" | "high" | "medium" | "small" | "very-small" | "minimal"

export interface CzkawkaFormatStat {
  format: string
  count: number
  bytes: number
  countPercent: number
  bytesPercent: number
}

export interface CzkawkaSimilarityStat {
  level: CzkawkaSimilarityLevel
  label: string
  range: string
  count: number
  percent: number
}

export interface CzkawkaAnalysis {
  formats: CzkawkaFormatStat[]
  similarities: CzkawkaSimilarityStat[]
  selection: ReturnType<typeof calculateCzkawkaSelectionStats>
  fileCount: number
  totalBytes: number
}

const LEVELS: CzkawkaSimilarityLevel[] = ["original", "very-high", "high", "medium", "small", "very-small", "minimal"]
const LEVEL_LABELS: Record<CzkawkaSimilarityLevel, string> = { original: "原始/相同", "very-high": "极高", high: "高", medium: "中等", small: "较小", "very-small": "很小", minimal: "最低" }
const THRESHOLDS: Record<8 | 16 | 32 | 64, readonly number[]> = { 8: [1, 2, 5, 7, 14, 40], 16: [2, 5, 15, 30, 40, 40], 32: [4, 10, 20, 40, 40, 40], 64: [6, 20, 40, 40, 40, 40] }

export function buildCzkawkaAnalysis(groups: CzkawkaGroup[], selectedPaths: Iterable<string>, tool: CzkawkaTool, hashSize = 16): CzkawkaAnalysis {
  const entries = groups.flatMap((group) => group.entries)
  return {
    formats: buildFormatStats(entries, tool),
    similarities: buildSimilarityStats(entries, hashSize, tool),
    selection: calculateCzkawkaSelectionStats(groups, selectedPaths),
    fileCount: entries.length,
    totalBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
  }
}

export function buildFormatStats(entries: CzkawkaEntry[], tool?: CzkawkaTool): CzkawkaFormatStat[] {
  const totals = new Map<string, { count: number; bytes: number }>()
  let totalBytes = 0
  for (const entry of entries) {
    const format = tool === "empty-folders" ? "folder" : extensionOf(entry.path)
    const current = totals.get(format) ?? { count: 0, bytes: 0 }
    totals.set(format, { count: current.count + 1, bytes: current.bytes + entry.size })
    totalBytes += entry.size
  }
  return [...totals].map(([format, value]) => ({ format, ...value, countPercent: entries.length ? value.count / entries.length * 100 : 0, bytesPercent: totalBytes ? value.bytes / totalBytes * 100 : 0 })).sort((left, right) => right.bytes - left.bytes || right.count - left.count || left.format.localeCompare(right.format))
}

export function buildSimilarityStats(entries: CzkawkaEntry[], hashSize = 16, tool?: CzkawkaTool): CzkawkaSimilarityStat[] {
  const normalizedHashSize = ([8, 16, 32, 64] as const).find((value) => value === hashSize) ?? 16
  const thresholds = tool === "similar-videos" ? [2.5, 5, 10, 20, 30, 40] : THRESHOLDS[normalizedHashSize]
  const counts = new Map<CzkawkaSimilarityLevel, number>()
  let total = 0
  for (const entry of entries) {
    if (entry.isReference || entry.similarity === undefined) continue
    const difference = parseSimilarity(entry.similarity)
    if (difference === undefined) continue
    const level = similarityLevel(difference, thresholds)
    counts.set(level, (counts.get(level) ?? 0) + 1)
    total += 1
  }
  return LEVELS.map((level, index) => ({ level, label: LEVEL_LABELS[level], range: similarityRange(level, index, thresholds), count: counts.get(level) ?? 0, percent: total ? (counts.get(level) ?? 0) / total * 100 : 0 })).filter((item) => item.count > 0)
}

function extensionOf(path: string): string {
  const name = path.replaceAll("\\", "/").split("/").at(-1) ?? path
  const index = name.lastIndexOf(".")
  return index > 0 && index < name.length - 1 ? name.slice(index + 1).toLocaleLowerCase() : "unknown"
}

function parseSimilarity(value: string): number | undefined {
  if (value === "") return 0
  const matched = value.match(/\d+(?:\.\d+)?/)
  if (!matched) return undefined
  const parsed = Number.parseFloat(matched[0])
  return Number.isFinite(parsed) ? parsed : undefined
}

function similarityLevel(value: number, thresholds: readonly number[]): CzkawkaSimilarityLevel {
  if (value === 0) return "original"
  const index = thresholds.findIndex((threshold) => value <= threshold)
  return index < 0 ? "minimal" : LEVELS[index + 1] ?? "minimal"
}

function similarityRange(level: CzkawkaSimilarityLevel, index: number, thresholds: readonly number[]): string {
  if (level === "original") return "= 0"
  return `≤ ${thresholds[Math.max(0, index - 1)] ?? thresholds.at(-1)}`
}
