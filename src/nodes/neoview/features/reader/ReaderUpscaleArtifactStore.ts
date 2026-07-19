import type { ReaderUpscaleArtifactResultDto } from "../../adapters/reader-http-client"

export interface ReaderUpscaleArtifactSnapshot {
  state: "idle" | "processing" | "completed" | "skipped" | "failed"
  result?: ReaderUpscaleArtifactResultDto
}

export const EMPTY_READER_UPSCALE_ARTIFACT_SNAPSHOT: ReaderUpscaleArtifactSnapshot = Object.freeze({ state: "idle" })

const values = new Map<string, ReaderUpscaleArtifactSnapshot>()
const listeners = new Map<string, Set<() => void>>()

export function readerUpscaleArtifactKey(sessionId: string, pageId: string): string { return `${sessionId}:${pageId}` }
export function readerUpscaleArtifactSnapshot(sessionId: string, pageId: string): ReaderUpscaleArtifactSnapshot { return values.get(readerUpscaleArtifactKey(sessionId, pageId)) ?? EMPTY_READER_UPSCALE_ARTIFACT_SNAPSHOT }
export function subscribeReaderUpscaleArtifact(sessionId: string, pageId: string, listener: () => void): () => void {
  const key = readerUpscaleArtifactKey(sessionId, pageId)
  const set = listeners.get(key) ?? new Set<() => void>()
  set.add(listener); listeners.set(key, set)
  return () => { set.delete(listener); if (!set.size) listeners.delete(key) }
}
export function setReaderUpscaleArtifact(sessionId: string, pageId: string, snapshot: ReaderUpscaleArtifactSnapshot): void {
  const key = readerUpscaleArtifactKey(sessionId, pageId)
  values.set(key, snapshot)
  listeners.get(key)?.forEach((listener) => listener())
}
