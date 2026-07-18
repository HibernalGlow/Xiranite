import {
  Virtuoso,
  type GridStateSnapshot,
  type ListRange,
  type StateSnapshot,
  type VirtuosoGridHandle,
  type VirtuosoHandle,
} from "react-virtuoso"
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CheckSquare, ClipboardPaste, Copy, Filter, GalleryHorizontalEnd, Grid2X2, History, Home, List, ListTree, Lock, MoreHorizontal, PanelsTopLeft, Pin, PinOff, Plus, RefreshCw, Rows3, Search, TableProperties, Unlock, type LucideIcon } from "lucide-react"
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { ActionHandle } from "@/components/ui/action-handle"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import type {
  ReaderDirectoryEntryDto,
  ReaderDirectoryFilterDto,
  ReaderDirectoryMetadataFieldDto,
  ReaderDirectoryNavigationDto,
  ReaderDirectoryPageDto,
  ReaderDirectorySortDto,
  ReaderDirectorySortFieldDto,
  ReaderDirectorySortPreferenceCommandDto,
  ReaderDirectorySortSourceDto,
  ReaderFolderViewMode,
  ReaderFolderViewConfig,
  ReaderFolderTreeLayout,
} from "../../../adapters/reader-http-client"
import { READER_FOLDER_DETAIL_DEFAULT_WIDTHS } from "../../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../registry"
import {
  createDirectoryCatalog,
  directoryEntryAt,
  directoryLoadedEntries,
  directoryPageHasMetadata,
  directoryPageCursors,
  folderErrorMessage,
  isAbortError,
  isEditableKeyboardEvent,
  isVerticalFolderRegion,
  mergeDirectoryPage,
  rememberDirectoryVisitState,
  restoreDirectoryVisitState,
  thumbnailPixelSize,
  trimDirectoryPages,
  viewUsesBanner,
  viewUsesGrid,
  viewUsesMosaic,
  viewUsesThumbnailGrid,
  viewUsesThumbnails,
  viewUsesVirtuosoList,
  visibleGridColumnCount,
  visiblePageStep,
  type DirectoryCatalog,
} from "./folder/DirectoryCatalog"
import {
  chainDirectorySelection,
  createDirectorySelection,
  directorySelectionDescriptor,
  directorySelectionCount,
  extendDirectorySelection,
  invertDirectorySelection,
  isDirectoryIndexSelected,
  rebaseDirectorySelection,
  selectedLoadedDirectoryPaths,
  selectAllDirectoryEntries,
  selectDirectorySingle,
  toggleDirectorySelection,
  type DirectorySelectionModel,
} from "./folder/DirectorySelection"
import { FolderEntryIcon, FolderEntryMetadata } from "./folder/FolderEntryPresentation"
import { FolderClipboardProvider, useFolderClipboard } from "./folder/FolderClipboard"
import { readerEntryClickIntent } from "./shared/ReaderEntryInteraction"
import {
  EMPTY_VIRTUOSO_COMPONENTS,
  FOLDER_LIST_COMPONENTS,
  FolderNavigationSettingsControl,
  runFolderNavigation,
  useFolderEmptyAreaNavigation,
} from "./folder/FolderEmptyAreaBehavior"

const PAGE_SIZE = 128
const MAX_CACHED_PAGES = 12
const MAX_THUMBNAILS = 64
const MAX_CACHED_THUMBNAIL_URLS = 256
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

const VIEW_MODE_OPTIONS: readonly { value: ReaderFolderViewMode; label: string; icon: LucideIcon }[] = [
  { value: "compact", label: "紧凑列表", icon: List },
  { value: "cover-list", label: "封面列表", icon: Rows3 },
  { value: "mosaic-list", label: "多图列表", icon: GalleryHorizontalEnd },
  { value: "details", label: "详细信息", icon: TableProperties },
  { value: "cover-grid", label: "封面网格", icon: Grid2X2 },
  { value: "mosaic-grid", label: "多图网格", icon: PanelsTopLeft },
]

type FolderViewMode = ReaderFolderViewMode
type FolderPreviewCount = 4 | 9 | 16

const DEFAULT_FOLDER_VIEW: ReaderFolderViewConfig = {
  homePath: "",
  viewMode: "compact",
  previewCount: 4,
  thumbnailWidthPercent: 20,
  bannerWidthPercent: 50,
  emptyArea: { singleClickAction: "none", doubleClickAction: "goUp", showBackButton: false },
  details: {
    columnOrder: ["name", "path", "type", "extension", "size", "modifiedAt", "dimensions", "pageCount", "rating", "tags"],
    hiddenColumns: [],
    pinnedLeft: ["name"],
    pinnedRight: [],
    columnWidths: READER_FOLDER_DETAIL_DEFAULT_WIDTHS,
  },
  search: {
    includeSubfolders: true,
    showHistoryOnFocus: true,
    searchInPath: false,
  },
  tree: { visible: false, layout: "left", size: 200, pinnedPaths: [] },
  tabs: { pinned: [], layout: "top", width: 160, breadcrumbPosition: "top", toolbarPosition: "top" },
}

const FolderDetailsView = lazy(() => import("./folder/FolderDetailsView"))
const FolderGridWorkspace = lazy(() => import("./folder/FolderGridWorkspace"))
const FolderBreadcrumb = lazy(() => import("./folder/FolderBreadcrumb"))
const FolderSearchPanel = lazy(() => import("./folder/FolderSearchPanel"))
const FolderTreeWorkspace = lazy(() => import("./folder/FolderTreeWorkspace"))
const DirectoryWatch = lazy(() => import("./folder/DirectoryWatch"))
const FolderTabsHost = lazy(() => import("./folder/FolderTabsHost"))
const FolderChromeLayout = lazy(() => import("./folder/FolderChromeLayout"))
const FolderSelectionBar = lazy(() => import("./folder/FolderSelectionBar"))
const FolderContextActions = lazy(() => import("./folder/FolderContextActions"))
const FolderTypeFilterBar = lazy(() => import("./folder/FolderTypeFilterBar"))

export interface SavedDirectoryState {
  total?: number
  viewMode: FolderViewMode
  previewCount: FolderPreviewCount
  multiSelectMode: boolean
  selection: DirectorySelectionModel
  focusedPath?: string
  focusedIndex?: number
  anchorIndex: number
  listSnapshot?: StateSnapshot
  gridSnapshot?: GridStateSnapshot
  gridScrollTop?: number
  detailsScrollTop?: number
  thumbnailUrls?: ReadonlyMap<string, string>
  thumbnailProfiles?: ReadonlyMap<string, string>
}

export interface FolderBrowserCloneSnapshot {
  sourceSessionId: string
  clonedPage?: ReaderDirectoryPageDto
  currentState: SavedDirectoryState
  navigationStates: ReadonlyMap<number, SavedDirectoryState>
}

export type FolderBrowserCloneProvider = (close?: boolean) => Promise<FolderBrowserCloneSnapshot | undefined>

export default function FolderMainCard(context: ReaderPanelContext) {
  const folderView = context.folderView
    ? {
        ...context.folderView,
        emptyArea: { ...DEFAULT_FOLDER_VIEW.emptyArea, ...context.folderView.emptyArea },
        tabs: context.folderView.tabs ?? DEFAULT_FOLDER_VIEW.tabs,
      }
    : DEFAULT_FOLDER_VIEW
  return (
    <FolderClipboardProvider client={context.client}>
      <Suspense fallback={<div className="h-8 rounded-md border bg-muted/30" aria-hidden="true" />}>
        <FolderTabsHost context={context} folderView={folderView} BrowserPane={FolderBrowserPane} />
      </Suspense>
    </FolderClipboardProvider>
  )
}

function FolderBrowserPane({ client, disabled, sourcePath, onOpen, systemActions, folderView = DEFAULT_FOLDER_VIEW, onFolderView, active, tabBar, folderTabCount, maxFolderTabs, onCreateTab, currentFolderTabPinned, canReopenFolderTab, onDuplicateCurrentTab, onToggleCurrentTabPinned, onReopenFolderTab, onCurrentPathChange, onOpenInNewTab, initialClone, onCloneProvider }: ReaderPanelContext & { active: boolean; tabBar?: ReactNode; folderTabCount: number; maxFolderTabs: number; onCreateTab(): void; currentFolderTabPinned: boolean; canReopenFolderTab: boolean; onDuplicateCurrentTab(): void; onToggleCurrentTabPinned(): void; onReopenFolderTab(): void; onCurrentPathChange(path: string): void; onOpenInNewTab(path: string): void; initialClone?: FolderBrowserCloneSnapshot; onCloneProvider(provider?: FolderBrowserCloneProvider): void }) {
  const clipboard = useFolderClipboard()
  const pendingInitialCloneRef = useRef(initialClone)
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
  const thumbnailRefreshSequenceRef = useRef(0)
  const clipboardCompletionRef = useRef<string>()
  const visibleRangeRef = useRef<ListRange>({ startIndex: 0, endIndex: 0 })
  const listRef = useRef<VirtuosoHandle>(null)
  const gridRef = useRef<VirtuosoGridHandle>(null)
  const listHostRef = useRef<HTMLDivElement>(null)
  const gridSnapshotRef = useRef<GridStateSnapshot | undefined>(undefined)
  const gridScrollTopRef = useRef(0)
  const detailsScrollTopRef = useRef(0)
  const focusedIndexRef = useRef<number | undefined>(undefined)
  const chainAnchorIndexRef = useRef<number | undefined>(undefined)
  const navigationStatesRef = useRef(new Map<number, SavedDirectoryState>())
  const [catalog, setCatalog] = useState<DirectoryCatalog>()
  const [searchOpen, setSearchOpen] = useState(false)
  const [filterBarOpen, setFilterBarOpen] = useState(false)
  const [activeToolbar, setActiveToolbar] = useState<"view" | "sort" | "size" | "more">()
  const [treeOpen, setTreeOpen] = useState(folderView.tree.visible)
  const [treeLayout, setTreeLayout] = useState(folderView.tree.layout)
  const [treeSize, setTreeSize] = useState(folderView.tree.size)
  const [viewMode, setViewMode] = useState<FolderViewMode>(folderView.viewMode)
  const [previewCount, setPreviewCount] = useState<FolderPreviewCount>(folderView.previewCount)
  const [thumbnailWidthPercent, setThumbnailWidthPercent] = useState(folderView.thumbnailWidthPercent)
  const [bannerWidthPercent, setBannerWidthPercent] = useState(folderView.bannerWidthPercent)
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [chainSelectMode, setChainSelectMode] = useState(false)
  const [checkModeClickBehavior, setCheckModeClickBehavior] = useState<"open" | "select">("open")
  const [restoreState, setRestoreState] = useState<SavedDirectoryState>()
  const [selection, setSelection] = useState<DirectorySelectionModel>(() => createDirectorySelection(0))
  const [focusedPath, setFocusedPath] = useState<string>()
  const [focusedIndex, setFocusedIndex] = useState<number>()
  const [thumbnailUrls, setThumbnailUrls] = useState<ReadonlyMap<string, string>>(() => new Map())
  const thumbnailUrlsRef = useRef<ReadonlyMap<string, string>>(thumbnailUrls)
  const thumbnailProfilesRef = useRef<ReadonlyMap<string, string>>(new Map())
  const [loading, setLoading] = useState(false)
  const [thumbnailRefreshPending, setThumbnailRefreshPending] = useState(false)
  const [error, setError] = useState<string>()
  const selectedPaths = useMemo(
    () => catalog ? selectedLoadedDirectoryPaths(selection, catalog.pages) : EMPTY_SELECTED_PATHS,
    [catalog, selection],
  )
  const itemIdPrefix = catalog?.sessionId
  const focusedItemId = catalog && focusedIndex !== undefined && viewMode !== "details" && directoryEntryAt(catalog, focusedIndex)
    ? `${itemIdPrefix}-item-${focusedIndex}`
    : undefined
  const emptyAreaHandlers = useFolderEmptyAreaNavigation(folderView.emptyArea, (action) => {
    runFolderNavigation(action, catalogRef.current, (command) => { void navigate(command) })
  })

  useEffect(() => {
    if (!sourcePath) return
    const snapshot = pendingInitialCloneRef.current
    pendingInitialCloneRef.current = undefined
    if (snapshot?.clonedPage) restoreClonedBrowser(snapshot)
    else void openBrowser(sourcePath)
  }, [sourcePath])

  useEffect(() => disposeBrowser, [])

  useEffect(() => {
    onCloneProvider(captureCloneSnapshot)
    return () => onCloneProvider(undefined)
  }, [onCloneProvider])

  useEffect(() => setViewMode(folderView.viewMode), [folderView.viewMode])
  useEffect(() => setPreviewCount(folderView.previewCount), [folderView.previewCount])
  useEffect(() => setThumbnailWidthPercent(folderView.thumbnailWidthPercent), [folderView.thumbnailWidthPercent])
  useEffect(() => setBannerWidthPercent(folderView.bannerWidthPercent), [folderView.bannerWidthPercent])
  useEffect(() => setTreeOpen(folderView.tree.visible), [folderView.tree.visible])
  useEffect(() => setTreeLayout(folderView.tree.layout), [folderView.tree.layout])
  useEffect(() => setTreeSize(folderView.tree.size), [folderView.tree.size])

  useEffect(() => {
    const completed = clipboard.lastCompleted
    if (!completed || clipboardCompletionRef.current === completed.id) return
    clipboardCompletionRef.current = completed.id
    const current = catalogRef.current
    if (completed.destinationPath && current && sameFolderPath(completed.destinationPath, current.path)) {
      void navigate({ action: "refresh" }, { keepTree: true })
    }
  }, [clipboard.lastCompleted?.id])

  useEffect(() => {
    if (!active || !catalog || !viewUsesThumbnails(viewMode)) return
    registerVisibleThumbnails()
  }, [active, catalog?.sessionId, catalog?.generation, viewMode, previewCount])

  useEffect(() => {
    if (!catalog || viewMode !== "details") return
    queueMicrotask(() => requestRange(visibleRangeRef.current))
  }, [catalog?.sessionId, catalog?.generation, viewMode])

  async function registerVisibleThumbnails(refresh = false): Promise<void> {
    const current = catalogRef.current
    if (!current || !viewUsesThumbnails(viewMode) || !client.registerLibraryThumbnails) return
    const range = visibleRangeRef.current
    const visible = directoryLoadedEntries(current, range.startIndex, range.endIndex, MAX_THUMBNAILS)
      .filter(({ entry }) => entry.kind === "directory" || entry.kind === "file")
      .filter(({ entry }) => refresh || thumbnailProfilesRef.current.get(entry.path) !== thumbnailProfile(entry, viewMode, previewCount))
    if (!visible.length) return
    const signature = `${refresh ? `refresh:${++thumbnailRefreshSequenceRef.current}` : "normal"}:${current.sessionId}:${current.generation}:${viewMode}:${previewCount}:${visible.map(({ index, entry }) => `${index}:${entry.path}`).join("|")}`
    if (thumbnailSignatureRef.current === signature) return
    thumbnailSignatureRef.current = signature
    thumbnailRequestRef.current?.abort()
    const request = new AbortController()
    thumbnailRequestRef.current = request
    const generation = ++thumbnailGenerationRef.current
    const contextId = thumbnailContextRef.current ?? `folder:${current.sessionId}:${++thumbnailContextSequenceRef.current}`
    thumbnailContextRef.current = contextId
    const pathById = new Map(visible.map(({ index, entry }) => [String(index), entry.path]))
    const profileById = new Map(visible.map(({ index, entry }) => [String(index), thumbnailProfile(entry, viewMode, previewCount)]))
    await client.registerLibraryThumbnails(
      contextId,
      generation,
      visible.map(({ index, entry }) => ({
        id: String(index),
        path: entry.path,
        kind: entry.kind === "directory" ? "folder" : "file",
        previewCount: entry.kind === "directory" && viewUsesMosaic(viewMode) ? previewCount : 1,
        ...(refresh ? { refresh: true } : {}),
      })),
      request.signal,
    ).then((batch) => {
      if (request.signal.aborted || generation !== thumbnailGenerationRef.current) return
      const resolved = batch.items.flatMap((item) => {
        const path = pathById.get(item.id)
        return path ? [[path, item.thumbnailUrl] as const] : []
      })
      setThumbnailUrls((currentUrls) => {
        const next = mergeThumbnailUrls(currentUrls, resolved, MAX_CACHED_THUMBNAIL_URLS)
        const nextProfiles = new Map(thumbnailProfilesRef.current)
        for (const item of batch.items) {
          const path = pathById.get(item.id)
          const profile = profileById.get(item.id)
          if (path && profile) nextProfiles.set(path, profile)
        }
        for (const path of nextProfiles.keys()) {
          if (!next.has(path)) nextProfiles.delete(path)
        }
        thumbnailUrlsRef.current = next
        thumbnailProfilesRef.current = nextProfiles
        return next
      })
    }).catch(() => {
      // Keep the bounded visit cache visible when background revalidation fails.
    })
  }

  async function refreshVisibleThumbnails() {
    if (thumbnailRefreshPending) return
    setThumbnailRefreshPending(true)
    try {
      await registerVisibleThumbnails(true)
    } finally {
      setThumbnailRefreshPending(false)
    }
  }

  const restoreIndex = catalog && restoreState
    ? Math.min(Math.max(restoreState.focusedIndex ?? restoreState.anchorIndex, 0), Math.max(0, catalog.total - 1))
    : undefined
  const shouldLocateRestore = (restoreState?.focusedIndex ?? restoreState?.anchorIndex ?? 0) > 0

  useEffect(() => {
    if (restoreIndex === undefined) return
    requestRange({ startIndex: restoreIndex, endIndex: restoreIndex })
    if (restoreState?.viewMode !== viewMode) return
    if (viewUsesVirtuosoList(viewMode) && !restoreState.listSnapshot) {
      listRef.current?.scrollToIndex({ index: restoreIndex, align: "center" })
    } else if (viewUsesGrid(viewMode) && !restoreState.gridSnapshot) {
      gridRef.current?.scrollToIndex({ index: restoreIndex, align: "center" })
    }
  }, [catalog?.sessionId, catalog?.generation, restoreIndex, restoreState, viewMode])

  async function openBrowser(path: string) {
    const normalized = path.trim()
    if (!normalized || !client.openDirectoryBrowser) return
    setSearchOpen(false)
    setTreeOpen(false)
    const generation = beginNavigation()
    setLoading(true)
    setError(undefined)
    try {
      const opened = await client.openDirectoryBrowser(normalized, navigationRequestRef.current?.signal, undefined, true)
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
      if (generation === navigationGenerationRef.current && !navigationRequestRef.current?.signal.aborted) setError(folderErrorMessage(cause))
    } finally {
      if (generation === navigationGenerationRef.current) setLoading(false)
    }
  }

  function restoreClonedBrowser(snapshot: FolderBrowserCloneSnapshot) {
    navigationStatesRef.current = new Map(snapshot.navigationStates)
    sessionIdRef.current = snapshot.clonedPage!.sessionId
    applyPage(snapshot.clonedPage!, snapshot.currentState)
  }

  async function navigate(navigation: ReaderDirectoryNavigationDto, options: { keepTree?: boolean; focusPath?: string; selectFocus?: boolean; clearSelection?: boolean } = {}) {
    const sessionId = sessionIdRef.current
    if (!sessionId) {
      if (navigation.action === "path") await openBrowser(navigation.path)
      return
    }
    if (!client.navigateDirectoryBrowser) return
    setSearchOpen(false)
    if (!options.keepTree) setTreeOpen(false)
    const capturedState = await captureRefreshState()
    const generation = beginNavigation()
    setLoading(true)
    setError(undefined)
    try {
      const result = await client.navigateDirectoryBrowser(
        sessionId,
        navigation,
        navigationRequestRef.current?.signal,
        options.focusPath ?? capturedState?.focusedPath,
      )
      if (generation === navigationGenerationRef.current) {
        let preferredState = navigation.action === "refresh" ? capturedState : undefined
        if (preferredState) preferredState = { ...preferredState, thumbnailUrls: undefined, thumbnailProfiles: undefined }
        if (preferredState && options.clearSelection) {
          preferredState = { ...preferredState, selection: createDirectorySelection(result.generation) }
        }
        if (preferredState && options.selectFocus && result.suggestedSelection) {
          const suggested = result.suggestedSelection
          preferredState = {
            ...preferredState,
            selection: selectDirectorySingle(result.generation, suggested.path, suggested.index),
            focusedPath: suggested.path,
            focusedIndex: suggested.index,
            anchorIndex: suggested.index,
            listSnapshot: undefined,
            gridSnapshot: undefined,
            detailsScrollTop: undefined,
          }
        }
        applyPage(result, preferredState, false, { preserveThumbnailCache: navigation.action !== "refresh" })
      }
    } catch (cause) {
      if (generation === navigationGenerationRef.current && !navigationRequestRef.current?.signal.aborted) setError(folderErrorMessage(cause))
    } finally {
      if (generation === navigationGenerationRef.current) setLoading(false)
    }
  }

  function applyPage(
    page: ReaderDirectoryPageDto,
    preferredState?: SavedDirectoryState,
    preserveViewport = false,
    options: { preserveThumbnailCache?: boolean } = {},
  ) {
    catalogRequestRef.current?.abort()
    catalogRequestRef.current = new AbortController()
    pendingCursorsRef.current.clear()
    resetThumbnailRegistration()
    const next = createDirectoryCatalog(page)
    chainAnchorIndexRef.current = undefined
    commitCatalog(next)
    if (preserveViewport) {
      setSelection((value) => rebaseDirectorySelection(value, page.generation))
      if (page.suggestedSelection) {
        focusedIndexRef.current = page.suggestedSelection.index
        setFocusedIndex(page.suggestedSelection.index)
        setFocusedPath(page.suggestedSelection.path)
      }
      queueMicrotask(() => requestRange(visibleRangeRef.current))
      return
    }
    visibleRangeRef.current = { startIndex: 0, endIndex: 0 }
    const suggested = page.suggestedSelection
    let restored = restoreDirectoryVisitState(page, preferredState, navigationStatesRef.current, {
      total: page.total,
      viewMode,
      previewCount,
      multiSelectMode: false,
      selection: suggested
        ? selectDirectorySingle(page.generation, suggested.path, suggested.index)
        : createDirectorySelection(page.generation),
      focusedPath: suggested?.path,
      focusedIndex: suggested?.index,
      anchorIndex: suggested?.index ?? 0,
    })
    if (restored.total !== undefined && restored.total !== page.total) {
      restored = { ...restored, total: page.total, listSnapshot: undefined, gridSnapshot: undefined }
    }
    gridSnapshotRef.current = restored.gridSnapshot
    gridScrollTopRef.current = restored.gridScrollTop ?? 0
    detailsScrollTopRef.current = restored.detailsScrollTop ?? 0
    focusedIndexRef.current = restored.focusedIndex
    setFocusedIndex(restored.focusedIndex)
    setViewMode(restored.viewMode)
    setPreviewCount(restored.previewCount)
    setMultiSelectMode(restored.multiSelectMode)
    const restoredThumbnailUrls = options.preserveThumbnailCache
      ? mergeThumbnailUrls(thumbnailUrlsRef.current, restored.thumbnailUrls ? [...restored.thumbnailUrls] : [], MAX_THUMBNAILS)
      : restored.thumbnailUrls ?? new Map()
    const restoredThumbnailProfiles = options.preserveThumbnailCache
      ? new Map([...restoredThumbnailUrls.keys()]
        .flatMap((path) => {
          const profile = restored.thumbnailProfiles?.get(path) ?? thumbnailProfilesRef.current.get(path)
          return profile ? [[path, profile] as const] : []
        }))
      : restored.thumbnailProfiles ?? new Map()
    thumbnailUrlsRef.current = restoredThumbnailUrls
    thumbnailProfilesRef.current = restoredThumbnailProfiles
    setRestoreState({ ...restored, thumbnailUrls: restoredThumbnailUrls, thumbnailProfiles: restoredThumbnailProfiles })
    setThumbnailUrls(restoredThumbnailUrls)
    setSelection(restored.selection)
    setFocusedPath(restored.focusedPath)
  }

  async function updateCatalogProjection(
    request: (sessionId: string, focusPath: string | undefined, signal: AbortSignal | undefined) => Promise<ReaderDirectoryPageDto>,
    resetSelection = false,
  ): Promise<ReaderDirectoryPageDto | undefined> {
    const sessionId = sessionIdRef.current
    const current = catalogRef.current
    if (!sessionId || !current) return undefined
    captureCurrentState()
    const generation = beginNavigation()
    setLoading(true)
    setError(undefined)
    try {
      const result = await request(sessionId, focusedPath, navigationRequestRef.current?.signal)
      if (generation !== navigationGenerationRef.current) return undefined
      const suggested = result.suggestedSelection
      applyPage(result, {
        total: result.total,
        viewMode,
        previewCount,
        multiSelectMode,
        selection: resetSelection ? createDirectorySelection(result.generation) : rebaseDirectorySelection(selection, result.generation),
        focusedPath: resetSelection ? suggested?.path : focusedPath,
        focusedIndex: suggested?.index,
        anchorIndex: suggested?.index ?? 0,
        thumbnailUrls,
        thumbnailProfiles: thumbnailProfilesRef.current,
      }, false, { preserveThumbnailCache: true })
      return result
    } catch (cause) {
      if (generation === navigationGenerationRef.current && !navigationRequestRef.current?.signal.aborted) setError(folderErrorMessage(cause))
      return undefined
    } finally {
      if (generation === navigationGenerationRef.current) setLoading(false)
    }
  }

  async function updateSort(sort: ReaderDirectorySortDto) {
    const applySort = client.sortDirectoryBrowser
    if (!applySort) return
    const sorted = await updateCatalogProjection((sessionId, focusPath, signal) => applySort(sessionId, sort, focusPath, signal))
    if (!sorted || sort.field !== "size" || !client.directorySizes) return
    const directoryPaths = sorted.entries
      .filter((entry) => entry.kind === "directory" && entry.size === undefined)
      .map((entry) => entry.path)
      .slice(0, 64)
    if (!directoryPaths.length) return
    try {
      const measured = await client.directorySizes(sorted.sessionId, sorted.generation, directoryPaths, catalogRequestRef.current?.signal)
      if (!measured.results.some((result) => result.status === "ok")) return
      await updateCatalogProjection((sessionId, focusPath, signal) => applySort(sessionId, sort, focusPath, signal))
    } catch (cause) {
      if (!isAbortError(cause)) setError(folderErrorMessage(cause))
    }
  }

  async function updateFilter(filter: ReaderDirectoryFilterDto) {
    const applyFilter = client.filterDirectoryBrowser
    const current = catalogRef.current
    if (!applyFilter || !current || filter === current.filter) return
    await updateCatalogProjection((sessionId, focusPath, signal) => applyFilter(sessionId, filter, focusPath, signal), true)
  }

  async function updateSortPreference(command: ReaderDirectorySortPreferenceCommandDto) {
    const applyPreference = client.updateDirectorySortPreference
    if (!applyPreference) return
    await updateCatalogProjection((sessionId, focusPath, signal) => applyPreference(sessionId, command, focusPath, signal))
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
          const currentFocusedEntry = directoryEntryAt(merged, focusedIndexRef.current ?? -1)
          if (currentFocusedEntry) setFocusedPath(currentFocusedEntry.path)
          const center = Math.floor((visibleRangeRef.current.startIndex + visibleRangeRef.current.endIndex) / 2)
          commitCatalog(trimDirectoryPages(merged, center, MAX_CACHED_PAGES))
          queueMicrotask(registerVisibleThumbnails)
        })
        .catch((cause) => {
          if (!requestSignal?.aborted && !isAbortError(cause)) setError(folderErrorMessage(cause))
        })
        .finally(() => {
          const latest = catalogRef.current
          if (latest?.sessionId === sessionId && latest.generation === generation) pendingCursorsRef.current.delete(requestKey)
        })
    }
    queueMicrotask(registerVisibleThumbnails)
  }

  function currentSavedState(): { current: DirectoryCatalog; state: SavedDirectoryState } | undefined {
    const current = catalogRef.current
    if (!current) return undefined
    const range = visibleRangeRef.current
    const state: SavedDirectoryState = {
      total: current.total,
      viewMode,
      previewCount,
      multiSelectMode,
      selection,
      focusedPath,
      focusedIndex: focusedIndexRef.current,
      anchorIndex: range.startIndex,
      gridSnapshot: viewUsesGrid(viewMode) ? gridSnapshotRef.current : undefined,
      gridScrollTop: viewUsesGrid(viewMode) ? gridScrollTopRef.current : undefined,
      detailsScrollTop: viewMode === "details" ? detailsScrollTopRef.current : undefined,
      thumbnailUrls: viewUsesThumbnails(viewMode) ? thumbnailUrls : undefined,
      thumbnailProfiles: viewUsesThumbnails(viewMode) ? thumbnailProfilesRef.current : undefined,
    }
    return { current, state }
  }

  function captureCurrentState(): SavedDirectoryState | undefined {
    const saved = currentSavedState()
    if (!saved) return undefined
    const { current, state } = saved
    rememberDirectoryVisitState(navigationStatesRef.current, current.navigationEntryId, state)
    if (viewUsesVirtuosoList(viewMode)) {
      listRef.current?.getState((snapshot) => {
        const latest = navigationStatesRef.current.get(current.navigationEntryId)
        if (latest) rememberDirectoryVisitState(navigationStatesRef.current, current.navigationEntryId, { ...latest, listSnapshot: snapshot })
      })
    }
    return state
  }

  async function captureRefreshState(): Promise<SavedDirectoryState | undefined> {
    const saved = currentSavedState()
    if (!saved) return undefined
    const { current, state } = saved
    rememberDirectoryVisitState(navigationStatesRef.current, current.navigationEntryId, state)
    const list = viewUsesVirtuosoList(state.viewMode) ? listRef.current : null
    if (!list) return state
    return new Promise((resolve) => {
      list.getState((snapshot) => {
        const next = { ...state, listSnapshot: snapshot }
        rememberDirectoryVisitState(navigationStatesRef.current, current.navigationEntryId, next)
        resolve(next)
      })
    })
  }

  async function captureCloneSnapshot(close = false): Promise<FolderBrowserCloneSnapshot | undefined> {
    const current = catalogRef.current
    const currentState = await captureRefreshState()
    if (!current || !currentState || sessionIdRef.current !== current.sessionId) return undefined
    const snapshot = { sourceSessionId: current.sessionId, currentState, navigationStates: new Map(navigationStatesRef.current) }
    if (close) {
      if (!client.closeDirectoryBrowser) return undefined
      await client.closeDirectoryBrowser(snapshot.sourceSessionId, true)
      if (sessionIdRef.current === snapshot.sourceSessionId) sessionIdRef.current = undefined
    }
    return snapshot
  }

  async function applyWatchedPage(page: ReaderDirectoryPageDto) {
    const current = catalogRef.current
    if (!current || current.sessionId !== page.sessionId || current.generation >= page.generation) return
    const preferredState = await captureRefreshState()
    const latest = catalogRef.current
    if (!latest || latest.sessionId !== page.sessionId || latest.generation >= page.generation) return
    applyPage(page, preferredState ? { ...preferredState, thumbnailUrls: undefined, thumbnailProfiles: undefined } : undefined, false, { preserveThumbnailCache: false })
  }

  function switchView(next: FolderViewMode) {
    if (next === viewMode) return
    captureCurrentState()
    const current = catalogRef.current
    const anchorIndex = focusedIndexRef.current ?? visibleRangeRef.current.startIndex
    const nextState: SavedDirectoryState = {
      total: current?.total,
      viewMode: next,
      previewCount,
      multiSelectMode,
      selection,
      focusedPath,
      focusedIndex: focusedIndexRef.current,
      anchorIndex,
      thumbnailUrls,
      thumbnailProfiles: thumbnailProfilesRef.current,
    }
    if (current) rememberDirectoryVisitState(navigationStatesRef.current, current.navigationEntryId, nextState)
    if (!viewUsesThumbnails(next)) {
      resetThumbnailRegistration()
    }
    setRestoreState(nextState)
    setViewMode(next)
    void onFolderView?.({ viewMode: next })
  }

  function switchPreviewCount(next: FolderPreviewCount) {
    if (next === previewCount) return
    captureCurrentState()
    resetThumbnailRegistration()
    const emptyThumbnailUrls = new Map<string, string>()
    thumbnailUrlsRef.current = emptyThumbnailUrls
    thumbnailProfilesRef.current = new Map()
    setThumbnailUrls(emptyThumbnailUrls)
    setPreviewCount(next)
    thumbnailSignatureRef.current = ""
    void onFolderView?.({ previewCount: next })
  }

  function commitThumbnailWidth(value: number) {
    if (value !== folderView.thumbnailWidthPercent) void onFolderView?.({ thumbnailWidthPercent: value })
  }

  function commitBannerWidth(value: number) {
    if (value !== folderView.bannerWidthPercent) void onFolderView?.({ bannerWidthPercent: value })
  }

  function toggleTree() {
    const visible = !treeOpen
    setTreeOpen(visible)
    void onFolderView?.({ tree: { visible } })
  }

  function toggleMultiSelectMode() {
    if (multiSelectMode) {
      setSelection(createDirectorySelection(catalog?.generation ?? selection.generation))
      chainAnchorIndexRef.current = undefined
      setChainSelectMode(false)
    }
    setMultiSelectMode((current) => !current)
  }

  function switchTreeLayout(layout: ReaderFolderTreeLayout) {
    if (layout === treeLayout) return
    setTreeLayout(layout)
    void onFolderView?.({ tree: { layout } })
  }

  function commitTreeSize(size: number) {
    if (size === treeSize) return
    setTreeSize(size)
    void onFolderView?.({ tree: { size } })
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
    } else if (readerEntryClickIntent(event, multiSelectMode && checkModeClickBehavior === "select") === "select") {
      setSelection((current) => toggleDirectorySelection(current, generation, entry.path, index))
    } else {
      activate(entry)
    }
  }

  function handleDirectoryKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (searchOpen || isEditableKeyboardEvent(event)) return
    const currentCatalog = catalogRef.current
    if (!currentCatalog || disabled || loading) return
    if (event.key === "F5") {
      event.preventDefault()
      event.stopPropagation()
      void navigate({ action: "refresh" })
      return
    }
    if (currentCatalog.total <= 0) return
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
    else if (event.key === "Delete") {
      const entry = directoryEntryAt(currentCatalog, currentIndex)
      if (!entry || (entry.kind !== "file" && entry.kind !== "directory") || !client.executeFileOperations) return
      event.currentTarget.dispatchEvent(new CustomEvent("neoview-folder-trash-request", {
        bubbles: true,
        detail: { index: currentIndex, ...entry },
      }))
    } else if (event.key === "Enter") {
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

  function activate(entry: Pick<ReaderDirectoryEntryDto, "kind" | "path" | "readerSupported">) {
    if (entry.kind === "directory") void navigate({ action: "path", path: entry.path }, { focusPath: entry.path })
    else if (entry.readerSupported) void onOpen?.(entry.path)
    else void client.openSystemPath?.(entry.path)
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
    setSelection((value) => value.generation === next.generation ? value : rebaseDirectorySelection(value, next.generation))
    catalogRef.current = next
    setCatalog(next)
    onCurrentPathChange(next.path)
  }

  function releaseThumbnailContext() {
    resetThumbnailRegistration()
    const contextId = thumbnailContextRef.current
    thumbnailContextRef.current = undefined
    if (contextId) void client.releaseLibraryThumbnailContext?.(contextId).catch(() => undefined)
  }

  function resetThumbnailRegistration() {
    thumbnailRequestRef.current?.abort()
    thumbnailRequestRef.current = undefined
    thumbnailSignatureRef.current = ""
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
  const tabLayout = folderView.tabs ?? DEFAULT_FOLDER_VIEW.tabs!
  const showReturnFooter = folderView.emptyArea.showBackButton && !searchOpen
  const returnFooterContext = {
    disabled: disabled || loading || !catalog || (!catalog.canGoBack && !catalog.parentPath),
    onReturn: () => runFolderNavigation("return", catalogRef.current, (command) => { void navigate(command) }),
  }
  const currentViewOption = VIEW_MODE_OPTIONS.find((option) => option.value === viewMode) ?? VIEW_MODE_OPTIONS[0]!
  const CurrentViewIcon = currentViewOption.icon
  const breadcrumbNode = (
    <Suspense fallback={<div className="h-8 rounded-md border bg-background" aria-label="正在加载路径导航" />}>
      <FolderBreadcrumb
        path={catalog?.path ?? sourcePath ?? ""}
        disabled={disabled}
        loading={loading}
        vertical={isVerticalFolderRegion(tabLayout.breadcrumbPosition)}
        canGoBack={catalog?.canGoBack}
        canGoForward={catalog?.canGoForward}
        canGoUp={Boolean(catalog?.parentPath)}
        onNavigate={(path) => { void navigate({ action: "path", path }) }}
        onNavigateAction={(action) => { void navigate({ action }) }}
        onCopyPath={systemActions?.copyText}
      />
    </Suspense>
  )
  const toggleToolbar = (toolbar: "view" | "sort" | "size" | "more") => {
    setActiveToolbar((current) => current === toolbar ? undefined : toolbar)
  }
  const actionHandleItems = [
    { id: "thumbnail-refresh", label: "\u91cd\u8f7d\u7f29\u7565\u56fe", preview: "\u91cd\u8f7d\u5f53\u524d\u53ef\u89c1\u9879\u7684\u7f29\u7565\u56fe", icon: <RefreshCw className="size-4" />, disabled: thumbnailRefreshPending || !client.registerLibraryThumbnails || !viewUsesThumbnails(viewMode), active: thumbnailRefreshPending, onSelect: () => { void refreshVisibleThumbnails() } },
    { id: "view", label: "视图", preview: "显示六种文件视图切换栏", icon: <CurrentViewIcon className="size-4" />, active: activeToolbar === "view", onSelect: () => toggleToolbar("view") },
    { id: "search", label: "搜索文件", preview: searchOpen ? "关闭当前搜索面板" : "打开当前目录搜索面板", icon: <Search className="size-4" />, active: searchOpen, onSelect: () => setSearchOpen((current) => !current) },
    { id: "filter", label: "类型筛选", preview: filterBarOpen ? "关闭文件类型筛选栏" : "显示文件类型筛选栏", icon: <Filter className="size-4" />, disabled: !client.filterDirectoryBrowser, active: filterBarOpen, onSelect: () => setFilterBarOpen((current) => !current) },
    { id: "sort", label: "排序", preview: "显示字段、方向和临时排序控制", icon: <ArrowDown className="size-4" />, active: activeToolbar === "sort", onSelect: () => toggleToolbar("sort") },
    { id: "tree", label: "文件树", preview: treeOpen ? "关闭独立文件树面板" : "打开独立文件树面板", icon: <ListTree className="size-4" />, disabled: !client.treeDirectoryBrowser, active: treeOpen, onSelect: toggleTree },
    { id: "size", label: "项目尺寸", preview: "显示当前视图的项目尺寸滑杆", icon: <Grid2X2 className="size-4" />, disabled: !viewUsesThumbnailGrid(viewMode) && !viewUsesBanner(viewMode), active: activeToolbar === "size", onSelect: () => toggleToolbar("size") },
    { id: "select", label: multiSelectMode ? "退出多选" : "多选模式", preview: multiSelectMode ? "关闭批量选择操作栏" : "打开批量选择操作栏", icon: <CheckSquare className="size-4" />, active: multiSelectMode, onSelect: toggleMultiSelectMode },
    { id: "more", label: "更多操作", preview: "显示新建标签、粘贴和导航设置", icon: <MoreHorizontal className="size-4" />, active: activeToolbar === "more", onSelect: () => toggleToolbar("more") },
  ]

  return (
    <div
      className="flex min-h-0 min-w-0 gap-2"
      data-neoview-folder-card={active || null}
      data-neoview-folder-pane={true}
      data-folder-breadcrumb-position={tabLayout.breadcrumbPosition}
      data-folder-toolbar-position={tabLayout.toolbarPosition}
      data-folder-tab-position={tabLayout.layout}
      data-folder-view-mode={viewMode}
      data-selection-count={selectedCount}
      data-selection-total={catalog?.total ?? 0}
      data-thumbnail-cache-size={thumbnailUrls.size}
      data-restored-thumbnail-cache-size={restoreState?.thumbnailUrls?.size ?? 0}
      data-selection-all={selection.allSelected || null}
      onContextMenuCapture={(event) => {
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-context-menu="neoview-folder-entry"]') : null
        const index = Number(target?.dataset.folderIndex)
        const path = target?.dataset.folderPath
        if (!catalog || !path || !Number.isSafeInteger(index) || isDirectoryIndexSelected(selection, index, path)) return
        focusedIndexRef.current = index
        setFocusedIndex(index)
        setFocusedPath(path)
        setSelection(selectDirectorySingle(catalog.generation, path, index))
      }}
      onKeyDownCapture={(event) => {
        if (isEditableKeyboardEvent(event)) return
        if ((event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) && focusedIndex !== undefined) {
          const target = listHostRef.current?.querySelector<HTMLElement>(`[data-folder-index="${focusedIndex}"]`)
          if (target) {
            event.preventDefault()
            event.stopPropagation()
            target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))
          }
          return
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
          event.preventDefault()
          event.stopPropagation()
          setSearchOpen(true)
        }
      }}
    >
      {active && catalog?.watching && client.watchDirectoryBrowser ? (
        <Suspense fallback={null}>
          <DirectoryWatch
            client={client}
            sessionId={catalog.sessionId}
            generation={catalog.generation}
            focusPath={focusedPath}
            onPage={(page) => { void applyWatchedPage(page) }}
            onError={(cause) => setError(`目录监听失败：${folderErrorMessage(cause)}`)}
          />
        </Suspense>
      ) : null}
      {active ? (
        <Suspense fallback={null}>
          <FolderContextActions
            client={client}
            disabled={disabled || loading}
            copyText={systemActions?.copyText}
            sessionId={catalog?.sessionId}
            generation={catalog?.generation}
            currentPath={catalog?.path}
            selection={directorySelectionDescriptor(selection)}
            selectedCount={selectedCount}
            onActivate={activate}
            onOpenInNewTab={onOpenInNewTab}
            onOpenAsBook={onOpen}
            onRenamed={(destinationPath) => navigate(
              { action: "refresh" },
              { keepTree: true, focusPath: destinationPath, selectFocus: true },
            )}
            onTrashed={(entry) => navigate(
              { action: "refresh" },
              { keepTree: true, focusPath: entry.path },
            )}
            onCatalogUpdate={(update) => commitCatalog(update(catalog!))}
            onRefreshEmm={() => updateSort(catalog!.sort)}
          />
        </Suspense>
      ) : null}
      <Suspense fallback={<div className="min-h-0 min-w-0 flex-1" aria-label="正在加载文件浏览布局" />}>
        <FolderChromeLayout
          layout={tabLayout}
          tabBar={tabBar}
          breadcrumb={breadcrumbNode}
        >
      <div
        className="contents"
        data-folder-chrome-slot="toolbar"
        data-folder-toolbar-layout="one-row"
      >
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto" data-folder-toolbar-row="operations" data-active-toolbar={activeToolbar ?? "navigation"}>
          <div className="flex shrink-0 items-center gap-0.5" data-folder-toolbar-group="nav">
            <BrowserButton label="后退" disabled={!catalog?.canGoBack || loading} onClick={() => void navigate({ action: "back" })}><ArrowLeft /></BrowserButton>
            <BrowserButton label="前进" disabled={!catalog?.canGoForward || loading} onClick={() => void navigate({ action: "forward" })}><ArrowRight /></BrowserButton>
            <BrowserButton label="上级" disabled={!catalog?.parentPath || loading} onClick={() => void navigate({ action: "up" })}><ArrowUp /></BrowserButton>
          </div>
          <div className="mx-0.5 h-4 w-px shrink-0 bg-border/70" aria-hidden="true" />
          <div className="flex shrink-0 items-center gap-0.5" data-folder-toolbar-group="home">
            <BrowserButton
              label="主页（单击返回主页，右键设置当前路径为主页）"
              disabled={!catalog || loading}
              clickDisabled={!folderView.homePath}
              active={Boolean(catalog && folderView.homePath && catalog.path === folderView.homePath)}
              onClick={() => {
                if (folderView.homePath && catalog?.path !== folderView.homePath) void navigate({ action: "path", path: folderView.homePath })
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                if (catalog && !loading && catalog.path !== folderView.homePath) void onFolderView?.({ homePath: catalog.path })
              }}
            >
              <Home />
            </BrowserButton>
            <BrowserButton label="刷新" disabled={!catalog || loading} onClick={() => void navigate({ action: "refresh" })}><RefreshCw className={loading ? "animate-spin" : undefined} /></BrowserButton>
          </div>
          <ActionHandle items={actionHandleItems} disabled={!catalog || loading} label="文件操作手柄" menuLabel="文件操作" />
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{loadedCount} / {catalog?.total ?? 0}</span>
          {activeToolbar ? <div className="mx-0.5 h-4 w-px shrink-0 bg-border/70" aria-hidden="true" /> : null}
          {activeToolbar === "view" ? (
            <div className="flex min-w-max items-center gap-0.5" data-folder-toolbar-group="view">
              {VIEW_MODE_OPTIONS.map((option) => {
                const Icon = option.icon
                return (
                  <BrowserButton key={option.value} label={option.label} disabled={!catalog || loading} active={viewMode === option.value} onClick={() => switchView(option.value)}>
                    <Icon />
                  </BrowserButton>
                )
              })}
              {viewUsesMosaic(viewMode) ? (
                <Select value={String(previewCount)} onValueChange={(value) => switchPreviewCount(Number(value) as FolderPreviewCount)}>
                  <SelectTrigger size="sm" className="h-7 w-[4.5rem] shrink-0 text-xs" aria-label="多图数量"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="4">4 图</SelectItem>
                    <SelectItem value="9">9 图</SelectItem>
                    <SelectItem value="16">16 图</SelectItem>
                  </SelectContent>
                </Select>
              ) : null}
            </div>
          ) : null}
          {activeToolbar === "sort" && catalog ? (
            <div className="flex min-w-[10rem] flex-1 items-center gap-0.5" data-folder-toolbar-group="sort">
              <Select
                value={catalog.sort.field}
                disabled={loading || !client.sortDirectoryBrowser}
                onValueChange={(field) => void updateSort({ ...catalog.sort, field: field as ReaderDirectorySortFieldDto })}
              >
                <SelectTrigger size="sm" className="h-7 min-w-24 flex-1 text-xs" aria-label="排序字段"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {catalog.sortFields.map((field) => <SelectItem key={field} value={field}>{SORT_LABELS[field]}</SelectItem>)}
                </SelectContent>
              </Select>
              <BrowserButton label={catalog.sort.order === "asc" ? "升序" : "降序"} disabled={loading || !client.sortDirectoryBrowser} onClick={() => void updateSort({ ...catalog.sort, order: catalog.sort.order === "asc" ? "desc" : "asc" })}>
                {catalog.sort.order === "asc" ? <ArrowUp /> : <ArrowDown />}
              </BrowserButton>
              <BrowserButton label={catalog.sortTemporary ? "取消临时排序" : "锁定当前目录排序"} disabled={loading || !client.updateDirectorySortPreference} active={catalog.sortTemporary} onClick={() => void updateSortPreference({ action: "temporary", enabled: !catalog.sortTemporary })}>
                {catalog.sortTemporary ? <Lock /> : <Unlock />}
              </BrowserButton>
            </div>
          ) : null}
          {activeToolbar === "size" && viewUsesThumbnailGrid(viewMode) ? (
            <div className="grid min-w-40 flex-1 grid-cols-[1rem_minmax(5rem,1fr)_3rem] items-center gap-2 px-1" data-folder-size-control="thumbnail">
              <Grid2X2 className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <Slider aria-label="缩略图宽度" min={10} max={90} step={1} value={[thumbnailWidthPercent]} disabled={disabled} onValueChange={(value) => setThumbnailWidthPercent(value[0] ?? 20)} onValueCommit={(value) => commitThumbnailWidth(value[0] ?? 20)} />
              <span className="text-right text-[10px] tabular-nums text-muted-foreground">{thumbnailPixelSize(thumbnailWidthPercent)}px</span>
            </div>
          ) : null}
          {activeToolbar === "size" && viewUsesBanner(viewMode) ? (
            <div className="grid min-w-40 flex-1 grid-cols-[1rem_minmax(5rem,1fr)_3rem] items-center gap-2 px-1" data-folder-size-control="banner">
              <GalleryHorizontalEnd className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <Slider aria-label="横幅宽度" min={20} max={100} step={10} value={[bannerWidthPercent]} disabled={disabled} onValueChange={(value) => setBannerWidthPercent(value[0] ?? 50)} onValueCommit={(value) => commitBannerWidth(value[0] ?? 50)} />
              <span className="text-right text-[10px] tabular-nums text-muted-foreground">{Math.max(1, Math.floor(100 / bannerWidthPercent))} 列</span>
            </div>
          ) : null}
          {activeToolbar === "more" ? (
            <div className="flex min-w-max items-center gap-0.5" data-folder-toolbar-group="more">
              <BrowserButton label="新建文件夹标签" disabled={folderTabCount >= maxFolderTabs || loading} onClick={onCreateTab}><Plus /></BrowserButton>
              <BrowserButton label="复制当前标签" disabled={folderTabCount >= maxFolderTabs || loading || !client.cloneDirectoryBrowser} onClick={onDuplicateCurrentTab}><Copy /></BrowserButton>
              <BrowserButton label={currentFolderTabPinned ? "取消固定当前标签" : "固定当前标签"} disabled={loading} active={currentFolderTabPinned} onClick={onToggleCurrentTabPinned}>{currentFolderTabPinned ? <PinOff /> : <Pin />}</BrowserButton>
              <BrowserButton label="重新打开关闭的标签" disabled={loading || !canReopenFolderTab} onClick={onReopenFolderTab}><History /></BrowserButton>
              <BrowserButton label={clipboard.operation?.status === "running" ? `正在粘贴 ${clipboard.operation.processed} / ${clipboard.operation.total}` : "粘贴到当前目录"} disabled={!catalog || loading || !clipboard.clipboard.available || clipboard.operation?.status === "running"} onClick={() => { if (catalog) void clipboard.paste(catalog.path) }}><ClipboardPaste /></BrowserButton>
            <FolderNavigationSettingsControl
              value={folderView.emptyArea}
              disabled={!catalog || loading}
              onChange={(emptyArea) => { void onFolderView?.({ emptyArea }) }}
            />
              <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="更多操作"
                  title="更多操作"
                  disabled={!catalog || loading}
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" data-folder-toolbar-overflow="true">
                <DropdownMenuItem
                  disabled={!catalog || loading || !clipboard.clipboard.available || clipboard.operation?.status === "running"}
                  onSelect={() => { if (catalog) void clipboard.paste(catalog.path) }}
                >
                  <ClipboardPaste />
                  {clipboard.operation?.status === "running"
                    ? `正在粘贴 ${clipboard.operation.processed} / ${clipboard.operation.total}`
                    : "粘贴到当前目录"}
                </DropdownMenuItem>
                {catalog && client.updateDirectorySortPreference ? (
                  <>
                    <DropdownMenuSeparator />
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
                  </>
                ) : null}
              </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
        </div>

        {/* Conditional third row: type filter */}
        {catalog && filterBarOpen ? (
          <Suspense fallback={<div className="h-8 border-t border-border/50" aria-label="正在加载类型筛选" />}>
            <FolderTypeFilterBar
              value={catalog.filter}
              options={catalog.filterOptions}
              disabled={disabled || loading}
              onChange={(filter) => { void updateFilter(filter) }}
            />
          </Suspense>
        ) : null}

      </div>
      <div className="contents" data-folder-chrome-slot="content">
      {catalog && multiSelectMode ? (
        <Suspense fallback={<div className="h-9 border-y" aria-label="正在加载选择操作" />}>
          <FolderSelectionBar
            client={client}
            sessionId={catalog.sessionId}
            selection={directorySelectionDescriptor(selection)}
            selectedCount={selectedCount}
            total={catalog.total}
            currentPath={catalog.path}
            disabled={disabled || loading}
            chainSelectMode={chainSelectMode}
            clickBehavior={checkModeClickBehavior}
            onSelectAll={() => setSelection(selectAllDirectoryEntries(catalog.generation))}
            onInvert={() => setSelection((current) => invertDirectorySelection(current, catalog.generation))}
            onToggleChain={() => {
              chainAnchorIndexRef.current = undefined
              setChainSelectMode((current) => !current)
            }}
            onToggleClickBehavior={() => setCheckModeClickBehavior((current) => current === "open" ? "select" : "open")}
            onClear={() => setSelection(createDirectorySelection(catalog.generation))}
            onClose={() => {
              setSelection(createDirectorySelection(catalog.generation))
              chainAnchorIndexRef.current = undefined
              setChainSelectMode(false)
              setMultiSelectMode(false)
            }}
            onTrashCompleted={() => navigate(
              { action: "refresh" },
              { keepTree: true, clearSelection: true },
            )}
          />
        </Suspense>
      ) : null}
      {error ? <div role="alert" className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">{error}</div> : null}
      {active && clipboard.feedback ? (
        <div role={clipboard.feedback.kind} className={clipboard.feedback.kind === "alert" ? "rounded bg-destructive/10 px-2 py-1 text-xs text-destructive" : "sr-only"}>
          {clipboard.feedback.text}
        </div>
      ) : null}
      <div
        className="grid min-h-0 overflow-hidden"
        style={{
          "--folder-tree-size": `${treeSize}px`,
          gridTemplateColumns: !treeOpen ? "1fr" : treeLayout === "left" ? "min(var(--folder-tree-size), 50%) 1fr" : treeLayout === "right" ? "1fr min(var(--folder-tree-size), 50%)" : "1fr",
          gridTemplateRows: !treeOpen ? undefined : treeLayout === "top" ? `var(--folder-tree-size) ${LIST_HEIGHT}px` : treeLayout === "bottom" ? `${LIST_HEIGHT}px var(--folder-tree-size)` : `${LIST_HEIGHT}px`,
        } as CSSProperties}
        data-tree-layout={treeOpen ? treeLayout : undefined}
      >
        {treeOpen && sessionIdRef.current && catalog ? (
          <Suspense fallback={<div className="min-h-0 min-w-0 animate-pulse rounded border bg-muted/30" style={{ order: treeLayout === "left" || treeLayout === "top" ? 0 : 1 }} aria-label="正在加载文件树" />}>
              <FolderTreeWorkspace
                client={client}
                sessionId={sessionIdRef.current}
                currentPath={catalog.path}
                watching={active && catalog.watching}
                disabled={disabled || loading}
                layout={treeLayout}
                size={treeSize}
                pinnedPaths={folderView.tree.pinnedPaths}
                onNavigate={(path) => { void navigate({ action: "path", path }, { keepTree: true }) }}
                onLayoutChange={switchTreeLayout}
                onSizeChange={commitTreeSize}
                onPinnedPathsChange={(pinnedPaths) => { void onFolderView?.({ tree: { pinnedPaths } }) }}
              />
          </Suspense>
        ) : null}
        <div
          ref={listHostRef}
          className="min-h-32 min-w-0 overflow-hidden rounded border bg-background/60 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-neoview-folder-list="true"
          data-focused-index={focusedIndex}
          role={searchOpen ? undefined : "listbox"}
          aria-label={searchOpen ? undefined : "文件项目"}
          aria-activedescendant={searchOpen ? undefined : focusedItemId}
          tabIndex={0}
          onKeyDown={handleDirectoryKeyDown}
          {...emptyAreaHandlers}
          style={{ order: treeOpen && (treeLayout === "right" || treeLayout === "bottom") ? 0 : 1, "--folder-grid-width": `${viewUsesBanner(viewMode) ? bannerWidthPercent : thumbnailWidthPercent}%` } as CSSProperties}
        >
        {searchOpen && sessionIdRef.current ? (
          <Suspense fallback={<div className="h-72 animate-pulse bg-muted/30" aria-label="正在加载搜索" />}>
            <FolderSearchPanel
              client={client}
              sessionId={sessionIdRef.current}
              disabled={disabled}
              settings={folderView.search}
              onSettingsChange={(search) => void onFolderView?.({ search })}
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
            components={showReturnFooter ? FOLDER_LIST_COMPONENTS : EMPTY_VIRTUOSO_COMPONENTS}
            context={showReturnFooter ? returnFooterContext : undefined}
            fixedItemHeight={viewMode === "compact" ? 34 : 76}
            increaseViewportBy={{ top: viewMode === "compact" ? 68 : 152, bottom: viewMode === "compact" ? 136 : 304 }}
            computeItemKey={(index) => directoryEntryAt(catalog, index)?.path ?? `${catalog.generation}:${index}`}
            rangeChanged={requestRange}
            restoreStateFrom={restoreState?.viewMode === viewMode ? restoreState.listSnapshot : undefined}
            initialTopMostItemIndex={shouldLocateRestore && restoreState?.viewMode === viewMode && !restoreState.listSnapshot && restoreIndex !== undefined
              ? { index: restoreIndex, align: "center" }
              : undefined}
            itemContent={(index) => {
              const entry = directoryEntryAt(catalog, index)
              return (
                <DirectoryListItem
                  itemId={`${itemIdPrefix}-item-${index}`}
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
              initialScrollTop={restoreState?.viewMode === "details" ? restoreState.detailsScrollTop : undefined}
              layout={folderView.details}
              onRangeChange={requestRange}
              onScrollTopChange={(scrollTop) => { detailsScrollTopRef.current = scrollTop }}
              onSelect={selectEntry}
              onLayoutChange={(details) => { void onFolderView?.({ details }) }}
              showReturnFooter={showReturnFooter}
              returnFooterContext={returnFooterContext}
            />
          </Suspense>
        ) : null}
        {!searchOpen && catalog && viewUsesGrid(viewMode) ? (
          <Suspense fallback={<div className="h-72 animate-pulse bg-muted/30" aria-label="正在加载网格视图" />}>
            <FolderGridWorkspace
              virtualKey={virtualKey}
              gridRef={gridRef}
              catalog={catalog}
              viewMode={viewMode}
              disabled={disabled}
              selectedPaths={selectedPaths}
              focusedIndex={focusedIndex}
              itemIdPrefix={itemIdPrefix}
              thumbnailUrls={thumbnailUrls}
              showReturnFooter={showReturnFooter}
              returnFooterContext={returnFooterContext}
              restoreSnapshot={restoreState?.viewMode === viewMode ? restoreState.gridSnapshot : undefined}
              initialScrollTop={restoreState?.viewMode === viewMode ? restoreState.gridScrollTop : undefined}
              initialIndex={shouldLocateRestore && restoreState?.viewMode === viewMode && !restoreState.gridSnapshot ? restoreIndex : undefined}
              onRangeChange={requestRange}
              onStateChange={(snapshot) => { gridSnapshotRef.current = snapshot }}
              onScrollTopChange={(scrollTop) => { gridScrollTopRef.current = scrollTop }}
              onSelect={selectEntry}
            />
          </Suspense>
        ) : null}
        {!catalog ? <div className="grid h-72 place-items-center text-xs text-muted-foreground">{loading ? "正在读取目录…" : "选择一个目录"}</div> : null}
        </div>
      </div>
      </div>
        </FolderChromeLayout>
      </Suspense>
    </div>
  )
}

function DirectoryListItem({ itemId, entry, index, disabled, selected, focused, showRating, showCollectTagCount, visualMode, thumbnailUrl, onSelect }: DirectoryItemProps & { visualMode: FolderViewMode; thumbnailUrl?: string }) {
  const rich = visualMode !== "compact"
  if (!entry) return <div className={`${rich ? "h-[76px]" : "h-[34px]"} animate-pulse border-b bg-muted/30`} aria-hidden="true" />
  return (
    <button
      id={itemId}
      type="button"
      className={`flex w-full items-center gap-2 border-b px-2 text-left text-xs hover:bg-muted aria-selected:bg-accent data-[focused=true]:ring-1 data-[focused=true]:ring-inset data-[focused=true]:ring-primary ${rich ? "h-[76px]" : "h-[34px]"}`}
      aria-selected={selected}
      data-focused={focused || undefined}
      disabled={disabled}
      title={entry.path}
      onClick={(event) => onSelect(entry, index, event)}
      tabIndex={-1}
      data-preview-mode={visualMode}
      data-folder-entry="true"
      data-context-menu="neoview-folder-entry"
      data-folder-index={index}
      data-folder-path={entry.path}
      data-folder-name={entry.name}
      data-folder-kind={entry.kind}
      data-folder-reader-supported={entry.readerSupported}
    >
      {rich ? (
        <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded bg-muted/30">
          {thumbnailUrl ? <img src={thumbnailUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover" /> : <FolderEntryIcon entry={entry} className="size-7" />}
        </span>
      ) : <FolderEntryIcon entry={entry} />}
      <span className="grid min-w-0 flex-1 gap-1">
        <span className="truncate">{entry.name}</span>
        {rich ? <span className="truncate text-[10px] text-muted-foreground">{entry.path}</span> : null}
      </span>
      <FolderEntryMetadata entry={entry} showRating={showRating} showCollectTagCount={showCollectTagCount} />
    </button>
  )
}

interface DirectoryItemProps {
  itemId: string
  entry?: ReaderDirectoryEntryDto
  index: number
  disabled: boolean
  selected: boolean
  focused: boolean
  showRating: boolean
  showCollectTagCount: boolean
  onSelect(entry: ReaderDirectoryEntryDto, index: number, event: ReactMouseEvent): void
}

function BrowserButton({ label, disabled = false, clickDisabled = false, active = false, onClick, onContextMenu, children }: { label: string; disabled?: boolean; clickDisabled?: boolean; active?: boolean; onClick(): void; onContextMenu?: (event: ReactMouseEvent<HTMLButtonElement>) => void; children: ReactNode }) {
  return <Button type="button" size="icon-sm" variant={active ? "default" : "ghost"} aria-label={label} title={label} aria-disabled={disabled || clickDisabled} aria-pressed={active || undefined} disabled={disabled} onClick={() => { if (!clickDisabled) onClick() }} onContextMenu={onContextMenu}>{children}</Button>
}

export function mergeThumbnailUrls(
  current: ReadonlyMap<string, string>,
  additions: readonly (readonly [string, string])[],
  maximum: number,
): ReadonlyMap<string, string> {
  if (!additions.length) return current
  const next = new Map(current)
  for (const [path, url] of additions) {
    next.delete(path)
    next.set(path, url)
  }
  while (next.size > maximum) next.delete(next.keys().next().value as string)
  return next
}

function thumbnailProfile(
  entry: Pick<ReaderDirectoryEntryDto, "kind">,
  viewMode: FolderViewMode,
  previewCount: FolderPreviewCount,
): string {
  return entry.kind === "directory" && viewUsesMosaic(viewMode)
    ? `folder:${previewCount}`
    : `${entry.kind}:1`
}

function sameFolderPath(left: string, right: string): boolean {
  const normalize = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/u, "")
  const normalizedLeft = normalize(left)
  const normalizedRight = normalize(right)
  return /^[a-z]:/iu.test(normalizedLeft) || /^[a-z]:/iu.test(normalizedRight)
    ? normalizedLeft.toLocaleLowerCase("en-US") === normalizedRight.toLocaleLowerCase("en-US")
    : normalizedLeft === normalizedRight
}
