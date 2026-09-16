import type { ReaderPreloadPlanDto } from "../../adapters/reader-http-client"

/**
 * Decides whether adjacent-page predecode may run for the current frame.
 *
 * It follows the config switch, the deferred frame mount and the cancelled-frame
 * guard, but deliberately not `useReaderSpeculativePreloadGate`. Routing adjacent
 * predecode through that gate made preheat anti-correlated with the fast page
 * turning it exists for, because the gate closes on exactly that input. The gate
 * keeps guarding optional work (super-resolution) instead.
 */
export function readerAdjacentPreloadEnabled(input: {
  browserPredecodeEnabled: boolean
  readerFrameAllowed: boolean
  sessionId?: string
  frameGeneration?: number
  cancelledPreloadFrame?: { sessionId: string; generation: number }
}): boolean {
  if (!input.browserPredecodeEnabled || !input.readerFrameAllowed) return false
  const cancelled = input.cancelledPreloadFrame
  if (!input.sessionId || !cancelled) return true
  return cancelled.sessionId !== input.sessionId || cancelled.generation !== input.frameGeneration
}

/**
 * Distinguishes the two situations the backend reports as `admission: "paused"`.
 *
 * A recent navigation only means "start no new work". The decoded window that is
 * already warm must survive it, otherwise the next turn is guaranteed cold and
 * the preheat it paid for is discarded on the way in. Memory pressure, a
 * background document and scrub are real teardown signals and still release.
 */
export function readerPreloadPlanRequiresRelease(plan: ReaderPreloadPlanDto): boolean {
  return plan.memoryPressure !== "normal" || !plan.focused || plan.mode === "scrub"
}
