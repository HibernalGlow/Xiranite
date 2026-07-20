import { BookOpen, CheckSquare, SlidersHorizontal, Square, SquareX, Trash2, X } from "lucide-react"
import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { ReaderRecentDto } from "../../../adapters/reader-http-client"
import { ReaderThumbnailSurface } from "../../thumbnails/ReaderThumbnailSurface"
import { useReaderLibraryThumbnails, type ReaderLibraryThumbnailItem } from "../../thumbnails/useReaderLibraryThumbnails"
import type { ReaderPanelContext } from "../registry"
import { formatLibraryTime, ReaderLibraryList } from "./ReaderLibraryList"
import { ReaderEntrySurface } from "./shared/ReaderEntrySurface"
import { readerEntryClickIntent } from "./shared/ReaderEntryInteraction"
import { readerLibraryListLayout, readerLibraryMediaClassName, readerLibrarySurfaceVariant, type ReaderLibraryViewMode } from "./shared/readerLibraryEntryLayout"
import { libraryItemFolderPath } from "./shared/libraryItemFolderPath"
import { ReaderLibraryViewToolbar, type ReaderLibrarySort } from "./shared/ReaderLibraryViewToolbar"

interface PendingDelete {
  ids: readonly string[]
  batch: boolean
}

type HistoryViewMode = ReaderLibraryViewMode
const LazyHistoryCleanupDialog = lazy(() => import("./history/HistoryCleanupDialog"))
const LazyHistoryContextActions = lazy(() => import("./history/HistoryContextActions"))

/**
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/history/HistoryListCard.tsx
 */
export default function HistoryListCard({ client, disabled, panelActive = true, onOpen, onBrowsePath, onOpenInNewTab, pickDirectory, systemActions, historyListPreferences, onHistoryListPreferences }: ReaderPanelContext) {
  const [revision, setRevision] = useState(0)
  const [actionError, setActionError] = useState<string>()
  const [cleanupMessage, setCleanupMessage] = useState<string>()
  const [switchingView, setSwitchingView] = useState(false)
  const [loadedRecents, setLoadedRecents] = useState<readonly ReaderRecentDto[]>([])
  const [visibleRecents, setVisibleRecents] = useState<readonly ReaderRecentDto[]>([])
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>()
  const [cleanupOpen, setCleanupOpen] = useState(false)
  const [viewMode, setViewMode] = useState<HistoryViewMode>(() => libraryViewFromPreference(historyListPreferences?.viewMode))
  const [confirmedViewMode, setConfirmedViewMode] = useState<HistoryViewMode>(() => libraryViewFromPreference(historyListPreferences?.viewMode))
  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search)
  const [sort, setSort] = useState<ReaderLibrarySort>({ field: "date", order: "desc" })
  const [viewportWidth, setViewportWidth] = useState(320)
  const [focusedIndex, setFocusedIndex] = useState<number>()
  const focusedIdRef = useRef<string>()
  const anchorIndexRef = useRef<number>()
  const thumbnailItems = useMemo<readonly ReaderLibraryThumbnailItem[]>(() => !panelActive ? [] : visibleRecents.map((item) => ({
    id: item.bookId,
    path: item.source.path,
    kind: item.source.kind === "directory" ? "folder" : "file",
    previewCount: item.source.kind === "directory" ? 4 : 1,
  })), [panelActive, visibleRecents])
  const thumbnails = useReaderLibraryThumbnails(client, "history", thumbnailItems)
  const listLayout = useMemo(() => readerLibraryListLayout(viewMode, viewportWidth), [viewMode, viewportWidth])
  const handleViewportWidthChange = useCallback((width: number) => {
    setViewportWidth((current) => current === width ? current : width)
  }, [])

  function openRecent(item: ReaderRecentDto) {
    const folderPath = libraryItemFolderPath(item.source.path, item.source.kind === "directory")
    onBrowsePath?.(folderPath)
    return onOpen?.(item.source.path, { browserOriginPath: folderPath })
  }

  useEffect(() => {
    if (switchingView || !historyListPreferences) return
    const next = libraryViewFromPreference(historyListPreferences.viewMode)
    setViewMode(next)
    setConfirmedViewMode(next)
  }, [historyListPreferences, switchingView])

  async function changeViewMode(next: HistoryViewMode) {
    if (next === viewMode || switchingView) return
    const previous = confirmedViewMode
    setViewMode(next)
    if (!onHistoryListPreferences) {
      setConfirmedViewMode(next)
      return
    }
    setSwitchingView(true)
    setActionError(undefined)
    try {
      const updated = await onHistoryListPreferences({ viewMode: libraryViewPreference(next) })
      const confirmed = libraryViewFromPreference(updated.viewMode)
      setViewMode(confirmed)
      setConfirmedViewMode(confirmed)
    } catch (error) {
      setViewMode(previous)
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setSwitchingView(false)
    }
  }

  const loadPage = useCallback((offset: number, limit: number, signal: AbortSignal) => {
    if (!panelActive) return Promise.resolve<readonly ReaderRecentDto[]>([])
    if (!client.listRecent) return Promise.reject(new Error("当前后端不支持历史记录"))
    return client.listRecent(offset, limit, signal, { search: deferredSearch, sort })
  }, [client, deferredSearch, panelActive, sort])

  const handleLoadedItems = useCallback((items: readonly ReaderRecentDto[]) => {
    setLoadedRecents(items)
    setFocusedIndex((current) => {
      if (current === undefined) return current
      const focusedId = focusedIdRef.current
      const restoredIndex = focusedId ? items.findIndex((item) => item.bookId === focusedId) : -1
      return restoredIndex >= 0 ? restoredIndex : Math.min(current, Math.max(0, items.length - 1))
    })
    const available = new Set(items.map((item) => item.bookId))
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => available.has(id)))
      return sameSet(current, next) ? current : next
    })
  }, [])

  function focusRecent(index: number) {
    const item = loadedRecents[index]
    if (item) focusedIdRef.current = item.bookId
    setFocusedIndex(index)
  }

  function selectRecent(item: ReaderRecentDto, index: number, event: Pick<MouseEvent, "ctrlKey" | "metaKey" | "shiftKey">) {
    setSelectedIds((current) => {
      if (event.shiftKey && anchorIndexRef.current !== undefined) {
        const start = Math.min(anchorIndexRef.current, index)
        const end = Math.max(anchorIndexRef.current, index)
        const next = event.ctrlKey || event.metaKey ? new Set(current) : new Set<string>()
        for (let cursor = start; cursor <= end; cursor += 1) {
          const candidate = loadedRecents[cursor]
          if (candidate) next.add(candidate.bookId)
        }
        return next
      }
      if (event.ctrlKey || event.metaKey) {
        const next = new Set(current)
        if (next.has(item.bookId)) next.delete(item.bookId)
        else next.add(item.bookId)
        return next
      }
      return new Set([item.bookId])
    })
    if (!event.shiftKey) anchorIndexRef.current = index
    focusRecent(index)
  }

  function selectAllLoaded() {
    setSelectedIds(new Set(loadedRecents.map((item) => item.bookId)))
  }

  function invertLoadedSelection() {
    setSelectedIds((current) => new Set(loadedRecents.flatMap((item) => current.has(item.bookId) ? [] : [item.bookId])))
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  function requestSelectedDelete() {
    if (!selectedIds.size) return
    setPendingDelete({ ids: [...selectedIds], batch: true })
  }

  function handleCardKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target
    if (target instanceof HTMLElement && (
      target.isContentEditable
      || target.tagName === "INPUT"
      || target.tagName === "TEXTAREA"
      || target.tagName === "SELECT"
    )) return
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "a") {
      event.preventDefault()
      selectAllLoaded()
    } else if (event.key === "Delete" && selectedIds.size) {
      event.preventDefault()
      requestSelectedDelete()
    } else if (event.key === "Escape" && selectedIds.size) {
      event.preventDefault()
      clearSelection()
    }
  }

  function moveFocus(index: number, event: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "shiftKey">) {
    const targetIndex = Math.min(Math.max(index, 0), Math.max(0, loadedRecents.length - 1))
    const item = loadedRecents[targetIndex]
    if (!item) return
    focusRecent(targetIndex)
    if (event.shiftKey) selectRecent(item, targetIndex, event)
  }

  async function confirmDelete() {
    if (!pendingDelete?.ids.length) return
    const request = pendingDelete
    const removedIds: string[] = []
    setActionError(undefined)
    try {
      if (request.batch) {
        if (!client.removeRecents) throw new Error("当前后端不支持批量删除历史记录")
        for (let offset = 0; offset < request.ids.length; offset += 500) {
          const chunk = request.ids.slice(offset, offset + 500)
          await client.removeRecents(chunk)
          removedIds.push(...chunk)
        }
      } else {
        if (!client.removeRecent) throw new Error("当前后端不支持删除历史记录")
        await client.removeRecent(request.ids[0]!)
        removedIds.push(request.ids[0]!)
      }
      setPendingDelete(undefined)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      if (removedIds.length) {
        const removed = new Set(removedIds)
        setSelectedIds((current) => new Set([...current].filter((id) => !removed.has(id))))
        setRevision((value) => value + 1)
      }
    }
  }

  return (
    <div
      className="flex h-full min-h-0 w-full flex-1 flex-col gap-2"
      data-neoview-history-card="true"
      data-testid="history-card"
      data-history-state={panelActive ? "ready" : "inactive"}
      data-selection-count={selectedIds.size}
      data-history-view-mode={viewMode}
      onKeyDown={handleCardKeyDown}
    >
      {!panelActive ? (
        <div className="grid min-h-24 place-items-center rounded border bg-background/60 px-3 py-4 text-center text-xs text-muted-foreground" data-history-empty-shell="true">
          暂无阅读历史
        </div>
      ) : null}
      {panelActive ? <>
      <Suspense fallback={null}>
        <LazyHistoryContextActions
          client={client}
          disabled={disabled}
          items={loadedRecents}
          copyText={systemActions?.copyText}
          onOpen={onOpen ? openRecent : undefined}
          onBrowseFolder={onBrowsePath ? (item) => onBrowsePath(libraryItemFolderPath(item.source.path, item.source.kind === "directory")) : undefined}
          onOpenInNewTab={onOpenInNewTab ? (item) => onOpenInNewTab(libraryItemFolderPath(item.source.path, item.source.kind === "directory")) : undefined}
          onReloadThumbnail={(item) => thumbnails.refresh(item.bookId)}
          onRemove={async (item) => {
            if (!client.removeRecent) throw new Error("当前后端不支持删除历史记录")
            await client.removeRecent(item.bookId)
          }}
          onChanged={() => setRevision((value) => value + 1)}
        />
      </Suspense>
      {selectedIds.size ? (
        <div className="flex min-w-0 items-center gap-1 rounded border bg-muted/30 px-2 py-1" aria-label="历史记录选择操作">
          <span className="mr-auto text-xs tabular-nums" aria-live="polite">{selectedIds.size} / {loadedRecents.length}</span>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="选择全部已加载历史记录"
            title="选择全部"
            disabled={selectedIds.size === loadedRecents.length}
            onClick={selectAllLoaded}
          >
            <CheckSquare />
          </Button>
          <Button type="button" size="icon-sm" variant="ghost" aria-label="反选已加载历史记录" title="反选" onClick={invertLoadedSelection}><Square /></Button>
          <Button type="button" size="icon-sm" variant="ghost" aria-label="取消全部历史记录选择" title="取消全部" onClick={clearSelection}><SquareX /></Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="删除所选历史记录"
            title="删除所选"
            disabled={disabled || !client.removeRecents}
            onClick={requestSelectedDelete}
          >
            <Trash2 />
          </Button>
          <Button type="button" size="icon-sm" variant="ghost" aria-label="退出历史记录选择" title="退出选择" onClick={clearSelection}><X /></Button>
        </div>
      ) : null}
      {actionError ? <div role="alert" className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">{actionError}</div> : null}
      {cleanupMessage ? <div role="status" className="rounded bg-emerald-500/10 px-2 py-1 text-xs text-emerald-700">{cleanupMessage}</div> : null}
      <ReaderLibraryList
        queryKey={`history:${deferredSearch}:${sort.field}:${sort.order}`}
        revision={revision}
        loadPage={loadPage}
        emptyLabel="暂无阅读历史"
        refreshLabel="刷新历史记录"
        {...listLayout}
        toolbar={(
          <ReaderLibraryViewToolbar
            label="历史记录视图"
            value={viewMode}
            disabled={disabled || switchingView}
            onValueChange={(mode) => void changeViewMode(mode)}
            search={search}
            onSearchChange={setSearch}
            sort={sort}
            onSortChange={setSort}
            trailing={(
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="高级清理历史记录"
                title="高级清理"
                disabled={disabled || !client.cleanupRecents}
                onClick={() => { setCleanupMessage(undefined); setCleanupOpen(true) }}
              >
                <SlidersHorizontal />
              </Button>
            )}
          />
        )}
        onViewportWidthChange={handleViewportWidthChange}
        getItemKey={(item) => item.bookId}
        onVisibleItemsChange={setVisibleRecents}
        onItemsChange={handleLoadedItems}
        focusIndex={focusedIndex}
        listLabel="阅读历史"
        renderRow={(item, index) => (
          <HistoryRow
            item={item}
            index={index}
            viewMode={viewMode}
            selected={selectedIds.has(item.bookId)}
            focused={focusedIndex === undefined ? index === 0 : focusedIndex === index}
            columnCount={listLayout.columns}
            disabled={disabled}
            canOpen={Boolean(onOpen)}
            thumbnailUrl={thumbnails.urls.get(item.bookId)}
            thumbnailUrls={thumbnails.urlSets.get(item.bookId)}
            thumbnailLoading={thumbnails.loading}
            onSelect={selectRecent}
            onFocus={focusRecent}
            onMoveFocus={moveFocus}
            onOpen={() => void openRecent(item)}
            onRemove={() => setPendingDelete({ ids: [item.bookId], batch: false })}
          />
        )}
      />

      <Dialog open={Boolean(pendingDelete)} onOpenChange={(open) => { if (!open) setPendingDelete(undefined) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{pendingDelete?.batch ? "删除所选历史记录" : "删除历史记录"}</DialogTitle>
            <DialogDescription>从阅读历史中移除 {pendingDelete?.ids.length ?? 0} 个项目？源文件不会被删除。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingDelete(undefined)}>取消</Button>
            <Button type="button" variant="destructive" disabled={disabled} onClick={() => void confirmDelete()}>删除历史</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {cleanupOpen ? (
        <Suspense fallback={<div className="h-24 animate-pulse rounded bg-muted" aria-label="正在加载高级清理" />}>
          <LazyHistoryCleanupDialog
            open={cleanupOpen}
            client={client}
            pickDirectory={pickDirectory}
            onOpenChange={setCleanupOpen}
            onCompleted={(result) => {
              clearSelection()
              setCleanupMessage(result.message)
              setRevision((value) => value + 1)
            }}
          />
        </Suspense>
      ) : null}
      </> : null}
    </div>
  )
}

function HistoryRow({ item, index, viewMode, selected, focused, columnCount, disabled, canOpen, thumbnailUrl, thumbnailUrls, thumbnailLoading, onSelect, onFocus, onMoveFocus, onOpen, onRemove }: {
  item: ReaderRecentDto
  index: number
  viewMode: HistoryViewMode
  selected: boolean
  focused: boolean
  columnCount: number
  disabled: boolean
  canOpen: boolean
  thumbnailUrl?: string
  thumbnailUrls?: readonly string[]
  thumbnailLoading: boolean
  onSelect(item: ReaderRecentDto, index: number, event: Pick<MouseEvent, "ctrlKey" | "metaKey" | "shiftKey">): void
  onFocus(index: number): void
  onMoveFocus(index: number, event: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "shiftKey">): void
  onOpen(): void
  onRemove(): void
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Enter" && canOpen) {
      event.preventDefault()
      onOpen()
      return
    }
    if (event.key === " ") {
      event.preventDefault()
      onSelect(item, index, event)
      return
    }
    const targetIndex = event.key === "ArrowDown" ? index + columnCount
      : event.key === "ArrowUp" ? index - columnCount
        : event.key === "ArrowRight" && columnCount > 1 ? index + 1
          : event.key === "ArrowLeft" && columnCount > 1 ? index - 1
        : event.key === "Home" ? 0
          : event.key === "End" ? Number.MAX_SAFE_INTEGER
            : undefined
    if (targetIndex === undefined) return
    event.preventDefault()
    onMoveFocus(targetIndex, event)
  }

  const progressPage = Math.min(item.pageIndex + 1, item.pageCount)
  const kind = item.source.kind === "directory" ? "folder" : "file"
  return (
    <ReaderEntrySurface
      variant={readerLibrarySurfaceVariant(viewMode)}
      selected={selected}
      data-context-menu="neoview-history-entry"
      data-history-context-id={item.bookId}
      data-history-id={item.bookId}
      leading={viewMode === "compact" || viewMode === "cover-list" ? <Checkbox checked={selected} aria-label={`选择历史记录：${item.displayName}`} onCheckedChange={() => onSelect(item, index, { ctrlKey: true, metaKey: false, shiftKey: false })} /> : undefined}
      media={(
        <ReaderThumbnailSurface
          url={thumbnailUrl}
          urls={thumbnailUrls}
          kind={kind}
          fit="cover"
          loading={thumbnailLoading}
          className={readerLibraryMediaClassName(viewMode)}
        />
      )}
      primary={item.displayName}
      secondary={viewMode === "cover-grid" ? undefined : <span title={item.source.path}>{item.source.path}</span>}
      tertiary={viewMode === "cover-list" || viewMode === "mosaic-list" ? `第 ${progressPage} / ${item.pageCount} 页 · ${formatLibraryTime(item.updatedAt)}` : undefined}
      buttonProps={{
        title: item.source.path,
        "aria-pressed": selected,
        disabled,
        tabIndex: focused ? 0 : -1,
        "data-context-menu": "neoview-history-entry",
         "data-history-context-id": item.bookId,
         "data-history-row-button": index,
         "data-testid": focused ? "history-focus" : undefined,
         "data-library-item-focus": "true",
        onFocus: () => onFocus(index),
        onClick: (event) => {
          if (readerEntryClickIntent(event) === "select") onSelect(item, index, event)
          else if (canOpen) onOpen()
        },
        onKeyDown: handleKeyDown,
      }}
      trailing={viewMode === "compact" || viewMode === "cover-list" ? (
        <span className="flex shrink-0 items-center">
          <Button type="button" size="icon-sm" variant="ghost" aria-label={`继续阅读：${item.displayName}`} title="继续阅读" disabled={disabled || !canOpen} onClick={onOpen}><BookOpen /></Button>
          <Button type="button" size="icon-sm" variant="ghost" aria-label={`删除历史：${item.displayName}`} title="删除历史" disabled={disabled} onClick={onRemove}><Trash2 /></Button>
        </span>
      ) : undefined}
    />
  )
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value))
}

function libraryViewFromPreference(value: "compact" | "content" | "banner" | "thumbnail" | undefined): HistoryViewMode {
  if (value === "content") return "cover-list"
  if (value === "banner") return "mosaic-list"
  if (value === "thumbnail") return "cover-grid"
  return "compact"
}

function libraryViewPreference(value: HistoryViewMode): "compact" | "content" | "banner" | "thumbnail" {
  if (value === "cover-list") return "content"
  if (value === "mosaic-list") return "banner"
  if (value === "cover-grid") return "thumbnail"
  return "compact"
}
