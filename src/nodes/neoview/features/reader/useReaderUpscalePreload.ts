import { useEffect, useRef, useState } from "react"

import { createLogger } from "@/lib/logger"
import type {
  ReaderHttpClient,
  ReaderSuperResolutionConfigDto,
  ReaderUpscalePreloadSnapshotDto,
} from "../../adapters/reader-http-client"
import { clearReaderUpscalePreload, readerUpscalePreloadSnapshot, setReaderUpscalePreload } from "./ReaderUpscalePreloadStore"
import { clearReaderUpscaleCoverage, updateReaderUpscaleCoverage } from "./ReaderUpscaleCoverageStore"

const ACTIVE_POLL_INTERVAL_MS = 750
const IDLE_POLL_INTERVAL_MS = 2_000
const SCHEDULE_DEBOUNCE_MS = 200
const EMPTY_SNAPSHOTS: readonly ReaderUpscalePreloadSnapshotDto[] = Object.freeze([])
const logger = createLogger("neoview.super-resolution")

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
  const loggedEventIds = useRef(new Set<string>())
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
  // Browser image preloading advances its generation for decode and retention
  // bookkeeping even when the visible page is unchanged. Treating that value
  // as navigation repeatedly cancels the nearby super-resolution batch.
  const navigationRevision = currentPageIndex

  useEffect(() => {
    setSnapshots(EMPTY_SNAPSHOTS)
    setError(undefined)
    loggedEventIds.current.clear()
    if (sessionId) clearReaderUpscalePreload(sessionId)
    if (sessionId) clearReaderUpscaleCoverage(sessionId)
    return () => {
      if (sessionId) clearReaderUpscalePreload(sessionId)
      if (sessionId) clearReaderUpscaleCoverage(sessionId)
    }
  }, [sessionId])

  useEffect(() => {
    for (const snapshot of snapshots) {
      for (const event of snapshot.events ?? []) {
        if (loggedEventIds.current.has(event.id)) continue
        loggedEventIds.current.add(event.id)
        const attributes = { eventId: event.id, mode: snapshot.mode, pageIndex: event.pageIndex, generation: snapshot.generation }
        if (event.level === "error") logger.error(event.message, attributes)
        else if (event.level === "success") logger.info(event.message, attributes)
        else logger.info(event.message, attributes)
      }
    }
    if (loggedEventIds.current.size > 512) loggedEventIds.current = new Set([...loggedEventIds.current].slice(-256))
  }, [snapshots])

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
        logger.info("Accepted reader super-resolution preload", {
          sessionId,
          mode,
          currentPageIndex,
          generation: preloadGeneration,
          preloadPages: preferences?.preloadPages,
          snapshots: next.map((snapshot) => ({
            state: snapshot.state,
            planned: snapshot.planned,
            pending: snapshot.pending,
            failed: snapshot.failed,
          })),
        })
        const merged = mergeSnapshots(readerUpscalePreloadSnapshot(sessionId), next)
        updateReaderUpscaleCoverage(sessionId, merged)
        setReaderUpscalePreload(sessionId, merged)
        setSnapshots(merged)
      }
    }
    const timer = setTimeout(() => {
      void start().catch((cause: unknown) => {
        if (current && !controller.signal.aborted) {
          const message = errorMessage(cause)
          logger.error("Reader super-resolution preload request failed", cause, {
            sessionId,
            currentPageIndex,
            generation: preloadGeneration,
            nearbyEnabled,
            progressiveEnabled,
            preloadPages: preferences?.preloadPages,
          })
          setError(message)
        }
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
        updateReaderUpscaleCoverage(sessionId, next)
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
