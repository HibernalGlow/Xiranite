import { useCallback, useEffect, useMemo, useRef } from "react"

import type { ReaderPageDto, ReaderPreloadEventDto } from "../../adapters/reader-http-client"
import { readerPreloadStatusStore } from "./ReaderPreloadStatusStore"

const MAX_PREDECODED_IMAGES = 1
const MAX_PREDECODED_PIXELS = 60_000_000
const MAX_CONCURRENT_PREDECODES = 1
const PREDECODE_START_DELAY_MS = 350
export const READER_PREFETCH_READY_MARK = "neoview-reader-prefetch-ready"

interface PreloadedImage {
  image: HTMLImageElement
  pageId: string
  pageIndex: number
  byteLength?: number
  generation?: number
  startedAt: number
  loadedAt?: number
  started: boolean
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
  enabled = true,
): ReaderImagePreloader {
  const imagesRef = useRef(new Map<string, PreloadedImage>())
  const queueRef = useRef<string[]>([])
  const activeRef = useRef(new Set<string>())
  const pumpRef = useRef<() => void>(() => undefined)
  const pumpTimerRef = useRef<ReturnType<typeof setTimeout>>()
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
      if (entry.started) report(entry, entry.terminal ? "evicted" : "cancelled", { activeLeases: Math.max(0, images.size - 1) })
      entry.terminal = true
      entry.image.src = ""
      images.delete(assetUrl)
      if (sessionId) readerPreloadStatusStore.evict(sessionId, entry.pageIndex)
    }
    queueRef.current = queueRef.current.filter((assetUrl) => images.has(assetUrl))
    if (!queueRef.current.length && pumpTimerRef.current !== undefined) {
      clearTimeout(pumpTimerRef.current)
      pumpTimerRef.current = undefined
    }
  }, [report, sessionId])

  const pump = useCallback(() => {
    const images = imagesRef.current
    const active = activeRef.current
    while (active.size < MAX_CONCURRENT_PREDECODES) {
      const assetUrl = queueRef.current.shift()
      if (!assetUrl) break
      const entry = images.get(assetUrl)
      if (!entry || entry.started || entry.terminal) continue
      const image = entry.image
      entry.started = true
      entry.startedAt = performance.now()
      active.add(assetUrl)
      image.onload = () => { entry.loadedAt = performance.now() }
      image.src = assetUrl
      if (sessionId) readerPreloadStatusStore.begin(sessionId, entry.pageIndex)
      report(entry, "started", { activeLeases: images.size })
      void image.decode().then(() => {
        if (images.get(assetUrl)?.image !== image || entry.terminal) return
        entry.terminal = true
        if (sessionId) readerPreloadStatusStore.ready(sessionId, entry.pageIndex)
        report(entry, "ready", preloadMetrics(entry, images.size))
        performance.mark(READER_PREFETCH_READY_MARK, { detail: entry.pageIndex })
      }).catch(() => {
        if (images.get(assetUrl)?.image !== image || entry.terminal) return
        entry.terminal = true
        if (sessionId) readerPreloadStatusStore.fail(sessionId, entry.pageIndex)
        report(entry, "failed", preloadMetrics(entry, images.size))
      }).finally(() => {
        active.delete(assetUrl)
        pumpRef.current()
      })
    }
  }, [report, sessionId])
  pumpRef.current = pump

  useEffect(() => {
    return () => {
      releaseRetained()
      if (sessionId) readerPreloadStatusStore.clear(sessionId)
      flushReports()
    }
  }, [flushReports, releaseRetained, sessionId])

  const preload = useCallback((pages: readonly ReaderPageDto[], generation?: number) => {
    if (!enabled || typeof Image === "undefined" || !sessionId) return
    const images = imagesRef.current
    const admitted = admitPredecodePages(pages)
    const admittedUrls = new Set(admitted.map((page) => page.assetUrl))
    releaseRetained(admittedUrls)
    for (const [pageOffset, page] of admitted.entries()) {
      const existing = images.get(page.assetUrl)
      if (existing) {
        if (pageOffset === 0 && !existing.started) {
          existing.image.fetchPriority = "high"
          queueRef.current = [page.assetUrl, ...queueRef.current.filter((assetUrl) => assetUrl !== page.assetUrl)]
        }
        continue
      }
      const image = new Image()
      const entry: PreloadedImage = {
        image,
        pageId: page.id,
        pageIndex: page.index,
        byteLength: page.byteLength,
        generation,
        startedAt: 0,
        started: false,
        terminal: false,
      }
      // Match PageImage's CORS request mode so Chromium can reuse the same
      // fetched and decoded image resource instead of loading the URL twice.
      image.crossOrigin = "anonymous"
      image.decoding = "async"
      image.loading = "eager"
      image.fetchPriority = pageOffset === 0 ? "high" : "low"
      images.set(page.assetUrl, entry)
      queueRef.current.push(page.assetUrl)
    }
    if (pumpTimerRef.current === undefined) {
      pumpTimerRef.current = setTimeout(() => {
        pumpTimerRef.current = undefined
        pump()
      }, PREDECODE_START_DELAY_MS)
    }
  }, [enabled, pump, releaseRetained, sessionId])

  const cancel = useCallback(() => {
    releaseRetained()
    if (sessionId) readerPreloadStatusStore.clear(sessionId)
  }, [releaseRetained, sessionId])

  // A freeze-triage flag can change during HMR or a host transition. Clear any
  // retained/queued work immediately when speculative predecode is disabled;
  // otherwise the old queue can keep running after the new render is safe.
  useEffect(() => {
    if (!enabled) cancel()
  }, [cancel, enabled])

  return useMemo(() => ({ preload, cancel, releaseRetained }), [cancel, preload, releaseRetained])
}

function admitPredecodePages(pages: readonly ReaderPageDto[]): ReaderPageDto[] {
  const admitted: ReaderPageDto[] = []
  let pixels = 0
  for (const page of pages) {
    if (page.mediaKind !== "image") continue
    if (admitted.length >= MAX_PREDECODED_IMAGES) break
    const pagePixels = estimatedDecodedPixels(page)
    if (admitted.length > 0 && pagePixels > 0 && pixels + pagePixels > MAX_PREDECODED_PIXELS) break
    admitted.push(page)
    pixels += pagePixels
  }
  return admitted
}

function estimatedDecodedPixels(page: ReaderPageDto): number {
  if (!page.dimensions) return 0
  const sourcePixels = page.dimensions.width * page.dimensions.height
  return sourcePixels
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
