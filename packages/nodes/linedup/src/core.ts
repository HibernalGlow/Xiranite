export interface LinedupFilterInput {
  sourceLines: string[]
  filterLines: string[]
  caseSensitive?: boolean
  sort?: boolean
}

export interface LinedupFilterResult {
  filteredLines: string[]
  removedLines: string[]
  removedCount: number
  keptCount: number
}

export function normalizeLine(line: string): string {
  return line.trim()
}

export function uniqueNonEmptyLines(lines: string[]): string[] {
  return [...new Set(lines.map(normalizeLine).filter(Boolean))]
}

export function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
}

export function filterLines(input: LinedupFilterInput): LinedupFilterResult {
  const source = uniqueNonEmptyLines(input.sourceLines)
  const filters = uniqueNonEmptyLines(input.filterLines)
  const caseSensitive = input.caseSensitive ?? true
  const normalizeCompare = (value: string) => (caseSensitive ? value : value.toLowerCase())
  const compareFilters = filters.map(normalizeCompare)

  const filteredLines: string[] = []
  const removedLines: string[] = []

  for (const line of source) {
    const comparableLine = normalizeCompare(line)
    const shouldRemove = compareFilters.some((filter) => filter.length > 0 && comparableLine.includes(filter))
    if (shouldRemove) {
      removedLines.push(line)
    } else {
      filteredLines.push(line)
    }
  }

  const sortedFiltered = input.sort === false ? filteredLines : [...filteredLines].sort(localeSort)
  const sortedRemoved = input.sort === false ? removedLines : [...removedLines].sort(localeSort)

  return {
    filteredLines: sortedFiltered,
    removedLines: sortedRemoved,
    removedCount: sortedRemoved.length,
    keptCount: sortedFiltered.length,
  }
}

export function createDiffRows(sourceLines: string[], filteredLines: string[]): Array<{ line: string; status: "kept" | "removed" }> {
  const kept = new Set(filteredLines.map(normalizeLine))
  return uniqueNonEmptyLines(sourceLines).map((line) => ({
    line,
    status: kept.has(line) ? "kept" : "removed",
  }))
}

function localeSort(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
}
