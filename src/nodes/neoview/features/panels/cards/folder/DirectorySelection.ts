export interface DirectorySelectionRange {
  start: number
  end: number
}

export interface DirectorySelectionModel {
  generation: number
  anchorIndex?: number
  ranges: readonly DirectorySelectionRange[]
  explicit: ReadonlyMap<string, number | undefined>
}

export function createDirectorySelection(generation: number): DirectorySelectionModel {
  return { generation, ranges: [], explicit: new Map() }
}

export function selectDirectorySingle(
  generation: number,
  path: string,
  index: number,
): DirectorySelectionModel {
  return {
    generation,
    anchorIndex: index,
    ranges: [],
    explicit: new Map([[path, index]]),
  }
}

export function toggleDirectorySelection(
  selection: DirectorySelectionModel,
  generation: number,
  path: string,
  index: number,
): DirectorySelectionModel {
  const current = selection.generation === generation
    ? selection
    : rebaseDirectorySelection(selection, generation)
  const explicit = new Map(current.explicit)
  let ranges = current.ranges
  if (isDirectoryIndexSelected(current, index, path)) {
    explicit.delete(path)
    ranges = removeIndex(current.ranges, index)
  } else {
    explicit.set(path, index)
  }
  return { generation, anchorIndex: index, ranges, explicit }
}

export function extendDirectorySelection(
  selection: DirectorySelectionModel,
  generation: number,
  endIndex: number,
  options: { additive: boolean; fallbackAnchor: number; endPath?: string },
): DirectorySelectionModel {
  const current = selection.generation === generation
    ? selection
    : rebaseDirectorySelection(selection, generation)
  const anchorIndex = current.anchorIndex ?? options.fallbackAnchor
  const range = normalizedRange(anchorIndex, endIndex)
  const ranges = options.additive
    ? mergeRanges([...current.ranges, range])
    : [range]
  const explicit = new Map(current.explicit)
  if (!options.additive) {
    for (const [path, index] of explicit) {
      if (index === undefined || !contains(range, index)) explicit.delete(path)
    }
  }
  if (options.endPath) explicit.set(options.endPath, endIndex)
  return { generation, anchorIndex, ranges, explicit }
}

export function rebaseDirectorySelection(
  selection: DirectorySelectionModel,
  generation: number,
): DirectorySelectionModel {
  return {
    generation,
    ranges: [],
    explicit: new Map([...selection.explicit].map(([path]) => [path, undefined])),
  }
}

export function isDirectoryIndexSelected(
  selection: DirectorySelectionModel,
  index: number,
  path?: string,
): boolean {
  if (path && selection.explicit.has(path)) return true
  return selection.ranges.some((range) => contains(range, index))
}

export function directorySelectionCount(selection: DirectorySelectionModel): number {
  const ranged = selection.ranges.reduce((total, range) => total + range.end - range.start + 1, 0)
  let outsideRanges = 0
  for (const index of selection.explicit.values()) {
    if (index === undefined || !selection.ranges.some((range) => contains(range, index))) outsideRanges += 1
  }
  return ranged + outsideRanges
}

export function selectedLoadedDirectoryPaths(
  selection: DirectorySelectionModel,
  pages: ReadonlyMap<number, readonly { path: string }[]>,
): ReadonlySet<string> {
  const selected = new Set<string>()
  for (const [cursor, entries] of pages) {
    for (let offset = 0; offset < entries.length; offset += 1) {
      const entry = entries[offset]!
      if (isDirectoryIndexSelected(selection, cursor + offset, entry.path)) selected.add(entry.path)
    }
  }
  return selected
}

function normalizedRange(left: number, right: number): DirectorySelectionRange {
  return { start: Math.min(left, right), end: Math.max(left, right) }
}

function mergeRanges(values: readonly DirectorySelectionRange[]): readonly DirectorySelectionRange[] {
  if (values.length < 2) return values
  const sorted = [...values].sort((left, right) => left.start - right.start || left.end - right.end)
  const merged: DirectorySelectionRange[] = []
  for (const value of sorted) {
    const last = merged[merged.length - 1]
    if (!last || value.start > last.end + 1) {
      merged.push({ ...value })
    } else if (value.end > last.end) {
      last.end = value.end
    }
  }
  return merged
}

function removeIndex(values: readonly DirectorySelectionRange[], index: number): readonly DirectorySelectionRange[] {
  const next: DirectorySelectionRange[] = []
  for (const range of values) {
    if (!contains(range, index)) {
      next.push(range)
      continue
    }
    if (range.start < index) next.push({ start: range.start, end: index - 1 })
    if (index < range.end) next.push({ start: index + 1, end: range.end })
  }
  return next
}

function contains(range: DirectorySelectionRange, index: number): boolean {
  return index >= range.start && index <= range.end
}
