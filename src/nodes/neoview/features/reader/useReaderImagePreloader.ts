import { useCallback, useEffect, useMemo, useRef } from "react"

import type { ReaderPageDto, ReaderPreloadEventDto } from "../../adapters/reader-http-client"
import { readerPreloadStatusStore } from "./ReaderPreloadStatusStore"

const MAX_PREDECODED_IMAGES = 4
export const READER_PREFETCH_READY_MARK = "neoview-reader-prefetch-ready"

interface PreloadedImage {
  image: HTMLImageElement
  pageId: string
  pageIndex: number
  byteLength?: number
  generation?: number
  startedAt: number
  loadedAt?: number
  terminal: boolean
}

export interface ReaderImagePreloader {
  preload(pages: readonly ReaderPageDto[], generation?: number): void
  cancel(): void
  releaseRetained(preserveAssetUrls?: ReadonlySet<string>): void
}

export function useReaderImagePreloader(
  sessionId?: string,
  reportEvents?: (sessionId: string, generation: number, events: readonly ReaderPreloadEventDto[]) => void,
): ReaderImagePreloader {
  const imagesRef = useRef(new Map<string, PreloadedImage>())
  const reportEventsRef = useRef(reportEvents)
  const pendingReportsRef = useRef(new Map<string, { sessionId: string; generation: number; events: ReaderPreloadEventDto[] }>())
  const reportTimerRef = useRef<ReturnType<typeof setTimeout>>()
  reportEventsRef.current = reportEvents

  const flushReports = useCallback(() => {
    if (reportTimerRef.current !== undefined) clearTimeout(reportTimerRef.current)
    reportTimerRef.current = undefined
    const pending = pendingReportsRef.current
    pendingReportsRef.current = new Map()
    for (const batch of pending.values()) {
      for (let index = 0; index < batch.events.length; index += 64) {
        reportEventsRef.current?.(batch.sessionId, batch.generation, batch.events.slice(index, index + 64))
      }
    }
  }, [])

  const report = useCallback((entry: PreloadedImage, outcome: ReaderPreloadEventDto["outcome"], metrics?: ReaderPreloadEventDto["metrics"]) => {
    if (!sessionId || entry.generation === undefined) return
    const key = `${sessionId}\0${entry.generation}`
    let batch = pendingReportsRef.current.get(key)
    if (!batch) {
      batch = { sessionId, generation: entry.generation, events: [] }
      pendingReportsRef.current.set(key, batch)
    }
    batch.events.push({ pageId: entry.pageId, outcome, metrics })
    reportTimerRef.current ??= setTimeout(flushReports, 50)
  }, [flushReports, sessionId])

  const releaseRetained = useCallback((preserveAssetUrls: ReadonlySet<string> = new Set()) => {
    const images = imagesRef.current
    for (const [assetUrl, entry] of images) {
      if (preserveAssetUrls.has(assetUrl)) continue
      report(entry, entry.terminal ? "evicted" : "cancelled", { activeLeases: Math.max(0, images.size - 1) })
      entry.terminal = true
      entry.image.src = ""
      images.delete(assetUrl)
      if (sessionId) readerPreloadStatusStore.evict(sessionId, entry.pageIndex)
    }
  }, [report, sessionId])

  useEffect(() => {
    const images = imagesRef.current
    return () => {
      releaseRetained()
      if (sessionId) readerPreloadStatusStore.clear(sessionId)
      flushReports()
    }
  }, [flushReports, releaseRetained, sessionId])

  const preload = useCallback((pages: readonly ReaderPageDto[], generation?: number) => {
    if (typeof Image === "undefined" || !sessionId) return
    const images = imagesRef.current
    for (const page of pages) {
      if (page.mediaKind !== "image" || images.has(page.assetUrl)) continue
      const image = new Image()
      const entry: PreloadedImage = {
        image,
        pageId: page.id,
        pageIndex: page.index,
        byteLength: page.byteLength,
        generation,
        startedAt: performance.now(),
        terminal: false,
      }
      image.decoding = "async"
      image.fetchPriority = "low"
      image.onload = () => { entry.loadedAt = performance.now() }
      image.src = page.assetUrl
      images.set(page.assetUrl, entry)
      readerPreloadStatusStore.begin(sessionId, page.index)
      report(entry, "started", { activeLeases: images.size })
      void image.decode().then(() => {
        if (images.get(page.assetUrl)?.image !== image) return
        entry.terminal = true
        readerPreloadStatusStore.ready(sessionId, page.index)
        report(entry, "ready", preloadMetrics(entry, images.size))
        performance.mark(READER_PREFETCH_READY_MARK, { detail: page.index })
      }).catch(() => {
        if (images.get(page.assetUrl)?.image === image) {
          entry.terminal = true
          readerPreloadStatusStore.fail(sessionId, page.index)
          report(entry, "failed", preloadMetrics(entry, images.size))
        }
      })
    }
    while (images.size > MAX_PREDECODED_IMAGES) {
      const oldestUrl = images.keys().next().value
      if (!oldestUrl) break
      const oldest = images.get(oldestUrl)
      images.delete(oldestUrl)
      if (oldest) {
        report(oldest, oldest.terminal ? "evicted" : "cancelled", { activeLeases: Math.max(0, images.size) })
        oldest.terminal = true
        oldest.image.src = ""
        readerPreloadStatusStore.evict(sessionId, oldest.pageIndex)
      }
    }
  }, [report, sessionId])

  const cancel = useCallback(() => {
    releaseRetained()
    if (sessionId) readerPreloadStatusStore.clear(sessionId)
  }, [releaseRetained, sessionId])

  return useMemo(() => ({ preload, cancel, releaseRetained }), [cancel, preload, releaseRetained])
}

function preloadMetrics(entry: PreloadedImage, activeLeases: number): ReaderPreloadEventDto["metrics"] {
  const finishedAt = performance.now()
  const timing = performance.getEntriesByName(entry.image.src, "resource").at(-1) as PerformanceResourceTiming | undefined
  const decodedBytes = entry.image.naturalWidth > 0 && entry.image.naturalHeight > 0
    ? Math.min(Number.MAX_SAFE_INTEGER, entry.image.naturalWidth * entry.image.naturalHeight * 4)
    : entry.byteLength
  return {
    ...(timing && timing.responseStart >= timing.startTime
      ? { ttfbMs: boundedDuration(timing.responseStart - timing.startTime) }
      : {}),
    decodeMs: boundedDuration(finishedAt - (entry.loadedAt ?? entry.startedAt)),
    ...(decodedBytes !== undefined ? { retainedBytes: Math.max(0, Math.trunc(decodedBytes)) } : {}),
    activeLeases,
  }
}

function boundedDuration(value: number): number {
  return Math.min(10 * 60_000, Math.max(0, value))
}
