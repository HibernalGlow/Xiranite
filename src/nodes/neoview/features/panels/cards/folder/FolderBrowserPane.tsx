import { type GridStateSnapshot, type ListRange, type StateSnapshot, type VirtuosoGridHandle, type VirtuosoHandle } from "react-virtuoso"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import type {
  ReaderActivationTraversalFrameDto,
  ReaderDirectoryEntryDto,
  ReaderDirectoryFilterDto,
  ReaderDirectoryMetadataFieldDto,
  ReaderDirectoryNavigationDto,
  ReaderDirectoryPageDto,
  ReaderDirectorySortDto,
  ReaderDirectorySortPreferenceCommandDto,
  ReaderFolderTreeLayout,
} from "../../../../adapters/reader-http-client"
import type { ReaderFolderExternalOpenRequest, ReaderFolderExternalOpenResult, ReaderPanelContext } from "../../registry"
import {
  createSearchDirectoryPage,
  isVirtualSearchPath,
  type FolderSearchTabSnapshot,
} from "./search/folderSearchModel"
import type { FolderSearchListingUpdate } from "./FolderSearchPanel"
import {
  createDirectoryCatalog,
  cloneDirectoryCatalog,
  directoryEntryAt,
  directoryPageHasMetadata,
  directoryPageCursors,
  folderMetadataFieldsForView,
  folderErrorMessage,
  FOLDER_MOSAIC_GROUP_SIZE,
  isAbortError,
  mergeDirectoryPage,
  sortDirectoryCatalogEntries,
  normalizeFolderNavigationPath,
  rememberDirectoryVisitState,
  restoreDirectoryVisitState,
  trimDirectoryPages,
  viewUsesFixedGrid,
  viewUsesMosaicGrid,
  viewUsesThumbnails,
  viewUsesVirtuosoList,
  type DirectoryCatalog,
} from "./DirectoryCatalog"
import {
  createDirectorySelection,
  rebaseDirectorySelection,
  selectedLoadedDirectoryPaths,
  selectDirectorySingle,
} from "./DirectorySelection"
import {
  folderTabReplacementPolicy,
  routeFolderTabActivation,
  routeFolderTabBrowse,
  routeFolderTabNavigation,
  type FolderTabKind,
} from "./FolderTabNavigationPolicy"
import type { FolderDeleteStrategy } from "./FolderDeleteButton"
import { useFolderClipboard } from "./FolderClipboard"
import { libraryItemFolderPath } from "../shared/libraryItemFolderPath"
import { runFolderNavigation, useFolderEmptyAreaNavigation } from "./FolderEmptyAreaBehavior"
import { DEFAULT_FOLDER_VIEW } from "./FolderBrowserState"
import type { FolderViewMode, FolderPreviewCount, SavedDirectoryState, FolderBrowserCloneSnapshot, FolderBrowserCloneProvider } from "./FolderBrowserState"
import { sameFolderPath, isSameFolderNavigationEntry, resolveFolderStartupPath, sameFolderOrChild } from "./FolderPathIdentity"
import { folderEntryName } from "./FolderDirectoryListItem"
import { useFolderThumbnailPipeline } from "./useFolderThumbnailPipeline"
import { useFolderInlineBranchState } from "./useFolderInlineBranchState"
import { useFolderSelectionController } from "./useFolderSelectionController"
import { useFolderPenetrationPipeline } from "./useFolderPenetrationPipeline"
import { useFolderEntryActivation } from "./useFolderEntryActivation"
import { useFolderNavigationEvents } from "./useFolderNavigationEvents"
import { useFolderExternalDeletion } from "./useFolderExternalDeletion"
import { openFolderBrowser } from "./FolderBrowserOpen"
import { useFolderExternalOpenRequest } from "./useFolderExternalOpenRequest"
import { useFolderViewportRestorer } from "./useFolderViewportRestorer"
import { FolderBrowserPaneView } from "./FolderBrowserPaneView"
export { DirectoryListItem } from "./FolderDirectoryListItem"
export { isSameFolderNavigationEntry } from "./FolderPathIdentity"
export { mergeThumbnailUrls, mergeThumbnailUrlSets, isThumbnailDemandNeeded } from "./FolderThumbnailState"
export { DEFAULT_FOLDER_VIEW } from "./FolderBrowserState"
export type { SavedDirectoryState, FolderBrowserCloneSnapshot, FolderBrowserCloneProvider } from "./FolderBrowserState"

const PAGE_SIZE = 128
const MAX_CACHED_PAGES = 12
const INITIAL_THUMBNAIL_DEMAND = 8
const EMPTY_SELECTED_PATHS: ReadonlySet<string> = new Set()
const DETAILS_METADATA_FIELDS: readonly ReaderDirectoryMetadataFieldDto[] = ["date", "size", "rating", "collectTagCount", "dimensions", "pageCount", "tags"]

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
export function FolderBrowserPane({
  client,
  disabled,
  sourcePath,
  onOpen,
  onDeleteThroughBinding, onUndoFileDeletion,
  pickEfuFile,
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
  onOpenEfuInNewTab,
  folderNavigationEvents,
  initialClone,
  initialSearchSnapshot,
  onOpenSearchInNewTab,
  currentFolderTabKind,
  onCloneProvider,
  externalOpenRequest,
  onExternalOpenResult,
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
  onOpenEfuInNewTab(path: string): void
  onOpenSearchInNewTab?(snapshot: FolderSearchTabSnapshot): void
  currentFolderTabKind: FolderTabKind
  initialClone?: FolderBrowserCloneSnapshot
  initialSearchSnapshot?: FolderSearchTabSnapshot
  onCloneProvider(provider?: FolderBrowserCloneProvider): void
  externalOpenRequest?: ReaderFolderExternalOpenRequest
  onExternalOpenResult?(result: ReaderFolderExternalOpenResult): void
}) {
  const thumbnailsVisible = active && (panelVisible ?? true)
  const clipboard = useFolderClipboard()
  const pendingInitialCloneRef = useRef(initialClone)
  const startupBrowserPathRef = useRef(resolveFolderStartupPath(browserPath, folderView.homePath))
  const sessionIdRef = useRef<string | undefined>(undefined)
  const catalogRef = useRef<DirectoryCatalog | undefined>(undefined)
  const navigationRequestRef = useRef<AbortController | undefined>(undefined)
  const retryOperationRef = useRef<FolderRetryOperation | undefined>(undefined)
  const catalogRequestRef = useRef<AbortController | undefined>(undefined)
  const pendingCursorsRef = useRef(new Set<string>())
  const navigationGenerationRef = useRef(0)
  const clipboardCompletionRef = useRef<string>()
  const visibleRangeRef = useRef<ListRange>({ startIndex: 0, endIndex: 0 })
  const listRef = useRef<VirtuosoHandle>(null)
  const listScrollerRef = useRef<HTMLElement>(null)
  const gridRef = useRef<VirtuosoGridHandle>(null)
  const mosaicRef = useRef<VirtuosoHandle>(null)
  const listHostRef = useRef<HTMLDivElement>(null)
  const gridSnapshotRef = useRef<GridStateSnapshot | undefined>(undefined)
  const gridScrollTopRef = useRef(0)
  const mosaicSnapshotRef = useRef<StateSnapshot | undefined>(undefined)
  const mosaicScrollTopRef = useRef(0)
  const detailsScrollTopRef = useRef(0)
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
  const restoreViewport = useFolderViewportRestorer({ viewMode, listRef, listScrollerRef, gridRef, mosaicRef, listHostRef })
  const [previewGridEnabled, setPreviewGridEnabled] = useState(folderView.previewGridEnabled ?? false)
  const [previewCount, setPreviewCount] = useState<FolderPreviewCount>(folderView.previewCount)
  const [contentWidthPercent, setContentWidthPercent] = useState(folderView.contentWidthPercent ?? 35)
  const [thumbnailWidthPercent, setThumbnailWidthPercent] = useState(folderView.thumbnailWidthPercent)
  const [bannerWidthPercent, setBannerWidthPercent] = useState(folderView.bannerWidthPercent)
  const [hoverPreviewEnabled, setHoverPreviewEnabled] = useState(folderView.hoverPreviewEnabled ?? true)
  const [hoverPreviewDelayMs, setHoverPreviewDelayMs] = useState(folderView.hoverPreviewDelayMs ?? 500)
  const [deleteMode, setDeleteMode] = useState(false)
  const [deleteStrategy, setDeleteStrategy] = useState<FolderDeleteStrategy>("trash")
  const confirmations = folderView.confirmations
  const activeDeleteConfirmation = deleteStrategy === "trash" ? confirmations.trash : confirmations.permanentDelete
  const [restoreState, setRestoreState] = useState<SavedDirectoryState>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const {
    penetration,
    descriptions: penetrationDescriptions,
    updatePenetration,
    requestDescriptions: requestPenetrationDescriptions,
  } = useFolderPenetrationPipeline({
    client,
    configuredPenetration: folderView.penetration,
    onFolderView,
    catalog,
    catalogRef,
    visibleRangeRef,
    viewMode,
    reportError: setError,
  })
  const { inlineBranch, closeInlineBranch, toggleInlineBranch } = useFolderInlineBranchState(
    active && penetration.enabled && penetration.expandBranchesInline,
  )
  const { activate, cancelPendingActivation } = useFolderEntryActivation({
    client,
    catalogRef,
    penetration,
    switchToast,
    openReaderEntry,
    enterRawDirectory,
    toggleInlineBranch,
  })
  const selectionController = useFolderSelectionController({
    catalog,
    catalogRef,
    visibleRangeRef,
    viewMode,
    penetrationEnabled: penetration.enabled,
    listRef,
    gridRef,
    mosaicRef,
    activate,
  })
  const {
    selection,
    setSelection,
    multiSelectMode,
    setMultiSelectMode,
    chainSelectMode,
    setChainSelectMode,
    checkModeClickBehavior,
    setCheckModeClickBehavior,
    renameRequest,
    setRenameRequest,
    focusedPath,
    setFocusedPath,
    focusedIndex,
    setFocusedIndex,
    focusedIndexRef,
    chainAnchorIndexRef,
    toggleMultiSelectMode,
    selectEntry,
    scrollToDirectoryIndex,
  } = selectionController
  const selectedPaths = useMemo(() => (catalog ? selectedLoadedDirectoryPaths(selection, catalog.pages) : EMPTY_SELECTED_PATHS), [catalog, selection])
  const thumbnailPipeline = useFolderThumbnailPipeline({
    client,
    catalog,
    catalogRef,
    thumbnailsVisible,
    viewMode,
    previewGridEnabled,
    previewCount,
    visibleRangeRef,
    selectedPaths, retainContextWhenHidden: navigationActive,
  })
  const {
    thumbnailStore,
    refreshPending: thumbnailRefreshPending,
    registerVisible: registerVisibleThumbnails,
    refreshVisible: refreshVisibleThumbnails,
    refreshSelected: refreshSelectedThumbnails,
    refreshPaths: refreshThumbnails,
    cancelRefresh: cancelThumbnailRefresh,
    primeInitialRange: primeInitialThumbnailRange,
    protectInitialRange: protectInitialThumbnailRange,
    snapshot: snapshotThumbnails,
    restore: restoreThumbnails,
    clearCaches: clearThumbnailCaches,
    retainFileCaches: retainFileThumbnailCaches,
    invalidateRegistration: invalidateThumbnailRegistration,
    resetRegistration: resetThumbnailRegistration,
    releaseContext: releaseThumbnailContext,
  } = thumbnailPipeline
  const itemIdPrefix = catalog?.sessionId
  const emptyAreaHandlers = useFolderEmptyAreaNavigation(folderView.emptyArea, (action) => {
    runFolderNavigation(action, catalogRef.current, (command) => {
      void navigate(command)
    })
  })

  function currentReplacementPolicy() {
    const current = catalogRef.current
    const kind: FolderTabKind = isVirtualSearchPath(current?.path)
      ? "search"
      : current?.sourceKind === "efu"
        ? "efu"
        : currentFolderTabKind
    return folderTabReplacementPolicy(kind)
  }

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
        const focusedEntry = directoryEntryAt(catalogRef.current, focusedIndexRef.current ?? -1)
        // A File Card click focuses before Reader commits sourcePath. Do not re-center the
        // same entry after the open completes; external source changes still locate normally.
        if (focusedEntry && sameFolderPath(focusedEntry.path, sourcePath)) return
        focusSourceEntry(sourcePath)
      }
      return
    }
    if (startupBrowserPathRef.current) void openBrowser(startupBrowserPathRef.current)
  }, [sourcePath])

  useFolderNavigationEvents({
    events: folderNavigationEvents,
    enabled: navigationActive,
    onBrowse: (path, newTab) => routeFolderTabBrowse({
      policy: currentReplacementPolicy(),
      forceNewTab: newTab,
      path,
      openInNewTab: onOpenInNewTab,
      replaceCurrent: (nextPath) => { void openBrowser(nextPath) },
    }),
    onActivate: (path) => routeFolderTabActivation({
      policy: currentReplacementPolicy(),
      path,
      activateCurrent: (nextPath) => { void activateLibraryFolder(nextPath) },
    }),
  })
  useFolderExternalDeletion({
    events: folderNavigationEvents,
    enabled: navigationActive,
    catalogRef,
    sourcePath,
    focusedPath,
    focusedIndexRef,
    commitCatalog,
    setFocusedIndex,
    setFocusedPath,
    setSelection,
    navigate,
  })

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
  useEffect(() => setTreeOpen(folderView.tree.visible), [folderView.tree.visible])
  useEffect(() => setTreeLayout(folderView.tree.layout), [folderView.tree.layout])
  useEffect(() => setTreeSize(folderView.tree.size), [folderView.tree.size])

  useEffect(() => {
    const completed = clipboard.lastCompleted
    if (!completed || clipboardCompletionRef.current === completed.id) return
    clipboardCompletionRef.current = completed.id
    const current = catalogRef.current
    if (current?.sourceKind === "efu" && completed.kind === "move") {
      void navigate({ action: "refresh" }, { keepTree: true })
    } else if (completed.destinationPath && current && sameFolderPath(completed.destinationPath, current.path)) {
      void navigate({ action: "refresh" }, { keepTree: true })
    }
  }, [clipboard.lastCompleted?.id])

  useEffect(() => {
    if (!catalog || viewMode !== "details") return
    queueMicrotask(() => requestRange(visibleRangeRef.current))
  }, [catalog?.sessionId, catalog?.generation, viewMode])

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

  const openBrowser = (path: string) => openFolderBrowser(path, {
    client,
    folderView,
    clearSearchSession,
    beginNavigation,
    isCurrentGeneration: (generation) => generation === navigationGenerationRef.current,
    navigationSignal: () => navigationRequestRef.current?.signal,
    setSearchOpen,
    setTreeOpen,
    setLoading,
    setError,
    setOpenRetry: (retryPath) => { retryOperationRef.current = { kind: "open", path: retryPath } },
    clearRetry: () => { retryOperationRef.current = undefined },
    currentSessionId: () => sessionIdRef.current,
    replaceSessionId: (sessionId) => { sessionIdRef.current = sessionId },
    releaseThumbnailContext,
    applyPage,
  })

  useFolderExternalOpenRequest(externalOpenRequest, openBrowser, onExternalOpenResult)

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
    if (routeFolderTabNavigation({
      policy: currentReplacementPolicy(),
      navigation: normalizedNavigation,
      fallbackPath: catalogRef.current?.parentPath,
      openInNewTab: onOpenInNewTab,
    })) return
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
      let result = await client.navigateDirectoryBrowser(
        sessionId,
        normalizedNavigation,
        navigationRequestRef.current?.signal,
        options.focusPath ?? capturedState?.focusedPath,
      )
      const hideMissingEfuEntries = folderView.hideMissingEfuEntries ?? false
      if (
        result.sourceKind === "efu"
        && hideMissingEfuEntries
        && !result.hideMissingEfuEntries
        && client.filterDirectoryBrowser
      ) {
        result = await client.filterDirectoryBrowser(
          sessionId,
          result.filter ?? "all",
          options.focusPath ?? capturedState?.focusedPath,
          navigationRequestRef.current?.signal,
          result.showHiddenFolders ?? false,
          true,
        )
      }
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
      invalidateThumbnailRegistration()
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
      : {
          startIndex: page.cursor,
          endIndex: Math.max(page.cursor, Math.min(page.total - 1, page.cursor + Math.min(page.entries.length, INITIAL_THUMBNAIL_DEMAND) - 1)),
        }
    primeInitialThumbnailRange(
      page,
      visibleRangeRef.current,
      Boolean(!sameNavigationEntry && thumbnailsVisible && viewUsesThumbnails(viewMode) && client.registerLibraryThumbnails),
    )
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
    const restoredThumbnails = restoreThumbnails(restored, options.preserveThumbnailCache === true)
    setRestoreState({
      ...restored,
      ...restoredThumbnails,
    })
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
      const thumbnails = snapshotThumbnails()
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
          ...thumbnails,
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
    const current = catalogRef.current
    if (current && isVirtualSearchPath(current.path)) {
      const next = sortDirectoryCatalogEntries(current, sort)
      commitCatalog(next)
      setSelection(createDirectorySelection(next.generation))
      const nextFocusedIndex = focusedPath
        ? [...next.pages.values()].flat().findIndex((entry) => entry.path === focusedPath)
        : -1
      focusedIndexRef.current = nextFocusedIndex < 0 ? undefined : nextFocusedIndex
      setFocusedIndex(nextFocusedIndex < 0 ? undefined : nextFocusedIndex)
      return
    }
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
        applyFilter(
          sessionId,
          filter,
          focusPath,
          signal,
          current.showHiddenFolders,
          current.hideMissingEfuEntries,
        ),
      true,
    )
    if ((folderView.typeFilter ?? "library") !== filter) void onFolderView?.({ typeFilter: filter })
  }

  async function updateHiddenFolders(showHiddenFolders: boolean) {
    const applyFilter = client.filterDirectoryBrowser
    const current = catalogRef.current
    if (!applyFilter || !current || showHiddenFolders === current.showHiddenFolders) return
    await updateCatalogProjection((sessionId, focusPath, signal) => applyFilter(
      sessionId,
      current.filter,
      focusPath,
      signal,
      showHiddenFolders,
      current.hideMissingEfuEntries,
    ), true)
    if (showHiddenFolders !== (folderView.showHiddenFolders ?? false)) void onFolderView?.({ showHiddenFolders })
  }

  async function updateMissingEfuEntries(hideMissingEfuEntries: boolean) {
    const applyFilter = client.filterDirectoryBrowser
    const current = catalogRef.current
    if (!applyFilter || current?.sourceKind !== "efu" || hideMissingEfuEntries === current.hideMissingEfuEntries) return
    const updated = await updateCatalogProjection((sessionId, focusPath, signal) => applyFilter(
      sessionId,
      current.filter,
      focusPath,
      signal,
      current.showHiddenFolders,
      hideMissingEfuEntries,
    ), true)
    if (updated && hideMissingEfuEntries !== (folderView.hideMissingEfuEntries ?? false)) {
      void onFolderView?.({ hideMissingEfuEntries })
    }
  }

  async function updateSortPreference(command: ReaderDirectorySortPreferenceCommandDto) {
    const applyPreference = client.updateDirectorySortPreference
    if (!applyPreference) return
    await updateCatalogProjection((sessionId, focusPath, signal) => applyPreference(sessionId, command, focusPath, signal))
  }

  function requestRange(range: ListRange) {
    const current = catalogRef.current
    const requestedRange = protectInitialThumbnailRange(current, range)
    visibleRangeRef.current = requestedRange
    requestPenetrationDescriptions(requestedRange, current)
    if (!current) return
    // Virtual search already holds every hit in-memory — skip listDirectoryBrowser
    // paging, but still run the shared visible-thumbnail pipeline so scroll works.
    if (!isVirtualSearchPath(current.path) && client.listDirectoryBrowser) {
      const metadataFields =
        viewMode === "details"
          ? DETAILS_METADATA_FIELDS.filter((field) => current.metadataCapabilities.includes(field))
          : folderMetadataFieldsForView(viewMode, current.metadataCapabilities)
      const cursors = directoryPageCursors(requestedRange.startIndex - 16, requestedRange.endIndex + 16, current.total, PAGE_SIZE)
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

  function currentSavedState(): { current: DirectoryCatalog; state: SavedDirectoryState } | undefined {
    const current = catalogRef.current
    if (!current) return undefined
    const range = visibleRangeRef.current
    const thumbnails = snapshotThumbnails()
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
      thumbnailUrls: viewUsesThumbnails(viewMode) ? thumbnails.thumbnailUrls : undefined,
      thumbnailUrlSets: viewUsesThumbnails(viewMode) ? thumbnails.thumbnailUrlSets : undefined,
      thumbnailProfiles: viewUsesThumbnails(viewMode) ? thumbnails.thumbnailProfiles : undefined,
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
    restoreViewport(preferredState)
    applyPage(page, preferredState, false, { preserveThumbnailCache: true })
  }

  function switchView(next: FolderViewMode) {
    if (next === viewMode) return
    captureCurrentState()
    const current = catalogRef.current
    const anchorIndex = focusedIndexRef.current ?? visibleRangeRef.current.startIndex
    const thumbnails = snapshotThumbnails()
    const nextState: SavedDirectoryState = {
      total: current?.total,
      viewMode: next,
      previewCount,
      multiSelectMode,
      selection,
      focusedPath,
      focusedIndex: focusedIndexRef.current,
      anchorIndex,
      ...thumbnails,
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
    clearThumbnailCaches()
    setPreviewCount(next)
    void onFolderView?.({ previewCount: next })
  }

  function togglePreviewGrid(enabled: boolean) {
    if (enabled === previewGridEnabled) return
    captureCurrentState()
    // Multi-preview only changes folder mosaic assets. Keep file single-cover
    // visit cache so enabling the grid does not thrash the shared thumbnail lane.
    retainFileThumbnailCaches()
    setPreviewGridEnabled(enabled)
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

  function openReaderEntry(
    entry: Pick<ReaderDirectoryEntryDto, "path">,
    browserOriginEntryPath = entry.path,
    browserOriginSelfTerminal = false,
    browserOriginTraversalFrames?: readonly ReaderActivationTraversalFrameDto[],
  ): void {
    const current = catalogRef.current
    void onOpen?.(
      entry.path,
      current
        ? {
            browserOriginPath: current.path,
            browserOriginEntryPath,
            ...(browserOriginSelfTerminal ? { browserOriginSelfTerminal: true } : {}),
            ...(browserOriginTraversalFrames?.length ? { browserOriginTraversalFrames } : {}),
          }
        : undefined,
    )
  }

  function enterRawDirectory(entry: Pick<ReaderDirectoryEntryDto, "path">): void {
    cancelPendingActivation()
    closeInlineBranch()
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

  function beginNavigation(): number {
    cancelPendingActivation()
    closeInlineBranch()
    navigationRequestRef.current?.abort()
    catalogRequestRef.current?.abort()
    navigationRequestRef.current = new AbortController()
    pendingCursorsRef.current.clear()
    navigationGenerationRef.current += 1
    return navigationGenerationRef.current
  }

  function commitCatalog(next: DirectoryCatalog) {
    setSelection((value) => (value.generation === next.generation ? value : rebaseDirectorySelection(value, next.generation)))
    catalogRef.current = next
    setCatalog(next)
    onCurrentPathChange(next.path)
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
          endIndex: Math.min(latest.total - 1, Math.max(0, INITIAL_THUMBNAIL_DEMAND - 1)),
        })
        return
      }
      requestRange(range)
    })
  }

  function disposeBrowser() {
    navigationGenerationRef.current += 1
    cancelPendingActivation()
    closeInlineBranch()
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
    <FolderBrowserPaneView
      runtime={{
        client,
        disabled,
        active,
        sourcePath,
        browserPath,
        tabBar,
        folderTabCount,
        maxFolderTabs,
        onCreateTab,
        onOpenInNewTab,
        onOpenEfuInNewTab,
        onOpenSearchInNewTab,
        onOpen,
        onDeleteThroughBinding, onUndoFileDeletion,
        pickEfuFile,
        systemActions,
        switchToast,
        onFolderView,
      }}
      state={{
        catalog,
        folderView,
        selection,
        selectedPaths,
        viewMode,
        previewGridEnabled,
        previewCount,
        contentWidthPercent,
        thumbnailWidthPercent,
        bannerWidthPercent,
        hoverPreviewEnabled,
        hoverPreviewDelayMs,
        penetration,
        penetrationDescriptions,
        inlineBranchAnchorPath: inlineBranch?.anchorPath,
        inlineBranchContentPath: inlineBranch?.contentPath,
        inlineBranchTraversalFrames: inlineBranch?.traversalFrames,
        multiSelectMode,
        chainSelectMode,
        checkModeClickBehavior,
        deleteMode,
        deleteStrategy,
        activeDeleteConfirmation,
        confirmations,
        restoreState,
        restoreIndex,
        shouldLocateRestore,
        thumbnailStore, thumbnailProbesEnabled: thumbnailsVisible,
        thumbnailRefreshPending,
        loading,
        error,
        searchOpen,
        treeOpen,
        inlineTreeOpen,
        treeLayout,
        treeSize,
        renameRequest,
        focusedPath,
        focusedIndex,
        itemIdPrefix,
        clipboard,
        canRetry: Boolean(retryOperationRef.current),
        sessionId: sessionIdRef.current,
        searchRootPath: searchOriginRef.current?.rootPath,
        pendingSearchSnapshot: pendingSearchSnapshotRef.current,
      }}
      refs={{
        catalogRef,
        focusedIndexRef,
        chainAnchorIndexRef,
        listRef,
        listScrollerRef,
        gridRef,
        mosaicRef,
        listHostRef,
        detailsScrollTopRef,
        gridSnapshotRef,
        gridScrollTopRef,
        mosaicScrollTopRef,
      }}
      actions={{
        navigate,
        applyWatchedPage,
        setError,
        activate,
        enterRawDirectory,
        commitCatalog,
        updateSort,
        refreshThumbnails,
        setRenameRequest,
        switchView,
        togglePreviewGrid,
        switchPreviewCount,
        commitHoverPreviewEnabled,
        commitHoverPreviewDelay,
        setContentWidthPercent,
        commitContentWidth,
        setThumbnailWidthPercent,
        commitThumbnailWidth,
        setBannerWidthPercent,
        commitBannerWidth,
        setSearchOpen,
        updateFilter,
        updateHiddenFolders,
        updateMissingEfuEntries,
        updatePenetration,
        closeInlineBranch,
        toggleTree,
        switchTreeLayout,
        toggleInlineTree,
        toggleMultiSelectMode,
        setDeleteMode,
        setDeleteStrategy,
        updateSortPreference,
        refreshVisibleThumbnails,
        refreshSelectedThumbnails,
        cancelThumbnailRefresh,
        setSelection,
        setFocusedIndex,
        setFocusedPath,
        setChainSelectMode,
        setCheckModeClickBehavior,
        setMultiSelectMode,
        retryLastOperation,
        commitTreeSize,
        applySearchListing,
        closeSearchChrome,
        requestRange,
        selectEntry,
        emptyAreaHandlers,
      }}
    />
  )
}
