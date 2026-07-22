export interface ReaderEmmRatingRecord {
  path: string
  rating: number
}

export interface ReaderFolderRatingEntry {
  path: string
  averageRating: number
  count: number
  direct: boolean
}

const MAX_PARENT_LEVELS = 3

/**
 * Builds the legacy folder-rating projection from EMM records. The bounded
 * parent walk keeps recomputation off reader navigation and image paths.
 */
export function buildReaderFolderRatingCache(records: readonly ReaderEmmRatingRecord[]): readonly ReaderFolderRatingEntry[] {
  const direct = new Map<string, { sum: number; count: number }>()
  for (const record of records) {
    if (!Number.isFinite(record.rating) || record.rating <= 0) continue
    const parent = parentPath(record.path)
    if (!parent) continue
    const current = direct.get(parent) ?? { sum: 0, count: 0 }
    current.sum += record.rating
    current.count++
    direct.set(parent, current)
  }
  const entries = new Map<string, ReaderFolderRatingEntry>()
  for (const [path, stats] of direct) entries.set(path, { path, averageRating: stats.sum / stats.count, count: stats.count, direct: true })

  const candidates = new Set<string>()
  for (const path of direct.keys()) {
    let current: string | undefined = path
    for (let level = 0; current && level <= MAX_PARENT_LEVELS; level++) {
      candidates.add(current)
      current = parentPath(current)
    }
  }
  const ordered = [...candidates].sort((left, right) => pathDepth(right) - pathDepth(left) || left.localeCompare(right))
  for (let round = 0; round < MAX_PARENT_LEVELS; round++) {
    let changed = false
    for (const path of ordered) {
      if (entries.has(path)) continue
      const children = [...entries.values()].filter((entry) => parentPath(entry.path) === path)
      if (!children.length) continue
      entries.set(path, {
        path,
        averageRating: children.reduce((sum, entry) => sum + entry.averageRating, 0) / children.length,
        count: children.length,
        direct: false,
      })
      changed = true
    }
    if (!changed) break
  }
  return [...entries.values()].sort((left, right) => left.path.localeCompare(right.path))
}

export function normalizeReaderFolderRatingPath(path: string): string {
  return path.trim().replaceAll("\\", "/").replace(/\/+$/, "")
}

function parentPath(path: string): string | undefined {
  const normalized = normalizeReaderFolderRatingPath(path)
  const separator = normalized.lastIndexOf("/")
  return separator > 2 ? normalized.slice(0, separator) : undefined
}

function pathDepth(path: string): number { return path.split("/").filter(Boolean).length }
