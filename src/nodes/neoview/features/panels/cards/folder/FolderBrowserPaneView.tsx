import { lazy, Suspense, useEffect, useRef, type CSSProperties, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from "react"
import { Virtuoso, type GridStateSnapshot, type ListRange, type VirtuosoGridHandle, type VirtuosoHandle } from "react-virtuoso"
import { GalleryHorizontalEnd, Grid2X2, LayoutGrid, List, RefreshCw, Rows3, TableProperties, type LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import type {
  ReaderDirectoryEntryDto,
  ReaderDirectoryFilterDto,
  ReaderDirectoryNavigationDto,
  ReaderDirectoryPageDto,
  ReaderDirectorySortDto,
  ReaderDirectorySortPreferenceCommandDto,
  ReaderDirectorySortFieldDto,
  ReaderDirectorySortSourceDto,
  ReaderFolderPenetrationConfig,
  ReaderFolderTreeLayout,
  ReaderFolderViewConfig,
  ReaderFolderViewMode,
  ReaderHttpClient,
} from "../../../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../../registry"
import {
  directoryEntryAt,
  directoryEntryIndex,
  folderErrorMessage,
  isEditableKeyboardEvent,
  isVerticalFolderRegion,
  nearestLoadedDirectoryEntry,
  removeDirectoryCatalogEntry,
  thumbnailPixelSize,
  viewUsesBanner,
  viewUsesFixedGrid,
  viewUsesMosaicGrid,
  viewUsesVirtuosoList,
  type DirectoryCatalog,
} from "./DirectoryCatalog"
import {
  createDirectorySelection,
  directorySelectionCount,
  directorySelectionDescriptor,
  invertDirectorySelection,
  isDirectoryIndexSelected,
  selectAllDirectoryEntries,
  selectDirectorySingle,
  type DirectorySelectionModel,
} from "./DirectorySelection"
import { DEFAULT_FOLDER_TAG_DISPLAY, FolderEntryDisplayProvider } from "./FolderEntryPresentation"
import { EMPTY_VIRTUOSO_COMPONENTS, FOLDER_LIST_COMPONENTS, runFolderNavigation, useFolderEmptyAreaNavigation } from "./FolderEmptyAreaBehavior"
import type { FolderClipboardState } from "./FolderClipboard"
import type { FolderContextEntry } from "./FolderContextActions"
import type { FolderDeleteStrategy } from "./FolderDeleteButton"
import { DEFAULT_FOLDER_VIEW, type FolderPreviewCount, type FolderViewMode, type SavedDirectoryState } from "./FolderBrowserState"
import { DirectoryListItem } from "./FolderDirectoryListItem"
import type { FolderThumbnailStore } from "./FolderThumbnailStore"
import type { FolderPenetrationFileName } from "./FolderPenetrationFileNames"
import type { FolderSearchListingUpdate } from "./FolderSearchPanel"
import type { FolderSearchTabSnapshot } from "./search/folderSearchModel"
import { isVirtualSearchPath } from "./search/folderSearchModel"
import { DEFAULT_FOLDER_TITLE_WRAP, FOLDER_VIEW_PRESENTATION_OPTIONS, resolveFolderTitleWrap } from "./FolderViewPresentation"

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
const FolderToolbarLazy = lazy(async () => ({ default: (await import("./FolderToolbar")).default }))

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
const VIEW_MODE_ICONS = {
  compact: List,
  "cover-list": Rows3,
  "mosaic-list": GalleryHorizontalEnd,
  details: TableProperties,
  "cover-grid": Grid2X2,
  "mosaic-grid": LayoutGrid,
} satisfies Record<ReaderFolderViewMode, LucideIcon>

const VIEW_MODE_OPTIONS = FOLDER_VIEW_PRESENTATION_OPTIONS.map((option) => ({
  ...option,
  icon: VIEW_MODE_ICONS[option.value],
}))

interface FolderNavigationOptions {
  keepTree?: boolean
  focusPath?: string
  selectFocus?: boolean
  clearSelection?: boolean
  preserveThumbnailCache?: boolean
}

export interface FolderBrowserPaneViewProps {
  runtime: {
    client: ReaderHttpClient
    disabled: boolean
    active: boolean
    sourcePath?: string
    browserPath: string
    tabBar?: ReactNode
    folderTabCount: number
    maxFolderTabs: number
    onCreateTab(): void
    onOpenInNewTab(path: string): void
    onOpenEfuInNewTab(path: string): void
    onOpenSearchInNewTab?(snapshot: FolderSearchTabSnapshot): void
    onOpen: ReaderPanelContext["onOpen"]
    onPrepareFileMutation: ReaderPanelContext["onPrepareFileMutation"]
    pickEfuFile: ReaderPanelContext["pickEfuFile"]
    systemActions: ReaderPanelContext["systemActions"]
    switchToast: ReaderPanelContext["switchToast"]
    onFolderView: ReaderPanelContext["onFolderView"]
  }
  state: {
    catalog?: DirectoryCatalog
    folderView: ReaderFolderViewConfig
    selection: DirectorySelectionModel
    selectedPaths: ReadonlySet<string>
    viewMode: FolderViewMode
    previewGridEnabled: boolean
    previewCount: FolderPreviewCount
    contentWidthPercent: number
    thumbnailWidthPercent: number
    bannerWidthPercent: number
    hoverPreviewEnabled: boolean
    hoverPreviewDelayMs: number
    penetration: ReaderFolderPenetrationConfig
    penetrationDescriptions: ReadonlyMap<string, readonly FolderPenetrationFileName[]>
    multiSelectMode: boolean
    chainSelectMode: boolean
    checkModeClickBehavior: "open" | "select"
    deleteMode: boolean
    deleteStrategy: FolderDeleteStrategy
    activeDeleteConfirmation: boolean
    confirmations: ReaderFolderViewConfig["confirmations"]
    restoreState?: SavedDirectoryState
    restoreIndex?: number
    shouldLocateRestore: boolean
    thumbnailStore: FolderThumbnailStore
    thumbnailRefreshPending: boolean
    loading: boolean
    error?: string
    searchOpen: boolean
    treeOpen: boolean
    inlineTreeOpen: boolean
    treeLayout: ReaderFolderTreeLayout
    treeSize: number
    renameRequest?: FolderContextEntry
    focusedPath?: string
    focusedIndex?: number
    focusedItemId?: string
    itemIdPrefix?: string
    clipboard: FolderClipboardState
    canRetry: boolean
    sessionId?: string
    searchRootPath?: string
    pendingSearchSnapshot?: FolderSearchTabSnapshot
  }
  refs: {
    catalogRef: RefObject<DirectoryCatalog | undefined>
    focusedIndexRef: RefObject<number | undefined>
    chainAnchorIndexRef: RefObject<number | undefined>
    listRef: RefObject<VirtuosoHandle | null>
    gridRef: RefObject<VirtuosoGridHandle | null>
    mosaicRef: RefObject<VirtuosoHandle | null>
    listHostRef: RefObject<HTMLDivElement | null>
    detailsScrollTopRef: RefObject<number>
    gridSnapshotRef: RefObject<GridStateSnapshot | undefined>
    gridScrollTopRef: RefObject<number>
    mosaicScrollTopRef: RefObject<number>
  }
  actions: {
    navigate(navigation: ReaderDirectoryNavigationDto, options?: FolderNavigationOptions): Promise<void>
    applyWatchedPage(page: ReaderDirectoryPageDto): Promise<void>
    setError: Dispatch<SetStateAction<string | undefined>>
    activate(entry: Pick<ReaderDirectoryEntryDto, "kind" | "name" | "path" | "readerSupported">, rawDirectory?: boolean): void
    enterRawDirectory(entry: Pick<ReaderDirectoryEntryDto, "path">): void
    commitCatalog(next: DirectoryCatalog): void
    updateSort(sort: ReaderDirectorySortDto): Promise<void>
    refreshThumbnails(paths?: ReadonlySet<string>): Promise<void>
    setRenameRequest: Dispatch<SetStateAction<FolderContextEntry | undefined>>
    switchView(next: FolderViewMode): void
    togglePreviewGrid(enabled: boolean): void
    switchPreviewCount(next: FolderPreviewCount): void
    commitHoverPreviewEnabled(enabled: boolean): void
    commitHoverPreviewDelay(value: number): void
    setContentWidthPercent: Dispatch<SetStateAction<number>>
    commitContentWidth(value: number): void
    setThumbnailWidthPercent: Dispatch<SetStateAction<number>>
    commitThumbnailWidth(value: number): void
    setBannerWidthPercent: Dispatch<SetStateAction<number>>
    commitBannerWidth(value: number): void
    setSearchOpen: Dispatch<SetStateAction<boolean>>
    updateFilter(filter: ReaderDirectoryFilterDto): Promise<void>
    updateHiddenFolders(showHiddenFolders: boolean): Promise<void>
    updateMissingEfuEntries(hideMissingEfuEntries: boolean): Promise<void>
    updatePenetration(patch: Partial<ReaderFolderPenetrationConfig>): Promise<void>
    toggleTree(): void
    switchTreeLayout(layout: ReaderFolderTreeLayout): void
    toggleInlineTree(): void
    toggleMultiSelectMode(): void
    setDeleteMode: Dispatch<SetStateAction<boolean>>
    setDeleteStrategy: Dispatch<SetStateAction<FolderDeleteStrategy>>
    updateSortPreference(command: ReaderDirectorySortPreferenceCommandDto): Promise<void>
    refreshVisibleThumbnails(): Promise<void>
    refreshSelectedThumbnails(): Promise<void>
    cancelThumbnailRefresh(): void
    setSelection: Dispatch<SetStateAction<DirectorySelectionModel>>
    setFocusedIndex: Dispatch<SetStateAction<number | undefined>>
    setFocusedPath: Dispatch<SetStateAction<string | undefined>>
    setChainSelectMode: Dispatch<SetStateAction<boolean>>
    setCheckModeClickBehavior: Dispatch<SetStateAction<"open" | "select">>
    setMultiSelectMode: Dispatch<SetStateAction<boolean>>
    retryLastOperation(): void
    commitTreeSize(size: number): void
    applySearchListing(update: FolderSearchListingUpdate): void
    closeSearchChrome(): void
    requestRange(range: ListRange): void
    handleDirectoryKeyDown: React.KeyboardEventHandler<HTMLDivElement>
    selectEntry: React.ComponentProps<typeof DirectoryListItem>["onSelect"]
    emptyAreaHandlers: ReturnType<typeof useFolderEmptyAreaNavigation>
  }
}

export function FolderBrowserPaneView({ runtime, state, refs, actions }: FolderBrowserPaneViewProps) {
  const {
    client, disabled, active, sourcePath, browserPath, tabBar, folderTabCount, maxFolderTabs,
    onCreateTab, onOpenInNewTab, onOpenEfuInNewTab, onOpenSearchInNewTab, onOpen,
    onPrepareFileMutation, pickEfuFile, systemActions, switchToast, onFolderView,
  } = runtime
  const {
    catalog, folderView, selection, selectedPaths, viewMode, previewGridEnabled, previewCount,
    contentWidthPercent, thumbnailWidthPercent, bannerWidthPercent, hoverPreviewEnabled,
    hoverPreviewDelayMs, penetration, penetrationDescriptions, multiSelectMode, chainSelectMode,
    checkModeClickBehavior, deleteMode, deleteStrategy, activeDeleteConfirmation, confirmations,
    restoreState, restoreIndex, shouldLocateRestore, thumbnailStore,
    thumbnailRefreshPending, loading, error, searchOpen, treeOpen, inlineTreeOpen, treeLayout,
    treeSize, renameRequest, focusedPath, focusedIndex, focusedItemId, itemIdPrefix, clipboard, canRetry,
    sessionId, searchRootPath, pendingSearchSnapshot,
  } = state
  const {
    catalogRef, focusedIndexRef, chainAnchorIndexRef, listRef, gridRef, mosaicRef, listHostRef,
    detailsScrollTopRef, gridSnapshotRef, gridScrollTopRef, mosaicScrollTopRef,
  } = refs
  const {
    navigate, applyWatchedPage, setError, activate, enterRawDirectory, commitCatalog, updateSort,
    refreshThumbnails, setRenameRequest, switchView, togglePreviewGrid, switchPreviewCount,
    commitHoverPreviewEnabled, commitHoverPreviewDelay, setContentWidthPercent, commitContentWidth,
    setThumbnailWidthPercent, commitThumbnailWidth, setBannerWidthPercent, commitBannerWidth,
    setSearchOpen, updateFilter, updateHiddenFolders, updateMissingEfuEntries, updatePenetration,
    toggleTree, switchTreeLayout, toggleInlineTree, toggleMultiSelectMode, setDeleteMode,
    setDeleteStrategy, updateSortPreference, refreshVisibleThumbnails, refreshSelectedThumbnails,
    cancelThumbnailRefresh, setSelection, setFocusedIndex, setFocusedPath, setChainSelectMode, setCheckModeClickBehavior,
    setMultiSelectMode, retryLastOperation, commitTreeSize, applySearchListing, closeSearchChrome,
    requestRange, handleDirectoryKeyDown, selectEntry, emptyAreaHandlers,
  } = actions
  const selectedCount = catalog ? directorySelectionCount(selection, catalog.total) : 0
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const publishSize = () => rootRef.current?.setAttribute("data-thumbnail-cache-size", String(thumbnailStore.size()))
    publishSize()
    return thumbnailStore.subscribeAll(publishSize)
  }, [thumbnailStore])
  // A generation identifies fresh listing data, not a new browser visit. Keep the
  // renderer mounted while refreshing/back-forwarding the same navigation entry so
  // Virtuoso/Niko can retain its viewport and existing thumbnail DOM.
  const virtualKey = catalog ? `${catalog.sessionId}:${catalog.navigationEntryId}:${viewMode}:${previewCount}` : `${viewMode}:${previewCount}`
  const tabLayout = folderView.tabs ?? DEFAULT_FOLDER_VIEW.tabs!
  const searchListingActive = isVirtualSearchPath(catalog?.path)
  const efuListingActive = catalog?.sourceKind === "efu"
  const treeVisible = treeOpen && !efuListingActive
  const inlineTreeVisible = inlineTreeOpen && !efuListingActive
  const showReturnFooter = folderView.emptyArea.showBackButton && !searchListingActive
  const folderTitleWrap = folderView.titleWrap ?? DEFAULT_FOLDER_TITLE_WRAP
  const wrapTitle = resolveFolderTitleWrap(folderTitleWrap, viewMode)
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

  return (
    <FolderEntryDisplayProvider value={folderView.tagDisplay ?? DEFAULT_FOLDER_TAG_DISPLAY}>
      <div
        ref={rootRef}
        className="relative flex h-full min-h-0 min-w-0 w-full flex-1 gap-2"
        data-neoview-folder-card={active || null}
        data-neoview-folder-pane={true}
        data-folder-breadcrumb-position={tabLayout.breadcrumbPosition}
        data-folder-toolbar-position={tabLayout.toolbarPosition}
        data-folder-tab-position={tabLayout.layout}
        data-folder-view-mode={viewMode}
        data-folder-inline-tree={inlineTreeVisible || null}
        data-folder-source-kind={catalog?.sourceKind}
        data-selection-count={selectedCount}
        data-selection-total={catalog?.total ?? 0}
        data-thumbnail-cache-size={thumbnailStore.size()}
        data-restored-thumbnail-cache-size={restoreState?.thumbnailUrls?.size ?? 0}
        data-selection-all={selection.allSelected || null}
        data-folder-delete-mode={deleteMode || null}
        data-folder-delete-strategy={deleteStrategy}
        data-folder-delete-confirm={activeDeleteConfirmation}
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
              currentSourceKind={catalog?.sourceKind}
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
              onPrepareFileMutation={onPrepareFileMutation}
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
              onDeleteStarted={(entry) => {
                const current = catalogRef.current
                if (!current) return
                const removedIndex = directoryEntryIndex(current, entry.path)
                if (removedIndex === undefined) return
                const next = removeDirectoryCatalogEntry(current, entry.path)
                commitCatalog(next)
                let nextIndex = sourcePath ? directoryEntryIndex(next, sourcePath) : undefined
                if (nextIndex === undefined && focusedPath) nextIndex = directoryEntryIndex(next, focusedPath)
                const nearestEntry = nextIndex === undefined ? nearestLoadedDirectoryEntry(next, removedIndex) : undefined
                nextIndex ??= nearestEntry?.index
                const nextEntry = nearestEntry?.entry ?? (nextIndex === undefined ? undefined : directoryEntryAt(next, nextIndex))
                focusedIndexRef.current = nextIndex
                setFocusedIndex(nextIndex)
                setFocusedPath(nextEntry?.path)
                setSelection(nextEntry && nextIndex !== undefined
                  ? selectDirectorySingle(next.generation, nextEntry.path, nextIndex)
                  : createDirectorySelection(next.generation))
              }}
              onDeleteFailed={(entry) =>
                navigate(
                  { action: "refresh" },
                  {
                    keepTree: true,
                    focusPath: sourcePath || entry.path,
                    preserveThumbnailCache: true,
                  },
                )
              }
              onTrashed={(entry) =>
                navigate(
                  { action: "refresh" },
                  {
                    keepTree: true,
                    // Keep the active Reader source selected when another entry is removed.
                    // If the source itself was removed, its missing path intentionally leaves
                    // the saved index in place so the next (or final previous) entry is focused.
                    focusPath: sourcePath || entry.path,
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
              confirmations={confirmations}
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
                  canGoUp={!efuListingActive && Boolean(catalog?.parentPath)}
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
                  hideMissingEfuEntries={catalog?.hideMissingEfuEntries ?? folderView.hideMissingEfuEntries ?? false}
                  canHideMissingEfuEntries={efuListingActive}
                  tagDisplay={folderView.tagDisplay ?? DEFAULT_FOLDER_TAG_DISPLAY}
                  titleWrap={folderTitleWrap}
                  penetration={penetration}
                  treeOpen={treeVisible}
                  treeLayout={treeLayout}
                  canTree={!efuListingActive && Boolean(client.treeDirectoryBrowser)}
                  inlineTreeOpen={inlineTreeVisible}
                  multiSelectMode={multiSelectMode}
                  deleteMode={deleteMode}
                  deleteStrategy={deleteStrategy}
                  confirmations={confirmations}
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
                  canImportEfu={Boolean(pickEfuFile) && folderTabCount < maxFolderTabs}
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
                  onChangeHideMissingEfuEntries={(hideMissingEfuEntries) => {
                    void updateMissingEfuEntries(hideMissingEfuEntries)
                  }}
                  onTagDisplayChange={(tagDisplay) => {
                    void onFolderView?.({ tagDisplay })
                  }}
                  onTitleWrapChange={(titleWrap) => {
                    void onFolderView?.({ titleWrap })
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
                  onConfirmationChange={(patch) => {
                    void onFolderView?.({ confirmations: patch })
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
                  onImportEfu={() => {
                    void pickEfuFile?.().then((path) => {
                      if (path) onOpenEfuInNewTab(path)
                    })
                  }}
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
                    canPasteToCurrentDirectory={!efuListingActive}
                    disabled={disabled || loading}
                    switchToast={switchToast}
                    confirmations={confirmations}
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
                  {canRetry ? (
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
                    gridTemplateColumns: !treeVisible
                      ? "1fr"
                      : treeLayout === "left"
                        ? "min(var(--folder-tree-size), 50%) 1fr"
                        : treeLayout === "right"
                          ? "1fr min(var(--folder-tree-size), 50%)"
                          : "1fr",
                    gridTemplateRows: !treeVisible
                      ? undefined
                      : treeLayout === "top"
                        ? "var(--folder-tree-size) minmax(0, 1fr)"
                        : treeLayout === "bottom"
                          ? "minmax(0, 1fr) var(--folder-tree-size)"
                          : "minmax(0, 1fr)",
                  } as CSSProperties
                }
                data-tree-layout={treeVisible ? treeLayout : undefined}
              >
                {treeVisible && sessionId && catalog ? (
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
                      sessionId={sessionId}
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
                      order: treeVisible && (treeLayout === "right" || treeLayout === "bottom") ? 0 : 1,
                      "--folder-grid-width": `${viewUsesBanner(viewMode) ? bannerWidthPercent : thumbnailWidthPercent}%`,
                    } as CSSProperties
                  }
                  data-neoview-folder-list-shell="true"
                  data-folder-search-open={searchOpen || undefined}
                  data-folder-search-listing={searchListingActive || undefined}
                >
                  {searchOpen && sessionId ? (
                    <Suspense fallback={<div className="h-16 animate-pulse bg-muted/30" aria-label="正在加载搜索" />}>
                      <FolderSearchPanel
                        client={client}
                        sessionId={sessionId}
                        disabled={disabled}
                        settings={folderView.search}
                        rootPath={
                          searchRootPath
                          ?? (catalog && !isVirtualSearchPath(catalog.path) ? catalog.path : undefined)
                          ?? browserPath
                        }
                        tabCount={folderTabCount}
                        maxTabs={maxFolderTabs}
                        initialSnapshot={pendingSearchSnapshot}
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
                    role={inlineTreeVisible ? undefined : "listbox"}
                    aria-label={searchListingActive ? "搜索结果" : "文件项目"}
                    aria-activedescendant={inlineTreeVisible ? undefined : focusedItemId}
                    tabIndex={inlineTreeVisible ? -1 : 0}
                    onKeyDown={inlineTreeVisible ? undefined : handleDirectoryKeyDown}
                    {...(inlineTreeVisible ? {} : emptyAreaHandlers)}
                  >
                  {inlineTreeVisible && sessionId && catalog ? (
                    <Suspense fallback={<div className="h-72 animate-pulse bg-muted/30" aria-label="正在加载内联文件树" />}>
                      <FolderTreePanel
                        client={client}
                        sessionId={sessionId}
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
                  {!inlineTreeVisible && catalog && catalog.total > 0 && viewUsesVirtuosoList(viewMode) ? (
                    <Virtuoso
                      key={virtualKey}
                      ref={listRef}
                      style={{ height: "100%" }}
                      totalCount={catalog.total}
                      components={showReturnFooter ? FOLDER_LIST_COMPONENTS : EMPTY_VIRTUOSO_COMPONENTS}
                      context={showReturnFooter ? returnFooterContext : undefined}
                      fixedItemHeight={wrapTitle ? undefined : viewMode === "compact" ? 34 : 76}
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
                            wrapTitle={wrapTitle}
                            thumbnailStore={thumbnailStore}
                            contentWidthPercent={contentWidthPercent}
                            hoverPreviewEnabled={active && hoverPreviewEnabled}
                            hoverPreviewDelayMs={hoverPreviewDelayMs}
                            penetrationFiles={entry ? penetrationDescriptions.get(entry.path) : undefined}
                            deleteMode={deleteMode}
                            deleteStrategy={deleteStrategy}
                            confirmDelete={activeDeleteConfirmation}
                            onSelect={selectEntry}
                          />
                        )
                      }}
                    />
                  ) : null}
                  {!inlineTreeVisible && catalog && viewMode === "details" ? (
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
                        wrapTitle={wrapTitle}
                        deleteMode={deleteMode}
                        deleteStrategy={deleteStrategy}
                        confirmDelete={activeDeleteConfirmation}
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
                  {!inlineTreeVisible && catalog && catalog.total > 0 && viewUsesFixedGrid(viewMode) ? (
                    <Suspense fallback={<div className="h-72 animate-pulse bg-muted/30" aria-label="正在加载网格视图" />}>
                      <FolderGridWorkspace
                        virtualKey={virtualKey}
                        gridRef={gridRef}
                        catalog={catalog}
                        viewMode={viewMode}
                        wrapTitle={wrapTitle}
                        disabled={disabled}
                        selectedPaths={selectedPaths}
                        focusedIndex={focusedIndex}
                        itemIdPrefix={itemIdPrefix}
                        thumbnailStore={thumbnailStore}
                        hoverPreviewEnabled={active && hoverPreviewEnabled}
                        hoverPreviewDelayMs={hoverPreviewDelayMs}
                        penetrationFiles={penetrationDescriptions}
                        deleteMode={deleteMode}
                        deleteStrategy={deleteStrategy}
                        confirmDelete={activeDeleteConfirmation}
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
                  {!inlineTreeVisible && catalog && catalog.total > 0 && viewUsesMosaicGrid(viewMode) ? (
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
                        thumbnailStore={thumbnailStore}
                        tileSize={thumbnailPixelSize(thumbnailWidthPercent)}
                        wrapTitle={wrapTitle}
                        hoverPreviewEnabled={active && hoverPreviewEnabled}
                        hoverPreviewDelayMs={hoverPreviewDelayMs}
                        penetrationFiles={penetrationDescriptions}
                        deleteMode={deleteMode}
                        deleteStrategy={deleteStrategy}
                        confirmDelete={activeDeleteConfirmation}
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
                  {!inlineTreeVisible && catalog && catalog.total === 0 ? (
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
