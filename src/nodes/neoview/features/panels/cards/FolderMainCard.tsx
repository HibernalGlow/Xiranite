import {
  Virtuoso,
  VirtuosoGrid,
  type GridStateSnapshot,
  type ListRange,
  type StateSnapshot,
  type VirtuosoGridHandle,
  type VirtuosoHandle,
} from "react-virtuoso"
import { ArrowDownAZ, ArrowLeft, ArrowRight, ArrowUp, ArrowUpAZ, CheckSquare, File, Folder, GalleryHorizontalEnd, Grid2X2, Heart, Link, List, Lock, MoreHorizontal, MousePointer2, PanelsTopLeft, RefreshCw, Rows3, Search, Square, SquareX, Star, TableProperties, Unlock, X } from "lucide-react"
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react"

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
  ReaderDirectoryMetadataFieldDto,
  ReaderDirectoryNavigationDto,
  ReaderDirectoryPageDto,
  ReaderDirectorySortDto,
  ReaderDirectorySortFieldDto,
  ReaderDirectorySortPreferenceCommandDto,
  ReaderDirectorySortSourceDto,
  ReaderFolderViewMode,
  ReaderFolderViewConfig,
} from "../../../adapters/reader-http-client"
import { READER_FOLDER_DETAIL_DEFAULT_WIDTHS } from "../../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../registry"
import {
  createDirectoryCatalog,
  directoryEntryAt,
  directoryLoadedEntries,
  directoryPageHasMetadata,
  directoryPageCursors,
  mergeDirectoryPage,
  trimDirectoryPages,
  type DirectoryCatalog,
} from "./folder/DirectoryCatalog"
import {
  chainDirectorySelection,
  createDirectorySelection,
  directorySelectionCount,
  extendDirectorySelection,
  invertDirectorySelection,
  rebaseDirectorySelection,
  selectedLoadedDirectoryPaths,
  selectAllDirectoryEntries,
  selectDirectorySingle,
  toggleDirectorySelection,
  type DirectorySelectionModel,
} from "./folder/DirectorySelection"

const PAGE_SIZE = 128
const MAX_CACHED_PAGES = 12
const MAX_HISTORY_STATES = 64
const MAX_THUMBNAILS = 64
const EMPTY_SELECTED_PATHS: ReadonlySet<string> = new Set()
const LIST_HEIGHT = 288
const DETAILS_METADATA_FIELDS: readonly ReaderDirectoryMetadataFieldDto[] = [
  "date", "size", "rating", "collectTagCount", "dimensions", "pageCount", "tags",
]
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

type FolderViewMode = ReaderFolderViewMode
type FolderPreviewCount = 4 | 9 | 16

const DEFAULT_FOLDER_VIEW: ReaderFolderViewConfig = {
  viewMode: "compact",
  previewCount: 4,
  details: {
    columnOrder: ["name", "path", "type", "extension", "size", "modifiedAt", "dimensions", "pageCount", "rating", "tags"],
    hiddenColumns: [],
    pinnedLeft: ["name"],
    pinnedRight: [],
    columnWidths: READER_FOLDER_DETAIL_DEFAULT_WIDTHS,
  },
}

const FolderDetailsView = lazy(() => import("./folder/FolderDetailsView"))
const FolderSearchPanel = lazy(() => import("./folder/FolderSearchPanel"))

interface SavedDirectoryState {
  viewMode: FolderViewMode
  previewCount: FolderPreviewCount
  multiSelectMode: boolean
  selection: DirectorySelectionModel
  focusedPath?: string
  focusedIndex?: number
  anchorIndex: number
  listSnapshot?: StateSnapshot
  gridSnapshot?: GridStateSnapshot
}

export default function FolderMainCard({ client, disabled, sourcePath, onOpen, folderView = DEFAULT_FOLDER_VIEW, onFolderView }: ReaderPanelContext) {
  const sessionIdRef = useRef<string | undefined>(undefined)
  const catalogRef = useRef<DirectoryCatalog | undefined>(undefined)
  const navigationRequestRef = useRef<AbortController | undefined>(undefined)
  const catalogRequestRef = useRef<AbortController | undefined>(undefined)
  const thumbnailRequestRef = useRef<AbortController | undefined>(undefined)
  const pendingCursorsRef = useRef(new Set<string>())
  const navigationGenerationRef = useRef(0)
  const thumbnailGenerationRef = useRef(0)
  const thumbnailContextSequenceRef = useRef(0)
  const thumbnailContextRef = useRef<string | undefined>(undefined)
  const thumbnailSignatureRef = useRef("")
  const visibleRangeRef = useRef<ListRange>({ startIndex: 0, endIndex: 0 })
  const listRef = useRef<VirtuosoHandle>(null)
  const gridRef = useRef<VirtuosoGridHandle>(null)
  const listHostRef = useRef<HTMLDivElement>(null)
  const gridSnapshotRef = useRef<GridStateSnapshot | undefined>(undefined)
  const focusedIndexRef = useRef<number | undefined>(undefined)
  const chainAnchorIndexRef = useRef<number | undefined>(undefined)
  const historyStatesRef = useRef(new Map<string, SavedDirectoryState>())
  const [draftPath, setDraftPath] = useState(sourcePath ?? "")
  const [catalog, setCatalog] = useState<DirectoryCatalog>()
  const [searchOpen, setSearchOpen] = useState(false)
  const [viewMode, setViewMode] = useState<FolderViewMode>(folderView.viewMode)
  const [previewCount, setPreviewCount] = useState<FolderPreviewCount>(folderView.previewCount)
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [chainSelectMode, setChainSelectMode] = useState(false)
  const [checkModeClickBehavior, setCheckModeClickBehavior] = useState<"open" | "select">("open")
  const [restoreState, setRestoreState] = useState<SavedDirectoryState>()
  const [selection, setSelection] = useState<DirectorySelectionModel>(() => createDirectorySelection(0))
  const [focusedPath, setFocusedPath] = useState<string>()
  const [focusedIndex, setFocusedIndex] = useState<number>()
  const [thumbnailUrls, setThumbnailUrls] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const selectedPaths = useMemo(
    () => catalog ? selectedLoadedDirectoryPaths(selection, catalog.pages) : EMPTY_SELECTED_PATHS,
    [catalog, selection],
  )

  useEffect(() => {
    if (!sourcePath) return
    setDraftPath(sourcePath)
    void openBrowser(sourcePath)
    return disposeBrowser
  }, [sourcePath])

  useEffect(() => setViewMode(folderView.viewMode), [folderView.viewMode])
  useEffect(() => setPreviewCount(folderView.previewCount), [folderView.previewCount])

  useEffect(() => {
    if (!catalog || !viewUsesThumbnails(viewMode)) return
    registerVisibleThumbnails()
  }, [catalog?.sessionId, catalog?.generation, viewMode, previewCount])

  useEffect(() => {
    if (!catalog || viewMode !== "details") return
    queueMicrotask(() => requestRange(visibleRangeRef.current))
  }, [catalog?.sessionId, catalog?.generation, viewMode])

  function registerVisibleThumbnails() {
    const current = catalogRef.current
    if (!current || !viewUsesThumbnails(viewMode) || !client.registerLibraryThumbnails) return
    const range = visibleRangeRef.current
    const visible = directoryLoadedEntries(current, range.startIndex, range.endIndex, MAX_THUMBNAILS)
      .filter(({ entry }) => entry.kind === "directory" || entry.kind === "file")
    if (!visible.length) return
    const signature = `${current.sessionId}:${current.generation}:${viewMode}:${previewCount}:${visible.map(({ index, entry }) => `${index}:${entry.path}`).join("|")}`
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
        previewCount: entry.kind === "directory" && viewUsesMosaic(viewMode) ? previewCount : 1,
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
    if (viewUsesVirtuosoList(viewMode) && !restoreState.listSnapshot) {
      queueMicrotask(() => listRef.current?.scrollToIndex({ index, align: "center" }))
    } else if (viewUsesGrid(viewMode) && !restoreState.gridSnapshot) {
      queueMicrotask(() => gridRef.current?.scrollToIndex({ index, align: "center" }))
    }
  }, [catalog?.sessionId, catalog?.generation, restoreState, viewMode])

  async function openBrowser(path: string) {
    const normalized = path.trim()
    if (!normalized || !client.openDirectoryBrowser) return
    setSearchOpen(false)
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
    setSearchOpen(false)
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
    chainAnchorIndexRef.current = undefined
    commitCatalog(next)
    setDraftPath(page.path)
    visibleRangeRef.current = { startIndex: 0, endIndex: 0 }
    const saved = historyStatesRef.current.get(page.path)
    const suggested = page.suggestedSelection
    const restored: SavedDirectoryState = preferredState ?? saved ?? {
      viewMode,
      previewCount,
      multiSelectMode: false,
      selection: suggested
        ? selectDirectorySingle(page.generation, suggested.path, suggested.index)
        : createDirectorySelection(page.generation),
      focusedPath: suggested?.path,
      focusedIndex: suggested?.index,
      anchorIndex: suggested?.index ?? 0,
    }
    const restoredSelection = restored.selection.generation === page.generation
      ? restored.selection
      : rebaseDirectorySelection(restored.selection, page.generation)
    focusedIndexRef.current = restored.focusedIndex
    setFocusedIndex(restored.focusedIndex)
    setViewMode(restored.viewMode)
    setPreviewCount(restored.previewCount)
    setMultiSelectMode(restored.multiSelectMode)
    setRestoreState({ ...restored, selection: restoredSelection })
    setSelection(restoredSelection)
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
        previewCount,
        multiSelectMode,
        selection: rebaseDirectorySelection(selection, result.generation),
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
        previewCount,
        multiSelectMode,
        selection: rebaseDirectorySelection(selection, result.generation),
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
    const metadataFields = viewMode === "details"
      ? DETAILS_METADATA_FIELDS.filter((field) => current.metadataCapabilities.includes(field))
      : []
    const cursors = directoryPageCursors(range.startIndex - 16, range.endIndex + 16, current.total, PAGE_SIZE)
    for (const cursor of cursors) {
      const requestKey = `${cursor}:${metadataFields.join(",")}`
      if ((current.pages.has(cursor) && directoryPageHasMetadata(current, cursor, metadataFields)) || pendingCursorsRef.current.has(requestKey)) continue
      pendingCursorsRef.current.add(requestKey)
      const sessionId = current.sessionId
      const generation = current.generation
      const requestSignal = catalogRequestRef.current?.signal
      const request = metadataFields.length
        ? client.listDirectoryBrowser(sessionId, cursor, PAGE_SIZE, requestSignal, metadataFields)
        : client.listDirectoryBrowser(sessionId, cursor, PAGE_SIZE, requestSignal)
      void request
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
          if (latest?.sessionId === sessionId && latest.generation === generation) pendingCursorsRef.current.delete(requestKey)
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
      previewCount,
      multiSelectMode,
      selection,
      focusedPath,
      focusedIndex: focusedIndexRef.current,
      anchorIndex: range.startIndex,
      gridSnapshot: viewUsesGrid(viewMode) ? gridSnapshotRef.current : undefined,
    }
    rememberState(current.path, state)
    if (viewUsesVirtuosoList(viewMode)) {
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
      previewCount,
      multiSelectMode,
      selection,
      focusedPath,
      focusedIndex: focusedIndexRef.current,
      anchorIndex,
    }
    if (current) rememberState(current.path, nextState)
    if (!viewUsesThumbnails(next)) {
      releaseThumbnailContext()
      setThumbnailUrls(new Map())
    }
    setRestoreState(nextState)
    setViewMode(next)
    void onFolderView?.({ viewMode: next })
  }

  function switchPreviewCount(next: FolderPreviewCount) {
    if (next === previewCount) return
    captureCurrentState()
    releaseThumbnailContext()
    setThumbnailUrls(new Map())
    setPreviewCount(next)
    thumbnailSignatureRef.current = ""
    void onFolderView?.({ previewCount: next })
  }

  function selectEntry(entry: ReaderDirectoryEntryDto, index: number, event: ReactMouseEvent) {
    const previousFocusIndex = focusedIndexRef.current
    focusedIndexRef.current = index
    setFocusedIndex(index)
    setFocusedPath(entry.path)
    const generation = catalogRef.current?.generation ?? selection.generation
    if (multiSelectMode && chainSelectMode) {
      const chainAnchorIndex = chainAnchorIndexRef.current
      setSelection((current) => chainDirectorySelection(current, generation, index, {
        anchorIndex: chainAnchorIndex,
        anchorPath: chainAnchorIndex === previousFocusIndex ? focusedPath : undefined,
        endPath: entry.path,
      }))
      chainAnchorIndexRef.current = index
    } else if (event.shiftKey) {
      setSelection((current) => extendDirectorySelection(current, generation, index, {
        additive: event.ctrlKey || event.metaKey,
        fallbackAnchor: previousFocusIndex ?? 0,
        anchorPath: focusedPath,
        endPath: entry.path,
      }))
    } else if ((multiSelectMode && checkModeClickBehavior === "select") || event.ctrlKey || event.metaKey) {
      setSelection((current) => toggleDirectorySelection(current, generation, entry.path, index))
    } else if (multiSelectMode) {
      activate(entry)
    } else {
      setSelection(selectDirectorySingle(generation, entry.path, index))
    }
  }

  function handleDirectoryKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (searchOpen || isEditableKeyboardEvent(event)) return
    const currentCatalog = catalogRef.current
    if (!currentCatalog || currentCatalog.total <= 0 || disabled || loading) return
    const currentIndex = Math.min(
      Math.max(focusedIndexRef.current ?? visibleRangeRef.current.startIndex, 0),
      currentCatalog.total - 1,
    )
    const gridColumns = viewUsesGrid(viewMode) ? visibleGridColumnCount(listHostRef.current) : 1
    const pageStep = visiblePageStep(viewMode, gridColumns)
    let targetIndex: number | undefined

    if (event.key === "ArrowUp") targetIndex = currentIndex - gridColumns
    else if (event.key === "ArrowDown") targetIndex = currentIndex + gridColumns
    else if (event.key === "ArrowLeft" && viewUsesGrid(viewMode)) targetIndex = currentIndex - 1
    else if (event.key === "ArrowRight" && viewUsesGrid(viewMode)) targetIndex = currentIndex + 1
    else if (event.key === "PageUp") targetIndex = currentIndex - pageStep
    else if (event.key === "PageDown") targetIndex = currentIndex + pageStep
    else if (event.key === "Home") targetIndex = 0
    else if (event.key === "End") targetIndex = currentCatalog.total - 1
    else if (event.key === "Enter") {
      const entry = directoryEntryAt(currentCatalog, currentIndex)
      if (entry) activate(entry)
    } else if (event.key === " ") {
      const entry = directoryEntryAt(currentCatalog, currentIndex)
      if (entry) {
        setMultiSelectMode(true)
        setSelection((current) => toggleDirectorySelection(current, currentCatalog.generation, entry.path, currentIndex))
      }
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      setMultiSelectMode(true)
      setSelection(selectAllDirectoryEntries(currentCatalog.generation))
    } else if (event.key === "Escape" && multiSelectMode) {
      setSelection(createDirectorySelection(currentCatalog.generation))
      setMultiSelectMode(false)
    } else if (event.key === "Backspace") {
      if (currentCatalog.canGoBack) void navigate({ action: "back" })
      else if (currentCatalog.parentPath) void navigate({ action: "up" })
    } else if (event.key === "F5") {
      void navigate({ action: "refresh" })
    } else {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    if (targetIndex === undefined) return
    const nextIndex = Math.min(Math.max(targetIndex, 0), currentCatalog.total - 1)
    const entry = directoryEntryAt(currentCatalog, nextIndex)
    focusedIndexRef.current = nextIndex
    setFocusedIndex(nextIndex)
    setFocusedPath(entry?.path)
    if (event.shiftKey) {
      setSelection((current) => extendDirectorySelection(current, currentCatalog.generation, nextIndex, {
        additive: event.ctrlKey || event.metaKey,
        fallbackAnchor: currentIndex,
        anchorPath: focusedPath,
        endPath: entry?.path,
      }))
    } else if (!event.ctrlKey && !event.metaKey) {
      setSelection(entry
        ? selectDirectorySingle(currentCatalog.generation, entry.path, nextIndex)
        : extendDirectorySelection(createDirectorySelection(currentCatalog.generation), currentCatalog.generation, nextIndex, {
          additive: false,
          fallbackAnchor: nextIndex,
        }))
    }
    requestRange({ startIndex: nextIndex, endIndex: nextIndex })
    if (viewUsesVirtuosoList(viewMode)) listRef.current?.scrollToIndex({ index: nextIndex, align: "center" })
    else if (viewUsesGrid(viewMode)) gridRef.current?.scrollToIndex({ index: nextIndex, align: "center" })
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
  const selectedCount = catalog ? directorySelectionCount(selection, catalog.total) : 0
  const virtualKey = catalog ? `${catalog.sessionId}:${catalog.generation}:${viewMode}:${previewCount}` : `${viewMode}:${previewCount}`

  return (
    <div
      className="grid min-h-0 gap-2"
      data-neoview-folder-card="true"
      data-selection-count={selectedCount}
      data-selection-total={catalog?.total ?? 0}
      data-selection-ranges={selection.ranges.length}
      data-selection-all={selection.allSelected || undefined}
      onKeyDownCapture={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f" && !event.nativeEvent.isComposing) {
          event.preventDefault()
          event.stopPropagation()
          setSearchOpen(true)
        }
      }}
    >
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
          <BrowserButton
            label={multiSelectMode ? "退出多选" : "多选模式"}
            disabled={!catalog || loading}
            onClick={() => {
              if (multiSelectMode) {
                setSelection(createDirectorySelection(catalog?.generation ?? selection.generation))
                chainAnchorIndexRef.current = undefined
                setChainSelectMode(false)
              }
              setMultiSelectMode((current) => !current)
            }}
          >
            <CheckSquare />
          </BrowserButton>
          <BrowserButton label="搜索文件" disabled={!catalog || loading} active={searchOpen} onClick={() => setSearchOpen((current) => !current)}><Search /></BrowserButton>
          <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">{loadedCount} / {catalog?.total ?? 0}</span>
        </div>
        <div className="flex min-w-0 items-center gap-1">
          <ToggleGroup
            type="single"
            size="sm"
            value={viewMode}
            className="min-w-0"
            onValueChange={(value) => { if (value) switchView(value as FolderViewMode) }}
          >
            <ToggleGroupItem value="compact" aria-label="紧凑列表" title="紧凑列表"><List /></ToggleGroupItem>
            <ToggleGroupItem value="cover-list" aria-label="封面列表" title="封面列表"><Rows3 /></ToggleGroupItem>
            <ToggleGroupItem value="mosaic-list" aria-label="多图列表" title="多图列表"><GalleryHorizontalEnd /></ToggleGroupItem>
            <ToggleGroupItem value="details" aria-label="详细信息" title="详细信息"><TableProperties /></ToggleGroupItem>
            <ToggleGroupItem value="cover-grid" aria-label="封面网格" title="封面网格"><Grid2X2 /></ToggleGroupItem>
            <ToggleGroupItem value="mosaic-grid" aria-label="多图网格" title="多图网格"><PanelsTopLeft /></ToggleGroupItem>
          </ToggleGroup>
          {viewUsesMosaic(viewMode) ? (
            <Select value={String(previewCount)} onValueChange={(value) => switchPreviewCount(Number(value) as FolderPreviewCount)}>
              <SelectTrigger size="sm" className="ml-auto h-7 w-[5.25rem] text-xs" aria-label="多图数量"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="4">4 图</SelectItem>
                <SelectItem value="9">9 图</SelectItem>
                <SelectItem value="16">16 图</SelectItem>
              </SelectContent>
            </Select>
          ) : null}
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
      {catalog && multiSelectMode ? (
        <div
          className="flex min-w-0 items-center gap-1 border-y px-1 py-1"
          data-neoview-folder-selection-bar="true"
        >
          <span className="min-w-[4.5rem] text-xs font-medium tabular-nums">
            <span className="text-primary">{selectedCount}</span> / {catalog.total}
          </span>
          <div className="ml-auto flex min-w-0 items-center gap-1 overflow-x-auto">
            <BrowserButton
              label="选择全部项目"
              disabled={selectedCount === catalog.total}
              onClick={() => setSelection(selectAllDirectoryEntries(catalog.generation))}
            >
              <CheckSquare />
            </BrowserButton>
            <BrowserButton
              label="反转选择状态"
              disabled={catalog.total === 0}
              onClick={() => setSelection((current) => invertDirectorySelection(current, catalog.generation))}
            >
              <Square />
            </BrowserButton>
            <BrowserButton
              label="链接选中模式"
              active={chainSelectMode}
              onClick={() => {
                chainAnchorIndexRef.current = undefined
                setChainSelectMode((current) => !current)
              }}
            >
              <Link />
            </BrowserButton>
            <Button
              type="button"
              size="sm"
              variant={checkModeClickBehavior === "select" ? "default" : "ghost"}
              className="h-7 gap-1 px-2 text-xs"
              aria-label={`点击行为：${checkModeClickBehavior === "select" ? "点选" : "点开"}`}
              title={`点击卡片会${checkModeClickBehavior === "select" ? "选中或取消选中" : "打开项目"}`}
              onClick={() => setCheckModeClickBehavior((current) => current === "open" ? "select" : "open")}
            >
              <MousePointer2 />
              {checkModeClickBehavior === "select" ? "点选" : "点开"}
            </Button>
            <BrowserButton
              label="取消全部选择"
              disabled={selectedCount === 0}
              onClick={() => setSelection(createDirectorySelection(catalog.generation))}
            >
              <SquareX />
            </BrowserButton>
            <BrowserButton
              label="关闭多选模式"
              onClick={() => {
                setSelection(createDirectorySelection(catalog.generation))
                chainAnchorIndexRef.current = undefined
                setChainSelectMode(false)
                setMultiSelectMode(false)
              }}
            >
              <X />
            </BrowserButton>
          </div>
        </div>
      ) : null}
      {error ? <div role="alert" className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">{error}</div> : null}
      <div
        ref={listHostRef}
        className="min-h-32 overflow-hidden rounded border bg-background/60 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-neoview-folder-list="true"
        data-focused-index={focusedIndex}
        role={searchOpen ? undefined : "listbox"}
        aria-label={searchOpen ? undefined : "文件项目"}
        tabIndex={0}
        onKeyDown={handleDirectoryKeyDown}
      >
        {searchOpen && sessionIdRef.current ? (
          <Suspense fallback={<div className="h-72 animate-pulse bg-muted/30" aria-label="正在加载搜索" />}>
            <FolderSearchPanel
              client={client}
              sessionId={sessionIdRef.current}
              disabled={disabled}
              onActivate={activate}
              onClose={() => setSearchOpen(false)}
            />
          </Suspense>
        ) : null}
        {!searchOpen && catalog && viewUsesVirtuosoList(viewMode) ? (
          <Virtuoso
            key={virtualKey}
            ref={listRef}
            style={{ height: LIST_HEIGHT }}
            totalCount={catalog.total}
            fixedItemHeight={viewMode === "compact" ? 34 : 76}
            increaseViewportBy={{ top: viewMode === "compact" ? 68 : 152, bottom: viewMode === "compact" ? 136 : 304 }}
            computeItemKey={(index) => directoryEntryAt(catalog, index)?.path ?? `${catalog.generation}:${index}`}
            rangeChanged={requestRange}
            restoreStateFrom={restoreState?.viewMode === viewMode ? restoreState.listSnapshot : undefined}
            itemContent={(index) => {
              const entry = directoryEntryAt(catalog, index)
              return (
                <DirectoryListItem
                  entry={entry}
                  index={index}
                  disabled={disabled}
                  selected={Boolean(entry && selectedPaths.has(entry.path))}
                  focused={index === focusedIndex}
                  showRating={catalog.metadataFields.includes("rating")}
                  showCollectTagCount={catalog.metadataFields.includes("collectTagCount")}
                  visualMode={viewMode}
                  thumbnailUrl={entry ? thumbnailUrls.get(entry.path) : undefined}
                  onSelect={selectEntry}
                  onActivate={activate}
                />
              )
            }}
          />
        ) : null}
        {!searchOpen && catalog && viewMode === "details" ? (
          <Suspense fallback={<div className="h-72 animate-pulse bg-muted/30" aria-label="正在加载详细信息视图" />}>
            <FolderDetailsView
              key={virtualKey}
              catalog={catalog}
              disabled={disabled}
              selectedPaths={selectedPaths}
              initialIndex={focusedIndex ?? (restoreState?.viewMode === "details" ? restoreState.focusedIndex ?? restoreState.anchorIndex : undefined)}
              layout={folderView.details}
              onRangeChange={requestRange}
              onSelect={selectEntry}
              onActivate={activate}
              onLayoutChange={(details) => { void onFolderView?.({ details }) }}
            />
          </Suspense>
        ) : null}
        {!searchOpen && catalog && viewUsesGrid(viewMode) ? (
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
            restoreStateFrom={restoreState?.viewMode === viewMode ? restoreState.gridSnapshot : undefined}
            stateChanged={(snapshot) => { gridSnapshotRef.current = snapshot }}
            itemContent={(index) => {
              const entry = directoryEntryAt(catalog, index)
              return (
                <DirectoryGridItem
                  entry={entry}
                  index={index}
                  disabled={disabled}
                  selected={Boolean(entry && selectedPaths.has(entry.path))}
                  focused={index === focusedIndex}
                  showRating={catalog.metadataFields.includes("rating")}
                  showCollectTagCount={catalog.metadataFields.includes("collectTagCount")}
                  visualMode={viewMode}
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

function DirectoryListItem({ entry, index, disabled, selected, focused, showRating, showCollectTagCount, visualMode, thumbnailUrl, onSelect, onActivate }: DirectoryItemProps & { visualMode: FolderViewMode; thumbnailUrl?: string }) {
  const rich = visualMode !== "compact"
  if (!entry) return <div className={`${rich ? "h-[76px]" : "h-[34px]"} animate-pulse border-b bg-muted/30`} aria-hidden="true" />
  return (
    <button
      type="button"
      className={`flex w-full items-center gap-2 border-b px-2 text-left text-xs hover:bg-muted aria-selected:bg-accent data-[focused=true]:ring-1 data-[focused=true]:ring-inset data-[focused=true]:ring-primary ${rich ? "h-[76px]" : "h-[34px]"}`}
      aria-selected={selected}
      data-focused={focused || undefined}
      disabled={disabled}
      title={entry.path}
      onClick={(event) => onSelect(entry, index, event)}
      onDoubleClick={() => onActivate(entry)}
      tabIndex={-1}
      data-preview-mode={visualMode}
    >
      {rich ? (
        <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded bg-muted/30">
          {thumbnailUrl ? <img src={thumbnailUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover" /> : <EntryIcon entry={entry} className="size-7" />}
        </span>
      ) : <EntryIcon entry={entry} />}
      <span className="grid min-w-0 flex-1 gap-1">
        <span className="truncate">{entry.name}</span>
        {rich ? <span className="truncate text-[10px] text-muted-foreground">{entry.path}</span> : null}
      </span>
      <EntryMetadata entry={entry} showRating={showRating} showCollectTagCount={showCollectTagCount} />
    </button>
  )
}

function DirectoryGridItem({ entry, index, disabled, selected, focused, showRating, showCollectTagCount, visualMode, thumbnailUrl, onSelect, onActivate }: DirectoryItemProps & { visualMode: FolderViewMode; thumbnailUrl?: string }) {
  if (!entry) return <div className="h-36 animate-pulse rounded bg-muted/30" aria-hidden="true" />
  const showMetadata = showRating || showCollectTagCount
  return (
    <button
      type="button"
      className={`grid h-36 w-full overflow-hidden rounded border bg-background text-left text-xs hover:bg-muted aria-selected:border-primary aria-selected:bg-accent data-[focused=true]:ring-1 data-[focused=true]:ring-primary ${showMetadata ? "grid-rows-[1fr_auto_auto]" : "grid-rows-[1fr_auto]"}`}
      aria-selected={selected}
      data-focused={focused || undefined}
      disabled={disabled}
      title={entry.path}
      onClick={(event) => onSelect(entry, index, event)}
      onDoubleClick={() => onActivate(entry)}
      tabIndex={-1}
      data-preview-mode={visualMode}
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
      {showMetadata ? <EntryMetadata entry={entry} showRating={showRating} showCollectTagCount={showCollectTagCount} className="h-5 border-t px-1.5" /> : null}
    </button>
  )
}

interface DirectoryItemProps {
  entry?: ReaderDirectoryEntryDto
  index: number
  disabled: boolean
  selected: boolean
  focused: boolean
  showRating: boolean
  showCollectTagCount: boolean
  onSelect(entry: ReaderDirectoryEntryDto, index: number, event: ReactMouseEvent): void
  onActivate(entry: ReaderDirectoryEntryDto): void
}

function EntryMetadata({
  entry,
  showRating,
  showCollectTagCount,
  className = "",
}: {
  entry: ReaderDirectoryEntryDto
  showRating: boolean
  showCollectTagCount: boolean
  className?: string
}) {
  return (
    <span className={`flex shrink-0 items-center gap-1.5 text-[10px] tabular-nums text-muted-foreground ${className}`}>
      {showRating ? <span className="inline-flex items-center gap-0.5" title={`评分 ${formatRating(entry.rating)}`}><Star className="size-3" />{formatRating(entry.rating)}</span> : null}
      {showCollectTagCount ? <span className="inline-flex items-center gap-0.5" title={`收藏标签 ${entry.collectTagCount ?? 0}`}><Heart className="size-3" />{entry.collectTagCount ?? 0}</span> : null}
    </span>
  )
}

function formatRating(value: number | undefined): string {
  return Number.isFinite(value) ? value!.toFixed(1) : "-"
}

function EntryIcon({ entry, className = "size-4" }: { entry: ReaderDirectoryEntryDto; className?: string }) {
  return entry.kind === "directory"
    ? <Folder className={`${className} shrink-0 text-amber-500`} />
    : <File className={`${className} shrink-0 text-muted-foreground`} />
}

function BrowserButton({ label, disabled = false, active = false, onClick, children }: { label: string; disabled?: boolean; active?: boolean; onClick(): void; children: ReactNode }) {
  return <Button type="button" size="icon-sm" variant={active ? "default" : "ghost"} aria-label={label} title={label} disabled={disabled} onClick={onClick}>{children}</Button>
}

function isEditableKeyboardEvent(event: ReactKeyboardEvent<HTMLElement>): boolean {
  if (event.nativeEvent.isComposing) return true
  const target = event.target
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.matches("input, textarea, select, [role='textbox'], [role='menu'], [role='dialog']")
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function viewUsesGrid(mode: FolderViewMode): boolean {
  return mode === "cover-grid" || mode === "mosaic-grid"
}

function viewUsesMosaic(mode: FolderViewMode): boolean {
  return mode === "mosaic-list" || mode === "mosaic-grid"
}

function visibleGridColumnCount(host: HTMLElement | null): number {
  const width = host?.clientWidth ?? 112
  return Math.max(1, Math.floor((width + 4) / 116))
}

function visiblePageStep(mode: FolderViewMode, gridColumns: number): number {
  if (viewUsesGrid(mode)) return gridColumns * 2
  if (mode === "compact") return Math.floor(LIST_HEIGHT / 34)
  if (mode === "details") return Math.floor(LIST_HEIGHT / 36)
  return Math.floor(LIST_HEIGHT / 76)
}

function viewUsesThumbnails(mode: FolderViewMode): boolean {
  return mode === "cover-list" || mode === "mosaic-list" || mode === "cover-grid" || mode === "mosaic-grid"
}

function viewUsesVirtuosoList(mode: FolderViewMode): boolean {
  return mode === "compact" || mode === "cover-list" || mode === "mosaic-list"
}
