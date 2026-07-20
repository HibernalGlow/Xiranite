import {
  Virtuoso,
  type GridStateSnapshot,
  type ListRange,
  type StateSnapshot,
  type VirtuosoGridHandle,
  type VirtuosoHandle,
} from "react-virtuoso"
import { GalleryHorizontalEnd, Grid2X2, List, RefreshCw, Rows3, TableProperties, type LucideIcon } from "lucide-react"
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
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
import type { FolderContextEntry } from "./folder/FolderContextActions"
import {
  createDirectoryCatalog,
  directoryEntryAt,
  directoryLoadedEntries,
  directoryPageHasMetadata,
  directoryPageCursors,
  folderMetadataFieldsForView,
  folderErrorMessage,
  isAbortError,
  isEditableKeyboardEvent,
  isVerticalFolderRegion,
  mergeDirectoryPage,
  normalizeFolderNavigationPath,
  rememberDirectoryVisitState,
  restoreDirectoryVisitState,
  trimDirectoryPages,
  viewUsesBanner,
  viewUsesGrid,
  viewUsesThumbnails,
  viewUsesVirtuosoList,
  visibleGridColumnCount,
  visiblePageStep,
  type DirectoryCatalog,
} from "./folder/DirectoryCatalog"
import { resolveFolderKeyboardCommand, type FolderKeyboardCommand } from "./folder/FolderKeyboardCommands"
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
import { FolderEntryFileMetadata, FolderEntryIcon, FolderEntryMetadata } from "./folder/FolderEntryPresentation"
import { FolderHoverPreview } from "./folder/FolderHoverPreview"
import { FolderClipboardProvider, useFolderClipboard } from "./folder/FolderClipboard"
import { readerEntryClickIntent } from "./shared/ReaderEntryInteraction"
import {
  EMPTY_VIRTUOSO_COMPONENTS,
  FOLDER_LIST_COMPONENTS,
  runFolderNavigation,
  useFolderEmptyAreaNavigation,
} from "./folder/FolderEmptyAreaBehavior"

const PAGE_SIZE = 128
const MAX_CACHED_PAGES = 12
const MAX_THUMBNAILS = 64
const MAX_CACHED_THUMBNAIL_URLS = 256
const EMPTY_SELECTED_PATHS: ReadonlySet<string> = new Set()
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
  { value: "mosaic-list", label: "横幅", icon: GalleryHorizontalEnd },
  { value: "details", label: "详细信息", icon: TableProperties },
  { value: "cover-grid", label: "封面网格", icon: Grid2X2 },
]

type FolderViewMode = ReaderFolderViewMode
type FolderPreviewCount = 4 | 9 | 16
type FolderNavigationOptions = {
  keepTree?: boolean
  focusPath?: string
  selectFocus?: boolean
  clearSelection?: boolean
}
type FolderRetryOperation =
  | { kind: "open"; path: string }
  | { kind: "navigate"; navigation: ReaderDirectoryNavigationDto; options: FolderNavigationOptions }

const DEFAULT_FOLDER_VIEW: ReaderFolderViewConfig = {
  homePath: "",
  viewMode: "compact",
  previewGridEnabled: false,
  previewCount: 4,
  thumbnailWidthPercent: 20,
  bannerWidthPercent: 50,
  hoverPreviewEnabled: true,
  hoverPreviewDelayMs: 500,
  typeFilter: "library",
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
const FolderTreePanel = lazy(() => import("./folder/FolderTreePanel"))
const DirectoryWatch = lazy(() => import("./folder/DirectoryWatch"))
const FolderTabsHost = lazy(() => import("./folder/FolderTabsHost"))
const FolderChromeLayout = lazy(() => import("./folder/FolderChromeLayout"))
const FolderSelectionBar = lazy(() => import("./folder/FolderSelectionBar"))
const FolderContextActions = lazy(() => import("./folder/FolderContextActions"))
const FolderToolbarLazy = lazy(async () => ({ default: (await import("./folder/FolderToolbar")).default }))

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
        hoverPreviewEnabled: context.folderView.hoverPreviewEnabled ?? DEFAULT_FOLDER_VIEW.hoverPreviewEnabled,
        hoverPreviewDelayMs: context.folderView.hoverPreviewDelayMs ?? DEFAULT_FOLDER_VIEW.hoverPreviewDelayMs,
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

function FolderBrowserPane({ client, disabled, sourcePath, onOpen, systemActions, switchToast, folderView = DEFAULT_FOLDER_VIEW, onFolderView, active, tabBar, folderTabCount, maxFolderTabs, onCreateTab, onCurrentPathChange, onOpenInNewTab, initialClone, onCloneProvider }: ReaderPanelContext & { active: boolean; tabBar?: ReactNode; folderTabCount: number; maxFolderTabs: number; onCreateTab(): void; currentFolderTabPinned: boolean; canReopenFolderTab: boolean; onDuplicateCurrentTab(): void; onToggleCurrentTabPinned(): void; onReopenFolderTab(): void; onCurrentPathChange(path: string): void; onOpenInNewTab(path: string): void; initialClone?: FolderBrowserCloneSnapshot; onCloneProvider(provider?: FolderBrowserCloneProvider): void }) {
  const clipboard = useFolderClipboard()
  const pendingInitialCloneRef = useRef(initialClone)
  const sessionIdRef = useRef<string | undefined>(undefined)
  const catalogRef = useRef<DirectoryCatalog | undefined>(undefined)
  const navigationRequestRef = useRef<AbortController | undefined>(undefined)
  const retryOperationRef = useRef<FolderRetryOperation | undefined>(undefined)
  const catalogRequestRef = useRef<AbortController | undefined>(undefined)
  const thumbnailRequestRef = useRef<AbortController | undefined>(undefined)
  const pendingCursorsRef = useRef(new Set<string>())
  const pendingKeyboardCommandRef = useRef<{ generation: number; index: number; kind: Extract<FolderKeyboardCommand["kind"], "activate" | "trash" | "rename" | "context-menu"> }>()
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
  const [treeOpen, setTreeOpen] = useState(folderView.tree.visible)
  const [inlineTreeOpen, setInlineTreeOpen] = useState(false)
  const [treeLayout, setTreeLayout] = useState(folderView.tree.layout)
  const [treeSize, setTreeSize] = useState(folderView.tree.size)
  const [viewMode, setViewMode] = useState<FolderViewMode>(folderView.viewMode)
  const [previewGridEnabled, setPreviewGridEnabled] = useState(folderView.previewGridEnabled ?? false)
  const [previewCount, setPreviewCount] = useState<FolderPreviewCount>(folderView.previewCount)
  const [thumbnailWidthPercent, setThumbnailWidthPercent] = useState(folderView.thumbnailWidthPercent)
  const [bannerWidthPercent, setBannerWidthPercent] = useState(folderView.bannerWidthPercent)
  const [hoverPreviewEnabled, setHoverPreviewEnabled] = useState(folderView.hoverPreviewEnabled ?? true)
  const [hoverPreviewDelayMs, setHoverPreviewDelayMs] = useState(folderView.hoverPreviewDelayMs ?? 500)
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [chainSelectMode, setChainSelectMode] = useState(false)
  const [checkModeClickBehavior, setCheckModeClickBehavior] = useState<"open" | "select">("open")
  const [restoreState, setRestoreState] = useState<SavedDirectoryState>()
  const [selection, setSelection] = useState<DirectorySelectionModel>(() => createDirectorySelection(0))
  const [renameRequest, setRenameRequest] = useState<FolderContextEntry>()
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
    const targetPath = resolveFolderStartupPath(sourcePath, folderView.homePath)
    if (!targetPath) return
    const snapshot = pendingInitialCloneRef.current
    pendingInitialCloneRef.current = undefined
    if (snapshot?.clonedPage) {
      restoreClonedBrowser(snapshot)
      return
    }
    if (catalogRef.current) {
      // Prefer focusing a file inside the current folder; otherwise reopen when the active book
      // (or home fallback) points at a different directory tree.
      if (sourcePath && sameFolderOrChild(catalogRef.current.path, sourcePath)) {
        focusSourceEntry(sourcePath)
        return
      }
      if (sameFolderPath(catalogRef.current.path, targetPath) || sameFolderOrChild(targetPath, catalogRef.current.path)) {
        return
      }
    }
    void openBrowser(targetPath)
  }, [sourcePath, folderView.homePath])

  useEffect(() => disposeBrowser, [])

  useEffect(() => {
    onCloneProvider(captureCloneSnapshot)
    return () => onCloneProvider(undefined)
  }, [onCloneProvider])

  useEffect(() => setViewMode(folderView.viewMode), [folderView.viewMode])
  useEffect(() => setPreviewGridEnabled(folderView.previewGridEnabled ?? false), [folderView.previewGridEnabled])
  useEffect(() => setPreviewCount(folderView.previewCount), [folderView.previewCount])
  useEffect(() => setThumbnailWidthPercent(folderView.thumbnailWidthPercent), [folderView.thumbnailWidthPercent])
  useEffect(() => setBannerWidthPercent(folderView.bannerWidthPercent), [folderView.bannerWidthPercent])
  useEffect(() => setHoverPreviewEnabled(folderView.hoverPreviewEnabled ?? true), [folderView.hoverPreviewEnabled])
  useEffect(() => setHoverPreviewDelayMs(folderView.hoverPreviewDelayMs ?? 500), [folderView.hoverPreviewDelayMs])
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
  }, [active, catalog?.sessionId, catalog?.generation, viewMode, previewGridEnabled, previewCount])

  useEffect(() => {
    if (!catalog || viewMode !== "details") return
    queueMicrotask(() => requestRange(visibleRangeRef.current))
  }, [catalog?.sessionId, catalog?.generation, viewMode])

  async function registerVisibleThumbnails(refresh = false, targetPaths?: ReadonlySet<string>): Promise<void> {
    const current = catalogRef.current
    if (!current || !viewUsesThumbnails(viewMode) || !client.registerLibraryThumbnails) return
    const range = visibleRangeRef.current
    const candidates = targetPaths
      ? [...current.pages].flatMap(([cursor, entries]) => entries.map((entry, offset) => ({ index: cursor + offset, entry })))
      : directoryLoadedEntries(current, range.startIndex, range.endIndex, MAX_THUMBNAILS)
    const visible = candidates
      .filter(({ entry }) => entry.kind === "directory" || (entry.kind === "file" && entry.readerSupported))
      .filter(({ entry }) => !targetPaths || targetPaths.has(entry.path))
      .filter(({ entry }) => refresh || isThumbnailDemandNeeded(
        entry,
        viewMode,
        previewCount,
        thumbnailProfilesRef.current,
        thumbnailUrlsRef.current,
        previewGridEnabled,
      ))
      .slice(0, MAX_THUMBNAILS)
    if (!visible.length) return
    const signature = `${refresh ? `refresh:${++thumbnailRefreshSequenceRef.current}` : "normal"}:${targetPaths ? "selected" : "visible"}:${current.sessionId}:${current.generation}:${viewMode}:${previewGridEnabled}:${previewCount}:${visible.map(({ index, entry }) => `${index}:${entry.path}`).join("|")}`
    if (thumbnailSignatureRef.current === signature) return
    thumbnailSignatureRef.current = signature
    thumbnailRequestRef.current?.abort()
    const request = new AbortController()
    thumbnailRequestRef.current = request
    const generation = ++thumbnailGenerationRef.current
    const contextId = thumbnailContextRef.current ?? `folder:${current.sessionId}:${++thumbnailContextSequenceRef.current}`
    thumbnailContextRef.current = contextId
    const pathById = new Map(visible.map(({ index, entry }) => [String(index), entry.path]))
    const profileById = new Map(visible.map(({ index, entry }) => [String(index), thumbnailProfile(entry, viewMode, previewCount, previewGridEnabled)]))
    await client.registerLibraryThumbnails(
      contextId,
      generation,
      visible.map(({ index, entry }) => ({
        id: String(index),
        path: entry.path,
        kind: entry.kind === "directory" ? "folder" : "file",
        previewCount: entry.kind === "directory" && previewGridEnabled ? previewCount : 1,
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

  async function refreshThumbnails(targetPaths?: ReadonlySet<string>) {
    if (thumbnailRefreshPending) return
    setThumbnailRefreshPending(true)
    try {
      await registerVisibleThumbnails(true, targetPaths)
    } finally {
      setThumbnailRefreshPending(false)
    }
  }

  const refreshVisibleThumbnails = () => refreshThumbnails()
  const refreshSelectedThumbnails = () => refreshThumbnails(selectedPaths)
  function cancelThumbnailRefresh() {
    if (!thumbnailRefreshPending) return
    thumbnailRequestRef.current?.abort(new DOMException("Thumbnail refresh cancelled", "AbortError"))
    thumbnailRequestRef.current = undefined
    thumbnailGenerationRef.current += 1
    setThumbnailRefreshPending(false)
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
    const normalized = normalizeFolderNavigationPath(path)
    if (!normalized || !client.openDirectoryBrowser) return
    setSearchOpen(false)
    setTreeOpen(false)
    const generation = beginNavigation()
    setLoading(true)
    setError(undefined)
    retryOperationRef.current = { kind: "open", path: normalized }
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
      retryOperationRef.current = undefined
      if (previous && previous !== opened.sessionId) void client.closeDirectoryBrowser?.(previous).catch(() => undefined)
      const preferredFilter = folderView.typeFilter ?? "library"
      if (preferredFilter !== "all" && preferredFilter !== opened.filter && client.filterDirectoryBrowser) {
        await updateCatalogProjection(
          (sessionId, focusPath, signal) => client.filterDirectoryBrowser!(sessionId, preferredFilter, focusPath, signal),
          true,
        )
      }
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

  async function navigate(navigation: ReaderDirectoryNavigationDto, options: FolderNavigationOptions = {}) {
    const normalizedNavigation = navigation.action === "path"
      ? { ...navigation, path: normalizeFolderNavigationPath(navigation.path) }
      : navigation
    const sessionId = sessionIdRef.current
    if (!sessionId) {
      if (normalizedNavigation.action === "path") await openBrowser(normalizedNavigation.path)
      return
    }
    if (!client.navigateDirectoryBrowser) return
    setSearchOpen(false)
    if (!options.keepTree) setTreeOpen(false)
    const capturedState = await captureRefreshState()
    const generation = beginNavigation()
    setLoading(true)
    setError(undefined)
    retryOperationRef.current = { kind: "navigate", navigation: normalizedNavigation, options }
    try {
      const result = await client.navigateDirectoryBrowser(
        sessionId,
        normalizedNavigation,
        navigationRequestRef.current?.signal,
        options.focusPath ?? capturedState?.focusedPath,
      )
      if (generation === navigationGenerationRef.current) {
        let preferredState = normalizedNavigation.action === "refresh" ? capturedState : undefined
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
        retryOperationRef.current = undefined
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
      ? mergeThumbnailUrls(thumbnailUrlsRef.current, restored.thumbnailUrls ? [...restored.thumbnailUrls] : [], MAX_CACHED_THUMBNAIL_URLS)
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

  function retryLastOperation() {
    const operation = retryOperationRef.current
    if (!operation) return
    if (operation.kind === "open") void openBrowser(operation.path)
    else void navigate(operation.navigation, operation.options)
  }

  async function updateFilter(filter: ReaderDirectoryFilterDto) {
    const applyFilter = client.filterDirectoryBrowser
    const current = catalogRef.current
    if (!applyFilter || !current || filter === current.filter) return
    await updateCatalogProjection((sessionId, focusPath, signal) => applyFilter(sessionId, filter, focusPath, signal), true)
    if ((folderView.typeFilter ?? "library") !== filter) void onFolderView?.({ typeFilter: filter })
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
      : folderMetadataFieldsForView(viewMode, current.metadataCapabilities)
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
          const pending = pendingKeyboardCommandRef.current
          if (pending && pending.generation === merged.generation && pending.index >= 0) {
            const pendingEntry = directoryEntryAt(merged, pending.index)
            if (pendingEntry) {
              pendingKeyboardCommandRef.current = undefined
              queueMicrotask(() => {
                const latest = catalogRef.current
                if (latest?.generation === pending.generation) {
                  runFocusedKeyboardEntry(pending.kind, latest, pending.index)
                }
              })
            }
          }
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
      // The ref is updated in the thumbnail response handler before React
      // necessarily commits the corresponding state update. Navigation and
      // tab snapshots must capture that latest cache to avoid a needless
      // re-registration when the user immediately goes back.
      thumbnailUrls: viewUsesThumbnails(viewMode) ? thumbnailUrlsRef.current : undefined,
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
      thumbnailUrls: thumbnailUrlsRef.current,
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

  function togglePreviewGrid(enabled: boolean) {
    if (enabled === previewGridEnabled) return
    captureCurrentState()
    resetThumbnailRegistration()
    const emptyThumbnailUrls = new Map<string, string>()
    thumbnailUrlsRef.current = emptyThumbnailUrls
    thumbnailProfilesRef.current = new Map()
    setThumbnailUrls(emptyThumbnailUrls)
    setPreviewGridEnabled(enabled)
    thumbnailSignatureRef.current = ""
    void onFolderView?.({ previewGridEnabled: enabled })
  }

  function commitThumbnailWidth(value: number) {
    if (value !== folderView.thumbnailWidthPercent) void onFolderView?.({ thumbnailWidthPercent: value })
  }

  function commitBannerWidth(value: number) {
    if (value !== folderView.bannerWidthPercent) void onFolderView?.({ bannerWidthPercent: value })
  }

  function commitHoverPreviewEnabled(enabled: boolean) {
    setHoverPreviewEnabled(enabled)
    if (enabled !== folderView.hoverPreviewEnabled) void onFolderView?.({ hoverPreviewEnabled: enabled })
  }

  function commitHoverPreviewDelay(value: number) {
    const delay = value as 200 | 500 | 800 | 1200
    setHoverPreviewDelayMs(delay)
    if (delay !== folderView.hoverPreviewDelayMs) void onFolderView?.({ hoverPreviewDelayMs: delay })
  }

  function toggleTree() {
    const visible = !treeOpen
    setTreeOpen(visible)
    void onFolderView?.({ tree: { visible } })
  }

  function toggleInlineTree() {
    if (!inlineTreeOpen) {
      const state = captureCurrentState()
      if (state) {
        if (viewUsesVirtuosoList(viewMode)) {
          listRef.current?.getState((listSnapshot) => setRestoreState({ ...state, listSnapshot }))
        } else {
          setRestoreState(state)
        }
      }
    }
    setInlineTreeOpen((current) => !current)
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
    pendingKeyboardCommandRef.current = undefined
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
    const currentIndex = Math.min(
      Math.max(focusedIndexRef.current ?? visibleRangeRef.current.startIndex, 0),
      Math.max(0, currentCatalog.total - 1),
    )
    const gridColumns = viewUsesGrid(viewMode) ? visibleGridColumnCount(listHostRef.current) : 1
    const pageStep = visiblePageStep(viewMode, gridColumns)
    const command = resolveFolderKeyboardCommand({
      key: event.key,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    }, {
      currentIndex,
      total: currentCatalog.total,
      isGrid: viewUsesGrid(viewMode),
      gridColumns,
      pageStep,
      canGoBack: currentCatalog.canGoBack,
      hasParent: Boolean(currentCatalog.parentPath),
      multiSelectMode,
    })
    if (!command) {
      if (event.key !== " ") return
      const entry = directoryEntryAt(currentCatalog, currentIndex)
      if (!entry) return
      event.preventDefault()
      event.stopPropagation()
      setMultiSelectMode(true)
      setSelection((current) => toggleDirectorySelection(current, currentCatalog.generation, entry.path, currentIndex))
      return
    }

    event.preventDefault()
    event.stopPropagation()
    if (command.kind === "refresh") {
      pendingKeyboardCommandRef.current = undefined
      void navigate({ action: "refresh" })
      return
    }
    if (command.kind === "search") {
      pendingKeyboardCommandRef.current = undefined
      setSearchOpen(true)
      return
    }
    if (command.kind === "select-all") {
      pendingKeyboardCommandRef.current = undefined
      setMultiSelectMode(true)
      setSelection(selectAllDirectoryEntries(currentCatalog.generation))
      return
    }
    if (command.kind === "clear-selection") {
      pendingKeyboardCommandRef.current = undefined
      setSelection(createDirectorySelection(currentCatalog.generation))
      setMultiSelectMode(false)
      return
    }
    if (command.kind === "back") {
      pendingKeyboardCommandRef.current = undefined
      void navigate({ action: "back" })
      return
    }
    if (command.kind === "up") {
      pendingKeyboardCommandRef.current = undefined
      void navigate({ action: "up" })
      return
    }
    if (command.kind === "activate" || command.kind === "trash" || command.kind === "rename" || command.kind === "context-menu") {
      runFocusedKeyboardEntry(command.kind, currentCatalog, currentIndex)
      return
    }
    if (command.kind !== "move") return
    pendingKeyboardCommandRef.current = undefined
    const nextIndex = command.targetIndex
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

  function runFocusedKeyboardEntry(
    kind: Extract<FolderKeyboardCommand["kind"], "activate" | "trash" | "rename" | "context-menu">,
    currentCatalog: DirectoryCatalog,
    index: number,
  ) {
    const entry = directoryEntryAt(currentCatalog, index)
    if (!entry) {
      if (!client.listDirectoryBrowser) return
      pendingKeyboardCommandRef.current = { generation: currentCatalog.generation, index, kind }
      requestRange({ startIndex: index, endIndex: index })
      if (viewUsesVirtuosoList(viewMode)) listRef.current?.scrollToIndex({ index, align: "center" })
      else if (viewUsesGrid(viewMode)) gridRef.current?.scrollToIndex({ index, align: "center" })
      return
    }
    pendingKeyboardCommandRef.current = undefined
    if (kind === "activate") {
      activate(entry)
    } else if (kind === "rename") {
      if (client.executeFileOperations) setRenameRequest({ index, ...entry })
    } else if (kind === "trash") {
      if (!client.executeFileOperations) return
      listHostRef.current?.dispatchEvent(new CustomEvent("neoview-folder-trash-request", {
        bubbles: true,
        detail: { index, ...entry },
      }))
    } else {
      dispatchFocusedFolderContextMenu(index, entry)
    }
  }

  function dispatchFocusedFolderContextMenu(index: number, entry: ReaderDirectoryEntryDto) {
    const host = listHostRef.current
    if (!host) return
    const mounted = host.querySelector<HTMLElement>(`[data-folder-index="${index}"]`)
    if (mounted) {
      mounted.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 0,
        clientY: 0,
      }))
      return
    }
    // Keep keyboard context menus usable for sparse virtual pages. The proxy
    // carries the same dataset as a mounted row, so the shared context-menu
    // builder remains the single source of menu actions.
    const proxy = document.createElement("button")
    proxy.type = "button"
    proxy.tabIndex = -1
    proxy.hidden = true
    proxy.dataset.contextMenu = "neoview-folder-entry"
    proxy.dataset.folderIndex = String(index)
    proxy.dataset.folderPath = entry.path
    proxy.dataset.folderName = entry.name
    proxy.dataset.folderKind = entry.kind
    proxy.dataset.folderReaderSupported = String(entry.readerSupported)
    host.append(proxy)
    proxy.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 0,
      clientY: 0,
    }))
    proxy.remove()
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
    pendingKeyboardCommandRef.current = undefined
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

  const selectedCount = catalog ? directorySelectionCount(selection, catalog.total) : 0
  // A generation identifies fresh listing data, not a new browser visit. Keep the
  // renderer mounted while refreshing/back-forwarding the same navigation entry so
  // Virtuoso/Niko can retain its viewport and existing thumbnail DOM.
  const virtualKey = catalog
    ? `${catalog.sessionId}:${catalog.navigationEntryId}:${viewMode}:${previewCount}`
    : `${viewMode}:${previewCount}`
  const tabLayout = folderView.tabs ?? DEFAULT_FOLDER_VIEW.tabs!
  const showReturnFooter = folderView.emptyArea.showBackButton && !searchOpen
  const returnFooterContext = {
    disabled: disabled || loading || !catalog || (!catalog.canGoBack && !catalog.parentPath),
    onReturn: () => runFolderNavigation("return", catalogRef.current, (command) => { void navigate(command) }),
  }
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
        client={client}
        sessionId={catalog?.sessionId}
        canCreateTab={!tabBar && folderTabCount < maxFolderTabs}
        onCreateTab={onCreateTab}
        onNavigate={(path) => { void navigate({ action: "path", path }) }}
        onNavigateAction={(action) => { void navigate({ action }) }}
        onCopyPath={systemActions?.copyText}
      />
    </Suspense>
  )

  function focusSourceEntry(path: string): void {
    const current = catalogRef.current
    if (!current) return
    for (const [cursor, entries] of current.pages) {
      const offset = entries.findIndex((entry) => sameFolderPath(entry.path, path))
      if (offset < 0) continue
      const index = cursor + offset
      focusedIndexRef.current = index
      setFocusedIndex(index)
      setFocusedPath(entries[offset]!.path)
      setSelection(selectDirectorySingle(current.generation, entries[offset]!.path, index))
      requestRange({ startIndex: index, endIndex: index })
      if (viewUsesVirtuosoList(viewMode)) listRef.current?.scrollToIndex({ index, align: "center" })
      else if (viewUsesGrid(viewMode)) gridRef.current?.scrollToIndex({ index, align: "center" })
      return
    }
  }

  return (
    <div
      className="flex h-full min-h-0 min-w-0 w-full flex-1 gap-2"
      data-neoview-folder-card={active || null}
      data-neoview-folder-pane={true}
      data-folder-breadcrumb-position={tabLayout.breadcrumbPosition}
      data-folder-toolbar-position={tabLayout.toolbarPosition}
      data-folder-tab-position={tabLayout.layout}
      data-folder-view-mode={viewMode}
      data-folder-inline-tree={inlineTreeOpen || null}
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
            switchToast={switchToast}
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
            renameRequest={renameRequest}
            onRenameRequestHandled={() => setRenameRequest(undefined)}
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
        data-folder-toolbar-layout="single-row"
      >
        <Suspense fallback={<div className="h-8" aria-label="正在加载工具栏" />}>
          <FolderToolbarLazy
            disabled={disabled}
            loading={loading}
            canGoBack={Boolean(catalog?.canGoBack)}
            canGoForward={Boolean(catalog?.canGoForward)}
            canGoUp={Boolean(catalog?.parentPath)}
            homePath={folderView.homePath || undefined}
            currentPath={catalog?.path}
            viewMode={viewMode}
            viewModeOptions={VIEW_MODE_OPTIONS}
            previewGridEnabled={previewGridEnabled}
            previewCount={previewCount}
            hoverPreviewEnabled={hoverPreviewEnabled}
            hoverPreviewDelayMs={hoverPreviewDelayMs}
            thumbnailWidthPercent={thumbnailWidthPercent}
            bannerWidthPercent={bannerWidthPercent}
            searchOpen={searchOpen}
            canFilter={Boolean(client.filterDirectoryBrowser)}
            typeFilter={catalog?.filter ?? folderView.typeFilter ?? "library"}
            filterOptions={catalog?.filterOptions}
            treeOpen={treeOpen}
            canTree={Boolean(client.treeDirectoryBrowser)}
            inlineTreeOpen={inlineTreeOpen}
            multiSelectMode={multiSelectMode}
            sort={catalog?.sort}
            sortFields={catalog?.sortFields}
            sortSource={catalog?.sortSource}
            sortTemporary={catalog?.sortTemporary}
            canSort={Boolean(client.sortDirectoryBrowser)}
            canSortPreference={Boolean(client.updateDirectorySortPreference)}
            emptyArea={folderView.emptyArea}
            pasteAvailable={Boolean(catalog && clipboard.clipboard.available)}
            pasteRunning={clipboard.operation?.status === "running"}
            pasteProgress={clipboard.operation ? { processed: clipboard.operation.processed, total: clipboard.operation.total } : undefined}
            thumbnailRefreshPending={thumbnailRefreshPending}
            canRefreshThumbnails={Boolean(client.registerLibraryThumbnails)}
            canRefreshSelectedThumbnails={Boolean(client.registerLibraryThumbnails && selectedPaths.size)}
            sortLabels={SORT_LABELS}
            sortSourceLabels={SORT_SOURCE_LABELS}
            onNavigateBack={() => { void navigate({ action: "back" }) }}
            onNavigateForward={() => { void navigate({ action: "forward" }) }}
            onNavigateUp={() => { void navigate({ action: "up" }) }}
            onGoHome={() => {
              if (folderView.homePath && catalog?.path !== folderView.homePath) void navigate({ action: "path", path: folderView.homePath })
            }}
            onSetHome={() => {
              if (catalog && !loading && catalog.path !== folderView.homePath) void onFolderView?.({ homePath: catalog.path })
            }}
            onRefresh={() => { void navigate({ action: "refresh" }) }}
            onSwitchView={switchView}
            onTogglePreviewGrid={togglePreviewGrid}
            onSwitchPreviewCount={switchPreviewCount}
            onCommitHoverPreviewEnabled={commitHoverPreviewEnabled}
            onCommitHoverPreviewDelay={commitHoverPreviewDelay}
            onThumbnailWidthChange={(value) => setThumbnailWidthPercent(value)}
            onCommitThumbnailWidth={commitThumbnailWidth}
            onBannerWidthChange={(value) => setBannerWidthPercent(value)}
            onCommitBannerWidth={commitBannerWidth}
            onToggleSearch={() => setSearchOpen((current) => !current)}
            onChangeTypeFilter={(filter) => { void updateFilter(filter) }}
            onToggleTree={toggleTree}
            onToggleInlineTree={toggleInlineTree}
            onToggleMultiSelect={toggleMultiSelectMode}
            onUpdateSort={(sort) => { void updateSort(sort) }}
            onUpdateSortPreference={(command) => { void updateSortPreference(command) }}
            onEmptyAreaChange={(emptyArea) => { void onFolderView?.({ emptyArea }) }}
            onPaste={() => { if (catalog) void clipboard.paste(catalog.path) }}
            onRefreshVisibleThumbnails={() => { void refreshVisibleThumbnails() }}
            onRefreshSelectedThumbnails={() => { void refreshSelectedThumbnails() }}
            onCancelThumbnailRefresh={cancelThumbnailRefresh}
          />
        </Suspense>

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
            switchToast={switchToast}
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
            onDeleteCompleted={() => navigate(
              { action: "refresh" },
              { keepTree: true, clearSelection: true },
            )}
          />
        </Suspense>
      ) : null}
      {error ? (
        <div role="alert" className="flex items-center gap-2 rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">
          <span className="min-w-0 flex-1">{error}</span>
          {retryOperationRef.current ? (
            <Button type="button" size="sm" variant="outline" disabled={loading} onClick={retryLastOperation}>
              <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />
              重试
            </Button>
          ) : null}
        </div>
      ) : null}
      {active && clipboard.feedback ? (
        <div role={clipboard.feedback.kind} className={clipboard.feedback.kind === "alert" ? "rounded bg-destructive/10 px-2 py-1 text-xs text-destructive" : "sr-only"}>
          {clipboard.feedback.text}
        </div>
      ) : null}
      <div
        className="grid min-h-0 flex-1 overflow-hidden"
        style={{
          "--folder-tree-size": `${treeSize}px`,
          gridTemplateColumns: !treeOpen ? "1fr" : treeLayout === "left" ? "min(var(--folder-tree-size), 50%) 1fr" : treeLayout === "right" ? "1fr min(var(--folder-tree-size), 50%)" : "1fr",
          gridTemplateRows: !treeOpen ? undefined : treeLayout === "top" ? "var(--folder-tree-size) minmax(0, 1fr)" : treeLayout === "bottom" ? "minmax(0, 1fr) var(--folder-tree-size)" : "minmax(0, 1fr)",
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
          className="min-h-0 min-w-0 overflow-hidden rounded border bg-background/60 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-neoview-folder-list="true"
          data-focused-index={focusedIndex}
          role={searchOpen || inlineTreeOpen ? undefined : "listbox"}
          aria-label={searchOpen ? undefined : "文件项目"}
          aria-activedescendant={searchOpen || inlineTreeOpen ? undefined : focusedItemId}
          tabIndex={inlineTreeOpen ? -1 : 0}
          onKeyDown={inlineTreeOpen ? undefined : handleDirectoryKeyDown}
          {...(inlineTreeOpen ? {} : emptyAreaHandlers)}
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
        {!searchOpen && inlineTreeOpen && sessionIdRef.current && catalog ? (
          <Suspense fallback={<div className="h-72 animate-pulse bg-muted/30" aria-label="正在加载内联文件树" />}>
            <FolderTreePanel
              client={client}
              sessionId={sessionIdRef.current}
              currentPath={catalog.path}
              watching={active && catalog.watching}
              disabled={disabled || loading}
              pinnedPaths={[]}
              onNavigate={(path) => { void navigate({ action: "path", path }, { keepTree: true }) }}
              onPinnedPathsChange={() => undefined}
            />
          </Suspense>
        ) : null}
        {!searchOpen && !inlineTreeOpen && catalog && catalog.total > 0 && viewUsesVirtuosoList(viewMode) ? (
          <Virtuoso
            key={virtualKey}
            ref={listRef}
            style={{ height: "100%" }}
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
                  hoverPreviewEnabled={active && hoverPreviewEnabled}
                  hoverPreviewDelayMs={hoverPreviewDelayMs}
                  onSelect={selectEntry}
                />
              )
            }}
          />
        ) : null}
        {!searchOpen && !inlineTreeOpen && catalog && viewMode === "details" ? (
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
        {!searchOpen && !inlineTreeOpen && catalog && catalog.total > 0 && viewUsesGrid(viewMode) ? (
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
              hoverPreviewEnabled={active && hoverPreviewEnabled}
              hoverPreviewDelayMs={hoverPreviewDelayMs}
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
        {!searchOpen && !inlineTreeOpen && catalog && catalog.total === 0 ? (
          <div
            className="grid h-72 place-items-center px-4 text-center text-xs text-muted-foreground"
            data-folder-empty-state="true"
            role="status"
          >
            {catalog.filter === "all" ? "此文件夹为空" : "没有符合当前筛选条件的项目"}
          </div>
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

function DirectoryListItem({ itemId, entry, index, disabled, selected, focused, showRating, showCollectTagCount, visualMode, thumbnailUrl, hoverPreviewEnabled, hoverPreviewDelayMs, onSelect }: DirectoryItemProps & { visualMode: FolderViewMode; thumbnailUrl?: string; hoverPreviewEnabled: boolean; hoverPreviewDelayMs: number }) {
  const rich = visualMode !== "compact"
  if (!entry) return <div className={`${rich ? "h-[76px]" : "h-[34px]"} animate-pulse border-b bg-muted/30`} aria-hidden="true" />
  return (
    <FolderHoverPreview thumbnailUrl={thumbnailUrl} enabled={hoverPreviewEnabled && rich} delayMs={hoverPreviewDelayMs} label={entry.name}>
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
            {thumbnailUrl
              ? <img
                  src={thumbnailUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="size-full object-contain"
                  onLoad={(event) => { event.currentTarget.hidden = false }}
                  onError={(event) => { event.currentTarget.hidden = true }}
                />
              : entry.kind === "directory" ? null : <FolderEntryIcon entry={entry} className="size-7" />}
          </span>
        ) : <FolderEntryIcon entry={entry} />}
        <span className="grid min-w-0 flex-1 gap-1">
          <span className="truncate">{entry.name}</span>
          {rich ? <span className="truncate text-[10px] text-muted-foreground">{entry.path}</span> : null}
          {rich ? <FolderEntryFileMetadata entry={entry} /> : null}
        </span>
        <FolderEntryMetadata entry={entry} showRating={showRating} showCollectTagCount={showCollectTagCount} />
      </button>
    </FolderHoverPreview>
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
  _viewMode: FolderViewMode,
  previewCount: FolderPreviewCount,
  previewGridEnabled = false,
): string {
  return entry.kind === "directory" && previewGridEnabled
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

/**
 * Reuse a restored file thumbnail even when it predates the profile sidecar.
 * Folder mosaic thumbnails remain profile-sensitive because preview count and
 * layout change their asset contents.
 */
export function isThumbnailDemandNeeded(
  entry: Pick<ReaderDirectoryEntryDto, "kind" | "path">,
  viewMode: FolderViewMode,
  previewCount: FolderPreviewCount,
  profiles: ReadonlyMap<string, string>,
  urls: ReadonlyMap<string, string>,
  previewGridEnabled = false,
): boolean {
  const expected = thumbnailProfile(entry, viewMode, previewCount, previewGridEnabled)
  const current = profiles.get(entry.path)
  if (current === expected) return false
  return !(entry.kind === "file" && current === undefined && urls.has(entry.path))
}

function resolveFolderStartupPath(sourcePath: string | undefined, homePath: string | undefined): string {
  const source = sourcePath?.trim()
  if (source) return source
  const home = homePath?.trim()
  if (home) return home
  return ""
}

function sameFolderOrChild(folderPath: string, sourcePath: string): boolean {
  const folder = folderPath.replaceAll("\\", "/").replace(/\/+$/u, "").toLocaleLowerCase()
  const source = sourcePath.trim().replaceAll("\\", "/").replace(/\/+$/u, "").toLocaleLowerCase()
  if (!folder || !source || folder === source) return folder === source
  const separator = source.lastIndexOf("/")
  const parent = separator < 0 ? source : source.slice(0, separator).replace(/\/+$/u, "")
  return parent === folder || parent === `${folder}:`
}
