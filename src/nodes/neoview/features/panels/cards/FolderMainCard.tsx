import {
  Virtuoso,
  VirtuosoGrid,
  type GridStateSnapshot,
  type ListRange,
  type StateSnapshot,
  type VirtuosoGridHandle,
  type VirtuosoHandle,
} from "react-virtuoso"
import { ArrowDownAZ, ArrowLeft, ArrowRight, ArrowUp, ArrowUpAZ, File, Folder, Grid2X2, List, Lock, MoreHorizontal, RefreshCw, Unlock } from "lucide-react"
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type {
  ReaderDirectoryEntryDto,
  ReaderDirectoryNavigationDto,
  ReaderDirectoryPageDto,
  ReaderDirectorySortDto,
  ReaderDirectorySortFieldDto,
  ReaderDirectorySortPreferenceCommandDto,
  ReaderDirectorySortSourceDto,
} from "../../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../registry"
import {
  createDirectoryCatalog,
  directoryEntryAt,
  directoryLoadedEntries,
  directoryPageCursors,
  mergeDirectoryPage,
  trimDirectoryPages,
  type DirectoryCatalog,
} from "./folder/DirectoryCatalog"

const PAGE_SIZE = 128
const MAX_CACHED_PAGES = 12
const MAX_HISTORY_STATES = 64
const MAX_THUMBNAILS = 64
const LIST_HEIGHT = 288
const SORT_LABELS: Record<ReaderDirectorySortFieldDto, string> = {
  name: "名称",
  date: "修改时间",
  size: "大小",
  type: "类型",
  random: "随机",
  rating: "评分",
  path: "路径",
  collectTagCount: "收藏标签数",
}
const SORT_SOURCE_LABELS: Record<ReaderDirectorySortSourceDto, string> = {
  temporary: "当前目录临时规则",
  memory: "文件夹记忆",
  "tab-default": "标签默认",
  "global-default": "全局默认",
}

type FolderViewMode = "compact" | "cover-grid"

interface SavedDirectoryState {
  viewMode: FolderViewMode
  selectedPaths: readonly string[]
  focusedPath?: string
  focusedIndex?: number
  anchorIndex: number
  listSnapshot?: StateSnapshot
  gridSnapshot?: GridStateSnapshot
}

export default function FolderMainCard({ client, disabled, sourcePath, onOpen }: ReaderPanelContext) {
  const sessionIdRef = useRef<string | undefined>(undefined)
  const catalogRef = useRef<DirectoryCatalog | undefined>(undefined)
  const navigationRequestRef = useRef<AbortController | undefined>(undefined)
  const catalogRequestRef = useRef<AbortController | undefined>(undefined)
  const thumbnailRequestRef = useRef<AbortController | undefined>(undefined)
  const pendingCursorsRef = useRef(new Set<number>())
  const navigationGenerationRef = useRef(0)
  const thumbnailGenerationRef = useRef(0)
  const thumbnailContextSequenceRef = useRef(0)
  const thumbnailContextRef = useRef<string | undefined>(undefined)
  const thumbnailSignatureRef = useRef("")
  const visibleRangeRef = useRef<ListRange>({ startIndex: 0, endIndex: 0 })
  const listRef = useRef<VirtuosoHandle>(null)
  const gridRef = useRef<VirtuosoGridHandle>(null)
  const gridSnapshotRef = useRef<GridStateSnapshot | undefined>(undefined)
  const focusedIndexRef = useRef<number | undefined>(undefined)
  const historyStatesRef = useRef(new Map<string, SavedDirectoryState>())
  const [draftPath, setDraftPath] = useState(sourcePath ?? "")
  const [catalog, setCatalog] = useState<DirectoryCatalog>()
  const [viewMode, setViewMode] = useState<FolderViewMode>("compact")
  const [restoreState, setRestoreState] = useState<SavedDirectoryState>()
  const [selectedPaths, setSelectedPaths] = useState<ReadonlySet<string>>(() => new Set())
  const [focusedPath, setFocusedPath] = useState<string>()
  const [thumbnailUrls, setThumbnailUrls] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!sourcePath) return
    setDraftPath(sourcePath)
    void openBrowser(sourcePath)
    return disposeBrowser
  }, [sourcePath])

  useEffect(() => {
    if (!catalog || viewMode !== "cover-grid") return
    registerVisibleThumbnails()
  }, [catalog?.sessionId, catalog?.generation, viewMode])

  function registerVisibleThumbnails() {
    const current = catalogRef.current
    if (!current || viewMode !== "cover-grid" || !client.registerLibraryThumbnails) return
    const range = visibleRangeRef.current
    const visible = directoryLoadedEntries(current, range.startIndex, range.endIndex, MAX_THUMBNAILS)
      .filter(({ entry }) => entry.kind === "directory" || entry.kind === "file")
    if (!visible.length) return
    const signature = `${current.sessionId}:${current.generation}:${visible.map(({ index, entry }) => `${index}:${entry.path}`).join("|")}`
    if (thumbnailSignatureRef.current === signature) return
    thumbnailSignatureRef.current = signature
    thumbnailRequestRef.current?.abort()
    const request = new AbortController()
    thumbnailRequestRef.current = request
    const generation = ++thumbnailGenerationRef.current
    const contextId = thumbnailContextRef.current ?? `folder:${current.sessionId}:${++thumbnailContextSequenceRef.current}`
    thumbnailContextRef.current = contextId
    const pathById = new Map(visible.map(({ index, entry }) => [String(index), entry.path]))
    void client.registerLibraryThumbnails(
      contextId,
      generation,
      visible.map(({ index, entry }) => ({
        id: String(index),
        path: entry.path,
        kind: entry.kind === "directory" ? "folder" : "file",
      })),
      request.signal,
    ).then((batch) => {
      if (request.signal.aborted || generation !== thumbnailGenerationRef.current) return
      setThumbnailUrls(new Map(batch.items.flatMap((item) => {
        const path = pathById.get(item.id)
        return path ? [[path, item.thumbnailUrl] as const] : []
      })))
    }).catch((cause) => {
      if (!request.signal.aborted && !isAbortError(cause)) setThumbnailUrls(new Map())
    })
  }

  useEffect(() => {
    if (!catalog || !restoreState) return
    const index = Math.min(Math.max(restoreState.focusedIndex ?? restoreState.anchorIndex, 0), Math.max(0, catalog.total - 1))
    requestRange({ startIndex: index, endIndex: index })
    if (viewMode === "compact" && !restoreState.listSnapshot) {
      queueMicrotask(() => listRef.current?.scrollToIndex({ index, align: "center" }))
    } else if (viewMode === "cover-grid" && !restoreState.gridSnapshot) {
      queueMicrotask(() => gridRef.current?.scrollToIndex({ index, align: "center" }))
    }
  }, [catalog?.sessionId, catalog?.generation, restoreState, viewMode])

  async function openBrowser(path: string) {
    const normalized = path.trim()
    if (!normalized || !client.openDirectoryBrowser) return
    const generation = beginNavigation()
    setLoading(true)
    setError(undefined)
    try {
      const opened = await client.openDirectoryBrowser(normalized, navigationRequestRef.current?.signal)
      if (generation !== navigationGenerationRef.current) {
        void client.closeDirectoryBrowser?.(opened.sessionId).catch(() => undefined)
        return
      }
      const previous = sessionIdRef.current
      if (previous && previous !== opened.sessionId) releaseThumbnailContext()
      sessionIdRef.current = opened.sessionId
      applyPage(opened)
      if (previous && previous !== opened.sessionId) void client.closeDirectoryBrowser?.(previous).catch(() => undefined)
    } catch (cause) {
      if (generation === navigationGenerationRef.current && !navigationRequestRef.current?.signal.aborted) setError(errorMessage(cause))
    } finally {
      if (generation === navigationGenerationRef.current) setLoading(false)
    }
  }

  async function navigate(navigation: ReaderDirectoryNavigationDto) {
    const sessionId = sessionIdRef.current
    if (!sessionId) {
      if (navigation.action === "path") await openBrowser(navigation.path)
      return
    }
    if (!client.navigateDirectoryBrowser) return
    captureCurrentState()
    const generation = beginNavigation()
    setLoading(true)
    setError(undefined)
    try {
      const result = await client.navigateDirectoryBrowser(sessionId, navigation, navigationRequestRef.current?.signal)
      if (generation === navigationGenerationRef.current) applyPage(result)
    } catch (cause) {
      if (generation === navigationGenerationRef.current && !navigationRequestRef.current?.signal.aborted) setError(errorMessage(cause))
    } finally {
      if (generation === navigationGenerationRef.current) setLoading(false)
    }
  }

  function applyPage(page: ReaderDirectoryPageDto, preferredState?: SavedDirectoryState) {
    catalogRequestRef.current?.abort()
    catalogRequestRef.current = new AbortController()
    pendingCursorsRef.current.clear()
    releaseThumbnailContext()
    setThumbnailUrls(new Map())
    const next = createDirectoryCatalog(page)
    commitCatalog(next)
    setDraftPath(page.path)
    visibleRangeRef.current = { startIndex: 0, endIndex: 0 }
    const saved = historyStatesRef.current.get(page.path)
    const suggested = page.suggestedSelection
    const restored: SavedDirectoryState = preferredState ?? saved ?? {
      viewMode,
      selectedPaths: suggested ? [suggested.path] : [],
      focusedPath: suggested?.path,
      focusedIndex: suggested?.index,
      anchorIndex: suggested?.index ?? 0,
    }
    focusedIndexRef.current = restored.focusedIndex
    setViewMode(restored.viewMode)
    setRestoreState(restored)
    setSelectedPaths(new Set(restored.selectedPaths))
    setFocusedPath(restored.focusedPath)
  }

  async function updateSort(sort: ReaderDirectorySortDto) {
    const sessionId = sessionIdRef.current
    const current = catalogRef.current
    if (!sessionId || !current || !client.sortDirectoryBrowser) return
    captureCurrentState()
    const generation = beginNavigation()
    setLoading(true)
    setError(undefined)
    try {
      const result = await client.sortDirectoryBrowser(sessionId, sort, focusedPath, navigationRequestRef.current?.signal)
      if (generation !== navigationGenerationRef.current) return
      const focusIndex = result.suggestedSelection?.index
      applyPage(result, {
        viewMode,
        selectedPaths: [...selectedPaths],
        focusedPath,
        focusedIndex: focusIndex,
        anchorIndex: focusIndex ?? 0,
      })
    } catch (cause) {
      if (generation === navigationGenerationRef.current && !navigationRequestRef.current?.signal.aborted) setError(errorMessage(cause))
    } finally {
      if (generation === navigationGenerationRef.current) setLoading(false)
    }
  }

  async function updateSortPreference(command: ReaderDirectorySortPreferenceCommandDto) {
    const sessionId = sessionIdRef.current
    const current = catalogRef.current
    if (!sessionId || !current || !client.updateDirectorySortPreference) return
    captureCurrentState()
    const generation = beginNavigation()
    setLoading(true)
    setError(undefined)
    try {
      const result = await client.updateDirectorySortPreference(
        sessionId,
        command,
        focusedPath,
        navigationRequestRef.current?.signal,
      )
      if (generation !== navigationGenerationRef.current) return
      const focusIndex = result.suggestedSelection?.index
      applyPage(result, {
        viewMode,
        selectedPaths: [...selectedPaths],
        focusedPath,
        focusedIndex: focusIndex,
        anchorIndex: focusIndex ?? 0,
      })
    } catch (cause) {
      if (generation === navigationGenerationRef.current && !navigationRequestRef.current?.signal.aborted) setError(errorMessage(cause))
    } finally {
      if (generation === navigationGenerationRef.current) setLoading(false)
    }
  }

  function requestRange(range: ListRange) {
    visibleRangeRef.current = range
    const current = catalogRef.current
    if (!current || !client.listDirectoryBrowser) return
    const cursors = directoryPageCursors(range.startIndex - 16, range.endIndex + 16, current.total, PAGE_SIZE)
    for (const cursor of cursors) {
      if (current.pages.has(cursor) || pendingCursorsRef.current.has(cursor)) continue
      pendingCursorsRef.current.add(cursor)
      const sessionId = current.sessionId
      const generation = current.generation
      const requestSignal = catalogRequestRef.current?.signal
      void client.listDirectoryBrowser(sessionId, cursor, PAGE_SIZE, requestSignal)
        .then((page) => {
          const latest = catalogRef.current
          if (!latest || latest.sessionId !== sessionId || latest.generation !== generation) return
          const merged = mergeDirectoryPage(latest, page)
          const center = Math.floor((visibleRangeRef.current.startIndex + visibleRangeRef.current.endIndex) / 2)
          commitCatalog(trimDirectoryPages(merged, center, MAX_CACHED_PAGES))
          queueMicrotask(registerVisibleThumbnails)
        })
        .catch((cause) => {
          if (!requestSignal?.aborted && !isAbortError(cause)) setError(errorMessage(cause))
        })
        .finally(() => {
          const latest = catalogRef.current
          if (latest?.sessionId === sessionId && latest.generation === generation) pendingCursorsRef.current.delete(cursor)
        })
    }
    queueMicrotask(registerVisibleThumbnails)
  }

  function captureCurrentState() {
    const current = catalogRef.current
    if (!current) return
    const range = visibleRangeRef.current
    const state: SavedDirectoryState = {
      viewMode,
      selectedPaths: [...selectedPaths],
      focusedPath,
      focusedIndex: focusedIndexRef.current,
      anchorIndex: range.startIndex,
      gridSnapshot: viewMode === "cover-grid" ? gridSnapshotRef.current : undefined,
    }
    rememberState(current.path, state)
    if (viewMode === "compact") {
      listRef.current?.getState((snapshot) => {
        const latest = historyStatesRef.current.get(current.path)
        if (latest) rememberState(current.path, { ...latest, listSnapshot: snapshot })
      })
    }
  }

  function switchView(next: FolderViewMode) {
    if (next === viewMode) return
    captureCurrentState()
    const current = catalogRef.current
    const anchorIndex = focusedIndexRef.current ?? visibleRangeRef.current.startIndex
    const nextState: SavedDirectoryState = {
      viewMode: next,
      selectedPaths: [...selectedPaths],
      focusedPath,
      focusedIndex: focusedIndexRef.current,
      anchorIndex,
    }
    if (current) rememberState(current.path, nextState)
    if (next === "compact") {
      releaseThumbnailContext()
      setThumbnailUrls(new Map())
    }
    setRestoreState(nextState)
    setViewMode(next)
  }

  function selectEntry(entry: ReaderDirectoryEntryDto, index: number, event: ReactMouseEvent) {
    focusedIndexRef.current = index
    setFocusedPath(entry.path)
    if (event.ctrlKey || event.metaKey) {
      setSelectedPaths((current) => {
        const next = new Set(current)
        if (next.has(entry.path)) next.delete(entry.path)
        else next.add(entry.path)
        return next
      })
    } else {
      setSelectedPaths(new Set([entry.path]))
    }
  }

  function activate(entry: ReaderDirectoryEntryDto) {
    if (entry.kind === "directory") void navigate({ action: "path", path: entry.path })
    else if (entry.readerSupported) void onOpen?.(entry.path)
  }

  function beginNavigation(): number {
    navigationRequestRef.current?.abort()
    catalogRequestRef.current?.abort()
    thumbnailRequestRef.current?.abort()
    navigationRequestRef.current = new AbortController()
    pendingCursorsRef.current.clear()
    navigationGenerationRef.current += 1
    return navigationGenerationRef.current
  }

  function commitCatalog(next: DirectoryCatalog) {
    catalogRef.current = next
    setCatalog(next)
  }

  function rememberState(path: string, state: SavedDirectoryState) {
    const states = historyStatesRef.current
    states.delete(path)
    states.set(path, state)
    while (states.size > MAX_HISTORY_STATES) states.delete(states.keys().next().value as string)
  }

  function releaseThumbnailContext() {
    thumbnailRequestRef.current?.abort()
    thumbnailRequestRef.current = undefined
    thumbnailSignatureRef.current = ""
    const contextId = thumbnailContextRef.current
    thumbnailContextRef.current = undefined
    if (contextId) void client.releaseLibraryThumbnailContext?.(contextId).catch(() => undefined)
  }

  function disposeBrowser() {
    navigationGenerationRef.current += 1
    navigationRequestRef.current?.abort()
    catalogRequestRef.current?.abort()
    releaseThumbnailContext()
    navigationRequestRef.current = undefined
    catalogRequestRef.current = undefined
    pendingCursorsRef.current.clear()
    const sessionId = sessionIdRef.current
    sessionIdRef.current = undefined
    catalogRef.current = undefined
    if (sessionId) void client.closeDirectoryBrowser?.(sessionId).catch(() => undefined)
  }

  const loadedCount = catalog ? [...catalog.pages.values()].reduce((total, entries) => total + entries.length, 0) : 0
  const virtualKey = catalog ? `${catalog.sessionId}:${catalog.generation}:${viewMode}` : viewMode

  return (
    <div className="grid min-h-0 gap-2" data-neoview-folder-card="true">
      <form
        className="flex gap-1"
        onSubmit={(event) => {
          event.preventDefault()
          void navigate({ action: "path", path: draftPath })
        }}
      >
        <Input aria-label="浏览路径" value={draftPath} onChange={(event) => setDraftPath(event.currentTarget.value)} />
        <Button type="submit" size="sm" variant="outline" disabled={disabled || loading || !draftPath.trim()}>转到</Button>
      </form>
      <div className="grid gap-1">
        <div className="flex min-w-0 items-center gap-1">
          <BrowserButton label="后退" disabled={!catalog?.canGoBack || loading} onClick={() => void navigate({ action: "back" })}><ArrowLeft /></BrowserButton>
          <BrowserButton label="前进" disabled={!catalog?.canGoForward || loading} onClick={() => void navigate({ action: "forward" })}><ArrowRight /></BrowserButton>
          <BrowserButton label="上级" disabled={!catalog?.parentPath || loading} onClick={() => void navigate({ action: "up" })}><ArrowUp /></BrowserButton>
          <BrowserButton label="刷新" disabled={!catalog || loading} onClick={() => void navigate({ action: "refresh" })}><RefreshCw className={loading ? "animate-spin" : undefined} /></BrowserButton>
          <ToggleGroup
            type="single"
            size="sm"
            value={viewMode}
            className="ml-auto"
            onValueChange={(value) => { if (value) switchView(value as FolderViewMode) }}
          >
            <ToggleGroupItem value="compact" aria-label="紧凑列表" title="紧凑列表"><List /></ToggleGroupItem>
            <ToggleGroupItem value="cover-grid" aria-label="封面网格" title="封面网格"><Grid2X2 /></ToggleGroupItem>
          </ToggleGroup>
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{loadedCount} / {catalog?.total ?? 0}</span>
        </div>
        {catalog ? (
          <div className="grid grid-cols-[minmax(6rem,1fr)_2rem_2rem_2rem] items-center gap-1">
            <Select
              value={catalog.sort.field}
              disabled={loading || !client.sortDirectoryBrowser}
              onValueChange={(field) => void updateSort({ ...catalog.sort, field: field as ReaderDirectorySortFieldDto })}
            >
              <SelectTrigger size="sm" className="h-7 min-w-0 text-xs" aria-label="排序字段">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {catalog.sortFields.map((field) => <SelectItem key={field} value={field}>{SORT_LABELS[field]}</SelectItem>)}
              </SelectContent>
            </Select>
            <BrowserButton
              label={catalog.sort.order === "asc" ? "升序" : "降序"}
              disabled={loading || !client.sortDirectoryBrowser}
              onClick={() => void updateSort({ ...catalog.sort, order: catalog.sort.order === "asc" ? "desc" : "asc" })}
            >
              {catalog.sort.order === "asc" ? <ArrowUpAZ /> : <ArrowDownAZ />}
            </BrowserButton>
            <BrowserButton
              label={catalog.sortTemporary ? "取消临时排序" : "锁定当前目录排序"}
              disabled={loading || !client.updateDirectorySortPreference}
              onClick={() => void updateSortPreference({ action: "temporary", enabled: !catalog.sortTemporary })}
            >
              {catalog.sortTemporary ? <Lock /> : <Unlock />}
            </BrowserButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="排序设置"
                  title="排序设置"
                  disabled={loading || !client.updateDirectorySortPreference}
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>{SORT_SOURCE_LABELS[catalog.sortSource]}</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => void updateSortPreference({ action: "set-default", scope: "tab" })}>
                  设为标签默认
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void updateSortPreference({ action: "set-default", scope: "global" })}>
                  设为全局默认
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void updateSortPreference({ action: "clear-memory", scope: "current" })}>
                  清除此文件夹记忆
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void updateSortPreference({ action: "clear-memory", scope: "all" })}>
                  清除全部排序记忆
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </div>
      {error ? <div role="alert" className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">{error}</div> : null}
      <div className="min-h-32 overflow-hidden rounded border bg-background/60" data-neoview-folder-list="true">
        {catalog && viewMode === "compact" ? (
          <Virtuoso
            key={virtualKey}
            ref={listRef}
            style={{ height: LIST_HEIGHT }}
            totalCount={catalog.total}
            fixedItemHeight={34}
            increaseViewportBy={{ top: 68, bottom: 136 }}
            computeItemKey={(index) => directoryEntryAt(catalog, index)?.path ?? `${catalog.generation}:${index}`}
            rangeChanged={requestRange}
            restoreStateFrom={restoreState?.viewMode === "compact" ? restoreState.listSnapshot : undefined}
            itemContent={(index) => {
              const entry = directoryEntryAt(catalog, index)
              return (
                <DirectoryListItem
                  entry={entry}
                  index={index}
                  disabled={disabled}
                  selected={Boolean(entry && selectedPaths.has(entry.path))}
                  focused={entry?.path === focusedPath}
                  onSelect={selectEntry}
                  onActivate={activate}
                />
              )
            }}
          />
        ) : null}
        {catalog && viewMode === "cover-grid" ? (
          <VirtuosoGrid
            key={virtualKey}
            ref={gridRef}
            style={{ height: LIST_HEIGHT }}
            totalCount={catalog.total}
            listClassName="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-1 p-1"
            itemClassName="min-w-0"
            increaseViewportBy={{ top: 144, bottom: 288 }}
            computeItemKey={(index) => directoryEntryAt(catalog, index)?.path ?? `${catalog.generation}:${index}`}
            rangeChanged={requestRange}
            restoreStateFrom={restoreState?.viewMode === "cover-grid" ? restoreState.gridSnapshot : undefined}
            stateChanged={(snapshot) => { gridSnapshotRef.current = snapshot }}
            itemContent={(index) => {
              const entry = directoryEntryAt(catalog, index)
              return (
                <DirectoryGridItem
                  entry={entry}
                  index={index}
                  disabled={disabled}
                  selected={Boolean(entry && selectedPaths.has(entry.path))}
                  focused={entry?.path === focusedPath}
                  thumbnailUrl={entry ? thumbnailUrls.get(entry.path) : undefined}
                  onSelect={selectEntry}
                  onActivate={activate}
                />
              )
            }}
          />
        ) : null}
        {!catalog ? <div className="grid h-72 place-items-center text-xs text-muted-foreground">{loading ? "正在读取目录…" : "选择一个目录"}</div> : null}
      </div>
    </div>
  )
}

function DirectoryListItem({ entry, index, disabled, selected, focused, onSelect, onActivate }: DirectoryItemProps) {
  if (!entry) return <div className="h-[34px] animate-pulse border-b bg-muted/30" aria-hidden="true" />
  return (
    <button
      type="button"
      className="flex h-[34px] w-full items-center gap-2 border-b px-2 text-left text-xs hover:bg-muted aria-selected:bg-accent"
      aria-selected={selected}
      data-focused={focused || undefined}
      disabled={disabled}
      title={entry.path}
      onClick={(event) => onSelect(entry, index, event)}
      onDoubleClick={() => onActivate(entry)}
      onKeyDown={(event) => { if (event.key === "Enter") onActivate(entry) }}
    >
      <EntryIcon entry={entry} />
      <span className="truncate">{entry.name}</span>
    </button>
  )
}

function DirectoryGridItem({ entry, index, disabled, selected, focused, thumbnailUrl, onSelect, onActivate }: DirectoryItemProps & { thumbnailUrl?: string }) {
  if (!entry) return <div className="h-36 animate-pulse rounded bg-muted/30" aria-hidden="true" />
  return (
    <button
      type="button"
      className="grid h-36 w-full grid-rows-[1fr_auto] overflow-hidden rounded border bg-background text-left text-xs hover:bg-muted aria-selected:border-primary aria-selected:bg-accent"
      aria-selected={selected}
      data-focused={focused || undefined}
      disabled={disabled}
      title={entry.path}
      onClick={(event) => onSelect(entry, index, event)}
      onDoubleClick={() => onActivate(entry)}
      onKeyDown={(event) => { if (event.key === "Enter") onActivate(entry) }}
    >
      <span className="grid min-h-0 place-items-center overflow-hidden bg-muted/30">
        {thumbnailUrl
          ? <img src={thumbnailUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
          : <EntryIcon entry={entry} className="size-8" />}
      </span>
      <span className="flex min-w-0 items-center gap-1 border-t px-1.5 py-1.5">
        <EntryIcon entry={entry} className="size-3.5" />
        <span className="truncate">{entry.name}</span>
      </span>
    </button>
  )
}

interface DirectoryItemProps {
  entry?: ReaderDirectoryEntryDto
  index: number
  disabled: boolean
  selected: boolean
  focused: boolean
  onSelect(entry: ReaderDirectoryEntryDto, index: number, event: ReactMouseEvent): void
  onActivate(entry: ReaderDirectoryEntryDto): void
}

function EntryIcon({ entry, className = "size-4" }: { entry: ReaderDirectoryEntryDto; className?: string }) {
  return entry.kind === "directory"
    ? <Folder className={`${className} shrink-0 text-amber-500`} />
    : <File className={`${className} shrink-0 text-muted-foreground`} />
}

function BrowserButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick(): void; children: ReactNode }) {
  return <Button type="button" size="icon-sm" variant="ghost" aria-label={label} title={label} disabled={disabled} onClick={onClick}>{children}</Button>
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
