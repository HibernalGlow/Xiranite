import type { ReaderUpscalePreloadSnapshotDto } from "../../adapters/reader-http-client"

export const EMPTY_READER_UPSCALE_PRELOAD_SNAPSHOTS: readonly ReaderUpscalePreloadSnapshotDto[] = Object.freeze([])
const values = new Map<string, readonly ReaderUpscalePreloadSnapshotDto[]>()
const listeners = new Map<string, Set<() => void>>()

export function readerUpscalePreloadSnapshot(sessionId: string): readonly ReaderUpscalePreloadSnapshotDto[] {
  return values.get(sessionId) ?? EMPTY_READER_UPSCALE_PRELOAD_SNAPSHOTS
}

export function subscribeReaderUpscalePreload(sessionId: string, listener: () => void): () => void {
  const sessionListeners = listeners.get(sessionId) ?? new Set<() => void>()
  sessionListeners.add(listener)
  listeners.set(sessionId, sessionListeners)
  return () => {
    sessionListeners.delete(listener)
    if (!sessionListeners.size) listeners.delete(sessionId)
  }
}

export function setReaderUpscalePreload(sessionId: string, snapshots: readonly ReaderUpscalePreloadSnapshotDto[]): void {
  values.set(sessionId, snapshots)
  for (const listener of listeners.get(sessionId) ?? []) listener()
}

export function clearReaderUpscalePreload(sessionId: string): void {
  if (!values.delete(sessionId)) return
  for (const listener of listeners.get(sessionId) ?? []) listener()
}
