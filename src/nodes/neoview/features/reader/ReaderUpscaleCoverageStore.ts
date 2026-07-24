import type { ReaderUpscalePreloadSnapshotDto } from "../../adapters/reader-http-client"

export interface ReaderUpscaleCoverageSnapshot {
  queued: ReadonlySet<number>
  processing: ReadonlySet<number>
  completed: ReadonlySet<number>
}

const EMPTY_SET = new Set<number>() as ReadonlySet<number>
const EMPTY: ReaderUpscaleCoverageSnapshot = Object.freeze({ queued: EMPTY_SET, processing: EMPTY_SET, completed: EMPTY_SET })
const values = new Map<string, ReaderUpscaleCoverageSnapshot>()
const listeners = new Map<string, Set<() => void>>()

export function readerUpscaleCoverageSnapshot(sessionId: string): ReaderUpscaleCoverageSnapshot {
  return values.get(sessionId) ?? EMPTY
}

export function subscribeReaderUpscaleCoverage(sessionId: string, listener: () => void): () => void {
  const set = listeners.get(sessionId) ?? new Set<() => void>()
  set.add(listener)
  listeners.set(sessionId, set)
  return () => {
    set.delete(listener)
    if (!set.size) listeners.delete(sessionId)
  }
}

export function updateReaderUpscaleCoverage(sessionId: string, snapshots: readonly ReaderUpscalePreloadSnapshotDto[]): void {
  const previous = values.get(sessionId) ?? EMPTY
  const queued = new Set(snapshots.flatMap((snapshot) => snapshot.queuedPageIndexes ?? []))
  const processing = new Set(snapshots.flatMap((snapshot) => snapshot.processingPageIndexes ?? []))
  const completed = new Set(previous.completed)
  for (const pageIndex of snapshots.flatMap((snapshot) => snapshot.upscaledPageIndexes ?? [])) completed.add(pageIndex)
  for (const pageIndex of completed) {
    queued.delete(pageIndex)
    processing.delete(pageIndex)
  }
  for (const pageIndex of processing) queued.delete(pageIndex)
  const next = { queued, processing, completed }
  if (sameSet(previous.queued, queued) && sameSet(previous.processing, processing) && sameSet(previous.completed, completed)) return
  values.set(sessionId, next)
  listeners.get(sessionId)?.forEach((listener) => listener())
}

export function clearReaderUpscaleCoverage(sessionId: string): void {
  if (!values.delete(sessionId)) return
  listeners.get(sessionId)?.forEach((listener) => listener())
}

function sameSet(left: ReadonlySet<number>, right: ReadonlySet<number>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value))
}
