import { startTransition, useEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"
import type { ReaderHttpClient, ReaderPageDto } from "../../adapters/reader-http-client"
import { ReaderThumbnailSurface } from "./ReaderThumbnailSurface"

const BATCH_SIZE = 64
const ITEM_SIZE = 68
const OVERSCAN = 4
const INITIAL_ITEMS = 16

export interface ThumbnailStripProps {
  sessionId: string
  totalPages: number
  activePageIndex: number
  currentPages: readonly ReaderPageDto[]
  client: ReaderHttpClient
  compact: boolean
  disabled?: boolean
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
  currentPages,
  client,
  compact,
  disabled = false,
  onSelect,
}: ThumbnailStripProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<number | undefined>(undefined)
  const pagesRef = useRef(new Map<number, ReaderPageDto>())
  const requestsRef = useRef(new Map<number, AbortController>())
  const [pages, setPages] = useState(() => new Map<number, ReaderPageDto>())
  const [renderWindow, setRenderWindow] = useState<RenderWindow>(() => ({
    start: 0,
    end: Math.min(totalPages, INITIAL_ITEMS),
  }))

  useEffect(() => {
    abortRequests(requestsRef.current)
    const initial = new Map<number, ReaderPageDto>()
    pagesRef.current = initial
    setPages(initial)
    setRenderWindow({ start: 0, end: Math.min(totalPages, INITIAL_ITEMS) })
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
      const next = calculateWindow(viewport, totalPages)
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
  }, [totalPages])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const left = activePageIndex * ITEM_SIZE
    const right = left + ITEM_SIZE
    if (left < viewport.scrollLeft || right > viewport.scrollLeft + viewport.clientWidth) {
      viewport.scrollLeft = Math.max(0, left - Math.max(0, viewport.clientWidth - ITEM_SIZE) / 2)
      const next = calculateWindow(viewport, totalPages)
      setRenderWindow((current) => sameWindow(current, next) ? current : next)
    }
  }, [activePageIndex, totalPages])

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
  for (let index = renderWindow.start; index < renderWindow.end; index += 1) {
    items.push(
      <ThumbnailTile
        key={pages.get(index)?.id ?? `placeholder-${index}`}
        index={index}
        page={pages.get(index)}
        active={index === activePageIndex}
        compact={compact}
        disabled={disabled}
        onSelect={onSelect}
      />,
    )
  }

  return (
    <div
      ref={viewportRef}
      aria-label="页面缩略图"
      className={cn("shrink-0 overflow-x-auto overflow-y-hidden border-t border-border/70 bg-muted/25", compact ? "h-[68px]" : "h-[84px]")}
      data-testid="neoview-thumbnail-viewport"
    >
      <div className="relative h-full" style={{ width: totalPages * ITEM_SIZE }}>
        {items}
      </div>
    </div>
  )
}

function ThumbnailTile({
  index,
  page,
  active,
  compact,
  disabled,
  onSelect,
}: {
  index: number
  page?: ReaderPageDto
  active: boolean
  compact: boolean
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
        "absolute top-1 grid overflow-hidden border bg-black/90 text-white transition-colors disabled:cursor-default",
        compact ? "h-[58px] w-14" : "h-[74px] w-16",
        active ? "border-primary ring-1 ring-primary" : "border-border/70 hover:border-foreground/50",
      )}
      style={{ transform: `translateX(${index * ITEM_SIZE + 2}px)` }}
    >
      <ReaderThumbnailSurface url={thumbnailUrl} kind="page" fit="contain" className="size-full rounded-none bg-black/90" />
      <span className="absolute inset-x-0 bottom-0 bg-black/65 px-1 py-0.5 text-center text-[10px] tabular-nums">
        {index + 1}
      </span>
    </button>
  )
}

function calculateWindow(viewport: HTMLDivElement, totalPages: number): RenderWindow {
  const visibleStart = Math.floor(viewport.scrollLeft / ITEM_SIZE)
  const visibleCount = Math.max(INITIAL_ITEMS, Math.ceil(viewport.clientWidth / ITEM_SIZE))
  return {
    start: Math.max(0, visibleStart - OVERSCAN),
    end: Math.min(totalPages, visibleStart + visibleCount + OVERSCAN),
  }
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
