import { Virtuoso, type GridStateSnapshot, type ListRange, type StateSnapshot, type VirtuosoGridHandle, type VirtuosoHandle } from "react-virtuoso"
import { GalleryHorizontalEnd, Grid2X2, LayoutGrid, List, RefreshCw, Rows3, TableProperties, type LucideIcon } from "lucide-react"
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react"

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
  ReaderFolderPenetrationConfig,
} from "../../../../adapters/reader-http-client"
import { READER_FOLDER_DETAIL_DEFAULT_WIDTHS } from "../../../../adapters/reader-http-client"
import { ReaderThumbnailSurface } from "../../../thumbnails/ReaderThumbnailSurface"
import type { ReaderPanelContext } from "../../registry"
import type { FolderContextEntry } from "./FolderContextActions"
import {
  createSearchDirectoryPage,
  isVirtualSearchPath,
  type FolderSearchTabSnapshot,
} from "./search/folderSearchModel"
import type { FolderSearchListingUpdate } from "./FolderSearchPanel"
import {
  createDirectoryCatalog,
  directoryEntryAt,
  directoryLoadedEntries,
  directoryPageHasMetadata,
  directoryPageCursors,
  folderMetadataFieldsForView,
  folderErrorMessage,
  FOLDER_MOSAIC_GROUP_SIZE,
  isAbortError,
  isEditableKeyboardEvent,
  isVerticalFolderRegion,
  mergeDirectoryPage,
  normalizeFolderNavigationPath,
  rememberDirectoryVisitState,
  restoreDirectoryVisitState,
  thumbnailPixelSize,
  trimDirectoryPages,
  viewUsesBanner,
  viewUsesFixedGrid,
  viewUsesGrid,
  viewUsesMosaicGrid,
  viewUsesThumbnails,
  viewUsesVirtuosoList,
  visibleGridColumnCount,
  visiblePageStep,
  type DirectoryCatalog,
} from "./DirectoryCatalog"
import { resolveFolderKeyboardCommand, type FolderKeyboardCommand } from "./FolderKeyboardCommands"
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
} from "./DirectorySelection"
import {
  DEFAULT_FOLDER_TAG_DISPLAY,
  FolderEntryDisplayProvider,
  FolderEntryFileMetadata,
  FolderEntryIcon,
  FolderEntryMetadata,
} from "./FolderEntryPresentation"
import { FolderHoverPreview } from "./FolderHoverPreview"
import { FolderPenetrationFileNames, folderViewShowsPenetrationFiles, type FolderPenetrationFileName } from "./FolderPenetrationFileNames"
import FolderDeleteButton, { type FolderDeleteStrategy } from "./FolderDeleteButton"
import { useFolderClipboard } from "./FolderClipboard"
import { readerEntryClickIntent } from "../shared/ReaderEntryInteraction"
import { libraryItemFolderPath } from "../shared/libraryItemFolderPath"
import { EMPTY_VIRTUOSO_COMPONENTS, FOLDER_LIST_COMPONENTS, runFolderNavigation, useFolderEmptyAreaNavigation } from "./FolderEmptyAreaBehavior"

const PAGE_SIZE = 128
const MAX_CACHED_PAGES = 12
const MAX_THUMBNAILS = 24
const MAX_CACHED_THUMBNAIL_URLS = 256
// A short confirmation window preserves double-click raw-folder entry without
// making a resolved folder feel like a half-second blocking operation.
const PENETRATION_CLICK_DELAY_MS = 180
const EMPTY_SELECTED_PATHS: ReadonlySet<string> = new Set()
const DETAILS_METADATA_FIELDS: readonly ReaderDirectoryMetadataFieldDto[] = ["date", "size", "rating", "collectTagCount", "dimensions", "pageCount", "tags"]
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

const VIEW_MODE_OPTIONS: readonly {
  value: ReaderFolderViewMode
  label: string
  icon: LucideIcon
}[] = [
  { value: "compact", label: "紧凑列表", icon: List },
  { value: "cover-list", label: "封面列表", icon: Rows3 },
  { value: "mosaic-list", label: "横幅", icon: GalleryHorizontalEnd },
  { value: "details", label: "详细信息", icon: TableProperties },
  { value: "cover-grid", label: "封面网格", icon: Grid2X2 },
  { value: "mosaic-grid", label: "自由缩略图", icon: LayoutGrid },
]

type FolderViewMode = ReaderFolderViewMode
type FolderPreviewCount = 4 | 9 | 16
type FolderNavigationOptions = {
  keepTree?: boolean
  focusPath?: string
  selectFocus?: boolean
  clearSelection?: boolean
  preserveThumbnailCache?: boolean
}
type FolderRetryOperation =
  | { kind: "open"; path: string }
  | {
      kind: "navigate"
      navigation: ReaderDirectoryNavigationDto
      options: FolderNavigationOptions
    }

export const DEFAULT_FOLDER_VIEW: ReaderFolderViewConfig = {
  homePath: "",
  viewMode: "compact",
  previewGridEnabled: false,
  previewCount: 4,
  contentWidthPercent: 35,
  thumbnailWidthPercent: 20,
  bannerWidthPercent: 50,
  hoverPreviewEnabled: true,
  hoverPreviewDelayMs: 500,
  typeFilter: "library",
  showHiddenFolders: false,
  confirmDelete: true,
  tagDisplay: DEFAULT_FOLDER_TAG_DISPLAY,
  penetration: {
    enabled: false,
    showInternalFiles: true,
    internalItemsMode: "single",
    maxDepth: 3,
    terminalTargets: ["archive", "document", "media-directory", "file"],
  },
  emptyArea: {
    singleClickAction: "none",
    doubleClickAction: "goUp",
    showBackButton: false,
  },
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
  tabs: {
    pinned: [],
    layout: "top",
    width: 160,
    breadcrumbPosition: "top",
    toolbarPosition: "top",
  },
}

const FolderDetailsView = lazy(() => import("./FolderDetailsView"))
const FolderGridWorkspace = lazy(() => import("./FolderGridWorkspace"))
const FolderMosaicWorkspace = lazy(() => import("./FolderMosaicWorkspace"))
const FolderBreadcrumb = lazy(() => import("./FolderBreadcrumb"))
const FolderSearchPanel = lazy(() => import("./FolderSearchPanel"))
const FolderTreeWorkspace = lazy(() => import("./FolderTreeWorkspace"))
const FolderTreePanel = lazy(() => import("./FolderTreePanel"))
const DirectoryWatch = lazy(() => import("./DirectoryWatch"))
const FolderChromeLayout = lazy(() => import("./FolderChromeLayout"))
const FolderSelectionBar = lazy(() => import("./FolderSelectionBar"))
const FolderContextActions = lazy(() => import("./FolderContextActions"))
const FolderToolbarLazy = lazy(async () => ({
  default: (await import("./FolderToolbar")).default,
}))

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
  mosaicSnapshot?: StateSnapshot
  mosaicScrollTop?: number
  detailsScrollTop?: number
  thumbnailUrls?: ReadonlyMap<string, string>
  thumbnailUrlSets?: ReadonlyMap<string, readonly string[]>
  thumbnailProfiles?: ReadonlyMap<string, string>
}

export interface FolderBrowserCloneSnapshot {
  sourceSessionId: string
  clonedPage?: ReaderDirectoryPageDto
  currentState: SavedDirectoryState
  navigationStates: ReadonlyMap<number, SavedDirectoryState>
}

export type FolderBrowserCloneProvider = (close?: boolean) => Promise<FolderBrowserCloneSnapshot | undefined>

export function FolderBrowserPane({
  client,
  disabled,
  sourcePath,
  onOpen,
  systemActions,
  switchToast,
  folderView = DEFAULT_FOLDER_VIEW,
  onFolderView,
  panelVisible,
  active,
  navigationActive = active,
  browserPath,
  tabBar,
  folderTabCount,
  maxFolderTabs,
  onCreateTab,
  onCurrentPathChange,
  onOpenInNewTab,
  folderNavigationEvents,
  initialClone,
  initialSearchSnapshot,
  onOpenSearchInNewTab,
  onCloneProvider,
}: ReaderPanelContext & {
  active: boolean
  /** Selected folder tab, even when the File Card panel itself is hidden. */
  navigationActive?: boolean
  browserPath: string
  tabBar?: ReactNode
  folderTabCount: number
  maxFolderTabs: number
  onCreateTab(): void
  currentFolderTabPinned: boolean
  canReopenFolderTab: boolean
  onDuplicateCurrentTab(): void
  onToggleCurrentTabPinned(): void
  onReopenFolderTab(): void
  onCurrentPathChange(path: string): void
  onOpenInNewTab(path: string): void
  onOpenSearchInNewTab?(snapshot: FolderSearchTabSnapshot): void
  initialClone?: FolderBrowserCloneSnapshot
  initialSearchSnapshot?: FolderSearchTabSnapshot
  onCloneProvider(provider?: FolderBrowserCloneProvider): void
}) {
  const thumbnailsVisible = active && (panelVisible ?? true)
  const clipboard = useFolderClipboard()
  const pendingInitialCloneRef = useRef(initialClone)
  const startupBrowserPathRef = useRef(resolveFolderStartupPath(browserPath, folderView.homePath))
  const sessionIdRef = useRef<string | undefined>(undefined)
  const catalogRef = useRef<DirectoryCatalog | undefined>(undefined)
  const navigationRequestRef = useRef<AbortController | undefined>(undefined)
  const penetrationActivationRef = useRef<
    | {
        path: string
        sessionId: string
        generation: number
        controller: AbortController
        timer: ReturnType<typeof setTimeout>
      }
    | undefined
  >(undefined)
  const penetrationDescriptionRequestRef = useRef<AbortController>()
  const penetrationDescriptionSignatureRef = useRef("")
  const retryOperationRef = useRef<FolderRetryOperation | undefined>(undefined)
  const catalogRequestRef = useRef<AbortController | undefined>(undefined)
  const thumbnailRequestRef = useRef<AbortController | undefined>(undefined)
  const pendingCursorsRef = useRef(new Set<string>())
  const pendingKeyboardCommandRef = useRef<{
    generation: number
    index: number
    kind: Extract<FolderKeyboardCommand["kind"], "activate" | "enter-raw" | "trash" | "rename" | "context-menu">
  }>()
  const navigationGenerationRef = useRef(0)
  const thumbnailGenerationRef = useRef(0)
  const thumbnailContextSequenceRef = useRef(0)
  const thumbnailContextRef = useRef<string | undefined>(undefined)
  const thumbnailSignatureRef = useRef("")
  const thumbnailRefreshSequenceRef = useRef(0)
  const thumbnailCompileKeysRef = useRef(new Set<string>())
  const clipboardCompletionRef = useRef<string>()
  const visibleRangeRef = useRef<ListRange>({ startIndex: 0, endIndex: 0 })
  const listRef = useRef<VirtuosoHandle>(null)
  const gridRef = useRef<VirtuosoGridHandle>(null)
  const mosaicRef = useRef<VirtuosoHandle>(null)
  const listHostRef = useRef<HTMLDivElement>(null)
  const gridSnapshotRef = useRef<GridStateSnapshot | undefined>(undefined)
  const gridScrollTopRef = useRef(0)
  const mosaicSnapshotRef = useRef<StateSnapshot | undefined>(undefined)
  const mosaicScrollTopRef = useRef(0)
  const detailsScrollTopRef = useRef(0)
  const focusedIndexRef = useRef<number | undefined>(undefined)
  const chainAnchorIndexRef = useRef<number | undefined>(undefined)
  const navigationStatesRef = useRef(new Map<number, SavedDirectoryState>())
  const [catalog, setCatalog] = useState<DirectoryCatalog>()
  const [searchOpen, setSearchOpen] = useState(Boolean(initialSearchSnapshot))
  const pendingSearchSnapshotRef = useRef(initialSearchSnapshot)
  const searchOriginRef = useRef<{
    catalog: DirectoryCatalog
    state: SavedDirectoryState
    rootPath: string
  }>()
  const searchCriteriaRef = useRef<FolderSearchTabSnapshot["criteria"]>()
  const [treeOpen, setTreeOpen] = useState(folderView.tree.visible)
  const [inlineTreeOpen, setInlineTreeOpen] = useState(false)
  const [treeLayout, setTreeLayout] = useState(folderView.tree.layout)
  const [treeSize, setTreeSize] = useState(folderView.tree.size)
  const [viewMode, setViewMode] = useState<FolderViewMode>(folderView.viewMode)
  const [previewGridEnabled, setPreviewGridEnabled] = useState(folderView.previewGridEnabled ?? false)
  const [previewCount, setPreviewCount] = useState<FolderPreviewCount>(folderView.previewCount)
  const [contentWidthPercent, setContentWidthPercent] = useState(folderView.contentWidthPercent ?? 35)
  const [thumbnailWidthPercent, setThumbnailWidthPercent] = useState(folderView.thumbnailWidthPercent)
  const [bannerWidthPercent, setBannerWidthPercent] = useState(folderView.bannerWidthPercent)
  const [hoverPreviewEnabled, setHoverPreviewEnabled] = useState(folderView.hoverPreviewEnabled ?? true)
  const [hoverPreviewDelayMs, setHoverPreviewDelayMs] = useState(folderView.hoverPreviewDelayMs ?? 500)
  const [penetration, setPenetration] = useState<ReaderFolderPenetrationConfig>(folderView.penetration)
  const [penetrationDescriptions, setPenetrationDescriptions] = useState<ReadonlyMap<string, readonly FolderPenetrationFileName[]>>(() => new Map())
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [deleteMode, setDeleteMode] = useState(false)
  const [deleteStrategy, setDeleteStrategy] = useState<FolderDeleteStrategy>("trash")
  const [confirmDelete, setConfirmDelete] = useState(folderView.confirmDelete ?? true)
  const [chainSelectMode, setChainSelectMode] = useState(false)
  const [checkModeClickBehavior, setCheckModeClickBehavior] = useState<"open" | "select">("open")
  const [restoreState, setRestoreState] = useState<SavedDirectoryState>()
  const [selection, setSelection] = useState<DirectorySelectionModel>(() => createDirectorySelection(0))
  const [renameRequest, setRenameRequest] = useState<FolderContextEntry>()
  const [focusedPath, setFocusedPath] = useState<string>()
  const [focusedIndex, setFocusedIndex] = useState<number>()
  const [thumbnailUrls, setThumbnailUrls] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [thumbnailUrlSets, setThumbnailUrlSets] = useState<ReadonlyMap<string, readonly string[]>>(() => new Map())
  const thumbnailUrlsRef = useRef<ReadonlyMap<string, string>>(thumbnailUrls)
  const thumbnailUrlSetsRef = useRef<ReadonlyMap<string, readonly string[]>>(thumbnailUrlSets)
  const thumbnailProfilesRef = useRef<ReadonlyMap<string, string>>(new Map())
  const [loading, setLoading] = useState(false)
  const [thumbnailRefreshPending, setThumbnailRefreshPending] = useState(false)
  const [error, setError] = useState<string>()
  const selectedPaths = useMemo(() => (catalog ? selectedLoadedDirectoryPaths(selection, catalog.pages) : EMPTY_SELECTED_PATHS), [catalog, selection])
  const itemIdPrefix = catalog?.sessionId
  const focusedItemId =
    catalog && focusedIndex !== undefined && viewMode !== "details" && directoryEntryAt(catalog, focusedIndex)
      ? `${itemIdPrefix}-item-${focusedIndex}`
      : undefined
  const emptyAreaHandlers = useFolderEmptyAreaNavigation(folderView.emptyArea, (action) => {
    runFolderNavigation(action, catalogRef.current, (command) => {
      void navigate(command)
    })
  })

  useEffect(() => {
    const snapshot = pendingInitialCloneRef.current
    pendingInitialCloneRef.current = undefined
    if (snapshot?.clonedPage) {
      restoreClonedBrowser(snapshot)
      return
    }
    if (catalogRef.current) {
      // Reader source identity may point through several nested directories. It can focus a
      // direct entry, but only the explicit browser path is allowed to navigate this Card.
      if (sourcePath && sameFolderOrChild(catalogRef.current.path, sourcePath)) {
        focusSourceEntry(sourcePath)
      }
      return
    }
    if (startupBrowserPathRef.current) void openBrowser(startupBrowserPathRef.current)
  }, [sourcePath])

  useEffect(() => {
    // Listen on the selected tab even when the File Card panel is hidden so
    // History/Bookmark can reuse this browser session for browse + penetration.
    if (!folderNavigationEvents || !navigationActive) return
    const browse = (event: Event) => {
      if (!(event instanceof CustomEvent)) return
      const detail = event.detail as { path?: unknown; newTab?: unknown } | undefined
      if (typeof detail?.path !== "string" || !detail.path.trim()) return
      if (detail.newTab === true) onOpenInNewTab(detail.path)
      else void openBrowser(detail.path)
    }
    const activateFromLibrary = (event: Event) => {
      if (!(event instanceof CustomEvent)) return
      const detail = event.detail as { path?: unknown; handled?: boolean } | undefined
      if (typeof detail?.path !== "string" || !detail.path.trim()) return
      if (detail && typeof detail === "object") detail.handled = true
      void activateLibraryFolder(detail.path)
    }
    folderNavigationEvents.addEventListener("browse", browse)
    folderNavigationEvents.addEventListener("activate", activateFromLibrary)
    return () => {
      folderNavigationEvents.removeEventListener("browse", browse)
      folderNavigationEvents.removeEventListener("activate", activateFromLibrary)
    }
  }, [folderNavigationEvents, navigationActive, onOpenInNewTab])

  useEffect(() => disposeBrowser, [])

  useEffect(() => {
    onCloneProvider(captureCloneSnapshot)
    return () => onCloneProvider(undefined)
  }, [onCloneProvider])

  useEffect(() => setViewMode(folderView.viewMode), [folderView.viewMode])
  useEffect(() => setPreviewGridEnabled(folderView.previewGridEnabled ?? false), [folderView.previewGridEnabled])
  useEffect(() => setPreviewCount(folderView.previewCount), [folderView.previewCount])
  useEffect(() => setContentWidthPercent(folderView.contentWidthPercent ?? 35), [folderView.contentWidthPercent])
  useEffect(() => setThumbnailWidthPercent(folderView.thumbnailWidthPercent), [folderView.thumbnailWidthPercent])
  useEffect(() => setBannerWidthPercent(folderView.bannerWidthPercent), [folderView.bannerWidthPercent])
  useEffect(() => setHoverPreviewEnabled(folderView.hoverPreviewEnabled ?? true), [folderView.hoverPreviewEnabled])
  useEffect(() => setHoverPreviewDelayMs(folderView.hoverPreviewDelayMs ?? 500), [folderView.hoverPreviewDelayMs])
  useEffect(() => setConfirmDelete(folderView.confirmDelete ?? true), [folderView.confirmDelete])
  // Parent cards rebuild `folderView.penetration` every render; only write when values change.
  const penetrationSyncKey = [
    folderView.penetration.enabled,
    folderView.penetration.showInternalFiles,
    folderView.penetration.internalItemsMode ?? "",
    folderView.penetration.maxDepth,
    folderView.penetration.terminalTargets.join(","),
  ].join(":")
  useEffect(() => {
    setPenetration((current) => {
      const next = folderView.penetration
      if (
        current.enabled === next.enabled
        && current.showInternalFiles === next.showInternalFiles
        && (current.internalItemsMode ?? "") === (next.internalItemsMode ?? "")
        && current.maxDepth === next.maxDepth
        && current.terminalTargets.join(",") === next.terminalTargets.join(",")
      ) return current
      return next
    })
    // folderView.penetration is intentionally omitted — identity churn; use the value key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [penetrationSyncKey])
  useEffect(() => requestPenetrationDescriptions(visibleRangeRef.current), [penetration.enabled, penetration.showInternalFiles, viewMode, catalog?.sessionId, catalog?.generation])
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
    if (!thumbnailsVisible || !catalog || !viewUsesThumbnails(viewMode)) return
    registerVisibleThumbnails()
  }, [thumbnailsVisible, catalog?.sessionId, catalog?.generation, viewMode, previewGridEnabled, previewCount])

  useEffect(() => {
    if (thumbnailsVisible) return
    releaseThumbnailContext()
  }, [thumbnailsVisible])

  useEffect(() => {
    if (!thumbnailsVisible || !catalog || !viewUsesThumbnails(viewMode) || !client.listDirectoryBrowser || !client.prewarmLibraryThumbnails) return
    // Virtual search is not a real browser listing — background compile via
    // listDirectoryBrowser would re-read the origin folder, not the search hits.
    // Viewport thumbnails still come from registerVisibleThumbnails via requestRange.
    if (isVirtualSearchPath(catalog.path)) return
    const compilePreviewCount = previewGridEnabled ? previewCount : 1
    const compileKey = `${catalog.sessionId}:${catalog.generation}:${compilePreviewCount}`
    if (thumbnailCompileKeysRef.current.has(compileKey)) return
    const controller = new AbortController()
    let completed = false
    const timer = setTimeout(() => {
      thumbnailCompileKeysRef.current.add(compileKey)
      while (thumbnailCompileKeysRef.current.size > 50) {
        thumbnailCompileKeysRef.current.delete(thumbnailCompileKeysRef.current.keys().next().value as string)
      }
      void import("./compileFolderThumbnails")
        .then(({ compileFolderThumbnails }) =>
          compileFolderThumbnails(client, catalog.sessionId, catalog.total, { previewCount: compilePreviewCount }, controller.signal),
        )
        .then(() => {
          completed = true
        })
        .catch(() => {
          thumbnailCompileKeysRef.current.delete(compileKey)
        })
    }, 1_000)
    return () => {
      clearTimeout(timer)
      controller.abort(new DOMException("Folder thumbnail compilation superseded.", "AbortError"))
      if (!completed) thumbnailCompileKeysRef.current.delete(compileKey)
    }
  }, [thumbnailsVisible, catalog?.sessionId, catalog?.generation, catalog?.total, viewMode, previewGridEnabled, previewCount])

  useEffect(() => {
    if (!catalog || viewMode !== "details") return
    queueMicrotask(() => requestRange(visibleRangeRef.current))
  }, [catalog?.sessionId, catalog?.generation, viewMode])

  async function registerVisibleThumbnails(refresh = false, targetPaths?: ReadonlySet<string>): Promise<void> {
    const current = catalogRef.current
    if (!thumbnailsVisible || !current || !viewUsesThumbnails(viewMode) || !client.registerLibraryThumbnails) return
    const range = visibleRangeRef.current
    const candidates = targetPaths
      ? [...current.pages].flatMap(([cursor, entries]) => entries.map((entry, offset) => ({ index: cursor + offset, entry })))
      : directoryLoadedEntries(current, range.startIndex, range.endIndex, MAX_THUMBNAILS)
    const visible = candidates
      .filter(({ entry }) => entry.kind === "directory" || (entry.kind === "file" && entry.readerSupported))
      .filter(({ entry }) => !targetPaths || targetPaths.has(entry.path))
      .filter(
        ({ entry }) =>
          refresh ||
          isThumbnailDemandNeeded(
            entry,
            viewMode,
            previewCount,
            thumbnailProfilesRef.current,
            thumbnailUrlsRef.current,
            previewGridEnabled,
            thumbnailUrlSetsRef.current,
          ),
      )
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
    await client
      .registerLibraryThumbnails(
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
      )
      .then((batch) => {
        if (request.signal.aborted || generation !== thumbnailGenerationRef.current) return
        const resolved = batch.items.flatMap((item) => {
          const path = pathById.get(item.id)
          return path ? [[path, item.thumbnailUrl] as const] : []
        })
        const resolvedSets = batch.items.flatMap((item) => {
          const path = pathById.get(item.id)
          if (!path) return []
          const urls = item.thumbnailUrls?.length ? item.thumbnailUrls : [item.thumbnailUrl]
          return [[path, urls] as const]
        })
        setThumbnailUrlSets((currentSets) => {
          const next = mergeThumbnailUrlSets(currentSets, resolvedSets, MAX_CACHED_THUMBNAIL_URLS)
          thumbnailUrlSetsRef.current = next
          return next
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
      })
      .catch(() => {
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

  const restoreIndex =
    catalog && restoreState ? Math.min(Math.max(restoreState.focusedIndex ?? restoreState.anchorIndex, 0), Math.max(0, catalog.total - 1)) : undefined
  const shouldLocateRestore = (restoreState?.focusedIndex ?? restoreState?.anchorIndex ?? 0) > 0

  useEffect(() => {
    if (restoreIndex === undefined) return
    requestRange({ startIndex: restoreIndex, endIndex: restoreIndex })
    if (restoreState?.viewMode !== viewMode) return
    if (viewUsesVirtuosoList(viewMode) && !restoreState.listSnapshot) {
      listRef.current?.scrollToIndex({ index: restoreIndex, align: "center" })
    } else if (viewUsesFixedGrid(viewMode) && !restoreState.gridSnapshot) {
      gridRef.current?.scrollToIndex({ index: restoreIndex, align: "center" })
    } else if (viewUsesMosaicGrid(viewMode) && !restoreState.mosaicSnapshot) {
      mosaicRef.current?.scrollToIndex({
        index: Math.floor(restoreIndex / FOLDER_MOSAIC_GROUP_SIZE),
        align: "center",
      })
    }
  }, [catalog?.sessionId, catalog?.generation, restoreIndex, restoreState, viewMode])

  async function openBrowser(path: string) {
    const normalized = normalizeFolderNavigationPath(path)
    if (!normalized || !client.openDirectoryBrowser) return
    clearSearchSession()
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
      const showHiddenFolders = folderView.showHiddenFolders ?? false
      if ((preferredFilter !== opened.filter || showHiddenFolders) && client.filterDirectoryBrowser) {
        await updateCatalogProjection(
          (sessionId, focusPath, signal) => client.filterDirectoryBrowser!(sessionId, preferredFilter, focusPath, signal, showHiddenFolders),
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
    let normalizedNavigation: ReaderDirectoryNavigationDto =
      navigation.action === "path"
        ? {
            ...navigation,
            path: normalizeFolderNavigationPath(navigation.path),
          }
        : navigation
    const sessionId = sessionIdRef.current
    if (!sessionId) {
      if (normalizedNavigation.action === "path") await openBrowser(normalizedNavigation.path)
      return
    }
    if (!client.navigateDirectoryBrowser) return
    if (isVirtualSearchPath(catalogRef.current?.path)) {
      if (normalizedNavigation.action === "back") {
        clearSearchSession({ restoreOrigin: true })
        return
      }
      if (normalizedNavigation.action === "up") {
        const parent = catalogRef.current?.parentPath
        clearSearchSession()
        setSearchOpen(false)
        if (!parent) return
        normalizedNavigation = { action: "path", path: normalizeFolderNavigationPath(parent) }
      } else if (normalizedNavigation.action === "refresh") {
        return
      } else {
        clearSearchSession()
        setSearchOpen(false)
      }
    }
    if (!options.keepTree) setTreeOpen(false)
    // Only refresh needs an exact snapshot before applying the replacement generation.
    // Path/back/forward/up navigation can persist the lightweight state synchronously and
    // let Virtuoso append its snapshot to the visit cache without delaying the request.
    const capturedState = normalizedNavigation.action === "refresh" ? await captureRefreshState() : captureCurrentState()
    const generation = beginNavigation()
    setLoading(true)
    setError(undefined)
    retryOperationRef.current = {
      kind: "navigate",
      navigation: normalizedNavigation,
      options,
    }
    try {
      const result = await client.navigateDirectoryBrowser(
        sessionId,
        normalizedNavigation,
        navigationRequestRef.current?.signal,
        options.focusPath ?? capturedState?.focusedPath,
      )
      if (generation === navigationGenerationRef.current) {
        let preferredState = normalizedNavigation.action === "refresh" ? capturedState : undefined
        if (preferredState && options.clearSelection) {
          preferredState = {
            ...preferredState,
            selection: createDirectorySelection(result.generation),
          }
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
            mosaicSnapshot: undefined,
            detailsScrollTop: undefined,
          }
        }
        applyPage(result, preferredState, false, {
          preserveThumbnailCache: options.preserveThumbnailCache ?? true,
        })
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
    const sameNavigationEntry = isSameFolderNavigationEntry(catalogRef.current, page)
    catalogRequestRef.current?.abort()
    catalogRequestRef.current = new AbortController()
    pendingCursorsRef.current.clear()
    if (options.preserveThumbnailCache) {
      // Keep the outgoing visible batch alive while the next directory is resolving.
      // Its ref-backed URLs remain useful for back/forward; the first new visible batch
      // will replace it through registerVisibleThumbnails' normal abort path.
      thumbnailSignatureRef.current = ""
    } else {
      resetThumbnailRegistration()
    }
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
    visibleRangeRef.current = sameNavigationEntry
      ? {
          startIndex: page.cursor,
          endIndex: Math.max(page.cursor, Math.min(page.total - 1, page.cursor + page.entries.length - 1)),
        }
      : { startIndex: 0, endIndex: 0 }
    const suggested = page.suggestedSelection
    let restored = restoreDirectoryVisitState(page, preferredState, navigationStatesRef.current, {
      total: page.total,
      viewMode,
      previewCount,
      multiSelectMode: false,
      selection: suggested ? selectDirectorySingle(page.generation, suggested.path, suggested.index) : createDirectorySelection(page.generation),
      focusedPath: suggested?.path,
      focusedIndex: suggested?.index,
      anchorIndex: suggested?.index ?? 0,
    })
    if (restored.total !== undefined && restored.total !== page.total) {
      restored = {
        ...restored,
        total: page.total,
        listSnapshot: undefined,
        gridSnapshot: undefined,
        mosaicSnapshot: undefined,
      }
    }
    gridSnapshotRef.current = restored.gridSnapshot
    gridScrollTopRef.current = restored.gridScrollTop ?? 0
    mosaicSnapshotRef.current = restored.mosaicSnapshot
    mosaicScrollTopRef.current = restored.mosaicScrollTop ?? 0
    detailsScrollTopRef.current = restored.detailsScrollTop ?? 0
    focusedIndexRef.current = restored.focusedIndex
    setFocusedIndex(restored.focusedIndex)
    setViewMode(restored.viewMode)
    setPreviewCount(restored.previewCount)
    setMultiSelectMode(restored.multiSelectMode)
    const restoredThumbnailUrls = options.preserveThumbnailCache
      ? mergeThumbnailUrls(thumbnailUrlsRef.current, restored.thumbnailUrls ? [...restored.thumbnailUrls] : [], MAX_CACHED_THUMBNAIL_URLS)
      : (restored.thumbnailUrls ?? new Map())
    const restoredThumbnailUrlSets = options.preserveThumbnailCache
      ? mergeThumbnailUrlSets(thumbnailUrlSetsRef.current, restored.thumbnailUrlSets ? [...restored.thumbnailUrlSets] : [], MAX_CACHED_THUMBNAIL_URLS)
      : (restored.thumbnailUrlSets ?? new Map())
    const restoredThumbnailProfiles = options.preserveThumbnailCache
      ? new Map(
          [...restoredThumbnailUrls.keys()].flatMap((path) => {
            const profile = restored.thumbnailProfiles?.get(path) ?? thumbnailProfilesRef.current.get(path)
            return profile ? [[path, profile] as const] : []
          }),
        )
      : (restored.thumbnailProfiles ?? new Map())
    thumbnailUrlsRef.current = restoredThumbnailUrls
    thumbnailUrlSetsRef.current = restoredThumbnailUrlSets
    thumbnailProfilesRef.current = restoredThumbnailProfiles
    setRestoreState({
      ...restored,
      thumbnailUrls: restoredThumbnailUrls,
      thumbnailUrlSets: restoredThumbnailUrlSets,
      thumbnailProfiles: restoredThumbnailProfiles,
    })
    setThumbnailUrls(restoredThumbnailUrls)
    setThumbnailUrlSets(restoredThumbnailUrlSets)
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
      applyPage(
        result,
        {
          total: result.total,
          viewMode,
          previewCount,
          multiSelectMode,
          selection: resetSelection ? createDirectorySelection(result.generation) : rebaseDirectorySelection(selection, result.generation),
          focusedPath: resetSelection ? suggested?.path : focusedPath,
          focusedIndex: suggested?.index,
          anchorIndex: suggested?.index ?? 0,
          thumbnailUrls,
          thumbnailUrlSets: thumbnailUrlSetsRef.current,
          thumbnailProfiles: thumbnailProfilesRef.current,
        },
        false,
        { preserveThumbnailCache: true },
      )
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
    await updateCatalogProjection(
      (sessionId, focusPath, signal) =>
        applyFilter(sessionId, filter, focusPath, signal, catalogRef.current?.showHiddenFolders ?? folderView.showHiddenFolders ?? false),
      true,
    )
    if ((folderView.typeFilter ?? "library") !== filter) void onFolderView?.({ typeFilter: filter })
  }

  async function updateHiddenFolders(showHiddenFolders: boolean) {
    const applyFilter = client.filterDirectoryBrowser
    const current = catalogRef.current
    if (!applyFilter || !current || showHiddenFolders === current.showHiddenFolders) return
    await updateCatalogProjection((sessionId, focusPath, signal) => applyFilter(sessionId, current.filter, focusPath, signal, showHiddenFolders), true)
    if (showHiddenFolders !== (folderView.showHiddenFolders ?? false)) void onFolderView?.({ showHiddenFolders })
  }

  async function updateSortPreference(command: ReaderDirectorySortPreferenceCommandDto) {
    const applyPreference = client.updateDirectorySortPreference
    if (!applyPreference) return
    await updateCatalogProjection((sessionId, focusPath, signal) => applyPreference(sessionId, command, focusPath, signal))
  }

  function requestRange(range: ListRange) {
    visibleRangeRef.current = range
    const current = catalogRef.current
    requestPenetrationDescriptions(range, current)
    if (!current) return
    // Virtual search already holds every hit in-memory — skip listDirectoryBrowser
    // paging, but still run the shared visible-thumbnail pipeline so scroll works.
    if (!isVirtualSearchPath(current.path) && client.listDirectoryBrowser) {
      const metadataFields =
        viewMode === "details"
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
            requestPenetrationDescriptions(visibleRangeRef.current, merged)
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
    }
    queueMicrotask(registerVisibleThumbnails)
  }

  function requestPenetrationDescriptions(range: ListRange, source = catalogRef.current) {
    if (!folderViewShowsPenetrationFiles(viewMode, penetration.enabled, penetration.showInternalFiles) || !client.describeFolderPenetration || !source) {
      penetrationDescriptionRequestRef.current?.abort()
      penetrationDescriptionSignatureRef.current = ""
      setPenetrationDescriptions((current) => current.size ? new Map() : current)
      return
    }
    const paths: string[] = []
    const end = Math.min(source.total - 1, range.endIndex)
    for (let index = Math.max(0, range.startIndex); index <= end && paths.length < 64; index += 1) {
      const entry = directoryEntryAt(source, index)
      if (entry?.kind === "directory") paths.push(entry.path)
    }
    const signature = `${source.sessionId}:${source.generation}:${paths.join("\u0000")}`
    if (signature === penetrationDescriptionSignatureRef.current) return
    penetrationDescriptionSignatureRef.current = signature
    penetrationDescriptionRequestRef.current?.abort()
    if (!paths.length) {
      setPenetrationDescriptions(new Map())
      return
    }
    const controller = new AbortController()
    penetrationDescriptionRequestRef.current = controller
    void client.describeFolderPenetration(source.sessionId, paths, controller.signal).then(({ entries }) => {
      if (controller.signal.aborted || penetrationDescriptionSignatureRef.current !== signature) return
      setPenetrationDescriptions(new Map(entries.map((entry) => [entry.path, entry.internalFiles])))
    }).catch((cause) => {
      if (!controller.signal.aborted) setError(`读取内部文件失败：${folderErrorMessage(cause)}`)
    })
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
      gridSnapshot: viewUsesFixedGrid(viewMode) ? gridSnapshotRef.current : undefined,
      gridScrollTop: viewUsesFixedGrid(viewMode) ? gridScrollTopRef.current : undefined,
      mosaicSnapshot: viewUsesMosaicGrid(viewMode) ? mosaicSnapshotRef.current : undefined,
      mosaicScrollTop: viewUsesMosaicGrid(viewMode) ? mosaicScrollTopRef.current : undefined,
      detailsScrollTop: viewMode === "details" ? detailsScrollTopRef.current : undefined,
      // The ref is updated in the thumbnail response handler before React
      // necessarily commits the corresponding state update. Navigation and
      // tab snapshots must capture that latest cache to avoid a needless
      // re-registration when the user immediately goes back.
      thumbnailUrls: viewUsesThumbnails(viewMode) ? thumbnailUrlsRef.current : undefined,
      thumbnailUrlSets: viewUsesThumbnails(viewMode) ? thumbnailUrlSetsRef.current : undefined,
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
    } else if (viewUsesMosaicGrid(viewMode)) {
      mosaicRef.current?.getState((snapshot) => {
        mosaicSnapshotRef.current = snapshot
        const latest = navigationStatesRef.current.get(current.navigationEntryId)
        if (latest) rememberDirectoryVisitState(navigationStatesRef.current, current.navigationEntryId, { ...latest, mosaicSnapshot: snapshot })
      })
    }
    return state
  }

  async function captureRefreshState(): Promise<SavedDirectoryState | undefined> {
    const saved = currentSavedState()
    if (!saved) return undefined
    const { current, state } = saved
    rememberDirectoryVisitState(navigationStatesRef.current, current.navigationEntryId, state)
    const list = viewUsesVirtuosoList(state.viewMode) ? listRef.current : viewUsesMosaicGrid(state.viewMode) ? mosaicRef.current : null
    if (!list) return state
    return new Promise((resolve) => {
      list.getState((snapshot) => {
        if (viewUsesMosaicGrid(state.viewMode)) mosaicSnapshotRef.current = snapshot
        const next = viewUsesMosaicGrid(state.viewMode) ? { ...state, mosaicSnapshot: snapshot } : { ...state, listSnapshot: snapshot }
        rememberDirectoryVisitState(navigationStatesRef.current, current.navigationEntryId, next)
        resolve(next)
      })
    })
  }

  async function captureCloneSnapshot(close = false): Promise<FolderBrowserCloneSnapshot | undefined> {
    const current = catalogRef.current
    const currentState = await captureRefreshState()
    if (!current || !currentState || sessionIdRef.current !== current.sessionId) return undefined
    const snapshot = {
      sourceSessionId: current.sessionId,
      currentState,
      navigationStates: new Map(navigationStatesRef.current),
    }
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
    applyPage(page, preferredState, false, { preserveThumbnailCache: true })
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
      thumbnailUrlSets: thumbnailUrlSetsRef.current,
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
    const emptyThumbnailUrlSets = new Map<string, readonly string[]>()
    thumbnailUrlsRef.current = emptyThumbnailUrls
    thumbnailUrlSetsRef.current = emptyThumbnailUrlSets
    thumbnailProfilesRef.current = new Map()
    setThumbnailUrls(emptyThumbnailUrls)
    setThumbnailUrlSets(emptyThumbnailUrlSets)
    setPreviewCount(next)
    thumbnailSignatureRef.current = ""
    void onFolderView?.({ previewCount: next })
  }

  function togglePreviewGrid(enabled: boolean) {
    if (enabled === previewGridEnabled) return
    captureCurrentState()
    resetThumbnailRegistration()
    // Multi-preview only changes folder mosaic assets. Keep file single-cover
    // visit cache so enabling the grid does not thrash the shared thumbnail lane.
    const nextUrls = new Map<string, string>()
    const nextUrlSets = new Map<string, readonly string[]>()
    const nextProfiles = new Map<string, string>()
    for (const [path, profile] of thumbnailProfilesRef.current) {
      if (!profile.startsWith("folder:")) {
        const url = thumbnailUrlsRef.current.get(path)
        const urls = thumbnailUrlSetsRef.current.get(path)
        if (url) nextUrls.set(path, url)
        if (urls) nextUrlSets.set(path, urls)
        nextProfiles.set(path, profile)
      }
    }
    thumbnailUrlsRef.current = nextUrls
    thumbnailUrlSetsRef.current = nextUrlSets
    thumbnailProfilesRef.current = nextProfiles
    setThumbnailUrls(nextUrls)
    setThumbnailUrlSets(nextUrlSets)
    setPreviewGridEnabled(enabled)
    thumbnailSignatureRef.current = ""
    void onFolderView?.({ previewGridEnabled: enabled })
  }

  function commitThumbnailWidth(value: number) {
    if (value !== folderView.thumbnailWidthPercent) void onFolderView?.({ thumbnailWidthPercent: value })
  }

  function commitContentWidth(value: number) {
    if (value !== (folderView.contentWidthPercent ?? 35)) void onFolderView?.({ contentWidthPercent: value })
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
        } else if (viewUsesMosaicGrid(viewMode)) {
          mosaicRef.current?.getState((mosaicSnapshot) => {
            mosaicSnapshotRef.current = mosaicSnapshot
            setRestoreState({ ...state, mosaicSnapshot })
          })
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
      setSelection((current) =>
        chainDirectorySelection(current, generation, index, {
          anchorIndex: chainAnchorIndex,
          anchorPath: chainAnchorIndex === previousFocusIndex ? focusedPath : undefined,
          endPath: entry.path,
        }),
      )
      chainAnchorIndexRef.current = index
    } else if (event.shiftKey) {
      setSelection((current) =>
        extendDirectorySelection(current, generation, index, {
          additive: event.ctrlKey || event.metaKey,
          fallbackAnchor: previousFocusIndex ?? 0,
          anchorPath: focusedPath,
          endPath: entry.path,
        }),
      )
    } else if (readerEntryClickIntent(event, multiSelectMode && checkModeClickBehavior === "select") === "select") {
      setSelection((current) => toggleDirectorySelection(current, generation, entry.path, index))
    } else if (entry.kind === "directory" && penetration.enabled && event.detail >= 2) {
      activate(entry, true)
    } else {
      activate(entry)
    }
  }

  async function updatePenetration(patch: Partial<ReaderFolderPenetrationConfig>): Promise<void> {
    const previous = penetration
    const next = { ...previous, ...patch }
    if (!next.terminalTargets.length) return
    setPenetration(next)
    try {
      await onFolderView?.({ penetration: patch })
    } catch (cause) {
      setPenetration(previous)
      setError(`保存穿透设置失败：${folderErrorMessage(cause)}`)
    }
  }

  function scrollToDirectoryIndex(index: number) {
    if (viewUsesVirtuosoList(viewMode)) {
      listRef.current?.scrollToIndex({ index, align: "center" })
    } else if (viewUsesFixedGrid(viewMode)) {
      gridRef.current?.scrollToIndex({ index, align: "center" })
    } else if (viewUsesMosaicGrid(viewMode)) {
      mosaicRef.current?.scrollToIndex({
        index: Math.floor(index / FOLDER_MOSAIC_GROUP_SIZE),
        align: "center",
      })
    }
  }

  function handleDirectoryKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    // Search chrome uses its own input; list shortcuts stay active so views remain usable.
    if (isEditableKeyboardEvent(event)) return
    const currentCatalog = catalogRef.current
    if (!currentCatalog || disabled || loading) return
    const currentIndex = Math.min(Math.max(focusedIndexRef.current ?? visibleRangeRef.current.startIndex, 0), Math.max(0, currentCatalog.total - 1))
    const gridColumns = viewUsesGrid(viewMode) ? visibleGridColumnCount(listHostRef.current) : 1
    const pageStep = visiblePageStep(viewMode, gridColumns)
    const command = resolveFolderKeyboardCommand(
      {
        key: event.key,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
      },
      {
        currentIndex,
        total: currentCatalog.total,
        isGrid: viewUsesGrid(viewMode),
        gridColumns,
        pageStep,
        canGoBack: currentCatalog.canGoBack,
        hasParent: Boolean(currentCatalog.parentPath),
        multiSelectMode,
      },
    )
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
    if (
      command.kind === "activate" ||
      command.kind === "enter-raw" ||
      command.kind === "trash" ||
      command.kind === "rename" ||
      command.kind === "context-menu"
    ) {
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
      setSelection((current) =>
        extendDirectorySelection(current, currentCatalog.generation, nextIndex, {
          additive: event.ctrlKey || event.metaKey,
          fallbackAnchor: currentIndex,
          anchorPath: focusedPath,
          endPath: entry?.path,
        }),
      )
    } else if (!event.ctrlKey && !event.metaKey) {
      setSelection(
        entry
          ? selectDirectorySingle(currentCatalog.generation, entry.path, nextIndex)
          : extendDirectorySelection(createDirectorySelection(currentCatalog.generation), currentCatalog.generation, nextIndex, {
              additive: false,
              fallbackAnchor: nextIndex,
            }),
      )
    }
    requestRange({ startIndex: nextIndex, endIndex: nextIndex })
    scrollToDirectoryIndex(nextIndex)
  }

  function runFocusedKeyboardEntry(
    kind: Extract<FolderKeyboardCommand["kind"], "activate" | "enter-raw" | "trash" | "rename" | "context-menu">,
    currentCatalog: DirectoryCatalog,
    index: number,
  ) {
    const entry = directoryEntryAt(currentCatalog, index)
    if (!entry) {
      if (!client.listDirectoryBrowser) return
      pendingKeyboardCommandRef.current = {
        generation: currentCatalog.generation,
        index,
        kind,
      }
      requestRange({ startIndex: index, endIndex: index })
      scrollToDirectoryIndex(index)
      return
    }
    pendingKeyboardCommandRef.current = undefined
    if (kind === "activate") {
      activate(entry)
    } else if (kind === "enter-raw" && entry.kind === "directory") {
      activate(entry, true)
    } else if (kind === "rename") {
      if (client.executeFileOperations) setRenameRequest({ index, ...entry })
    } else if (kind === "trash") {
      if (!client.executeFileOperations) return
      listHostRef.current?.dispatchEvent(
        new CustomEvent("neoview-folder-trash-request", {
          bubbles: true,
          detail: { index, ...entry },
        }),
      )
    } else {
      dispatchFocusedFolderContextMenu(index, entry)
    }
  }

  function dispatchFocusedFolderContextMenu(index: number, entry: ReaderDirectoryEntryDto) {
    const host = listHostRef.current
    if (!host) return
    const mounted = host.querySelector<HTMLElement>(`[data-folder-index="${index}"]`)
    if (mounted) {
      mounted.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 0,
          clientY: 0,
        }),
      )
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
    proxy.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 0,
        clientY: 0,
      }),
    )
    proxy.remove()
  }

  function cancelPenetrationActivation(): void {
    const pending = penetrationActivationRef.current
    if (!pending) return
    penetrationActivationRef.current = undefined
    clearTimeout(pending.timer)
    pending.controller.abort()
  }

  function openReaderEntry(entry: Pick<ReaderDirectoryEntryDto, "path">, browserOriginEntryPath = entry.path, browserOriginSelfTerminal = false): void {
    const current = catalogRef.current
    void onOpen?.(
      entry.path,
      current
        ? {
            browserOriginPath: current.path,
            browserOriginEntryPath,
            ...(browserOriginSelfTerminal ? { browserOriginSelfTerminal: true } : {}),
          }
        : undefined,
    )
  }

  function enterRawDirectory(entry: Pick<ReaderDirectoryEntryDto, "path">): void {
    cancelPenetrationActivation()
    void navigate({ action: "path", path: entry.path }, { focusPath: entry.path })
  }

  /**
   * History/Bookmark folder open: ensure parent listing is loaded, then run the same
   * smart-penetration activation used by File Card clicks. Falls back to entering the
   * folder when resolve is unavailable or reports branch/empty/blocked.
   */
  async function activateLibraryFolder(path: string): Promise<void> {
    const target = path.trim()
    if (!target) return
    const parentPath = libraryItemFolderPath(target, false)
    if (parentPath && !sameFolderPath(parentPath, target)) {
      const current = catalogRef.current
      if (!current || !sameFolderPath(current.path, parentPath)) {
        await openBrowser(parentPath)
      }
    }
    const current = catalogRef.current
    if (!current) {
      // No browser session yet — open the target folder directly.
      await openBrowser(target)
      return
    }
    // Prefer a loaded entry so name/kind match File Card activation.
    let entry: Pick<ReaderDirectoryEntryDto, "kind" | "name" | "path" | "readerSupported"> | undefined
    for (const [, entries] of current.pages) {
      const found = entries.find((candidate) => sameFolderPath(candidate.path, target))
      if (found) {
        entry = found
        break
      }
    }
    activate(entry ?? {
      kind: "directory",
      name: folderEntryName(target),
      path: target,
      readerSupported: true,
    })
  }

  function activate(entry: Pick<ReaderDirectoryEntryDto, "kind" | "name" | "path" | "readerSupported">, rawDirectory = false) {
    if (entry.kind === "directory") {
      if (rawDirectory || !penetration.enabled || !client.resolveFolderPenetration) {
        enterRawDirectory(entry)
        return
      }
      const current = catalogRef.current
      if (!current) return
      cancelPenetrationActivation()
      const controller = new AbortController()
      const pending = {
        path: entry.path,
        sessionId: current.sessionId,
        generation: current.generation,
        controller,
        timer: setTimeout(() => undefined, PENETRATION_CLICK_DELAY_MS),
      }
      penetrationActivationRef.current = pending
      clearTimeout(pending.timer)
      const delay = new Promise<void>((resolve) => {
        pending.timer = setTimeout(resolve, PENETRATION_CLICK_DELAY_MS)
      })
      void Promise.all([
        client.resolveFolderPenetration(
          current.sessionId,
          entry.path,
          {
            maxDepth: penetration.maxDepth,
            terminalTargets: penetration.terminalTargets,
          },
          controller.signal,
        ),
        delay,
      ])
        .then(([resolution]) => {
          if (penetrationActivationRef.current !== pending) return
          penetrationActivationRef.current = undefined
          if (catalogRef.current?.sessionId !== pending.sessionId || catalogRef.current?.generation !== pending.generation) return
          if (resolution.status === "resolved" && resolution.terminal) {
            const mixedMedia = resolution.reason === "mixed-media-directory"
            if (mixedMedia) {
              switchToast?.show({
                title: `先阅读“${entry.name}”的当前层图片`,
                description: `当前层 ${resolution.directMediaCount ?? 0} 张图片；发现 ${resolution.deferredDirectoryCount ?? 0} 个子文件夹，可继续作为“下一本”。`,
              })
            }
            openReaderEntry({ path: resolution.terminal.path }, entry.path, mixedMedia)
            return
          }
          if (resolution.status === "blocked" && (resolution.reason === "permission" || resolution.reason === "cycle")) {
            setError(`无法穿透此文件夹：${resolution.reason === "permission" ? "没有读取权限" : "检测到目录循环"}`)
            return
          }
          enterRawDirectory(entry)
        })
        .catch((cause) => {
          if (controller.signal.aborted || penetrationActivationRef.current !== pending) return
          penetrationActivationRef.current = undefined
          setError(`穿透解析失败：${folderErrorMessage(cause)}`)
        })
      return
    }
    if (entry.readerSupported) openReaderEntry(entry)
    else void client.openSystemPath?.(entry.path)
  }

  function beginNavigation(): number {
    cancelPenetrationActivation()
    navigationRequestRef.current?.abort()
    catalogRequestRef.current?.abort()
    navigationRequestRef.current = new AbortController()
    pendingCursorsRef.current.clear()
    pendingKeyboardCommandRef.current = undefined
    navigationGenerationRef.current += 1
    return navigationGenerationRef.current
  }

  function commitCatalog(next: DirectoryCatalog) {
    setSelection((value) => (value.generation === next.generation ? value : rebaseDirectorySelection(value, next.generation)))
    catalogRef.current = next
    setCatalog(next)
    onCurrentPathChange(next.path)
  }

  function cloneDirectoryCatalog(source: DirectoryCatalog): DirectoryCatalog {
    return {
      ...source,
      pages: new Map([...source.pages].map(([cursor, entries]) => [cursor, [...entries]])),
      pageMetadataFields: new Map([...source.pageMetadataFields].map(([cursor, fields]) => [cursor, new Set(fields)])),
    }
  }

  function clearSearchSession(options: { restoreOrigin?: boolean } = {}) {
    const origin = searchOriginRef.current
    searchOriginRef.current = undefined
    searchCriteriaRef.current = undefined
    pendingSearchSnapshotRef.current = undefined
    if (options.restoreOrigin && origin) {
      catalogRef.current = origin.catalog
      setCatalog(origin.catalog)
      onCurrentPathChange(origin.catalog.path)
      setRestoreState(origin.state)
      setSelection(origin.state.selection)
      setFocusedIndex(origin.state.focusedIndex)
      setFocusedPath(origin.state.focusedPath)
      setViewMode(origin.state.viewMode)
      setPreviewCount(origin.state.previewCount)
      setMultiSelectMode(origin.state.multiSelectMode)
      focusedIndexRef.current = origin.state.focusedIndex
    }
  }

  function closeSearchChrome() {
    clearSearchSession({ restoreOrigin: true })
    setSearchOpen(false)
  }

  function applySearchListing(update: FolderSearchListingUpdate) {
    if (update.phase === "cleared" || update.phase === "idle") {
      clearSearchSession({ restoreOrigin: true })
      return
    }
    const sessionId = sessionIdRef.current
    if (!sessionId) return
    const current = catalogRef.current
    if (!searchOriginRef.current && current && !isVirtualSearchPath(current.path)) {
      const state = captureCurrentState() ?? {
        total: current.total,
        viewMode,
        previewCount,
        multiSelectMode,
        selection,
        focusedPath,
        focusedIndex,
        anchorIndex: focusedIndex ?? 0,
      }
      searchOriginRef.current = {
        catalog: cloneDirectoryCatalog(current),
        state,
        rootPath: current.path,
      }
    }
    const rootPath = searchOriginRef.current?.rootPath
      ?? (current && !isVirtualSearchPath(current.path) ? current.path : undefined)
      ?? browserPath
    const entries = update.result?.entries ?? update.streamedEntries
    searchCriteriaRef.current = update.criteria
    const page = createSearchDirectoryPage({
      sessionId,
      rootPath,
      result: {
        entries,
        generation: update.result?.generation
          ?? ((current && isVirtualSearchPath(current.path) ? current.generation : (current?.generation ?? 0)) + 1),
        query: update.criteria.query,
        mode: update.criteria.mode,
      },
      criteria: update.criteria,
      base: searchOriginRef.current?.catalog ?? (current && !isVirtualSearchPath(current.path) ? current : undefined),
    })
    applyPage(page, undefined, isVirtualSearchPath(catalogRef.current?.path))
    // Force the shared thumbnail pipeline for the virtual listing. If Virtuoso
    // has not reported a viewport yet, seed the first page of hits so cover
    // views do not sit on a single thumbnail until the user scrolls.
    queueMicrotask(() => {
      const latest = catalogRef.current
      const range = visibleRangeRef.current
      if (!latest || !isVirtualSearchPath(latest.path)) return
      if (range.endIndex <= range.startIndex && latest.total > 0) {
        requestRange({
          startIndex: 0,
          endIndex: Math.min(latest.total - 1, Math.max(0, MAX_THUMBNAILS - 1)),
        })
        return
      }
      requestRange(range)
    })
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
    cancelPenetrationActivation()
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
  const virtualKey = catalog ? `${catalog.sessionId}:${catalog.navigationEntryId}:${viewMode}:${previewCount}` : `${viewMode}:${previewCount}`
  const tabLayout = folderView.tabs ?? DEFAULT_FOLDER_VIEW.tabs!
  const searchListingActive = isVirtualSearchPath(catalog?.path)
  const showReturnFooter = folderView.emptyArea.showBackButton && !searchListingActive
  const returnFooterContext = {
    disabled: disabled || loading || !catalog || (!catalog.canGoBack && !catalog.parentPath),
    onReturn: () =>
      runFolderNavigation("return", catalogRef.current, (command) => {
        void navigate(command)
      }),
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
        onNavigate={(path) => {
          void navigate({ action: "path", path })
        }}
        onNavigateAction={(action) => {
          void navigate({ action })
        }}
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
      scrollToDirectoryIndex(index)
      return
    }
  }

  return (
    <FolderEntryDisplayProvider value={folderView.tagDisplay ?? DEFAULT_FOLDER_TAG_DISPLAY}>
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
        data-folder-delete-mode={deleteMode || null}
        data-folder-delete-strategy={deleteStrategy}
        data-folder-delete-confirm={confirmDelete}
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
              onPage={(page) => {
                void applyWatchedPage(page)
              }}
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
              treePinnedPaths={folderView.tree.pinnedPaths}
              onToggleTreePin={(path) => {
                const current = folderView.tree.pinnedPaths
                const key = path.replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase()
                const pinned = current.some((candidate) => candidate.replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase() === key)
                void onFolderView?.({
                  tree: {
                    pinnedPaths: pinned
                      ? current.filter((candidate) => candidate.replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase() !== key)
                      : [...current, path],
                  },
                })
              }}
              onActivate={activate}
              onEnterRawDirectory={enterRawDirectory}
              onOpenInNewTab={onOpenInNewTab}
              onOpenAsBook={onOpen}
              switchToast={switchToast}
              onRenamed={(destinationPath) =>
                navigate(
                  { action: "refresh" },
                  {
                    keepTree: true,
                    focusPath: destinationPath,
                    selectFocus: true,
                  },
                )
              }
              onTrashed={(entry) =>
                navigate(
                  { action: "refresh" },
                  {
                    keepTree: true,
                    focusPath: entry.path,
                    preserveThumbnailCache: true,
                  },
                )
              }
              onUndoDelete={() =>
                navigate(
                  { action: "refresh" },
                  {
                    keepTree: true,
                    focusPath: focusedPath,
                    preserveThumbnailCache: true,
                  },
                )
              }
              confirmDelete={confirmDelete}
              onCatalogUpdate={(update) => commitCatalog(update(catalog!))}
              onRefreshEmm={() => updateSort(catalog!.sort)}
              onRefreshDirectory={() =>
                navigate(
                  { action: "refresh" },
                  {
                    keepTree: true,
                    focusPath: focusedPath,
                    preserveThumbnailCache: true,
                  },
                )
              }
              onReloadThumbnail={(entry) => refreshThumbnails(new Set([entry.path]))}
              renameRequest={renameRequest}
              onRenameRequestHandled={() => setRenameRequest(undefined)}
            />
          </Suspense>
        ) : null}
        <Suspense fallback={<div className="min-h-0 min-w-0 flex-1" aria-label="正在加载文件浏览布局" />}>
          <FolderChromeLayout layout={tabLayout} tabBar={tabBar} breadcrumb={breadcrumbNode}>
            <div className="contents" data-folder-chrome-slot="toolbar" data-folder-toolbar-layout="wrapping">
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
                  contentWidthPercent={contentWidthPercent}
                  thumbnailWidthPercent={thumbnailWidthPercent}
                  bannerWidthPercent={bannerWidthPercent}
                  searchOpen={searchOpen}
                  canFilter={Boolean(client.filterDirectoryBrowser)}
                  typeFilter={catalog?.filter ?? folderView.typeFilter ?? "library"}
                  filterOptions={catalog?.filterOptions}
                  showHiddenFolders={catalog?.showHiddenFolders ?? folderView.showHiddenFolders ?? false}
                  tagDisplay={folderView.tagDisplay ?? DEFAULT_FOLDER_TAG_DISPLAY}
                  penetration={penetration}
                  treeOpen={treeOpen}
                  treeLayout={treeLayout}
                  canTree={Boolean(client.treeDirectoryBrowser)}
                  inlineTreeOpen={inlineTreeOpen}
                  multiSelectMode={multiSelectMode}
                  deleteMode={deleteMode}
                  deleteStrategy={deleteStrategy}
                  confirmDelete={confirmDelete}
                  sort={catalog?.sort}
                  sortFields={catalog?.sortFields}
                  sortSource={catalog?.sortSource}
                  sortTemporary={catalog?.sortTemporary}
                  canSort={Boolean(client.sortDirectoryBrowser)}
                  canSortPreference={Boolean(client.updateDirectorySortPreference)}
                  emptyArea={folderView.emptyArea}
                  thumbnailRefreshPending={thumbnailRefreshPending}
                  canRefreshThumbnails={Boolean(client.registerLibraryThumbnails)}
                  canRefreshSelectedThumbnails={Boolean(client.registerLibraryThumbnails && selectedPaths.size)}
                  sortLabels={SORT_LABELS}
                  sortSourceLabels={SORT_SOURCE_LABELS}
                  onNavigateBack={() => {
                    void navigate({ action: "back" })
                  }}
                  onNavigateForward={() => {
                    void navigate({ action: "forward" })
                  }}
                  onNavigateUp={() => {
                    void navigate({ action: "up" })
                  }}
                  onGoHome={() => {
                    if (folderView.homePath && catalog?.path !== folderView.homePath)
                      void navigate({
                        action: "path",
                        path: folderView.homePath,
                      })
                  }}
                  onSetHome={() => {
                    if (catalog && !loading && catalog.path !== folderView.homePath) void onFolderView?.({ homePath: catalog.path })
                  }}
                  onRefresh={() => {
                    void navigate({ action: "refresh" })
                  }}
                  onSwitchView={switchView}
                  onTogglePreviewGrid={togglePreviewGrid}
                  onSwitchPreviewCount={switchPreviewCount}
                  onCommitHoverPreviewEnabled={commitHoverPreviewEnabled}
                  onCommitHoverPreviewDelay={commitHoverPreviewDelay}
                  onContentWidthChange={(value) => setContentWidthPercent(value)}
                  onCommitContentWidth={commitContentWidth}
                  onThumbnailWidthChange={(value) => setThumbnailWidthPercent(value)}
                  onCommitThumbnailWidth={commitThumbnailWidth}
                  onBannerWidthChange={(value) => setBannerWidthPercent(value)}
                  onCommitBannerWidth={commitBannerWidth}
                  onToggleSearch={() => setSearchOpen((current) => !current)}
                  onChangeTypeFilter={(filter) => {
                    void updateFilter(filter)
                  }}
                  onChangeShowHiddenFolders={(showHiddenFolders) => {
                    void updateHiddenFolders(showHiddenFolders)
                  }}
                  onTagDisplayChange={(tagDisplay) => {
                    void onFolderView?.({ tagDisplay })
                  }}
                  onTogglePenetration={(enabled) => {
                    void updatePenetration({ enabled })
                  }}
                  onUpdatePenetration={(patch) => {
                    void updatePenetration(patch)
                  }}
                  onToggleTree={toggleTree}
                  onTreeLayoutChange={switchTreeLayout}
                  onToggleInlineTree={toggleInlineTree}
                  onToggleMultiSelect={toggleMultiSelectMode}
                  onToggleDeleteMode={() => setDeleteMode((current) => !current)}
                  onToggleDeleteStrategy={() => setDeleteStrategy((current) => (current === "trash" ? "permanent" : "trash"))}
                  onConfirmDeleteChange={(value) => {
                    setConfirmDelete(value)
                    void onFolderView?.({ confirmDelete: value })
                  }}
                  onUpdateSort={(sort) => {
                    void updateSort(sort)
                  }}
                  onUpdateSortPreference={(command) => {
                    void updateSortPreference(command)
                  }}
                  onEmptyAreaChange={(emptyArea) => {
                    void onFolderView?.({ emptyArea })
                  }}
                  onRefreshVisibleThumbnails={() => {
                    void refreshVisibleThumbnails()
                  }}
                  onRefreshSelectedThumbnails={() => {
                    void refreshSelectedThumbnails()
                  }}
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
                    onToggleClickBehavior={() => setCheckModeClickBehavior((current) => (current === "open" ? "select" : "open"))}
                    onClear={() => setSelection(createDirectorySelection(catalog.generation))}
                    onClose={() => {
                      setSelection(createDirectorySelection(catalog.generation))
                      chainAnchorIndexRef.current = undefined
                      setChainSelectMode(false)
                      setMultiSelectMode(false)
                    }}
                    onTrashCompleted={() =>
                      navigate(
                        { action: "refresh" },
                        {
                          keepTree: true,
                          clearSelection: true,
                          preserveThumbnailCache: true,
                        },
                      )
                    }
                    onDeleteCompleted={() =>
                      navigate(
                        { action: "refresh" },
                        {
                          keepTree: true,
                          clearSelection: true,
                          preserveThumbnailCache: true,
                        },
                      )
                    }
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
                <div
                  role={clipboard.feedback.kind}
                  className={clipboard.feedback.kind === "alert" ? "rounded bg-destructive/10 px-2 py-1 text-xs text-destructive" : "sr-only"}
                >
                  {clipboard.feedback.text}
                </div>
              ) : null}
              <div
                className="grid min-h-0 flex-1 overflow-hidden"
                style={
                  {
                    "--folder-tree-size": `${treeSize}px`,
                    gridTemplateColumns: !treeOpen
                      ? "1fr"
                      : treeLayout === "left"
                        ? "min(var(--folder-tree-size), 50%) 1fr"
                        : treeLayout === "right"
                          ? "1fr min(var(--folder-tree-size), 50%)"
                          : "1fr",
                    gridTemplateRows: !treeOpen
                      ? undefined
                      : treeLayout === "top"
                        ? "var(--folder-tree-size) minmax(0, 1fr)"
                        : treeLayout === "bottom"
                          ? "minmax(0, 1fr) var(--folder-tree-size)"
                          : "minmax(0, 1fr)",
                  } as CSSProperties
                }
                data-tree-layout={treeOpen ? treeLayout : undefined}
              >
                {treeOpen && sessionIdRef.current && catalog ? (
                  <Suspense
                    fallback={
                      <div
                        className="min-h-0 min-w-0 animate-pulse rounded border bg-muted/30"
                        style={{
                          order: treeLayout === "left" || treeLayout === "top" ? 0 : 1,
                        }}
                        aria-label="正在加载文件树"
                      />
                    }
                  >
                    <FolderTreeWorkspace
                      client={client}
                      sessionId={sessionIdRef.current}
                      currentPath={catalog.path}
                      watching={active && catalog.watching}
                      disabled={disabled || loading}
                      layout={treeLayout}
                      size={treeSize}
                      pinnedPaths={folderView.tree.pinnedPaths}
                      onNavigate={(path) => {
                        void navigate({ action: "path", path }, { keepTree: true })
                      }}
                      onLayoutChange={switchTreeLayout}
                      onSizeChange={commitTreeSize}
                      onPinnedPathsChange={(pinnedPaths) => {
                        void onFolderView?.({ tree: { pinnedPaths } })
                      }}
                    />
                  </Suspense>
                ) : null}
                <div
                  className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded border bg-background/60"
                  style={
                    {
                      order: treeOpen && (treeLayout === "right" || treeLayout === "bottom") ? 0 : 1,
                      "--folder-grid-width": `${viewUsesBanner(viewMode) ? bannerWidthPercent : thumbnailWidthPercent}%`,
                    } as CSSProperties
                  }
                  data-neoview-folder-list-shell="true"
                  data-folder-search-open={searchOpen || undefined}
                  data-folder-search-listing={searchListingActive || undefined}
                >
                  {searchOpen && sessionIdRef.current ? (
                    <Suspense fallback={<div className="h-16 animate-pulse bg-muted/30" aria-label="正在加载搜索" />}>
                      <FolderSearchPanel
                        client={client}
                        sessionId={sessionIdRef.current}
                        disabled={disabled}
                        settings={folderView.search}
                        rootPath={
                          searchOriginRef.current?.rootPath
                          ?? (catalog && !isVirtualSearchPath(catalog.path) ? catalog.path : undefined)
                          ?? browserPath
                        }
                        tabCount={folderTabCount}
                        maxTabs={maxFolderTabs}
                        initialSnapshot={pendingSearchSnapshotRef.current}
                        onSettingsChange={(search) => void onFolderView?.({ search })}
                        onListingChange={applySearchListing}
                        onClose={closeSearchChrome}
                        onSaveToTab={onOpenSearchInNewTab}
                      />
                    </Suspense>
                  ) : null}
                  <div
                    ref={listHostRef}
                    className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    data-neoview-folder-list="true"
                    data-focused-index={focusedIndex}
                    role={inlineTreeOpen ? undefined : "listbox"}
                    aria-label={searchListingActive ? "搜索结果" : "文件项目"}
                    aria-activedescendant={inlineTreeOpen ? undefined : focusedItemId}
                    tabIndex={inlineTreeOpen ? -1 : 0}
                    onKeyDown={inlineTreeOpen ? undefined : handleDirectoryKeyDown}
                    {...(inlineTreeOpen ? {} : emptyAreaHandlers)}
                  >
                  {inlineTreeOpen && sessionIdRef.current && catalog ? (
                    <Suspense fallback={<div className="h-72 animate-pulse bg-muted/30" aria-label="正在加载内联文件树" />}>
                      <FolderTreePanel
                        client={client}
                        sessionId={sessionIdRef.current}
                        currentPath={isVirtualSearchPath(catalog.path) ? (catalog.parentPath ?? catalog.path) : catalog.path}
                        watching={active && catalog.watching}
                        disabled={disabled || loading}
                        pinnedPaths={folderView.tree.pinnedPaths}
                        onNavigate={(path) => {
                          void navigate({ action: "path", path }, { keepTree: true })
                        }}
                        onPinnedPathsChange={(pinnedPaths) => {
                          void onFolderView?.({ tree: { pinnedPaths } })
                        }}
                      />
                    </Suspense>
                  ) : null}
                  {!inlineTreeOpen && catalog && catalog.total > 0 && viewUsesVirtuosoList(viewMode) ? (
                    <Virtuoso
                      key={virtualKey}
                      ref={listRef}
                      style={{ height: "100%" }}
                      totalCount={catalog.total}
                      components={showReturnFooter ? FOLDER_LIST_COMPONENTS : EMPTY_VIRTUOSO_COMPONENTS}
                      context={showReturnFooter ? returnFooterContext : undefined}
                      fixedItemHeight={viewMode === "compact" ? 34 : 76}
                      increaseViewportBy={{
                        top: viewMode === "compact" ? 68 : 152,
                        bottom: viewMode === "compact" ? 136 : 304,
                      }}
                      computeItemKey={(index) => directoryEntryAt(catalog, index)?.path ?? `${catalog.generation}:${index}`}
                      rangeChanged={requestRange}
                      restoreStateFrom={restoreState?.viewMode === viewMode ? restoreState.listSnapshot : undefined}
                      initialTopMostItemIndex={
                        shouldLocateRestore && restoreState?.viewMode === viewMode && !restoreState.listSnapshot && restoreIndex !== undefined
                          ? { index: restoreIndex, align: "center" }
                          : undefined
                      }
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
                            thumbnailUrls={entry ? thumbnailUrlSets.get(entry.path) : undefined}
                            contentWidthPercent={contentWidthPercent}
                            hoverPreviewEnabled={active && hoverPreviewEnabled}
                            hoverPreviewDelayMs={hoverPreviewDelayMs}
                            penetrationFiles={entry ? penetrationDescriptions.get(entry.path) : undefined}
                            deleteMode={deleteMode}
                            deleteStrategy={deleteStrategy}
                            confirmDelete={confirmDelete}
                            onSelect={selectEntry}
                          />
                        )
                      }}
                    />
                  ) : null}
                  {!inlineTreeOpen && catalog && viewMode === "details" ? (
                    <Suspense fallback={<div className="h-72 animate-pulse bg-muted/30" aria-label="正在加载详细信息视图" />}>
                      <FolderDetailsView
                        key={virtualKey}
                        catalog={catalog}
                        disabled={disabled}
                        selectedPaths={selectedPaths}
                        initialIndex={
                          focusedIndex ?? (restoreState?.viewMode === "details" ? (restoreState.focusedIndex ?? restoreState.anchorIndex) : undefined)
                        }
                        initialScrollTop={restoreState?.viewMode === "details" ? restoreState.detailsScrollTop : undefined}
                        layout={folderView.details}
                        deleteMode={deleteMode}
                        deleteStrategy={deleteStrategy}
                        confirmDelete={confirmDelete}
                        onRangeChange={requestRange}
                        onScrollTopChange={(scrollTop) => {
                          detailsScrollTopRef.current = scrollTop
                        }}
                        onSelect={selectEntry}
                        onLayoutChange={(details) => {
                          void onFolderView?.({ details })
                        }}
                        showReturnFooter={showReturnFooter}
                        returnFooterContext={returnFooterContext}
                      />
                    </Suspense>
                  ) : null}
                  {!inlineTreeOpen && catalog && catalog.total > 0 && viewUsesFixedGrid(viewMode) ? (
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
                        thumbnailUrlSets={thumbnailUrlSets}
                        hoverPreviewEnabled={active && hoverPreviewEnabled}
                        hoverPreviewDelayMs={hoverPreviewDelayMs}
                        penetrationFiles={penetrationDescriptions}
                        deleteMode={deleteMode}
                        deleteStrategy={deleteStrategy}
                        confirmDelete={confirmDelete}
                        showReturnFooter={showReturnFooter}
                        returnFooterContext={returnFooterContext}
                        restoreSnapshot={restoreState?.viewMode === viewMode ? restoreState.gridSnapshot : undefined}
                        initialScrollTop={restoreState?.viewMode === viewMode ? restoreState.gridScrollTop : undefined}
                        initialIndex={shouldLocateRestore && restoreState?.viewMode === viewMode && !restoreState.gridSnapshot ? restoreIndex : undefined}
                        onRangeChange={requestRange}
                        onStateChange={(snapshot) => {
                          gridSnapshotRef.current = snapshot
                        }}
                        onScrollTopChange={(scrollTop) => {
                          gridScrollTopRef.current = scrollTop
                        }}
                        onSelect={selectEntry}
                      />
                    </Suspense>
                  ) : null}
                  {!inlineTreeOpen && catalog && catalog.total > 0 && viewUsesMosaicGrid(viewMode) ? (
                    <Suspense fallback={<div className="h-72 animate-pulse bg-muted/30" aria-label="正在加载自由缩略图视图" />}>
                      <FolderMosaicWorkspace
                        key={virtualKey}
                        virtualKey={virtualKey}
                        mosaicRef={mosaicRef}
                        catalog={catalog}
                        disabled={disabled}
                        selectedPaths={selectedPaths}
                        focusedIndex={focusedIndex}
                        itemIdPrefix={itemIdPrefix}
                        thumbnailUrls={thumbnailUrls}
                        thumbnailUrlSets={thumbnailUrlSets}
                        tileSize={thumbnailPixelSize(thumbnailWidthPercent)}
                        hoverPreviewEnabled={active && hoverPreviewEnabled}
                        hoverPreviewDelayMs={hoverPreviewDelayMs}
                        penetrationFiles={penetrationDescriptions}
                        deleteMode={deleteMode}
                        deleteStrategy={deleteStrategy}
                        confirmDelete={confirmDelete}
                        showReturnFooter={showReturnFooter}
                        returnFooterContext={returnFooterContext}
                        restoreSnapshot={restoreState?.viewMode === viewMode ? restoreState.mosaicSnapshot : undefined}
                        initialScrollTop={restoreState?.viewMode === viewMode ? restoreState.mosaicScrollTop : undefined}
                        initialIndex={shouldLocateRestore && restoreState?.viewMode === viewMode && !restoreState.mosaicSnapshot ? restoreIndex : undefined}
                        onRangeChange={requestRange}
                        onScrollTopChange={(scrollTop) => {
                          mosaicScrollTopRef.current = scrollTop
                        }}
                        onSelect={selectEntry}
                      />
                    </Suspense>
                  ) : null}
                  {!inlineTreeOpen && catalog && catalog.total === 0 ? (
                    <div className="grid h-72 place-items-center px-4 text-center text-xs text-muted-foreground" data-folder-empty-state="true" role="status">
                      {isVirtualSearchPath(catalog.path)
                        ? "未找到匹配的搜索结果"
                        : catalog.filter === "all" ? "此文件夹为空" : "没有符合当前筛选条件的项目"}
                    </div>
                  ) : null}
                  {!catalog ? (
                    <div className="grid h-72 place-items-center text-xs text-muted-foreground">{loading ? "正在读取目录…" : "选择一个目录"}</div>
                  ) : null}
                  </div>
                </div>
              </div>
            </div>
          </FolderChromeLayout>
        </Suspense>
      </div>
    </FolderEntryDisplayProvider>
  )
}

export function DirectoryListItem({
  itemId,
  entry,
  index,
  disabled,
  selected,
  focused,
  showRating,
  showCollectTagCount,
  visualMode,
  thumbnailUrl,
  thumbnailUrls,
  contentWidthPercent,
  hoverPreviewEnabled,
  hoverPreviewDelayMs,
  penetrationFiles,
  deleteMode,
  deleteStrategy,
  confirmDelete,
  onSelect,
}: DirectoryItemProps & {
  visualMode: FolderViewMode
  thumbnailUrl?: string
  thumbnailUrls?: readonly string[]
  contentWidthPercent: number
  hoverPreviewEnabled: boolean
  hoverPreviewDelayMs: number
  penetrationFiles?: readonly FolderPenetrationFileName[]
  deleteMode: boolean
  deleteStrategy: FolderDeleteStrategy
  confirmDelete: boolean
}) {
  const rich = visualMode !== "compact"
  if (!entry) return <div className={`${rich ? "h-[76px]" : "h-[34px]"} animate-pulse border-b bg-muted/30`} aria-hidden="true" />
  return (
    <FolderHoverPreview thumbnailUrl={thumbnailUrl} enabled={hoverPreviewEnabled && rich} delayMs={hoverPreviewDelayMs} label={entry.name}>
      <div className="relative">
        {deleteMode ? (
          <FolderDeleteButton entry={{ index, ...entry }} strategy={deleteStrategy} disabled={disabled} placement="leading" confirm={confirmDelete} />
        ) : null}
        <button
          id={itemId}
          type="button"
          className={`flex w-full items-center gap-2 border-b pr-2 text-left text-xs hover:bg-muted aria-selected:bg-accent data-[focused=true]:ring-1 data-[focused=true]:ring-inset data-[focused=true]:ring-primary ${deleteMode ? "pl-9" : "pl-2"} ${rich ? "min-h-[76px] py-1.5" : penetrationFiles?.length ? "min-h-[34px] py-1" : "h-[34px]"}`}
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
            <span
              className="grid h-16 shrink-0 place-items-center overflow-hidden rounded bg-muted/30"
              style={{ width: `${contentWidthPercent}%`, maxWidth: "70%" }}
            >
              {thumbnailUrl ? (
                <ReaderThumbnailSurface
                  url={thumbnailUrl}
                  urls={thumbnailUrls}
                  kind={entry.kind === "directory" ? "folder" : "file"}
                  fit="contain"
                  imageLoading="eager"
                  className="size-full rounded-none bg-transparent"
                />
              ) : entry.kind === "directory" ? null : (
                <FolderEntryIcon entry={entry} className="size-7" />
              )}
            </span>
          ) : (
            <FolderEntryIcon entry={entry} />
          )}
          <span className="grid min-w-0 flex-1 gap-1">
            <span className="truncate">{entry.name}</span>
            {rich ? <span className="truncate text-[10px] text-muted-foreground">{entry.path}</span> : null}
            {rich ? <FolderEntryFileMetadata entry={entry} /> : null}
            <FolderPenetrationFileNames files={penetrationFiles} />
          </span>
          <FolderEntryMetadata entry={entry} showRating={showRating} showCollectTagCount={showCollectTagCount} />
        </button>
      </div>
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

export function mergeThumbnailUrlSets(
  current: ReadonlyMap<string, readonly string[]>,
  additions: readonly (readonly [string, readonly string[]])[],
  maximum: number,
): ReadonlyMap<string, readonly string[]> {
  if (!additions.length) return current
  const next = new Map(current)
  for (const [path, urls] of additions) {
    next.delete(path)
    next.set(path, urls)
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
  return entry.kind === "directory" && previewGridEnabled ? `folder:${previewCount}` : `${entry.kind}:1`
}

function sameFolderPath(left: string, right: string): boolean {
  const normalize = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/u, "")
  const normalizedLeft = normalize(left)
  const normalizedRight = normalize(right)
  return /^[a-z]:/iu.test(normalizedLeft) || /^[a-z]:/iu.test(normalizedRight)
    ? normalizedLeft.toLocaleLowerCase("en-US") === normalizedRight.toLocaleLowerCase("en-US")
    : normalizedLeft === normalizedRight
}

export function isSameFolderNavigationEntry(
  previous: Pick<ReaderDirectoryPageDto, "sessionId" | "navigationEntryId"> | undefined,
  next: Pick<ReaderDirectoryPageDto, "sessionId" | "navigationEntryId">,
): boolean {
  return previous?.sessionId === next.sessionId && previous.navigationEntryId === next.navigationEntryId
}

function folderEntryName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "")
  return normalized.split(/[\\/]/).at(-1) || normalized || path
}

/**
 * Reuse a restored file thumbnail even when it predates the profile sidecar.
 * Folder mosaic thumbnails remain profile-sensitive because preview count and
 * layout change their asset contents. Multi-tile profiles also require a urlSet
 * entry so single-cover visit cache is not mistaken for a finished mosaic.
 */
export function isThumbnailDemandNeeded(
  entry: Pick<ReaderDirectoryEntryDto, "kind" | "path">,
  viewMode: FolderViewMode,
  previewCount: FolderPreviewCount,
  profiles: ReadonlyMap<string, string>,
  urls: ReadonlyMap<string, string>,
  previewGridEnabled = false,
  urlSets?: ReadonlyMap<string, readonly string[]>,
): boolean {
  const expected = thumbnailProfile(entry, viewMode, previewCount, previewGridEnabled)
  const current = profiles.get(entry.path)
  if (current === expected) {
    if (entry.kind === "directory" && previewGridEnabled && previewCount > 1) {
      return !urlSets?.has(entry.path)
    }
    return false
  }
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
