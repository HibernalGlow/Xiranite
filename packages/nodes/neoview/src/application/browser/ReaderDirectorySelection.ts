import type { ReaderDirectoryEntry } from "../../ports/ReaderDirectoryListingProvider.js"

const MAX_SELECTION_RANGES = 1_024
const MAX_SELECTION_EXPLICIT_PATHS = 4_096
const MAX_SELECTION_BATCH_SIZE = 512

export interface ReaderDirectorySelectionRange {
  start: number
  end: number
}

export interface ReaderDirectorySelectionExplicitPath {
  path: string
  index?: number
}

export interface ReaderDirectorySelectionDescriptor {
  generation: number
  allSelected: boolean
  ranges: readonly ReaderDirectorySelectionRange[]
  explicit: readonly ReaderDirectorySelectionExplicitPath[]
}

export interface ReaderDirectorySelectionBatchSource {
  generation: number
  total: number
  selectedCount: number
  batches(batchSize?: number, signal?: AbortSignal): Iterable<readonly ReaderDirectoryEntry[]>
}

export class ReaderDirectorySelectionStaleError extends Error {
  constructor(generation: number) {
    super(`Reader directory selection generation is stale: ${generation}`)
    this.name = "ReaderDirectorySelectionStaleError"
  }
}

export function createReaderDirectorySelectionBatchSource(
  entries: readonly ReaderDirectoryEntry[],
  currentGeneration: number,
  descriptor: ReaderDirectorySelectionDescriptor,
): ReaderDirectorySelectionBatchSource {
  if (!Number.isSafeInteger(descriptor.generation) || descriptor.generation < 0 || descriptor.generation !== currentGeneration) {
    throw new ReaderDirectorySelectionStaleError(descriptor.generation)
  }
  if (typeof descriptor.allSelected !== "boolean") throw new TypeError("Reader directory selection allSelected must be boolean.")
  const ranges = validateRanges(descriptor.ranges, entries.length)
  const explicitIndexes = validateExplicitPaths(descriptor.explicit, entries)
  const ranged = ranges.reduce((count, range) => count + range.end - range.start + 1, 0)
  let explicitOutsideRanges = 0
  for (const index of explicitIndexes.values()) {
    if (!rangeContains(ranges, index)) explicitOutsideRanges += 1
  }
  const deviations = ranged + explicitOutsideRanges
  const selectedCount = descriptor.allSelected ? entries.length - deviations : deviations

  return {
    generation: currentGeneration,
    total: entries.length,
    selectedCount,
    batches(batchSize = 256, signal) {
      assertBatchSize(batchSize)
      return selectedEntryBatches(entries, descriptor.allSelected, ranges, explicitIndexes, batchSize, signal)
    },
  }
}

function validateRanges(
  value: readonly ReaderDirectorySelectionRange[],
  total: number,
): readonly ReaderDirectorySelectionRange[] {
  if (!Array.isArray(value) || value.length > MAX_SELECTION_RANGES) {
    throw new RangeError(`Reader directory selection cannot exceed ${MAX_SELECTION_RANGES} ranges.`)
  }
  let previousEnd = -2
  return value.map((range) => {
    if (!range || typeof range !== "object"
      || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end)
      || range.start < 0 || range.end < range.start || range.end >= total) {
      throw new RangeError("Reader directory selection range is outside the current listing.")
    }
    if (range.start <= previousEnd + 1) {
      throw new RangeError("Reader directory selection ranges must be sorted, disjoint and non-adjacent.")
    }
    previousEnd = range.end
    return { start: range.start, end: range.end }
  })
}

function validateExplicitPaths(
  value: readonly ReaderDirectorySelectionExplicitPath[],
  entries: readonly ReaderDirectoryEntry[],
): ReadonlyMap<string, number> {
  if (!Array.isArray(value) || value.length > MAX_SELECTION_EXPLICIT_PATHS) {
    throw new RangeError(`Reader directory selection cannot exceed ${MAX_SELECTION_EXPLICIT_PATHS} explicit paths.`)
  }
  const requested = new Map<string, ReaderDirectorySelectionExplicitPath>()
  for (const item of value) {
    if (!item || typeof item !== "object" || typeof item.path !== "string"
      || item.path.length === 0 || item.path.length > 32_768 || item.path.includes("\0")
      || (item.index !== undefined && (!Number.isSafeInteger(item.index) || item.index < 0 || item.index >= entries.length))) {
      throw new RangeError("Reader directory selection explicit path is invalid.")
    }
    const key = normalizePathKey(item.path)
    if (requested.has(key)) throw new RangeError("Reader directory selection contains duplicate explicit paths.")
    requested.set(key, item)
  }
  if (!requested.size) return new Map()

  const found = new Map<string, number>()
  for (let index = 0; index < entries.length; index += 1) {
    const key = normalizePathKey(entries[index]!.path)
    const item = requested.get(key)
    if (!item) continue
    if (item.index !== undefined && item.index !== index) {
      throw new RangeError("Reader directory selection explicit path index does not match the current listing.")
    }
    found.set(key, index)
  }
  if (found.size !== requested.size) {
    throw new RangeError("Reader directory selection explicit path is not in the current listing.")
  }
  return found
}

function* selectedEntryBatches(
  entries: readonly ReaderDirectoryEntry[],
  allSelected: boolean,
  ranges: readonly ReaderDirectorySelectionRange[],
  explicitIndexes: ReadonlyMap<string, number>,
  batchSize: number,
  signal?: AbortSignal,
): Generator<readonly ReaderDirectoryEntry[]> {
  let rangeIndex = 0
  let batch: ReaderDirectoryEntry[] = []
  for (let index = 0; index < entries.length; index += 1) {
    signal?.throwIfAborted()
    while (rangeIndex < ranges.length && ranges[rangeIndex]!.end < index) rangeIndex += 1
    const inRange = rangeIndex < ranges.length && ranges[rangeIndex]!.start <= index
    const differsFromDefault = inRange || explicitIndexes.has(normalizePathKey(entries[index]!.path))
    if (differsFromDefault === allSelected) continue
    batch.push(entries[index]!)
    if (batch.length === batchSize) {
      yield batch
      batch = []
    }
  }
  if (batch.length) yield batch
}

function rangeContains(ranges: readonly ReaderDirectorySelectionRange[], index: number): boolean {
  return ranges.some((range) => index >= range.start && index <= range.end)
}

function assertBatchSize(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_SELECTION_BATCH_SIZE) {
    throw new RangeError(`Reader directory selection batch size must be from 1 to ${MAX_SELECTION_BATCH_SIZE}.`)
  }
}

function normalizePathKey(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/u, "")
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized
}
