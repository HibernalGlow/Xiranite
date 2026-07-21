import { startTransition, useCallback, useEffect, useRef, useState } from "react"
import { Virtuoso, type ListRange, type VirtuosoHandle } from "react-virtuoso"
import {
  calculateReaderFrameSize,
  calculateReaderScale,
  calculateReaderPageStretchScales,
  effectiveReaderRotation,
  rotatePresentationSize,
  type FrameSnapshot,
  type ReaderPresentation,
} from "@xiranite/node-neoview/ui-core"

import type { ReaderHttpClient, ReaderMediaConfigDto, ReaderPageDto, ReaderSubtitleConfigDto, ReaderSuperResolutionConfigDto } from "../../adapters/reader-http-client"
import type { ReaderColorFilterPort } from "../color-filter/ReaderColorFilterStore"
import type { ReaderImageTrimPort } from "../image-trim/ReaderImageTrimStore"
import type { ReaderVideoController } from "../video/ReaderVideoController"
import { PageMedia } from "./PageMedia"
import { useReaderHoverScroll } from "./useReaderHoverScroll"

const PAGE_LIST_BATCH_SIZE = 32
const FRAME_WINDOW_BATCH_SIZE = 16

export function ReaderPanoramaFrame({
  sessionId,
  totalPages,
  anchorPageIndex,
  direction,
  pageMode,
  doublePageGap = 0,
  currentPages,
  presentation,
  hoverScrollEnabled = false,
  hoverScrollSpeed = 2,
  colorFilter,
  imageTrim,
  videoController,
  client,
  media,
  superResolution,
  onSubtitleConfigChange,
  onVideoListEnded,
  onVisiblePageChange,
}: {
  sessionId: string
  totalPages: number
  anchorPageIndex: number
  direction: "left-to-right" | "right-to-left"
  pageMode: "single" | "double"
  doublePageGap?: number
  currentPages: readonly ReaderPageDto[]
  presentation: ReaderPresentation
  hoverScrollEnabled?: boolean
  hoverScrollSpeed?: number
  colorFilter?: ReaderColorFilterPort
  imageTrim?: ReaderImageTrimPort
  videoController: ReaderVideoController
  client: ReaderHttpClient
  media?: ReaderMediaConfigDto
  superResolution?: ReaderSuperResolutionConfigDto
  onSubtitleConfigChange(patch: Partial<ReaderSubtitleConfigDto>): Promise<void>
  onVideoListEnded(): void
  onVisiblePageChange?(pageIndex: number): void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLElement>(null)
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const requestsRef = useRef(new Map<number, AbortController>())
  const pagesRef = useRef(new Map(currentPages.map((page) => [page.index, page])))
  const [frames, setFrames] = useState(() => new Map<number, FrameSnapshot>())
  const [pages, setPages] = useState(() => new Map(currentPages.map((page) => [page.index, page])))
  const [viewport, setViewport] = useState({ width: 1, height: 1 })
  const [imageTrimDetectionPageIndex, setImageTrimDetectionPageIndex] = useState(anchorPageIndex)
  const lastVisiblePageRef = useRef<number>(anchorPageIndex)
  const syncTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const pagesPerUnit = pageMode === "double" ? 2 : 1
  const unitCount = Math.ceil(totalPages / pagesPerUnit)
  const setScrollerRef = useCallback((element: HTMLElement | Window | null) => {
    scrollerRef.current = element instanceof HTMLElement ? element : null
  }, [])
  useReaderHoverScroll(scrollerRef, {
    enabled: hoverScrollEnabled,
    speed: hoverScrollSpeed,
    pageKey: `${sessionId}:${anchorPageIndex}:${presentation.orientation}:${pageMode}:${direction}`,
  })

  useEffect(() => () => abortRequests(requestsRef.current), [])

  useEffect(() => {
    if (!currentPages.length) return
    startTransition(() => setPages((current) => {
      const next = new Map(current)
      for (const page of currentPages) next.set(page.index, page)
      pagesRef.current = next
      return next
    }))
  }, [currentPages])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const update = () => setViewport((current) => {
      const next = { width: Math.max(1, host.clientWidth), height: Math.max(1, host.clientHeight) }
      return current.width === next.width && current.height === next.height ? current : next
    })
    update()
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update)
    observer?.observe(host)
    return () => observer?.disconnect()
  }, [])

  useEffect(() => {
    virtuosoRef.current?.scrollToIndex({ index: Math.min(Math.floor(anchorPageIndex / pagesPerUnit), Math.max(0, unitCount - 1)), align: "center" })
    setImageTrimDetectionPageIndex(anchorPageIndex)
  }, [anchorPageIndex, pagesPerUnit, unitCount])

  useEffect(() => () => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
  }, [])

  function loadRange(range: ListRange) {
    const batchSize = client.frameWindow ? FRAME_WINDOW_BATCH_SIZE : PAGE_LIST_BATCH_SIZE
    const firstPage = range.startIndex * pagesPerUnit
    const lastPage = Math.min(totalPages - 1, (range.endIndex + 1) * pagesPerUnit - 1)
    const firstBatch = Math.floor(firstPage / batchSize) * batchSize
    const lastBatch = Math.floor(lastPage / batchSize) * batchSize
    for (let cursor = firstBatch; cursor <= lastBatch; cursor += batchSize) {
      const limit = Math.min(batchSize, totalPages - cursor)
      if (limit <= 0 || batchLoaded(pagesRef.current, cursor, limit) || requestsRef.current.has(cursor)) continue
      const controller = new AbortController()
      requestsRef.current.set(cursor, controller)
      const load = client.frameWindow
        ? client.frameWindow(sessionId, Math.min(totalPages - 1, cursor + Math.floor(limit / 2)), Math.min(8, Math.ceil(limit / 2)), controller.signal).then((result) => ({ pages: result.visiblePages, frames: result.frames }))
        : client.listPages(sessionId, cursor, limit, controller.signal).then((result) => ({ pages: result.pages, frames: [] as FrameSnapshot[] }))
      void load.then((result) => {
        if (controller.signal.aborted) return
        startTransition(() => setPages((current) => {
          const next = new Map(current)
          for (const page of result.pages) next.set(page.index, page)
          pagesRef.current = next
          return next
        }))
        if (result.frames.length) startTransition(() => setFrames((current) => {
          const next = new Map(current)
          for (const frame of result.frames) {
            next.set(frame.anchorPageIndex, frame)
            for (const page of frame.pages) next.set(page.pageIndex, frame)
          }
          return next
        }))
      }).catch(() => undefined).finally(() => {
        if (requestsRef.current.get(cursor) === controller) requestsRef.current.delete(cursor)
      })
    }

    const centerUnit = Math.round((range.startIndex + range.endIndex) / 2)
    const visiblePageIndex = Math.min(totalPages - 1, centerUnit * pagesPerUnit)
    if (visiblePageIndex !== lastVisiblePageRef.current) {
      lastVisiblePageRef.current = visiblePageIndex
      startTransition(() => setImageTrimDetectionPageIndex(visiblePageIndex))
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
      syncTimerRef.current = setTimeout(() => onVisiblePageChange?.(visiblePageIndex), 48)
    }
  }

  return (
    <div ref={hostRef} dir={direction === "right-to-left" ? "rtl" : "ltr"} className="h-full min-h-0 w-full" data-reader-panorama="true" data-reader-orientation={presentation.orientation} data-reader-page-mode={pageMode} data-reader-hover-scroll={hoverScrollEnabled ? "enabled" : "disabled"} data-reader-hover-scroll-speed={hoverScrollSpeed}>
      <Virtuoso
        ref={virtuosoRef}
        scrollerRef={setScrollerRef}
        key={`${sessionId}:${presentation.orientation}:${pageMode}:${direction}`}
        style={{ height: "100%", width: "100%" }}
        totalCount={unitCount}
        horizontalDirection={presentation.orientation === "horizontal"}
        initialTopMostItemIndex={anchorPageIndex > 0 ? { index: Math.min(Math.floor(anchorPageIndex / pagesPerUnit), Math.max(0, unitCount - 1)), align: "center" } : undefined}
        increaseViewportBy={{ top: 600, bottom: 600 }}
        rangeChanged={loadRange}
        computeItemKey={(index) => pages.get(index * pagesPerUnit)?.id ?? `panorama-unit-${index}`}
        itemContent={(index) => {
          const firstPageIndex = index * pagesPerUnit
          const canonicalFrame = frames.get(firstPageIndex)
          const fallbackPages = Array.from({ length: pagesPerUnit }, (_, offset) => pages.get(firstPageIndex + offset))
          const unitPages = (canonicalFrame
            ? canonicalFrame.pages.map((framePage) => pages.get(framePage.pageIndex))
            : direction === "right-to-left" ? fallbackPages.toReversed() : fallbackPages)
            .filter((page): page is ReaderPageDto => Boolean(page))
          if (!unitPages.length) return <div className="grid h-full min-h-48 min-w-48 place-items-center bg-black text-xs text-white/35" data-panorama-placeholder={index}>{index * pagesPerUnit + 1}</div>
          const renderedPages = unitPages
          const dimensions = renderedPages.flatMap((page) => page.dimensions ? [page.dimensions] : [])
          const frameSize = dimensions.length === unitPages.length
            ? calculateReaderFrameSize(dimensions, presentation.rotation, "horizontal", presentation.autoRotation, presentation.widePageStretch)
            : undefined
          const gap = renderedPages.length > 1 ? doublePageGap * (renderedPages.length - 1) : 0
          const available = { width: Math.max(1, viewport.width - 8 - gap), height: Math.max(1, viewport.height - 8) }
          const scale = frameSize ? calculateReaderScale(presentation.fitMode, frameSize, available, presentation.manualScale) : undefined
          const rotatedDimensions = dimensions.map((dimension) => rotatePresentationSize(dimension, effectiveReaderRotation(presentation.rotation, presentation.autoRotation, dimension)))
          const stretchScales = calculateReaderPageStretchScales(rotatedDimensions, presentation.widePageStretch)
          const width = frameSize && scale ? frameSize.width * scale + gap : available.width
          const height = frameSize && scale ? frameSize.height * scale : available.height
          const unit = <div className="flex shrink-0 items-center justify-center bg-black p-1" style={{ width, height, flexDirection: "row" }} data-panorama-unit={index} data-reader-double-page-gap={renderedPages.length > 1 ? doublePageGap : undefined}>
            {renderedPages.map((page, slotIndex) => <div key={page.id} className="flex shrink-0" data-reader-page-slot={slotIndex} style={slotIndex > 0 ? { marginInlineStart: doublePageGap } : undefined}><PageMedia page={page} rotation={page.dimensions ? effectiveReaderRotation(presentation.rotation, presentation.autoRotation, page.dimensions) : presentation.rotation} scale={scale === undefined ? undefined : scale * (stretchScales[slotIndex] ?? 1)} fallbackSize={available} colorFilter={colorFilter} imageTrim={imageTrim} imageTrimDetectionActive={page.index === imageTrimDetectionPageIndex} videoController={videoController} sessionId={sessionId} client={client} media={media} superResolution={superResolution} onSubtitleConfigChange={onSubtitleConfigChange} onVideoListEnded={onVideoListEnded} /></div>)}
          </div>
          return presentation.orientation === "vertical"
            ? <div className="flex w-full justify-center" data-panorama-unit-wrapper={index}>{unit}</div>
            : unit
        }}
      />
    </div>
  )
}

function batchLoaded(pages: ReadonlyMap<number, ReaderPageDto>, cursor: number, limit: number): boolean {
  for (let index = cursor; index < cursor + limit; index += 1) if (!pages.has(index)) return false
  return true
}

function abortRequests(requests: Map<number, AbortController>) {
  for (const controller of requests.values()) controller.abort()
  requests.clear()
}
