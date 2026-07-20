import { useEffect, useState } from "react"

import type {
  ReaderHttpClient,
  ReaderSuperResolutionConfigDto,
  ReaderUpscalePreloadSnapshotDto,
} from "../../adapters/reader-http-client"
import { clearReaderUpscalePreload, readerUpscalePreloadSnapshot, setReaderUpscalePreload } from "./ReaderUpscalePreloadStore"

const ACTIVE_POLL_INTERVAL_MS = 750
const IDLE_POLL_INTERVAL_MS = 2_000
const SCHEDULE_DEBOUNCE_MS = 200
const EMPTY_SNAPSHOTS: readonly ReaderUpscalePreloadSnapshotDto[] = Object.freeze([])

export interface ReaderUpscalePreloadRuntime {
  snapshots: readonly ReaderUpscalePreloadSnapshotDto[]
  error?: string
}

export function useReaderUpscalePreload({
  client,
  sessionId,
  preloadGeneration,
  currentPageIndex,
  superResolution,
}: {
  client: ReaderHttpClient
  sessionId?: string
  preloadGeneration?: number
  currentPageIndex?: number
  superResolution?: ReaderSuperResolutionConfigDto
}): ReaderUpscalePreloadRuntime {
  const [snapshots, setSnapshots] = useState(EMPTY_SNAPSHOTS)
  const [error, setError] = useState<string>()
  const preferences = superResolution?.preferences
  const enabled = superResolution?.provider !== "disabled"
    && preferences?.globalUpscaleEnabled !== false
    && preferences?.autoUpscaleEnabled === true
  const nearbyEnabled = enabled && preferences?.preUpscaleEnabled !== false
  const progressiveEnabled = enabled && preferences?.progressiveEnabled === true
  const scheduleRevision = JSON.stringify({
    nearbyEnabled,
    progressiveEnabled,
    preloadPages: preferences?.preloadPages,
    backgroundConcurrency: preferences?.backgroundConcurrency,
    progressiveDwellTimeMs: preferences?.progressiveDwellTimeMs,
    progressiveMaxPages: preferences?.progressiveMaxPages,
  })
  const navigationRevision = preloadGeneration ?? currentPageIndex

  useEffect(() => {
    setSnapshots(EMPTY_SNAPSHOTS)
    setError(undefined)
    if (sessionId) clearReaderUpscalePreload(sessionId)
    return () => {
      if (sessionId) clearReaderUpscalePreload(sessionId)
    }
  }, [sessionId])

  useEffect(() => {
    if (enabled) return
    setSnapshots(EMPTY_SNAPSHOTS)
    setError(undefined)
    if (sessionId) clearReaderUpscalePreload(sessionId)
  }, [enabled, sessionId])

  useEffect(() => {
    if (!sessionId || !enabled || !client.startUpscalePreload) return
    let current = true
    const controller = new AbortController()
    const start = async () => {
      const modes: Array<"nearby" | "progressive"> = []
      if (nearbyEnabled) modes.push("nearby")
      if (progressiveEnabled) modes.push("progressive")
      for (const mode of modes) {
        if (!current) return
        // Keep admission ordering explicit: progressive work is submitted only
        // after the nearby/pre-upscale batch has been accepted by the backend.
        const next = await client.startUpscalePreload(sessionId, mode, controller.signal)
        if (!current) return
        const merged = mergeSnapshots(readerUpscalePreloadSnapshot(sessionId), next)
        setReaderUpscalePreload(sessionId, merged)
        setSnapshots(merged)
      }
    }
    const timer = setTimeout(() => {
      void start().catch((cause: unknown) => {
        if (current && !controller.signal.aborted) setError(errorMessage(cause))
      })
    }, SCHEDULE_DEBOUNCE_MS)
    return () => {
      current = false
      controller.abort()
      clearTimeout(timer)
    }
  }, [client, enabled, nearbyEnabled, navigationRevision, progressiveEnabled, scheduleRevision, sessionId])

  useEffect(() => {
    if (!sessionId || !enabled || !client.upscalePreloadSnapshots) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      try {
        const next = await client.upscalePreloadSnapshots!(sessionId, controller.signal)
        if (controller.signal.aborted) return
        setSnapshots(next)
        setReaderUpscalePreload(sessionId, next)
        setError(undefined)
        timer = setTimeout(refresh, hasActiveBatch(next) ? ACTIVE_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS)
      } catch (cause) {
        if (controller.signal.aborted) return
        setError(errorMessage(cause))
        timer = setTimeout(refresh, IDLE_POLL_INTERVAL_MS)
      }
    }
    void refresh()
    return () => {
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }, [client, enabled, sessionId])

  return { snapshots, error }
}

function mergeSnapshots(
  current: readonly ReaderUpscalePreloadSnapshotDto[],
  incoming: readonly ReaderUpscalePreloadSnapshotDto[],
): readonly ReaderUpscalePreloadSnapshotDto[] {
  const byMode = new Map(current.map((snapshot) => [snapshot.mode, snapshot]))
  for (const snapshot of incoming) byMode.set(snapshot.mode, snapshot)
  return [...byMode.values()].toSorted((left, right) => left.mode.localeCompare(right.mode))
}

function hasActiveBatch(snapshots: readonly ReaderUpscalePreloadSnapshotDto[]): boolean {
  return snapshots.some((snapshot) => snapshot.state === "queued" || snapshot.state === "countdown" || snapshot.state === "running")
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
