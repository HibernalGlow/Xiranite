import { useVirtualizer } from "@tanstack/react-virtual"
import { RefreshCw } from "lucide-react"
import { useEffect, useRef, useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"

const PAGE_SIZE = 100

export function ReaderLibraryList<T>({
  queryKey,
  loadPage,
  renderRow,
  emptyLabel,
  refreshLabel,
  revision = 0,
  itemSize = 58,
  getItemKey,
  onVisibleItemsChange,
  onItemsChange,
  focusIndex,
  listLabel,
  columns = 1,
  gap = 0,
  toolbar,
  onViewportWidthChange,
}: {
  queryKey: string
  loadPage(offset: number, limit: number, signal: AbortSignal): Promise<readonly T[]>
  renderRow(item: T, index: number): ReactNode
  emptyLabel: string
  refreshLabel: string
  revision?: number
  itemSize?: number
  getItemKey?(item: T): string
  onVisibleItemsChange?(items: readonly T[]): void
  onItemsChange?(items: readonly T[]): void
  focusIndex?: number
  listLabel?: string
  columns?: number
  gap?: number
  toolbar?: ReactNode
  /** Fired when the scroll viewport width changes so parents can recompute adaptive columns/heights. */
  onViewportWidthChange?(width: number): void
}) {
  const columnCount = Math.max(1, Math.floor(columns))
  const viewportRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | undefined>(undefined)
  const generationRef = useRef(0)
  const itemsRef = useRef<readonly T[]>([])
  const loadingRef = useRef(false)
  const [items, setItems] = useState<readonly T[]>([])
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [manualRevision, setManualRevision] = useState(0)
  const rowCount = Math.ceil(items.length / columnCount)
  // Include geometry in the virtualizer identity so view-mode / resize switches drop stale row heights.
  const layoutKey = `${itemSize}:${columnCount}:${gap}`
  const virtualizer = useVirtualizer({
    count: rowCount + (hasMore ? 1 : 0),
    getScrollElement: () => viewportRef.current,
    estimateSize: () => itemSize,
    initialRect: { width: 320, height: 288 },
    overscan: 8,
  })
  const virtualItems = virtualizer.getVirtualItems()
  const lastVirtualIndex = virtualItems.at(-1)?.index
  const firstVirtualIndex = virtualItems[0]?.index
  const visibleStart = firstVirtualIndex === undefined ? 0 : Math.min(firstVirtualIndex * columnCount, items.length)
  const visibleEnd = lastVirtualIndex === undefined ? 0 : Math.min((lastVirtualIndex + 1) * columnCount, items.length)

  useEffect(() => {
    onVisibleItemsChange?.(items.slice(visibleStart, visibleEnd))
  }, [items, onVisibleItemsChange, visibleEnd, visibleStart])

  useEffect(() => {
    onItemsChange?.(items)
  }, [items, onItemsChange])

  useEffect(() => {
    if (focusIndex === undefined || focusIndex < 0 || focusIndex >= items.length) return
    virtualizer.scrollToIndex(Math.floor(focusIndex / columnCount), { align: "auto" })
    const frame = requestAnimationFrame(() => {
      viewportRef.current
        ?.querySelector<HTMLElement>(`[data-library-item-index="${focusIndex}"] [data-library-item-focus="true"]`)
        ?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [columnCount, focusIndex, items.length, virtualizer])

  useEffect(() => () => onVisibleItemsChange?.([]), [onVisibleItemsChange])

  useEffect(() => {
    virtualizer.measure?.()
  }, [layoutKey, virtualizer])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !onViewportWidthChange) return
    const report = () => onViewportWidthChange(Math.max(0, Math.floor(viewport.clientWidth)))
    report()
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", report)
      return () => window.removeEventListener("resize", report)
    }
    const observer = new ResizeObserver(report)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [onViewportWidthChange])

  useEffect(() => {
    generationRef.current += 1
    abortRef.current?.abort()
    itemsRef.current = []
    loadingRef.current = false
    setItems([])
    setHasMore(true)
    setLoading(false)
    setError(undefined)
    void loadNextPage(true)
    return () => {
      generationRef.current += 1
      abortRef.current?.abort()
    }
  }, [queryKey, revision, manualRevision, loadPage])

  useEffect(() => {
    if (lastVirtualIndex === undefined || (lastVirtualIndex + 1) * columnCount < items.length - 8 || !hasMore) return
    void loadNextPage(false)
  }, [columnCount, hasMore, items.length, lastVirtualIndex])

  async function loadNextPage(reset: boolean) {
    if (loadingRef.current) return
    const generation = generationRef.current
    const offset = reset ? 0 : itemsRef.current.length
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller
    loadingRef.current = true
    setLoading(true)
    setError(undefined)
    try {
      const page = await loadPage(offset, PAGE_SIZE, controller.signal)
      if (controller.signal.aborted || generation !== generationRef.current) return
      const next = reset ? page : [...itemsRef.current, ...page]
      itemsRef.current = next
      setItems(next)
      setHasMore(page.length === PAGE_SIZE)
    } catch (cause) {
      if (!controller.signal.aborted && generation === generationRef.current) setError(errorMessage(cause))
    } finally {
      if (generation === generationRef.current) {
        loadingRef.current = false
        setLoading(false)
      }
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-neoview-library-list={queryKey}>
      <div className="flex min-h-7 items-center gap-2">
        {toolbar}
        <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">{items.length} 项</span>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={refreshLabel}
          title={refreshLabel}
          disabled={loading}
          onClick={() => setManualRevision((value) => value + 1)}
        >
          <RefreshCw className={loading ? "animate-spin" : undefined} />
        </Button>
      </div>
      {error ? <div role="alert" className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">{error}</div> : null}
      <div
        ref={viewportRef}
        className="min-h-32 flex-1 overflow-auto rounded border bg-background/60"
        data-neoview-library-viewport="true"
        role={listLabel ? "listbox" : undefined}
        aria-label={listLabel}
        aria-multiselectable={listLabel ? true : undefined}
      >
        {items.length === 0 && !loading ? (
          <div className="grid h-24 place-items-center text-xs text-muted-foreground">{emptyLabel}</div>
        ) : (
          <div
            key={layoutKey}
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
            data-library-grid-columns={columnCount}
            data-library-item-size={itemSize}
            data-library-gap={gap}
          >
            {virtualItems.map((virtualItem) => {
              const firstItemIndex = virtualItem.index * columnCount
              const rowItems = items.slice(firstItemIndex, firstItemIndex + columnCount)
              // itemSize is the full row pitch (surface + gap). Content fills the non-gap portion.
              const contentHeight = Math.max(virtualItem.size - gap, 0)
              return (
                <div
                  key={virtualItem.key}
                  className="absolute left-0 grid w-full"
                  style={{
                    columnGap: gap,
                    rowGap: 0,
                    gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                    height: contentHeight,
                    marginBottom: gap,
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  {rowItems.length ? rowItems.map((item, offset) => (
                    <div
                      key={getItemKey ? getItemKey(item) : firstItemIndex + offset}
                      className="h-full min-h-0 min-w-0 overflow-hidden"
                      data-library-item-index={firstItemIndex + offset}
                    >
                      {renderRow(item, firstItemIndex + offset)}
                    </div>
                  )) : <div className="col-span-full h-full animate-pulse bg-muted/35" aria-label="正在加载更多" />}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export function formatLibraryTime(timestamp: number): string {
  return LIBRARY_TIME_FORMAT.format(new Date(timestamp))
}

const LIBRARY_TIME_FORMAT = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
})

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
