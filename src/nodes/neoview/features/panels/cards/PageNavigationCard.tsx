import { useVirtualizer } from "@tanstack/react-virtual"
import { Navigation, Search } from "lucide-react"
import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent, type ReactNode, type RefObject, type SetStateAction } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import type { ReaderHttpClient, ReaderPageDto } from "../../../adapters/reader-http-client"
import { ReaderThumbnailSurface } from "../../thumbnails/ReaderThumbnailSurface"
import type { ReaderPanelContext } from "../registry"
import {
  createSparsePageCatalog,
  mergeSparsePageBatch,
  mergeSparsePagePositions,
  sparseBatchLoaded,
  sparsePageAt,
  sparsePageMap,
  type SparsePageCatalog,
} from "./page-list/SparsePageCatalog"
import { ReaderEntrySurface } from "./shared/ReaderEntrySurface"

const BATCH_SIZE = 64
const MAX_RETAINED_BATCHES = 8
const THUMB_COLUMNS = 3
const THUMBNAIL_ROW_HEIGHT = 148

type PageListViewMode = "list" | "details" | "thumbnails"
const PageListToolbar = lazy(() => import("./page-list/PageListToolbar"))
const PageListContextActions = lazy(() => import("./page-list/PageListContextActions"))

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
      systemActions={context.systemActions}
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
  systemActions,
}: {
  sessionId: string
  totalPages: number
  activePageIndex: number
  currentPages: readonly ReaderPageDto[]
  client: ReaderHttpClient
  disabled: boolean
  onGoTo(pageIndex: number): void | Promise<void>
  systemActions?: ReaderPanelContext["systemActions"]
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const catalogRef = useRef(seedPageCatalog(totalPages, currentPages, activePageIndex))
  const requestsRef = useRef(new Map<number, AbortController>())
  const catalogKeyRef = useRef("")
  const initialAnchorPendingRef = useRef(activePageIndex > 0)
  const retentionPositionsRef = useRef<readonly number[]>([activePageIndex])
  const goToRef = useRef(onGoTo)
  const sliderNavigationRef = useRef<{ running: boolean; latest?: number }>({ running: false })
  const navigationGenerationRef = useRef(0)
  const [catalog, setCatalog] = useState(() => catalogRef.current)
  const [resultCount, setResultCount] = useState(totalPages)
  const [searchQuery, setSearchQuery] = useState("")
  const deferredQuery = useDeferredValue(searchQuery.trim())
  const [viewMode, setViewMode] = useState<PageListViewMode>("list")
  const [followProgress, setFollowProgress] = useState(true)
  const [catalogReady, setCatalogReady] = useState(false)
  const [catalogError, setCatalogError] = useState<string | undefined>(undefined)
  const [navigationError, setNavigationError] = useState<string | undefined>(undefined)
  const [reloadVersion, setReloadVersion] = useState(0)
  const [previewIndex, setPreviewIndex] = useState<number>()
  const [focusedPosition, setFocusedPosition] = useState(activePageIndex)
  const [pendingNavigationIndex, setPendingNavigationIndex] = useState<number>()
  const [pageNumber, setPageNumber] = useState(String(activePageIndex + 1))
  const pages = useMemo(() => sparsePageMap(catalog), [catalog])
  const virtualCount = viewMode === "thumbnails" ? Math.ceil(resultCount / THUMB_COLUMNS) : resultCount
  const virtualizer = useVirtualizer({
    count: virtualCount,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => viewMode === "list" ? 34 : viewMode === "details" ? 76 : THUMBNAIL_ROW_HEIGHT,
    overscan: viewMode === "thumbnails" ? 2 : 8,
  })
  const virtualItems = virtualizer.getVirtualItems()
  const firstPosition = (virtualItems[0]?.index ?? 0) * (viewMode === "thumbnails" ? THUMB_COLUMNS : 1)
  const lastPosition = Math.min(
    resultCount,
    ((virtualItems.at(-1)?.index ?? 0) + 1) * (viewMode === "thumbnails" ? THUMB_COLUMNS : 1),
  )
  const sliderIndex = followProgress ? pendingNavigationIndex ?? activePageIndex : previewIndex ?? activePageIndex
  useEffect(() => {
    goToRef.current = onGoTo
  }, [onGoTo])

  useEffect(() => {
    navigationGenerationRef.current += 1
    sliderNavigationRef.current = { running: false }
    setPendingNavigationIndex(undefined)
    return () => {
      navigationGenerationRef.current += 1
      sliderNavigationRef.current = { running: false }
    }
  }, [client, sessionId])

  useEffect(() => {
    retentionPositionsRef.current = deferredQuery
      ? [focusedPosition]
      : [activePageIndex, previewIndex ?? activePageIndex, focusedPosition]
  }, [activePageIndex, deferredQuery, focusedPosition, previewIndex])

  useEffect(() => {
    abortRequests(requestsRef.current)
    const initial = deferredQuery
      ? createSparsePageCatalog<ReaderPageDto>(0, MAX_RETAINED_BATCHES)
      : seedPageCatalog(totalPages, currentPages, activePageIndex)
    catalogRef.current = initial
    setCatalog(initial)
    initialAnchorPendingRef.current = !deferredQuery && activePageIndex > 0
    setResultCount(deferredQuery ? 0 : totalPages)
    setFocusedPosition(deferredQuery ? 0 : activePageIndex)
    setCatalogReady(false)
    setCatalogError(undefined)
    const catalogKey = `${sessionId}\0${deferredQuery}\0${reloadVersion}`
    catalogKeyRef.current = catalogKey
    if (totalPages < 1) {
      initialAnchorPendingRef.current = false
      setCatalogReady(true)
      return () => abortRequests(requestsRef.current)
    }
    const cursor = deferredQuery ? 0 : batchCursor(activePageIndex)
    requestCatalogBatch({
      client,
      sessionId,
      query: deferredQuery,
      cursor,
      limit: Math.min(BATCH_SIZE, Math.max(0, totalPages - cursor)),
      catalogKey,
      catalogKeyRef,
      catalogRef,
      retentionPositionsRef,
      requestsRef,
      setCatalog,
      setResultCount,
      setCatalogReady,
      setCatalogError,
    })
    return () => abortRequests(requestsRef.current)
  }, [client, deferredQuery, reloadVersion, sessionId, totalPages])

  useEffect(() => {
    if (deferredQuery || !currentPages.length) return
    setCatalog((existing) => {
      const next = mergeSparsePagePositions(
        existing,
        currentPages.map((page) => ({ position: page.index, page })),
        totalPages,
        retentionPositionsRef.current,
      )
      catalogRef.current = next
      return next
    })
  }, [currentPages, deferredQuery, totalPages])

  useEffect(() => {
    if (initialAnchorPendingRef.current || lastPosition <= firstPosition) return
    const firstBatch = Math.floor(firstPosition / BATCH_SIZE) * BATCH_SIZE
    const lastBatch = Math.ceil(lastPosition / BATCH_SIZE) * BATCH_SIZE
    for (let cursor = firstBatch; cursor < Math.min(resultCount, lastBatch); cursor += BATCH_SIZE) {
      requestCatalogBatch({
        client,
        sessionId,
        query: deferredQuery,
        cursor,
        limit: Math.min(BATCH_SIZE, resultCount - cursor),
        catalogKey: catalogKeyRef.current,
        catalogKeyRef,
        catalogRef,
        retentionPositionsRef,
        requestsRef,
        setCatalog,
        setResultCount,
        setCatalogReady,
        setCatalogError,
      })
    }
  }, [client, deferredQuery, firstPosition, lastPosition, resultCount, sessionId])

  useEffect(() => {
    setPageNumber(String(activePageIndex + 1))
    if (followProgress) {
      setFocusedPosition(activePageIndex)
      if (!deferredQuery) {
        centerPosition(activePageIndex)
        initialAnchorPendingRef.current = false
      }
    }
  }, [activePageIndex, deferredQuery, followProgress, viewMode])

  useEffect(() => {
    if (followProgress || previewIndex === undefined || deferredQuery) return
    centerPosition(previewIndex)
  }, [deferredQuery, followProgress, previewIndex, viewMode])

  function centerPosition(position: number) {
    virtualizer.scrollToIndex(viewMode === "thumbnails" ? Math.floor(position / THUMB_COLUMNS) : position, { align: "center" })
  }

  function requestPosition(position: number) {
    const cursor = batchCursor(position)
    requestCatalogBatch({
      client,
      sessionId,
      query: deferredQuery,
      cursor,
      limit: Math.min(BATCH_SIZE, Math.max(0, resultCount - cursor)),
      catalogKey: catalogKeyRef.current,
      catalogKeyRef,
      catalogRef,
      retentionPositionsRef,
      requestsRef,
      setCatalog,
      setResultCount,
      setCatalogReady,
      setCatalogError,
    })
  }

  function focusPosition(position: number, selectPreview: boolean) {
    const bounded = Math.min(Math.max(position, 0), Math.max(0, resultCount - 1))
    setFocusedPosition(bounded)
    requestPosition(bounded)
    centerPosition(bounded)
    const page = sparsePageAt(catalogRef.current, bounded)
    if (selectPreview && page) setPreviewIndex(page.index)
    requestAnimationFrame(() => {
      viewportRef.current?.querySelector<HTMLButtonElement>(`[data-page-result-position="${bounded}"]`)?.focus({ preventScroll: true })
    })
  }

  async function navigateTo(pageIndex: number, generation = navigationGenerationRef.current) {
    const goTo = goToRef.current
    try {
      if (generation === navigationGenerationRef.current) setNavigationError(undefined)
      await goTo(pageIndex)
    } catch (error) {
      if (generation === navigationGenerationRef.current) setNavigationError(errorMessage(error))
    }
  }

  function navigateSlider(pageIndex: number) {
    sliderNavigationRef.current.latest = pageIndex
    setPendingNavigationIndex(pageIndex)
    if (sliderNavigationRef.current.running) return
    sliderNavigationRef.current.running = true
    const generation = navigationGenerationRef.current
    void (async () => {
      while (generation === navigationGenerationRef.current && sliderNavigationRef.current.latest !== undefined) {
        const target = sliderNavigationRef.current.latest
        sliderNavigationRef.current.latest = undefined
        await navigateTo(target, generation)
      }
      if (generation !== navigationGenerationRef.current) return
      sliderNavigationRef.current.running = false
      setPendingNavigationIndex(undefined)
    })()
  }

  function handlePageListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (isEditableTarget(event.target) || resultCount < 1) return
    const current = Math.min(Math.max(focusedPosition, 0), resultCount - 1)
    const columns = viewMode === "thumbnails" ? THUMB_COLUMNS : 1
    const pageStep = viewMode === "list" ? 8 : viewMode === "details" ? 4 : THUMB_COLUMNS * 3
    let target: number | undefined
    if (event.key === "ArrowUp") target = current - columns
    else if (event.key === "ArrowDown") target = current + columns
    else if (event.key === "ArrowLeft" && viewMode === "thumbnails") target = current - 1
    else if (event.key === "ArrowRight" && viewMode === "thumbnails") target = current + 1
    else if (event.key === "PageUp") target = current - pageStep
    else if (event.key === "PageDown") target = current + pageStep
    else if (event.key === "Home") target = 0
    else if (event.key === "End") target = resultCount - 1
    else if (event.key === "Enter") {
      const page = sparsePageAt(catalogRef.current, current)
      if (page) void navigateTo(page.index)
    } else if (event.key === "Escape") {
      setPreviewIndex(undefined)
      if (!deferredQuery) focusPosition(activePageIndex, false)
    } else {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (target !== undefined) focusPosition(target, !followProgress)
  }

  function commitPageNumber() {
    const value = Number.parseInt(pageNumber, 10)
    if (Number.isSafeInteger(value) && value >= 1 && value <= totalPages) void navigateTo(value - 1)
  }

  return (
    <div
      className="flex h-[clamp(20rem,60vh,36rem)] min-h-0 flex-col gap-2"
      data-neoview-page-list="true"
      data-page-list-mode={viewMode}
      data-focused-position={focusedPosition}
      data-preview-index={previewIndex}
      data-retained-batches={catalog.batches.size}
      onKeyDownCapture={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f" && !isEditableTarget(event.target)) {
          event.preventDefault()
          event.stopPropagation()
          searchInputRef.current?.focus()
        }
      }}
    >
      <div className="flex items-center gap-1">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            ref={searchInputRef}
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
      <Suspense fallback={<div className="h-8" aria-hidden="true" />}>
        <PageListToolbar
          client={client}
          sessionId={sessionId}
          totalPages={totalPages}
          resultCount={resultCount}
          filtered={Boolean(deferredQuery)}
          viewMode={viewMode}
          disabled={disabled}
          onViewModeChange={setViewMode}
        />
      </Suspense>
      {navigationError ? <div role="alert" className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">{navigationError}</div> : null}
      <Suspense fallback={null}>
        <PageListContextActions client={client} sessionId={sessionId} disabled={disabled} copyFiles={systemActions?.copyFiles} onGoTo={navigateTo} />
      </Suspense>
      <div
        ref={viewportRef}
        className="min-h-0 flex-1 overflow-auto rounded border bg-background/55 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-neoview-page-list-viewport="true"
        role="listbox"
        aria-label="页面"
        tabIndex={0}
        onKeyDown={handlePageListKeyDown}
      >
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
                measureElement={virtualizer.measureElement}
                pages={pages}
                activePageIndex={activePageIndex}
                previewIndex={previewIndex}
                focusedPosition={focusedPosition}
                disabled={disabled}
                onFocusPosition={(position) => setFocusedPosition(position)}
                onGoTo={(index) => void navigateTo(index)}
              />
            ) : (
              <PageRow
                key={virtualItem.key}
                start={virtualItem.start}
                size={virtualItem.size}
                position={virtualItem.index}
                page={pages.get(virtualItem.index)}
                activePageIndex={activePageIndex}
                previewed={pages.get(virtualItem.index)?.index === previewIndex}
                focused={virtualItem.index === focusedPosition}
                details={viewMode === "details"}
                disabled={disabled}
                onFocus={() => setFocusedPosition(virtualItem.index)}
                onGoTo={(index) => void navigateTo(index)}
              />
            ))}
          </div>
        )}
      </div>
      {totalPages > 1 ? (
        <div className="grid grid-cols-[2.5rem_1fr_2.5rem] items-center gap-2 border-t pt-2">
          <span className="text-right text-[10px] tabular-nums text-muted-foreground">{sliderIndex + 1}</span>
          <div onKeyDown={(event) => event.stopPropagation()}>
            <Slider
              aria-label="页面位置"
              min={0}
              max={totalPages - 1}
              step={1}
              value={[sliderIndex]}
              disabled={disabled}
              onValueChange={(value) => {
                const next = value[0] ?? 0
                if (followProgress) navigateSlider(next)
                else setPreviewIndex(next)
              }}
            />
          </div>
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

export function PageRow({ start, size, position, page, activePageIndex, previewed = false, focused = false, details, disabled, onFocus, onGoTo }: {
  start: number
  size: number
  position: number
  page?: ReaderPageDto
  activePageIndex: number
  previewed?: boolean
  focused?: boolean
  details: boolean
  disabled: boolean
  onFocus?(): void
  onGoTo(pageIndex: number): void | Promise<void>
}) {
  const active = page?.index === activePageIndex
  return (
    <ReaderEntrySurface
      variant={details ? "content" : "compact"}
      current={active}
      selected={previewed}
      focused={focused}
      data-page-index={page?.index}
      data-page-id={page?.id}
      data-page-name={page?.name}
      data-context-menu={page ? "neoview-page-list" : undefined}
      data-page-result-position={position}
      className={cn("absolute left-0", active && "text-primary")}
      style={{ height: size, transform: `translateY(${start}px)` }}
      media={details ? <PageThumbnail page={page} className="h-16 w-12" /> : undefined}
      primary={<PageIdentity page={page} position={position} active={active} />}
      buttonProps={{
        "aria-current": active ? "page" : undefined,
        "aria-selected": previewed,
        "aria-label": page ? `转到第 ${page.index + 1} 页：${page.name}` : `正在加载第 ${position + 1} 项`,
        role: "option",
        tabIndex: focused ? 0 : -1,
        disabled: disabled || !page,
        onFocus,
        onClick: () => { if (page) void onGoTo(page.index) },
      }}
    />
  )
}

export function ThumbnailRow({ start, rowIndex, measureElement, pages, activePageIndex, previewIndex, focusedPosition, disabled, onFocusPosition, onGoTo }: {
  start: number
  rowIndex: number
  measureElement?: (element: HTMLDivElement | null) => void
  pages: ReadonlyMap<number, ReaderPageDto>
  activePageIndex: number
  previewIndex?: number
  focusedPosition?: number
  disabled: boolean
  onFocusPosition?(position: number): void
  onGoTo(pageIndex: number): void | Promise<void>
}) {
  return (
    <div
      ref={measureElement}
      className="absolute left-0 grid w-full grid-cols-3 gap-1 p-1"
      data-index={rowIndex}
      data-page-thumbnail-grid-row={rowIndex}
      style={{ transform: `translateY(${start}px)` }}
    >
      {Array.from({ length: THUMB_COLUMNS }, (_, column) => {
        const position = rowIndex * THUMB_COLUMNS + column
        const page = pages.get(position)
        if (!page) return <div key={position} className="rounded bg-muted/35" aria-hidden="true" />
        const active = page.index === activePageIndex
        const previewed = page.index === previewIndex
        const focused = position === focusedPosition
        return (
          <ReaderEntrySurface
            key={page.id}
            variant="thumbnail"
            current={active}
            selected={previewed}
            focused={focused}
            className="h-auto"
            data-page-thumbnail-tile={page.index}
            data-page-id={page.id}
            data-page-index={page.index}
            data-page-name={page.name}
            data-context-menu="neoview-page-list"
            data-page-result-position={position}
            media={<PageThumbnail page={page} className="aspect-[3/4] w-full" />}
            primary={(
              <span className="flex min-w-0 items-center gap-1">
                <span className="shrink-0 font-mono text-[10px] font-semibold text-primary">#{page.index + 1}</span>
                <span className="min-w-0 flex-1 truncate">{page.name}</span>
                {active ? <span className="shrink-0 rounded bg-primary/15 px-1 text-[9px] text-primary">当前</span> : null}
              </span>
            )}
            buttonProps={{
              "aria-label": `转到第 ${page.index + 1} 页：${page.name}`,
              "aria-current": active ? "page" : undefined,
              "aria-selected": previewed,
              role: "option",
              tabIndex: focused ? 0 : -1,
              disabled,
              onFocus: () => onFocusPosition?.(position),
              onClick: () => void onGoTo(page.index),
            }}
          />
        )
      })}
    </div>
  )
}

export function PageThumbnail({ page, className }: { page?: ReaderPageDto; className: string }) {
  return <ReaderThumbnailSurface url={page?.thumbnailUrl} kind="page" fit="contain" loading={!page} className={className} />
}

function PageIdentity({ page, position, active }: { page?: ReaderPageDto; position: number; active: boolean }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className="w-9 shrink-0 font-mono text-[10px] font-semibold text-primary">#{page ? page.index + 1 : position + 1}</span>
      <span className="min-w-0 flex-1 truncate">{page?.name ?? "加载中"}</span>
      {active ? <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[9px] text-primary">当前</span> : null}
    </span>
  )
}

function IconToggle({ label, pressed, onClick, children }: { label: string; pressed: boolean; onClick(): void; children: ReactNode }) {
  return <Button type="button" size="icon-sm" variant={pressed ? "default" : "ghost"} title={label} aria-label={label} aria-pressed={pressed} onClick={onClick}>{children}</Button>
}

interface CatalogBatchRequest {
  client: ReaderHttpClient
  sessionId: string
  query: string
  cursor: number
  limit: number
  catalogKey: string
  catalogKeyRef: RefObject<string>
  catalogRef: RefObject<SparsePageCatalog<ReaderPageDto>>
  retentionPositionsRef: RefObject<readonly number[]>
  requestsRef: RefObject<Map<number, AbortController>>
  setCatalog: Dispatch<SetStateAction<SparsePageCatalog<ReaderPageDto>>>
  setResultCount: Dispatch<SetStateAction<number>>
  setCatalogReady: Dispatch<SetStateAction<boolean>>
  setCatalogError: Dispatch<SetStateAction<string | undefined>>
}

function requestCatalogBatch(request: CatalogBatchRequest): void {
  if (request.limit < 1 || request.requestsRef.current.has(request.cursor) || sparseBatchLoaded(request.catalogRef.current, request.cursor, request.limit)) return
  const controller = new AbortController()
  request.requestsRef.current.set(request.cursor, controller)
  const operation = request.client.listPageCatalog
    ? request.client.listPageCatalog(request.sessionId, request.cursor, request.limit, { query: request.query, thumbnails: false }, controller.signal)
    : request.client.listPages(request.sessionId, request.cursor, request.limit, controller.signal)
  void operation.then((result) => {
    if (controller.signal.aborted || request.catalogKeyRef.current !== request.catalogKey) return
    request.setResultCount(result.total)
    request.setCatalogReady(true)
    request.setCatalogError(undefined)
    request.setCatalog((existing) => {
      const next = mergeSparsePageBatch(existing, request.cursor, result.pages, result.total, request.retentionPositionsRef.current)
      request.catalogRef.current = next
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

function abortRequests(requests: Map<number, AbortController>): void {
  for (const controller of requests.values()) controller.abort()
  requests.clear()
}

function seedPageCatalog(total: number, pages: readonly ReaderPageDto[], activePageIndex: number): SparsePageCatalog<ReaderPageDto> {
  const catalog = createSparsePageCatalog<ReaderPageDto>(total, MAX_RETAINED_BATCHES)
  if (!pages.length) return catalog
  return mergeSparsePagePositions(catalog, pages.map((page) => ({ position: page.index, page })), total, [activePageIndex])
}

function batchCursor(position: number): number {
  return Math.floor(Math.max(0, position) / BATCH_SIZE) * BATCH_SIZE
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable=true]"))
}
