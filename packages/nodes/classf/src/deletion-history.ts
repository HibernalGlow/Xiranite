import { parse } from "csv-parse/sync"
import { parseSameaArtistLabel } from "./blacklist.js"

export interface ClassfDeletionBlacklistCandidate {
  keyword: string
  occurrences: number
}

/**
 * Extract recurring authors from Xiranite's deletion-history CSV. Only
 * successfully trashed entries count, and author parsing is delegated to SameA.
 */
export function suggestClassfBlacklistKeywords(csv: string, minimumOccurrences = 3): ClassfDeletionBlacklistCandidate[] {
  const records = parse(csv, { bom: true, columns: true, relax_column_count: true, skip_empty_lines: true }) as Array<{ sourcePath?: string; state?: string }>
  const counts = new Map<string, number>()
  for (const record of records) {
    if (record.state !== "trashed" || !record.sourcePath) continue
    const label = parseSameaArtistLabel(pathName(record.sourcePath))?.label
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts.entries()]
    .filter(([, occurrences]) => occurrences >= minimumOccurrences)
    .map(([keyword, occurrences]) => ({ keyword, occurrences }))
    .sort((left, right) => right.occurrences - left.occurrences || left.keyword.localeCompare(right.keyword))
}

function pathName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) ?? path
}
