import type { ReaderSessionDto, ReaderSourceChangeDto } from "../../adapters/reader-http-client"

export interface WatchReaderSourceChangesOptions {
  sessionId: string
  signal: AbortSignal
  waitForChanges(
    sessionId: string,
    afterRevision: number,
    signal: AbortSignal,
  ): Promise<ReaderSourceChangeDto | undefined>
  reload(sessionId: string, signal: AbortSignal): Promise<ReaderSessionDto>
  beforeReload?(signal: AbortSignal): Promise<void>
  onReloaded(session: ReaderSessionDto): void
  onReloadFailed(): void
  onWatchUnavailable(): void
  retryDelayMs?: number
}

/**
 * Runs one session-scoped, pathless long-poll outside Reader navigation state.
 * A successful reload replaces the session, so the caller starts a fresh loop.
 */
export async function watchReaderSourceChanges({
  sessionId,
  signal,
  waitForChanges,
  reload,
  beforeReload,
  onReloaded,
  onReloadFailed,
  onWatchUnavailable,
  retryDelayMs = 1_000,
}: WatchReaderSourceChangesOptions): Promise<void> {
  let revision = 0
  let unavailableNotified = false
  while (!signal.aborted) {
    let change: ReaderSourceChangeDto | undefined
    try {
      change = await waitForChanges(sessionId, revision, signal)
    } catch {
      if (signal.aborted) return
      if (!unavailableNotified) onWatchUnavailable()
      unavailableNotified = true
      await abortableDelay(retryDelayMs, signal)
      continue
    }
    if (!change) {
      unavailableNotified = false
      continue
    }
    revision = Math.max(revision, change.revision)
    if (change.state === "unavailable") {
      if (!unavailableNotified) onWatchUnavailable()
      unavailableNotified = true
      await abortableDelay(retryDelayMs, signal)
      continue
    }
    unavailableNotified = false
    try {
      await beforeReload?.(signal)
      const replacement = await reload(sessionId, signal)
      if (!signal.aborted) onReloaded(replacement)
      return
    } catch {
      if (signal.aborted) return
      onReloadFailed()
    }
  }
}

function abortableDelay(durationMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", finish)
      resolve()
    }
    const timer = setTimeout(finish, durationMs)
    signal.addEventListener("abort", finish, { once: true })
  })
}
