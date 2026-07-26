type MissingTrackListener = (trackId: string) => void

const missingTrackListeners = new Set<MissingTrackListener>()

export function reportMissingMelodeckTrack(trackId: string): void {
  for (const listener of missingTrackListeners) listener(trackId)
}

export function subscribeMissingMelodeckTrack(listener: MissingTrackListener): () => void {
  missingTrackListeners.add(listener)
  return () => missingTrackListeners.delete(listener)
}
