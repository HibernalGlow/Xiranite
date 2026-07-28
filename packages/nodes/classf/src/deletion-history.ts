import { parse } from "csv-parse/browser/esm/sync"
import { parseSameaArtistLabel } from "./blacklist.js"

export interface ClassfDeletionBlacklistCandidate {
  keyword: string
  occurrences: number
}

export interface ClassfDeletionHistoryAnalysis {
  importedRecords: number
  successfulDeletions: number
  artistDeletionCount: number
  candidates: ClassfDeletionBlacklistCandidate[]
}

/**
 * Extract recurring authors from Xiranite's deletion-history CSV. Only
 * successful trash/permanent operations count; failed and restored records do
 * not. Author parsing remains delegated to SameA.
 */
export function analyzeClassfDeletionHistory(csv: string, minimumOccurrences = 3): ClassfDeletionHistoryAnalysis {
  const records = parse(csv, { bom: true, columns: true, relax_column_count: true, skip_empty_lines: true }) as Array<{ sourcePath?: string; state?: string }>
  const counts = new Map<string, ClassfDeletionBlacklistCandidate>()
  let successfulDeletions = 0
  let artistDeletionCount = 0
  for (const record of records) {
    if (!isSuccessfulDeletion(record.state)) continue
    successfulDeletions += 1
    if (!record.sourcePath) continue
    const label = parseSameaArtistLabel(pathName(record.sourcePath))?.label
    if (!label) continue
    artistDeletionCount += 1
    const key = label.toLocaleLowerCase()
    const existing = counts.get(key)
    if (existing) existing.occurrences += 1
    else counts.set(key, { keyword: label, occurrences: 1 })
  }
  const threshold = Math.max(1, Math.floor(minimumOccurrences) || 1)
  const candidates = [...counts.values()]
    .filter(({ occurrences }) => occurrences >= threshold)
    .sort((left, right) => right.occurrences - left.occurrences || left.keyword.localeCompare(right.keyword))
  return { importedRecords: records.length, successfulDeletions, artistDeletionCount, candidates }
}

export function suggestClassfBlacklistKeywords(csv: string, minimumOccurrences = 3): ClassfDeletionBlacklistCandidate[] {
  return analyzeClassfDeletionHistory(csv, minimumOccurrences).candidates
}

function isSuccessfulDeletion(state: string | undefined): boolean {
  const normalized = state?.trim().toLocaleLowerCase()
  return normalized === "trashed" || normalized === "permanent"
}

function pathName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) ?? path
}
