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
}: {
  queryKey: string
  loadPage(offset: number, limit: number, signal: AbortSignal): Promise<readonly T[]>
  renderRow(item: T): ReactNode
  emptyLabel: string
  refreshLabel: string
  revision?: number
}) {
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
  const virtualizer = useVirtualizer({
    count: items.length + (hasMore ? 1 : 0),
    getScrollElement: () => viewportRef.current,
    estimateSize: () => 58,
    initialRect: { width: 320, height: 288 },
    overscan: 8,
  })
  const virtualItems = virtualizer.getVirtualItems()
  const lastVirtualIndex = virtualItems.at(-1)?.index

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
    if (lastVirtualIndex === undefined || lastVirtualIndex < items.length - 8 || !hasMore) return
    void loadNextPage(false)
  }, [hasMore, items.length, lastVirtualIndex])

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
    <div className="grid min-h-0 gap-2" data-neoview-library-list={queryKey}>
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-[10px] tabular-nums text-muted-foreground">{items.length} 项</span>
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
      <div ref={viewportRef} className="h-72 min-h-32 overflow-auto rounded border bg-background/60">
        {items.length === 0 && !loading ? (
          <div className="grid h-24 place-items-center text-xs text-muted-foreground">{emptyLabel}</div>
        ) : (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualItems.map((virtualItem) => {
              const item = items[virtualItem.index]
              return (
                <div
                  key={virtualItem.key}
                  className="absolute left-0 w-full border-b"
                  style={{ height: virtualItem.size, transform: `translateY(${virtualItem.start}px)` }}
                >
                  {item ? renderRow(item) : <div className="h-full animate-pulse bg-muted/35" aria-label="正在加载更多" />}
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
