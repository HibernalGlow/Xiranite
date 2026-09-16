import { useEffect, useState } from "react"

/**
 * How long the reader frame must hold still before adjacent-page predecode is
 * worth restarting. The backend budget pauses below 120 ms since the last
 * navigation and only retains the reverse frame above 150 ms, so one honest
 * crossing is enough to leave "paused" without also waiting for the speculative
 * gate's idle callback.
 */
export const READER_FRAME_STABLE_MS = 200

/**
 * Reports the navigation-quiet duration that the preload budget consumes.
 *
 * A boolean gate cannot express this. The budget needs to know that a page turn
 * happened *recently* (report 0 and stay out of the visible page's way), not that
 * optional work is globally disabled. The value resets on every frame generation,
 * so a settled duration is never carried over from an earlier page.
 */
export function useReaderFrameStability(sessionId?: string, frameGeneration?: number): number {
  const key = sessionId === undefined || frameGeneration === undefined ? undefined : `${sessionId}\0${frameGeneration}`
  const [stable, setStable] = useState<{ key?: string; ready: boolean }>({ ready: false })
  // Derived-state reset: React re-renders this component before committing, so
  // the preload-context effect never observes the previous frame's settled value.
  if (stable.key !== key) setStable({ key, ready: false })
  useEffect(() => {
    if (key === undefined || stable.key !== key || stable.ready) return
    const timer = window.setTimeout(() => setStable({ key, ready: true }), READER_FRAME_STABLE_MS)
    return () => window.clearTimeout(timer)
  }, [key, stable.key, stable.ready])
  return stable.key === key && stable.ready ? READER_FRAME_STABLE_MS : 0
}
