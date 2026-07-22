import pMap from "p-map"
import { useCallback, useEffect, useMemo, useRef } from "react"

import type { ReaderPageDto, ReaderPreloadEventDto } from "../../adapters/reader-http-client"
import { readerPreloadStatusStore } from "./ReaderPreloadStatusStore"

const PREDECODE_START_DELAY_MS = 350
export const READER_PREFETCH_READY_MARK = "neoview-reader-prefetch-ready"

export interface ReaderPredecodeDeviceHints {
  deviceMemoryGb?: number
  hardwareConcurrency?: number
  effectiveConnectionType?: string
  saveData?: boolean
}

export interface ReaderPredecodePolicy {
  concurrency: 1 | 2
  maxRetainedImages: 1 | 2
  maxEstimatedPixels: number
}

interface PreloadedImage {
  image: HTMLImageElement
  assetUrl: string
  pageId: string
  pageIndex: number
  byteLength?: number
  generation?: number
  startedAt: number
  loadedAt?: number
  started: boolean
  scheduled: boolean
  terminal: boolean
  completion?: Promise<void>
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
  const batchTailRef = useRef<Promise<void>>(Promise.resolve())
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
    if (!images.size && pumpTimerRef.current !== undefined) {
      clearTimeout(pumpTimerRef.current)
      pumpTimerRef.current = undefined
    }
  }, [report, sessionId])

  useEffect(() => {
    return () => {
      releaseRetained()
      if (sessionId) readerPreloadStatusStore.clear(sessionId)
      flushReports()
    }
  }, [flushReports, releaseRetained, sessionId])

  const preload = useCallback((pages: readonly ReaderPageDto[], generation?: number) => {
    if (typeof Image === "undefined" || !sessionId) return
    const images = imagesRef.current
    const policy = resolveReaderPredecodePolicy(browserPredecodeDeviceHints())
    const admitted = admitPredecodePages(pages, policy)
    const admittedUrls = new Set(admitted.map((page) => page.assetUrl))
    releaseRetained(admittedUrls)
    const pending: PreloadedImage[] = []
    for (const [pageOffset, page] of admitted.entries()) {
      const existing = images.get(page.assetUrl)
      if (existing) {
        if (pageOffset === 0 && !existing.started) existing.image.fetchPriority = "high"
        continue
      }
      const image = new Image()
      const entry: PreloadedImage = {
        image,
        assetUrl: page.assetUrl,
        pageId: page.id,
        pageIndex: page.index,
        byteLength: page.byteLength,
        generation,
        startedAt: 0,
        started: false,
        scheduled: false,
        terminal: false,
      }
      // Match PageImage's CORS request mode so Chromium can reuse the same
      // fetched and decoded image resource instead of loading the URL twice.
      image.crossOrigin = "anonymous"
      image.decoding = "async"
      image.loading = "eager"
      image.fetchPriority = pageOffset === 0 ? "high" : "low"
      images.set(page.assetUrl, entry)
    }
    for (const page of admitted) {
      const entry = images.get(page.assetUrl)
      if (entry && !entry.started && !entry.scheduled) pending.push(entry)
    }
    if (pumpTimerRef.current !== undefined) clearTimeout(pumpTimerRef.current)
    if (pending.length) {
      pumpTimerRef.current = setTimeout(() => {
        pumpTimerRef.current = undefined
        pending.forEach((entry) => { entry.scheduled = true })
        const completion = batchTailRef.current.then(async () => pMap(pending, async (entry) => {
          const { assetUrl } = entry
          if (entry.terminal || images.get(assetUrl) !== entry) return
          const image = entry.image
          entry.started = true
          entry.startedAt = performance.now()
          image.onload = () => { entry.loadedAt = performance.now() }
          image.src = assetUrl
          readerPreloadStatusStore.begin(sessionId, entry.pageIndex)
          report(entry, "started", { activeLeases: images.size })
          try {
            await image.decode()
            if (images.get(assetUrl)?.image !== image || entry.terminal) return
            entry.terminal = true
            readerPreloadStatusStore.ready(sessionId, entry.pageIndex)
            report(entry, "ready", preloadMetrics(entry, images.size))
            performance.mark(READER_PREFETCH_READY_MARK, { detail: entry.pageIndex })
          } catch {
            if (images.get(assetUrl)?.image !== image || entry.terminal) return
            entry.terminal = true
            readerPreloadStatusStore.fail(sessionId, entry.pageIndex)
            report(entry, "failed", preloadMetrics(entry, images.size))
          }
        }, { concurrency: policy.concurrency })).then(() => undefined).catch(() => undefined)
        batchTailRef.current = completion
        pending.forEach((entry) => { entry.completion = completion })
      }, PREDECODE_START_DELAY_MS)
    }
  }, [releaseRetained, report, sessionId])

  const cancel = useCallback(() => {
    releaseRetained()
    if (sessionId) readerPreloadStatusStore.clear(sessionId)
  }, [releaseRetained, sessionId])

  return useMemo(() => ({ preload, cancel, releaseRetained }), [cancel, preload, releaseRetained])
}

function admitPredecodePages(pages: readonly ReaderPageDto[], policy: ReaderPredecodePolicy): ReaderPageDto[] {
  const admitted: ReaderPageDto[] = []
  let pixels = 0
  for (const page of pages) {
    if (page.mediaKind !== "image") continue
    if (admitted.length >= policy.maxRetainedImages) break
    const pagePixels = estimatedDecodedPixels(page)
    if (admitted.length > 0 && pagePixels > 0 && pixels + pagePixels > policy.maxEstimatedPixels) break
    admitted.push(page)
    pixels += pagePixels
  }
  return admitted
}

export function resolveReaderPredecodePolicy(hints: ReaderPredecodeDeviceHints): ReaderPredecodePolicy {
  const constrainedNetwork = hints.saveData === true || hints.effectiveConnectionType === "slow-2g" || hints.effectiveConnectionType === "2g"
  const capableDevice = (hints.deviceMemoryGb ?? 4) >= 8 && (hints.hardwareConcurrency ?? 4) >= 8
  if (constrainedNetwork) return { concurrency: 1, maxRetainedImages: 1, maxEstimatedPixels: 12_000_000 }
  if (capableDevice) return { concurrency: 2, maxRetainedImages: 2, maxEstimatedPixels: 32_000_000 }
  return { concurrency: 1, maxRetainedImages: 1, maxEstimatedPixels: 20_000_000 }
}

function browserPredecodeDeviceHints(): ReaderPredecodeDeviceHints {
  if (typeof navigator === "undefined") return {}
  const browser = navigator as Navigator & {
    deviceMemory?: number
    connection?: { effectiveType?: string; saveData?: boolean }
  }
  return {
    deviceMemoryGb: browser.deviceMemory,
    hardwareConcurrency: browser.hardwareConcurrency,
    effectiveConnectionType: browser.connection?.effectiveType,
    saveData: browser.connection?.saveData,
  }
}

function estimatedDecodedPixels(page: ReaderPageDto): number {
  if (!page.dimensions) return 0
  const sourcePixels = page.dimensions.width * page.dimensions.height
  return page.contentVersion.includes(":upscale:") ? sourcePixels * 4 : sourcePixels
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
