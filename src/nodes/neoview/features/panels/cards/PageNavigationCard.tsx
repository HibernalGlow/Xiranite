import { useVirtualizer } from "@tanstack/react-virtual"
import { Grid3X3, ImageIcon, List, Navigation, Search } from "lucide-react"
import { useDeferredValue, useEffect, useRef, useState, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import type { ReaderHttpClient, ReaderPageDto } from "../../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../registry"

const BATCH_SIZE = 64
const THUMB_COLUMNS = 3

type PageListViewMode = "list" | "details" | "thumbnails"

export default function PageNavigationCard(context: ReaderPanelContext) {
  if (!context.session) return null
  return (
    <PageListCard
      sessionId={context.session.sessionId}
      totalPages={context.session.book.pageCount}
      activePageIndex={context.session.frame.anchorPageIndex}
      currentPages={context.session.visiblePages}
      client={context.client}
      disabled={context.disabled}
      onGoTo={context.onGoTo}
    />
  )
}

function PageListCard({
  sessionId,
  totalPages,
  activePageIndex,
  currentPages,
  client,
  disabled,
  onGoTo,
}: {
  sessionId: string
  totalPages: number
  activePageIndex: number
  currentPages: readonly ReaderPageDto[]
  client: ReaderHttpClient
  disabled: boolean
  onGoTo(pageIndex: number): void | Promise<void>
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef(new Map<number, ReaderPageDto>())
  const requestsRef = useRef(new Map<number, AbortController>())
  const catalogKeyRef = useRef("")
  const [pages, setPages] = useState(() => new Map<number, ReaderPageDto>())
  const [resultCount, setResultCount] = useState(totalPages)
  const [searchQuery, setSearchQuery] = useState("")
  const deferredQuery = useDeferredValue(searchQuery.trim())
  const [viewMode, setViewMode] = useState<PageListViewMode>("list")
  const [followProgress, setFollowProgress] = useState(true)
  const [catalogReady, setCatalogReady] = useState(false)
  const [catalogError, setCatalogError] = useState<string | undefined>(undefined)
  const [reloadVersion, setReloadVersion] = useState(0)
  const [previewIndex, setPreviewIndex] = useState(activePageIndex)
  const [pageNumber, setPageNumber] = useState(String(activePageIndex + 1))
  const showsThumbnails = viewMode !== "list"
  const virtualCount = viewMode === "thumbnails" ? Math.ceil(resultCount / THUMB_COLUMNS) : resultCount
  const virtualizer = useVirtualizer({
    count: virtualCount,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => viewMode === "list" ? 34 : viewMode === "details" ? 78 : 122,
    overscan: viewMode === "thumbnails" ? 2 : 8,
  })
  const virtualItems = virtualizer.getVirtualItems()
  const firstPosition = (virtualItems[0]?.index ?? 0) * (viewMode === "thumbnails" ? THUMB_COLUMNS : 1)
  const lastPosition = Math.min(
    resultCount,
    ((virtualItems.at(-1)?.index ?? 0) + 1) * (viewMode === "thumbnails" ? THUMB_COLUMNS : 1),
  )

  useEffect(() => {
    abortRequests(requestsRef.current)
    const initial = new Map<number, ReaderPageDto>()
    if (!deferredQuery) {
      for (const page of currentPages) initial.set(page.index, page)
    }
    pagesRef.current = initial
    setPages(initial)
    setResultCount(deferredQuery ? 0 : totalPages)
    setCatalogReady(false)
    setCatalogError(undefined)
    const catalogKey = `${sessionId}\0${deferredQuery}\0${showsThumbnails ? 1 : 0}\0${reloadVersion}`
    catalogKeyRef.current = catalogKey
    requestCatalogBatch({
      client,
      sessionId,
      query: deferredQuery,
      thumbnails: showsThumbnails,
      cursor: 0,
      limit: Math.min(BATCH_SIZE, totalPages),
      catalogKey,
      catalogKeyRef,
      pagesRef,
      requestsRef,
      setPages,
      setResultCount,
      setCatalogReady,
      setCatalogError,
    })
    return () => abortRequests(requestsRef.current)
  }, [client, deferredQuery, reloadVersion, sessionId, showsThumbnails, totalPages])

  useEffect(() => {
    if (deferredQuery || !currentPages.length) return
    setPages((existing) => {
      const next = new Map(existing)
      for (const page of currentPages) next.set(page.index, page)
      pagesRef.current = next
      return next
    })
  }, [currentPages, deferredQuery])

  useEffect(() => {
    if (lastPosition <= firstPosition) return
    const firstBatch = Math.floor(firstPosition / BATCH_SIZE) * BATCH_SIZE
    const lastBatch = Math.ceil(lastPosition / BATCH_SIZE) * BATCH_SIZE
    for (let cursor = firstBatch; cursor < Math.min(resultCount, lastBatch); cursor += BATCH_SIZE) {
      requestCatalogBatch({
        client,
        sessionId,
        query: deferredQuery,
        thumbnails: showsThumbnails,
        cursor,
        limit: Math.min(BATCH_SIZE, resultCount - cursor),
        catalogKey: catalogKeyRef.current,
        catalogKeyRef,
        pagesRef,
        requestsRef,
        setPages,
        setResultCount,
        setCatalogReady,
        setCatalogError,
      })
    }
  }, [client, deferredQuery, firstPosition, lastPosition, resultCount, sessionId, showsThumbnails])

  useEffect(() => {
    setPageNumber(String(activePageIndex + 1))
    if (followProgress) setPreviewIndex(activePageIndex)
    if (!followProgress || deferredQuery) return
    virtualizer.scrollToIndex(
      viewMode === "thumbnails" ? Math.floor(activePageIndex / THUMB_COLUMNS) : activePageIndex,
      { align: "center" },
    )
  }, [activePageIndex, deferredQuery, followProgress, viewMode])

  function commitPageNumber() {
    const value = Number.parseInt(pageNumber, 10)
    if (Number.isSafeInteger(value) && value >= 1 && value <= totalPages) void onGoTo(value - 1)
  }

  return (
    <div className="flex h-[clamp(20rem,60vh,36rem)] min-h-0 flex-col gap-2" data-neoview-page-list="true">
      <div className="flex items-center gap-1">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            aria-label="搜索页面"
            className="h-8 pl-7 text-xs"
            value={searchQuery}
            placeholder="名称或页码"
            onChange={(event) => setSearchQuery(event.currentTarget.value)}
          />
        </div>
        <IconToggle
          label="跟随阅读进度"
          pressed={followProgress}
          onClick={() => setFollowProgress((value) => !value)}
        ><Navigation /></IconToggle>
      </div>
      <div className="flex items-center gap-1">
        <ViewModeButton label="列表" mode="list" current={viewMode} onChange={setViewMode}><List /></ViewModeButton>
        <ViewModeButton label="带图列表" mode="details" current={viewMode} onChange={setViewMode}><ImageIcon /></ViewModeButton>
        <ViewModeButton label="缩略图网格" mode="thumbnails" current={viewMode} onChange={setViewMode}><Grid3X3 /></ViewModeButton>
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
          {deferredQuery ? `${resultCount} / ${totalPages}` : `${totalPages} 页`}
        </span>
      </div>
      <div ref={viewportRef} className="min-h-0 flex-1 overflow-auto rounded border bg-background/55" data-neoview-page-list-viewport="true">
        {catalogError ? (
          <div className="grid h-28 place-items-center gap-2 p-3 text-center text-xs" role="alert">
            <span className="text-destructive">{catalogError}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => setReloadVersion((value) => value + 1)}>重试</Button>
          </div>
        ) : resultCount === 0 ? (
          <div className="grid h-24 place-items-center text-xs text-muted-foreground">{catalogReady ? (deferredQuery ? "没有匹配页面" : "书籍没有页面") : "正在加载页面"}</div>
        ) : (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualItems.map((virtualItem) => viewMode === "thumbnails" ? (
              <ThumbnailRow
                key={virtualItem.key}
                start={virtualItem.start}
                rowIndex={virtualItem.index}
                pages={pages}
                activePageIndex={activePageIndex}
                disabled={disabled}
                onGoTo={onGoTo}
              />
            ) : (
              <PageRow
                key={virtualItem.key}
                start={virtualItem.start}
                size={virtualItem.size}
                position={virtualItem.index}
                page={pages.get(virtualItem.index)}
                activePageIndex={activePageIndex}
                details={viewMode === "details"}
                disabled={disabled}
                onGoTo={onGoTo}
              />
            ))}
          </div>
        )}
      </div>
      {totalPages > 1 ? (
        <div className="grid grid-cols-[2.5rem_1fr_2.5rem] items-center gap-2 border-t pt-2">
          <span className="text-right text-[10px] tabular-nums text-muted-foreground">{previewIndex + 1}</span>
          <Slider
            aria-label="页面位置"
            min={0}
            max={totalPages - 1}
            step={1}
            value={[previewIndex]}
            disabled={disabled}
            onValueChange={(value) => setPreviewIndex(value[0] ?? 0)}
            onValueCommit={(value) => void onGoTo(value[0] ?? 0)}
          />
          <span className="text-[10px] tabular-nums text-muted-foreground">{totalPages}</span>
        </div>
      ) : null}
      <div className="flex gap-1">
        <Input
          aria-label="跳转页码"
          type="number"
          min={1}
          max={totalPages}
          value={pageNumber}
          onChange={(event) => setPageNumber(event.currentTarget.value)}
          onKeyDown={(event) => { if (event.key === "Enter") commitPageNumber() }}
        />
        <Button type="button" size="sm" disabled={disabled} onClick={commitPageNumber}>跳转</Button>
      </div>
    </div>
  )
}

function PageRow({ start, size, position, page, activePageIndex, details, disabled, onGoTo }: {
  start: number
  size: number
  position: number
  page?: ReaderPageDto
  activePageIndex: number
  details: boolean
  disabled: boolean
  onGoTo(pageIndex: number): void | Promise<void>
}) {
  const active = page?.index === activePageIndex
  return (
    <button
      type="button"
      data-page-index={page?.index}
      aria-current={active ? "page" : undefined}
      aria-label={page ? `转到第 ${page.index + 1} 页：${page.name}` : `正在加载第 ${position + 1} 项`}
      className={cn(
        "absolute left-0 flex w-full items-center gap-2 border-b px-2 text-left text-xs hover:bg-muted disabled:opacity-50",
        active && "bg-primary/12 text-primary",
      )}
      style={{ height: size, transform: `translateY(${start}px)` }}
      disabled={disabled || !page}
      onClick={() => { if (page) void onGoTo(page.index) }}
    >
      {details ? <PageThumbnail page={page} className="h-16 w-12" /> : <span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground">{page ? page.index + 1 : position + 1}</span>}
      <span className="min-w-0 flex-1 truncate">{page?.name ?? "加载中"}</span>
    </button>
  )
}

function ThumbnailRow({ start, rowIndex, pages, activePageIndex, disabled, onGoTo }: {
  start: number
  rowIndex: number
  pages: ReadonlyMap<number, ReaderPageDto>
  activePageIndex: number
  disabled: boolean
  onGoTo(pageIndex: number): void | Promise<void>
}) {
  return (
    <div className="absolute left-0 grid h-[122px] w-full grid-cols-3 gap-1 p-1" style={{ transform: `translateY(${start}px)` }}>
      {Array.from({ length: THUMB_COLUMNS }, (_, column) => {
        const position = rowIndex * THUMB_COLUMNS + column
        const page = pages.get(position)
        if (!page) return <div key={position} className="rounded bg-muted/35" aria-hidden="true" />
        const active = page.index === activePageIndex
        return (
          <button
            key={page.id}
            type="button"
            aria-label={`转到第 ${page.index + 1} 页：${page.name}`}
            aria-current={active ? "page" : undefined}
            className={cn("grid min-w-0 grid-rows-[1fr_auto] overflow-hidden rounded border bg-muted/45", active ? "border-primary ring-1 ring-primary" : "border-border hover:border-foreground/50")}
            disabled={disabled}
            onClick={() => void onGoTo(page.index)}
          >
            <PageThumbnail page={page} className="h-full w-full" />
            <span className="truncate px-1 py-0.5 text-[10px] tabular-nums">{page.index + 1}</span>
          </button>
        )
      })}
    </div>
  )
}

function PageThumbnail({ page, className }: { page?: ReaderPageDto; className: string }) {
  const [failedUrl, setFailedUrl] = useState<string | undefined>(undefined)
  const url = page?.thumbnailUrl
  return (
    <span className={cn("grid shrink-0 place-items-center overflow-hidden rounded bg-black/80", className)}>
      {url && url !== failedUrl ? <img src={url} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-contain" onError={() => setFailedUrl(url)} /> : <ImageIcon className="size-4 text-white/35" aria-hidden="true" />}
    </span>
  )
}

function IconToggle({ label, pressed, onClick, children }: { label: string; pressed: boolean; onClick(): void; children: ReactNode }) {
  return <Button type="button" size="icon-sm" variant={pressed ? "default" : "ghost"} title={label} aria-label={label} aria-pressed={pressed} onClick={onClick}>{children}</Button>
}

function ViewModeButton({ label, mode, current, onChange, children }: { label: string; mode: PageListViewMode; current: PageListViewMode; onChange(mode: PageListViewMode): void; children: ReactNode }) {
  return <Button type="button" size="icon-sm" variant={mode === current ? "default" : "ghost"} title={label} aria-label={label} aria-pressed={mode === current} onClick={() => onChange(mode)}>{children}</Button>
}

interface CatalogBatchRequest {
  client: ReaderHttpClient
  sessionId: string
  query: string
  thumbnails: boolean
  cursor: number
  limit: number
  catalogKey: string
  catalogKeyRef: RefObject<string>
  pagesRef: RefObject<Map<number, ReaderPageDto>>
  requestsRef: RefObject<Map<number, AbortController>>
  setPages: Dispatch<SetStateAction<Map<number, ReaderPageDto>>>
  setResultCount: Dispatch<SetStateAction<number>>
  setCatalogReady: Dispatch<SetStateAction<boolean>>
  setCatalogError: Dispatch<SetStateAction<string | undefined>>
}

function requestCatalogBatch(request: CatalogBatchRequest): void {
  if (request.limit < 1 || request.requestsRef.current.has(request.cursor) || batchLoaded(request.pagesRef.current, request.cursor, request.limit)) return
  const controller = new AbortController()
  request.requestsRef.current.set(request.cursor, controller)
  const operation = request.client.listPageCatalog
    ? request.client.listPageCatalog(request.sessionId, request.cursor, request.limit, { query: request.query, thumbnails: request.thumbnails }, controller.signal)
    : request.client.listPages(request.sessionId, request.cursor, request.limit, controller.signal)
  void operation.then((result) => {
    if (controller.signal.aborted || request.catalogKeyRef.current !== request.catalogKey) return
    request.setResultCount(result.total)
    request.setCatalogReady(true)
    request.setCatalogError(undefined)
    request.setPages((existing) => {
      const next = new Map(existing)
      for (let offset = 0; offset < result.pages.length; offset += 1) next.set(request.cursor + offset, result.pages[offset]!)
      request.pagesRef.current = next
      return next
    })
  }).catch((error) => {
    if (!controller.signal.aborted && request.catalogKeyRef.current === request.catalogKey) {
      request.setCatalogReady(true)
      request.setCatalogError(errorMessage(error))
    }
  }).finally(() => {
    if (request.requestsRef.current.get(request.cursor) === controller) request.requestsRef.current.delete(request.cursor)
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function batchLoaded(pages: ReadonlyMap<number, ReaderPageDto>, cursor: number, limit: number): boolean {
  for (let position = cursor; position < cursor + limit; position += 1) {
    if (!pages.has(position)) return false
  }
  return true
}

function abortRequests(requests: Map<number, AbortController>): void {
  for (const controller of requests.values()) controller.abort()
  requests.clear()
}
