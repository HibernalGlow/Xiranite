import { startTransition, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { Grid3X3, Hash, Pin, PinOff, Sparkles, Target } from "lucide-react"

import { Button } from "@/components/ui/button"
import { RangeInput } from "@/components/ui/range-input"
import { cn } from "@/lib/utils"
import type { ReaderHttpClient, ReaderPageDto } from "../../adapters/reader-http-client"
import { ReaderViewerToggleStore, type ReaderViewerTogglePort } from "../viewer/ReaderViewerToggleStore"
import { ReaderThumbnailSurface } from "./ReaderThumbnailSurface"

const BATCH_SIZE = 64
const ITEM_SIZE = 92
const OVERSCAN = 4
const INITIAL_ITEMS = 16

export interface ThumbnailStripProps {
  sessionId: string
  totalPages: number
  activePageIndex: number
  direction?: "left-to-right" | "right-to-left"
  currentPages: readonly ReaderPageDto[]
  client: ReaderHttpClient
  compact: boolean
  disabled?: boolean
  pinned?: boolean
  onPinnedChange?(pinned: boolean): void
  viewerToggles?: ReaderViewerTogglePort
  onSelect(pageIndex: number): void | Promise<void>
}

interface RenderWindow {
  start: number
  end: number
}

export function ThumbnailStrip({
  sessionId,
  totalPages,
  activePageIndex,
  direction = "left-to-right",
  currentPages,
  client,
  compact,
  disabled = false,
  pinned = false,
  onPinnedChange,
  viewerToggles,
  onSelect,
}: ThumbnailStripProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<number | undefined>(undefined)
  const pagesRef = useRef(new Map<number, ReaderPageDto>())
  const requestsRef = useRef(new Map<number, AbortController>())
  const [pages, setPages] = useState(() => new Map<number, ReaderPageDto>())
  const [showAreaGuide, setShowAreaGuide] = useState(false)
  const [showEdgeGuide, setShowEdgeGuide] = useState(false)
  const [fallbackViewerToggles] = useState(() => new ReaderViewerToggleStore())
  const toggleStore = viewerToggles ?? fallbackViewerToggles
  const { progressBarVisible, progressBarGlow, pageInfoVisible } = useSyncExternalStore(
    toggleStore.subscribe,
    toggleStore.getSnapshot,
    toggleStore.getSnapshot,
  )
  const [renderWindow, setRenderWindow] = useState<RenderWindow>(() => initialPageWindow(totalPages, activePageIndex))

  useEffect(() => {
    abortRequests(requestsRef.current)
    const initial = new Map<number, ReaderPageDto>()
    pagesRef.current = initial
    setPages(initial)
    setRenderWindow(initialPageWindow(totalPages, activePageIndex))
    return () => abortRequests(requestsRef.current)
  }, [sessionId, totalPages])

  useEffect(() => {
    if (!currentPages.length) return
    setPages((existing) => {
      const next = new Map(existing)
      for (const page of currentPages) next.set(page.index, page)
      pagesRef.current = next
      return next
    })
  }, [currentPages])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const update = () => {
      frameRef.current = undefined
      const next = calculateWindow(viewport, totalPages, direction)
      startTransition(() => setRenderWindow((current) => sameWindow(current, next) ? current : next))
    }
    const schedule = () => {
      if (frameRef.current !== undefined) return
      frameRef.current = requestAnimationFrame(update)
    }
    viewport.addEventListener("scroll", schedule, { passive: true })
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule)
    observer?.observe(viewport)
    update()
    return () => {
      viewport.removeEventListener("scroll", schedule)
      observer?.disconnect()
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current)
    }
  }, [direction, totalPages])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const left = visualPagePosition(activePageIndex, totalPages, direction) * ITEM_SIZE
    const right = left + ITEM_SIZE
    if (left < viewport.scrollLeft || right > viewport.scrollLeft + viewport.clientWidth) {
      viewport.scrollLeft = Math.max(0, left - Math.max(0, viewport.clientWidth - ITEM_SIZE) / 2)
      const next = calculateWindow(viewport, totalPages, direction)
      setRenderWindow((current) => sameWindow(current, next) ? current : next)
    }
  }, [activePageIndex, direction, totalPages])

  useEffect(() => {
    const firstBatch = Math.floor(renderWindow.start / BATCH_SIZE) * BATCH_SIZE
    const lastBatch = Math.ceil(renderWindow.end / BATCH_SIZE) * BATCH_SIZE
    for (let cursor = firstBatch; cursor < Math.min(totalPages, lastBatch); cursor += BATCH_SIZE) {
      const limit = Math.min(BATCH_SIZE, totalPages - cursor)
      if (batchLoaded(pagesRef.current, cursor, limit) || requestsRef.current.has(cursor)) continue
      const controller = new AbortController()
      requestsRef.current.set(cursor, controller)
      void client.listPages(sessionId, cursor, limit, controller.signal).then((result) => {
        if (controller.signal.aborted) return
        setPages((existing) => {
          const next = new Map(existing)
          for (const page of result.pages) next.set(page.index, page)
          pagesRef.current = next
          return next
        })
      }).catch(() => undefined).finally(() => {
        if (requestsRef.current.get(cursor) === controller) requestsRef.current.delete(cursor)
      })
    }
  }, [client, renderWindow.end, renderWindow.start, sessionId, totalPages])

  const items: React.ReactNode[] = []
  for (let offset = 0; offset < renderWindow.end - renderWindow.start; offset += 1) {
    const index = direction === "right-to-left" ? renderWindow.end - 1 - offset : renderWindow.start + offset
    items.push(
      <ThumbnailTile
        key={pages.get(index)?.id ?? `placeholder-${index}`}
        index={index}
        page={pages.get(index)}
        active={index === activePageIndex}
        visualPosition={visualPagePosition(index, totalPages, direction)}
        showPageNumber={pageInfoVisible}
        disabled={disabled}
        onSelect={onSelect}
      />,
    )
  }

  return (
    <div className="relative min-w-0 max-w-full overflow-x-clip" data-reader-bottom-bar="true">
      <div className="flex min-h-10 items-center justify-center gap-1.5 border-b border-border/45 px-2 py-1" data-reader-bottom-controls="true">
        <Button type="button" size="sm" variant={pinned ? "default" : "ghost"} aria-label={pinned ? "取消钉住底栏" : "钉住底栏"} aria-pressed={pinned} disabled={!onPinnedChange} onClick={() => onPinnedChange?.(!pinned)}>
          {pinned ? <Pin /> : <PinOff />}<span className="text-xs">{pinned ? "已钉住" : "钉住"}</span>
        </Button>
        <Button type="button" size="sm" variant={pageInfoVisible ? "default" : "ghost"} aria-label="显示页码" aria-pressed={pageInfoVisible} onClick={() => toggleStore.togglePageInfo()}><Hash /><span className="text-xs">页码</span></Button>
        <Button type="button" size="sm" variant={showAreaGuide ? "default" : "ghost"} aria-label="显示区域参考线" aria-pressed={showAreaGuide} onClick={() => setShowAreaGuide((value) => !value)}><Grid3X3 /><span className="text-xs">区域</span></Button>
        <Button type="button" size="sm" variant={showEdgeGuide ? "default" : "ghost"} aria-label="显示边栏触发区" aria-pressed={showEdgeGuide} onClick={() => setShowEdgeGuide((value) => !value)}><Target /><span className="text-xs">边栏</span></Button>
        <Button type="button" size="sm" variant={progressBarGlow ? "default" : "ghost"} aria-label="进度条荧光" aria-pressed={progressBarGlow} onClick={() => toggleStore.toggleProgressBarGlow()}><Sparkles /><span className="text-xs">荧光</span></Button>
      </div>
      <div
        ref={viewportRef}
        aria-label="页面缩略图"
        className={cn(
          "relative max-w-full shrink-0 scale-y-[-1] overflow-x-auto overflow-y-hidden overscroll-x-contain bg-muted/15 px-1 py-1.5",
          compact ? "h-[clamp(84px,24vh,124px)]" : "h-[clamp(104px,25vh,176px)]",
        )}
        data-reader-native-scrollbar="top"
        data-reader-direction={direction}
        data-testid="neoview-thumbnail-viewport"
      >
        <div className="relative h-full scale-y-[-1]" style={{ width: totalPages * ITEM_SIZE }} data-reader-thumbnail-track="true">
          {items}
          {showAreaGuide ? <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-45" data-reader-area-guide="true">{Array.from({ length: 9 }, (_, index) => <span key={index} className="border border-primary/50" />)}</div> : null}
          {showEdgeGuide ? <div aria-hidden="true" className="pointer-events-none absolute inset-0 border-4 border-primary/55" data-reader-edge-guide="true" /> : null}
        </div>
      </div>
      {progressBarVisible ? <>
        <label className="sr-only" htmlFor={`neoview-bottom-progress-${sessionId}`}>阅读进度</label>
        <div className="min-w-0 max-w-full overflow-hidden border-t border-border/35 px-1 py-1" data-reader-bottom-progress="true">
          <RangeInput
            id={`neoview-bottom-progress-${sessionId}`}
            aria-label="阅读进度"
            className={cn("block h-2 w-full", progressBarGlow && "drop-shadow-[0_0_5px_color-mix(in_oklch,var(--primary)_75%,transparent)]")}
            min={0}
            max={Math.max(0, totalPages - 1)}
            dir={direction === "right-to-left" ? "rtl" : "ltr"}
            step={1}
            value={Math.min(activePageIndex, Math.max(0, totalPages - 1))}
            disabled={disabled || totalPages < 2}
            onChange={(event) => void onSelect(Number(event.currentTarget.value))}
          />
        </div>
      </> : null}
    </div>
  )
}

function ThumbnailTile({
  index,
  page,
  active,
  visualPosition,
  showPageNumber,
  disabled,
  onSelect,
}: {
  index: number
  page?: ReaderPageDto
  active: boolean
  visualPosition: number
  showPageNumber: boolean
  disabled: boolean
  onSelect(pageIndex: number): void | Promise<void>
}) {
  const thumbnailUrl = page?.thumbnailUrl
  return (
    <button
      type="button"
      aria-label={`转到第 ${index + 1} 页${page ? `：${page.name}` : ""}`}
      aria-current={active ? "page" : undefined}
      disabled={disabled || !page}
      onClick={() => void onSelect(index)}
      className={cn(
        "absolute inset-y-1 grid w-[88px] overflow-hidden border bg-black/90 text-white transition-colors disabled:cursor-default",
        active ? "border-primary ring-2 ring-primary/80" : "border-border/60 hover:border-foreground/55",
      )}
      style={{ transform: `translateX(${visualPosition * ITEM_SIZE + 2}px)` }}
    >
      <ReaderThumbnailSurface url={thumbnailUrl} kind="page" fit="contain" className="size-full rounded-none bg-black/90" />
      {showPageNumber ? <span className="absolute inset-x-0 bottom-0 bg-primary/85 px-1 py-0.5 text-center text-[10px] tabular-nums text-primary-foreground">{index + 1}</span> : null}
    </button>
  )
}

function calculateWindow(viewport: HTMLDivElement, totalPages: number, direction: "left-to-right" | "right-to-left"): RenderWindow {
  const visibleStart = Math.floor(viewport.scrollLeft / ITEM_SIZE)
  const visibleCount = Math.max(INITIAL_ITEMS, Math.ceil(viewport.clientWidth / ITEM_SIZE))
  const visualWindow = {
    start: Math.max(0, visibleStart - OVERSCAN),
    end: Math.min(totalPages, visibleStart + visibleCount + OVERSCAN),
  }
  return direction === "left-to-right" ? visualWindow : {
    start: Math.max(0, totalPages - visualWindow.end),
    end: Math.min(totalPages, totalPages - visualWindow.start),
  }
}

function initialPageWindow(totalPages: number, activePageIndex: number): RenderWindow {
  const start = Math.max(0, Math.min(activePageIndex - OVERSCAN, totalPages - INITIAL_ITEMS))
  return { start, end: Math.min(totalPages, start + INITIAL_ITEMS) }
}

function visualPagePosition(index: number, totalPages: number, direction: "left-to-right" | "right-to-left"): number {
  return direction === "right-to-left" ? totalPages - 1 - index : index
}

function batchLoaded(pages: ReadonlyMap<number, ReaderPageDto>, cursor: number, limit: number): boolean {
  for (let index = cursor; index < cursor + limit; index += 1) {
    if (!pages.has(index)) return false
  }
  return true
}

function abortRequests(requests: Map<number, AbortController>): void {
  for (const controller of requests.values()) controller.abort()
  requests.clear()
}

function sameWindow(left: RenderWindow, right: RenderWindow): boolean {
  return left.start === right.start && left.end === right.end
}
