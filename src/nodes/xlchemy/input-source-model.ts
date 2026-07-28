export const XLCHEMY_INPUT_PREVIEW_LIMIT = 1_000
export const XLCHEMY_INPUT_SIZE_CACHE_LIMIT = 1_000

export interface XlchemyInputPathSummary {
  previewPaths: string[]
  totalCount: number
  truncated: boolean
}

export function summarizeXlchemyInputPaths(
  value: string | undefined,
  previewLimit = XLCHEMY_INPUT_PREVIEW_LIMIT,
): XlchemyInputPathSummary {
  const previewPaths: string[] = []
  let totalCount = 0
  forEachInputLine(value, (path) => {
    totalCount += 1
    if (previewPaths.length < previewLimit) previewPaths.push(path)
  })
  return { previewPaths, totalCount, truncated: totalCount > previewPaths.length }
}

export function parseXlchemyInputPaths(value: string | undefined): string[] {
  const paths: string[] = []
  forEachInputLine(value, (path) => paths.push(path))
  return paths
}

export function mergeXlchemyInputPaths(value: string | undefined, additions: Iterable<string>): string {
  const paths = parseXlchemyInputPaths(value)
  const seen = new Set(paths)
  for (const candidate of additions) {
    const path = candidate.trim()
    if (!path || seen.has(path)) continue
    seen.add(path)
    paths.push(path)
  }
  return paths.join("\n")
}

export function removeXlchemyInputPaths(value: string | undefined, removals: ReadonlySet<string>): string {
  if (!removals.size) return String(value ?? "")
  const retained: string[] = []
  forEachInputLine(value, (path) => {
    if (!removals.has(path)) retained.push(path)
  })
  return retained.join("\n")
}

function forEachInputLine(value: string | undefined, visit: (path: string) => void): void {
  const text = String(value ?? "")
  let start = 0
  for (let index = 0; index <= text.length; index += 1) {
    if (index < text.length && text.charCodeAt(index) !== 10) continue
    const path = text.slice(start, index).trim()
    if (path) visit(path)
    start = index + 1
  }
}
