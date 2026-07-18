import type { FrameSnapshot, PageDimensions, PageMediaKind, PageMode, ReaderFitMode, ViewSource } from "@xiranite/node-neoview/ui-core"
import type { ReaderColorFilterPatch, ReaderColorFilterSettings } from "@xiranite/node-neoview/color-filter"
import { resolveLocalBackendConfig, type LocalBackendConfig } from "@/backend/localBackendConfig"

export interface ReaderPageDto {
  id: string
  index: number
  name: string
  mediaKind: PageMediaKind
  mimeType?: string
  byteLength?: number
  dimensions?: PageDimensions
  contentVersion: string
  assetUrl: string
  thumbnailUrl?: string
}

export interface ReaderSessionDto {
  sessionId: string
  book: { id: string; displayName: string; pageCount: number }
  frame: FrameSnapshot
  visiblePages: ReaderPageDto[]
}

export interface ReaderNavigationDto {
  frame: FrameSnapshot
  visiblePages: ReaderPageDto[]
}

export interface ReaderBookSettingsSnapshotDto {
  schemaVersion: 1
  bookId: string
  revision: number
  updatedAt?: number
  overrides: Partial<ReaderBookSettingsValuesDto>
  effective: ReaderBookSettingsValuesDto
  inherited: ReaderBookSettingsKeyDto[]
}

export interface ReaderBookSettingsValuesDto {
  favorite: boolean
  rating: number
  direction: "left-to-right" | "right-to-left"
  pageMode: "single" | "double"
  horizontalBook: boolean
}

export type ReaderBookSettingsKeyDto = keyof ReaderBookSettingsValuesDto
export type ReaderBookSettingsPatchDto = Partial<{ [Key in ReaderBookSettingsKeyDto]: ReaderBookSettingsValuesDto[Key] | null }>

export interface ReaderBookSettingsUpdateDto extends ReaderNavigationDto {
  settings: ReaderBookSettingsSnapshotDto
}

export interface ReaderPageListDto {
  pages: ReaderPageDto[]
  nextCursor?: number
  total: number
}

export interface ReaderPageCopyActionDto {
  path: string
  leaseToken?: string
  expiresAt?: number
}

export type ReaderFileMutationDto =
  | { kind: "copy" | "move" | "rename"; sourcePath: string; destinationPath: string; overwrite?: boolean }
  | { kind: "delete" | "trash"; sourcePath: string }
  | { kind: "create-directory"; destinationPath: string }

export interface ReaderFileOperationResultDto {
  index: number
  operation: ReaderFileMutationDto
  status: "succeeded" | "failed" | "cancelled"
  errorCode?: string
  error?: string
}

export interface ReaderFileOperationBatchResultDto {
  results: ReaderFileOperationResultDto[]
  succeeded: number
  failed: number
  cancelled: number
  undoable: number
  undoId?: string
  undoPersisted?: boolean
}

export interface ReaderDirectorySelectionDescriptorDto {
  generation: number
  allSelected: boolean
  ranges: readonly { start: number; end: number }[]
  explicit: readonly { path: string; index?: number }[]
}

export interface ReaderDirectorySelectionOperationSnapshotDto {
  id: string
  kind: "copy" | "move" | "delete" | "trash"
  destinationPath?: string
  status: "running" | "completed" | "cancelled" | "failed"
  generation: number
  total: number
  processed: number
  succeeded: number
  failed: number
  cancelled: number
  failureSamples: readonly ReaderFileOperationResultDto[]
  failureSamplesTruncated: boolean
  startedAt: number
  completedAt?: number
  error?: string
}

export type ReaderDirectoryClipboardSnapshotDto =
  | { available: false }
  | { available: true; mode: "copy" | "move"; generation: number; total: number; createdAt: number }

export interface ReaderMetadataDto {
  book: {
    bookId: string
    displayName: string
    sourceKind: "path" | "directory" | "archive" | "image" | "media" | "document"
    sourceFormat?: "pdf" | "epub"
    sourcePath: string
    pageCount: number
    currentPage: number
    progressPercent?: number
    emm?: { translatedTitle?: string }
    byteLength?: number
    createdAtMs?: number
    modifiedAtMs?: number
    accessedAtMs?: number
  }
  page?: {
    index: number
    name: string
    displayPath: string
    mediaKind: PageMediaKind
    mimeType?: string
    byteLength?: number
    dimensions?: PageDimensions
    timeSource?: "filesystem" | "archive-entry" | "book-source"
    createdAtMs?: number
    modifiedAtMs?: number
    accessedAtMs?: number
  }
}

export interface ReaderPageMediaInformationDto {
  pageId: string
  contentVersion: string
  mediaKind: PageMediaKind
  durationSeconds?: number
  frameRate?: number
  bitRateBps?: number
  videoCodec?: string
  audioCodec?: string
}

export interface ReaderStorageDiagnosticsDto {
  schemaVersion: 1
  reader?: {
    activeSessions: number
    preload?: {
      sessions: number
      candidates: { near: number; ahead: number; background: number }
      active: number
      plannedCandidates: number
      started: number
      ready: number
      failed: number
      cancelled: number
      evicted: number
    }
    sessionPreload?: {
      generation?: number
      pages: readonly {
        pageIndex: number
        outcome: "started" | "ready" | "failed" | "cancelled" | "evicted"
      }[]
    }
  }
  assets: {
    presentation: {
      entries?: number
      bytes: number
      maxBytes?: number
      activeLeases?: number
    } | null
    thumbnails: { cachedBytes: number } | null
  }
  presentationDiskCache: { enabled: boolean; bytes?: number }
  solidArchiveCache: { retainedBytes: number }
}

export type ReaderPreloadActionDto = "cancel-speculative" | "release-retained"

export interface ReaderPreloadActionResultDto {
  action: ReaderPreloadActionDto
  generation: number
  cancelled: number
  released: number
  visibleRetained: number
}

export interface ReaderThumbnailWriterSnapshotDto {
  pendingWrites: number
  flushing: boolean
  committedBatches: number
  committedWrites: number
  busyRetries: number
  failedBatches: number
  lastError?: string
}

export interface ReaderThumbnailMaintenanceSnapshotDto {
  totalRows: number
  fileRows: number
  folderRows: number
  blobBytes: number
  emptyBlobs: number
  failedRows: number
  failuresByReason: Readonly<Record<string, number>>
  databaseBytes?: number
  walBytes?: number
  shmBytes?: number
  writer: ReaderThumbnailWriterSnapshotDto
}

export type ReaderThumbnailCleanupCommandDto =
  | { kind: "empty"; limit?: number }
  | { kind: "expired"; days: number; limit?: number; preserveFolders: true }
  | { kind: "invalid"; scanLimit?: number; limit?: number }

export type ReaderThumbnailCleanupResultDto =
  | { kind: "empty"; deleted: number }
  | { kind: "expired"; deleted: number; cutoff: string }
  | { kind: "invalid"; scanned: number; deleted: number; unavailableVolumeRowsPreserved: number; wrapped: boolean }

export interface ReaderRecentDto {
  bookId: string
  source: ViewSource
  displayName: string
  pageIndex: number
  pageCount: number
  updatedAt: number
}

export interface ReaderRecentBatchRemoveResultDto {
  deleted: number
  missingIds: readonly string[]
}

export type ReaderRecentCleanupRequestDto =
  | { kind: "oldest"; limit: number }
  | { kind: "before"; before: number; limit?: number }
  | { kind: "folder"; path: string }
  | { kind: "all"; confirmed: true }

export interface ReaderRecentCleanupResultDto {
  deleted: number
  selectedIds?: readonly string[]
  missingIds?: readonly string[]
}

export interface ReaderInvalidLibraryCleanupResultDto {
  kind: "recents" | "bookmarks" | "both"
  scanned: number
  missing: number
  unknown: number
  deleted: number
  truncated: boolean
}

export interface ReaderBookmarkDto {
  id: string
  source: ViewSource
  name: string
  kind: "file" | "folder"
  starred: boolean
  createdAt: number
  updatedAt: number
  listIds: readonly string[]
}

export interface ReaderBookmarkListDto {
  id: string
  name: string
  isFavorite: boolean
  createdAt: number
  updatedAt: number
  system?: boolean
}

export interface SaveReaderBookmarkDto {
  id?: string
  source: ViewSource
  name: string
  kind?: "file" | "folder"
  starred?: boolean
  createdAt?: number
  listIds?: readonly string[]
}

export interface UpdateReaderBookmarkDto {
  starred?: boolean
  listIds?: readonly string[]
}

export interface ReaderBookmarkBatchUpdateDto extends UpdateReaderBookmarkDto {
  id: string
}

export interface ReaderBookmarkBatchResultDto {
  items: readonly ReaderBookmarkDto[]
  missingIds: readonly string[]
}

export interface ReaderBookmarkBatchRemoveResultDto {
  deleted: number
  missingIds: readonly string[]
}

export interface ReaderDirectoryEntryDto {
  name: string
  path: string
  kind: "directory" | "file" | "other"
  readerSupported: boolean
  modifiedAt?: number
  size?: number
  rating?: number
  collectTagCount?: number
  width?: number
  height?: number
  pageCount?: number
  tags?: readonly string[]
}

export type ReaderDirectorySortFieldDto = "name" | "date" | "size" | "type" | "random" | "rating" | "path" | "collectTagCount"
export type ReaderDirectoryMetadataFieldDto =
  | "date"
  | "size"
  | "rating"
  | "collectTagCount"
  | "dimensions"
  | "pageCount"
  | "tags"
export type ReaderDirectorySortOrderDto = "asc" | "desc"

export interface ReaderDirectorySortDto {
  field: ReaderDirectorySortFieldDto
  order: ReaderDirectorySortOrderDto
  directoriesFirst: boolean
}

export type ReaderDirectorySortSourceDto = "temporary" | "memory" | "tab-default" | "global-default"
export type ReaderDirectorySortPreferenceCommandDto =
  | { action: "temporary"; enabled: boolean }
  | { action: "set-default"; scope: "global" | "tab" }
  | { action: "clear-memory"; scope: "current" | "all" }

export interface ReaderDirectoryPageDto {
  sessionId: string
  navigationEntryId: number
  path: string
  parentPath?: string
  entries: ReaderDirectoryEntryDto[]
  cursor: number
  nextCursor?: number
  total: number
  canGoBack: boolean
  canGoForward: boolean
  generation: number
  filter?: ReaderDirectoryFilterDto
  filterOptions?: ReaderDirectoryFilterDto[]
  sort: ReaderDirectorySortDto
  sortFields: ReaderDirectorySortFieldDto[]
  metadataFields: ReaderDirectoryMetadataFieldDto[]
  metadataCapabilities?: ReaderDirectoryMetadataFieldDto[]
  sortSource: ReaderDirectorySortSourceDto
  sortTemporary: boolean
  globalDefaultSort: ReaderDirectorySortDto
  tabDefaultSort: ReaderDirectorySortDto
  suggestedSelection?: { path: string; index: number }
  watching: boolean
  watchError?: string
}

export type ReaderDirectorySearchModeDto = "text" | "glob"
export type ReaderDirectorySearchKindDto = "all" | "file" | "directory"

export interface ReaderDirectorySearchOptionsDto {
  mode?: ReaderDirectorySearchModeDto
  kind?: ReaderDirectorySearchKindDto
  caseSensitive?: boolean
  searchInPath?: boolean
  maximumDepth?: number
  maximumResults?: number
  excludePatterns?: readonly string[]
  onEntries?: (entries: readonly ReaderDirectoryEntryDto[]) => void
}

export interface ReaderDirectorySearchResultDto {
  sessionId: string
  rootPath: string
  generation: number
  query: string
  mode: ReaderDirectorySearchModeDto
  entries: ReaderDirectoryEntryDto[]
  scanned: number
  matched: number
  truncated: boolean
}

export interface ReaderDirectoryTreePageDto {
  sessionId: string
  path: string
  parentPath?: string
  entries: ReaderDirectoryEntryDto[]
  generation: number
  cacheHit: boolean
  excludedPaths: string[]
}

export interface ReaderDirectoryTreeChangesDto {
  sessionId: string
  revision: number
  generation: number
  paths: string[]
  reset: boolean
  watchError?: string
}

export interface ReaderDirectoryRootDto {
  path: string
  label: string
  kind: "fixed" | "removable" | "network" | "optical" | "ramdisk" | "system" | "unknown"
  available: boolean
}

export type ReaderSearchHistoryScopeDto = "folder" | "file" | "bookmark" | "history"

export interface ReaderSearchHistoryDto {
  scope: ReaderSearchHistoryScopeDto
  query: string
  usedAt: number
  useCount: number
}

export interface ReaderLibraryThumbnailDto {
  id: string
  thumbnailUrl: string
  contentVersion: string
}

export interface ReaderLibraryThumbnailBatchDto {
  contextId: string
  generation: number
  items: ReaderLibraryThumbnailDto[]
}

export interface ReaderLibraryThumbnailRegistrationDto {
  id: string
  path: string
  kind: "file" | "folder"
  previewCount?: 1 | 4 | 9 | 16
  refresh?: boolean
}

export type ReaderDirectoryNavigationDto =
  | { action: "path"; path: string }
  | { action: "back" | "forward" | "up" | "refresh" }

export interface ReaderShellConfigDto {
  revision?: number
  showDelayMs: number
  hideDelayMs: number
  opacity: { top: number; bottom: number; sidebar: number }
  blur: { top: number; bottom: number; sidebar: number }
  edges: Record<ReaderShellEdge, { enabled: boolean; initialVisible: boolean; pinned: boolean; triggerSize: number; lockMode?: ReaderShellLockMode }>
  floatingControl?: { enabled: boolean; position: { x: number; y: number } }
  sidebars: Record<"left" | "right", { width: number; height: "full" | "two-thirds" | "half" | "one-third" | "custom"; customHeight: number; verticalAlign: number; horizontalPosition: number }>
  panelLayout: Record<string, { visible: boolean; order: number; position: "left" | "right" | "bottom" | "floating" }>
  cardLayout: Record<string, { panelId: string; visible: boolean; expanded: boolean; order: number; height?: number }>
}

export type ReaderShellEdge = "top" | "right" | "bottom" | "left"
export type ReaderShellLockMode = "auto" | "locked-open" | "locked-hidden"

export interface ReaderHistoryListPreferencesDto {
  viewMode: "compact" | "content" | "banner" | "thumbnail"
}

export interface ReaderHistoryListPreferencesPatch {
  historyList: Partial<ReaderHistoryListPreferencesDto>
}

export interface ReaderBookmarkListPreferencesDto {
  activeListId: string
}

export interface ReaderBookmarkListPreferencesPatch {
  bookmarkList: Partial<ReaderBookmarkListPreferencesDto>
}

export interface ReaderPageListPreferencesDto {
  viewMode: "list" | "details" | "thumbnails"
  followProgress: boolean
}

export interface ReaderPageListPreferencesPatch {
  pageList: Partial<ReaderPageListPreferencesDto>
}

export interface ReaderRuntimeConfigDto {
  shell: ReaderShellConfigDto
  viewDefaults: { fitMode: ReaderFitMode; pageMode: PageMode }
  pageList: ReaderPageListPreferencesDto
  bookmarkList: ReaderBookmarkListPreferencesDto
  historyList: ReaderHistoryListPreferencesDto
  folderView: ReaderFolderViewConfig
  slideshow: ReaderSlideshowConfig
  colorFilter: ReaderColorFilterSettings
  inputBindings: ReaderInputBindingsConfig
  radialMenu: ReaderRadialMenuConfig
}

export type {
  ReaderInputAction,
  ReaderInputBinding,
  ReaderInputBindingsConfig,
  ReaderInputContext,
  ReaderInputDescriptor,
} from "@xiranite/node-neoview/ui-core"
import type { ReaderInputBindingsConfig, ReaderRadialMenuConfig } from "@xiranite/node-neoview/ui-core"

export interface ReaderInputBindingsPatch {
  inputBindings: { bindings?: ReaderInputBindingsConfig["bindings"]; reset?: "defaults" }
}

export type ReaderDirectoryFilterDto = "all" | "archive" | "directory" | "video"

export interface ReaderRadialMenuPatch {
  radialMenu: { config?: ReaderRadialMenuConfig; reset?: "defaults" }
}

export interface ReaderColorFilterConfigPatch {
  colorFilter: ReaderColorFilterPatch | { reset: "defaults" }
}

export type ReaderFolderViewMode = "compact" | "cover-list" | "mosaic-list" | "details" | "cover-grid" | "mosaic-grid"
export type ReaderFolderTreeLayout = "left" | "right" | "top" | "bottom"
export type ReaderFolderDetailColumn = "name" | "path" | "type" | "extension" | "size" | "modifiedAt" | "dimensions" | "pageCount" | "rating" | "tags"

export const READER_FOLDER_DETAIL_DEFAULT_WIDTHS: Record<ReaderFolderDetailColumn, number> = {
  name: 220,
  path: 280,
  type: 80,
  extension: 80,
  size: 96,
  modifiedAt: 152,
  dimensions: 96,
  pageCount: 72,
  rating: 72,
  tags: 180,
}

export interface ReaderFolderDetailsConfig {
  columnOrder: ReaderFolderDetailColumn[]
  hiddenColumns: ReaderFolderDetailColumn[]
  pinnedLeft: ReaderFolderDetailColumn[]
  pinnedRight: ReaderFolderDetailColumn[]
  columnWidths: Record<ReaderFolderDetailColumn, number>
}

export interface ReaderFolderSearchConfig {
  includeSubfolders: boolean
  showHistoryOnFocus: boolean
  searchInPath: boolean
}

export interface ReaderFolderTreeViewConfig {
  visible: boolean
  layout: ReaderFolderTreeLayout
  size: number
  pinnedPaths: string[]
}

export interface ReaderFolderPinnedTab {
  path: string
  title: string
}

export interface ReaderFolderTabsConfig {
  pinned: ReaderFolderPinnedTab[]
  layout: ReaderFolderRegionPosition
  width: number
  breadcrumbPosition: ReaderFolderRegionPosition
  toolbarPosition: ReaderFolderRegionPosition
}

export type ReaderFolderRegionPosition = "none" | "top" | "bottom" | "left" | "right"
export type ReaderFolderEmptyAreaAction = "none" | "goUp" | "goBack"

export interface ReaderFolderEmptyAreaConfig {
  singleClickAction: ReaderFolderEmptyAreaAction
  doubleClickAction: ReaderFolderEmptyAreaAction
  showBackButton: boolean
}

export interface ReaderFolderViewConfig {
  homePath: string
  viewMode: ReaderFolderViewMode
  previewCount: 4 | 9 | 16
  thumbnailWidthPercent: number
  bannerWidthPercent: number
  emptyArea: ReaderFolderEmptyAreaConfig
  details: ReaderFolderDetailsConfig
  search: ReaderFolderSearchConfig
  tree: ReaderFolderTreeViewConfig
  tabs?: ReaderFolderTabsConfig
}

export interface ReaderFolderDetailsPatch {
  columnOrder?: ReaderFolderDetailColumn[]
  hiddenColumns?: ReaderFolderDetailColumn[]
  pinnedLeft?: ReaderFolderDetailColumn[]
  pinnedRight?: ReaderFolderDetailColumn[]
  columnWidths?: Partial<Record<ReaderFolderDetailColumn, number>>
}

export interface ReaderFolderViewPatch {
  folderView: {
    homePath?: string
    viewMode?: ReaderFolderViewMode
    previewCount?: 4 | 9 | 16
    thumbnailWidthPercent?: number
    bannerWidthPercent?: number
    emptyArea?: Partial<ReaderFolderEmptyAreaConfig>
    details?: ReaderFolderDetailsPatch
    search?: Partial<ReaderFolderSearchConfig>
    tree?: Partial<ReaderFolderTreeViewConfig>
    tabs?: Partial<ReaderFolderTabsConfig>
  }
}

export interface ReaderViewDefaultsPatch {
  viewDefaults: { fitMode?: ReaderFitMode; pageMode?: PageMode }
}

export interface ReaderSlideshowConfig {
  intervalSeconds: number
  loop: boolean
  random: boolean
  fadeTransition: boolean
}

export interface ReaderSlideshowPatch {
  slideshow: Partial<ReaderSlideshowConfig>
}

export interface ReaderSidebarLayoutPatch {
  side: "left" | "right"
  pinned?: boolean
  width?: number
  height?: ReaderShellConfigDto["sidebars"]["left"]["height"]
  customHeight?: number
  verticalAlign?: number
  horizontalPosition?: number
}

export interface ReaderCardLayoutPatch {
  cardId: string
  panelId?: string
  visible?: boolean
  expanded?: boolean
  order?: number
  height?: number | null
}

export interface ReaderBoardLayoutPatch {
  expectedRevision: number
  board: {
    panels: Array<{ id: string; visible: boolean; order: number; position: ReaderShellConfigDto["panelLayout"][string]["position"] }>
    cards: Array<{ cardId: string; panelId: string; visible: boolean; order: number }>
  }
}

export interface ReaderShellControlPatch {
  expectedRevision: number
  shellControl: {
    floating?: { enabled?: boolean; position?: { x: number; y: number } }
    edges?: Partial<Record<ReaderShellEdge, {
      enabled?: boolean
      initialVisible?: boolean
      pinned?: boolean
      triggerSize?: number
      lockMode?: ReaderShellLockMode
    }>>
    reset?: "known-defaults"
  }
}

export interface ReaderHttpClient {
  config(signal?: AbortSignal): Promise<ReaderRuntimeConfigDto>
  updateSidebarLayout(patch: ReaderSidebarLayoutPatch, signal?: AbortSignal): Promise<ReaderShellConfigDto>
  updateCardLayout(patch: ReaderCardLayoutPatch, signal?: AbortSignal): Promise<ReaderShellConfigDto>
  updateBoardLayout(patch: ReaderBoardLayoutPatch, signal?: AbortSignal): Promise<ReaderShellConfigDto>
  updateShellControl?(patch: ReaderShellControlPatch, signal?: AbortSignal): Promise<ReaderShellConfigDto>
  updateViewDefaults(patch: ReaderViewDefaultsPatch, signal?: AbortSignal): Promise<ReaderRuntimeConfigDto["viewDefaults"]>
  updatePageList?(patch: ReaderPageListPreferencesPatch, signal?: AbortSignal): Promise<ReaderPageListPreferencesDto>
  updateBookmarkList?(patch: ReaderBookmarkListPreferencesPatch, signal?: AbortSignal): Promise<ReaderBookmarkListPreferencesDto>
  updateHistoryList?(patch: ReaderHistoryListPreferencesPatch, signal?: AbortSignal): Promise<ReaderHistoryListPreferencesDto>
  updateFolderView?(patch: ReaderFolderViewPatch, signal?: AbortSignal): Promise<ReaderFolderViewConfig>
  updateSlideshow(patch: ReaderSlideshowPatch, signal?: AbortSignal): Promise<ReaderSlideshowConfig>
  updateInputBindings?(patch: ReaderInputBindingsPatch, signal?: AbortSignal): Promise<ReaderInputBindingsConfig>
  updateRadialMenu?(patch: ReaderRadialMenuPatch, signal?: AbortSignal): Promise<ReaderRadialMenuConfig>
  updateColorFilter?(patch: ReaderColorFilterConfigPatch, signal?: AbortSignal): Promise<ReaderColorFilterSettings>
  open(path: string, signal?: AbortSignal): Promise<ReaderSessionDto>
  openAdjacentBook?(sessionId: string, direction: "next" | "previous", signal?: AbortSignal): Promise<ReaderSessionDto | undefined>
  openDirectoryBrowser?(path: string, signal?: AbortSignal, scopeId?: string, watch?: boolean): Promise<ReaderDirectoryPageDto>
  cloneDirectoryBrowser?(sessionId: string, signal?: AbortSignal): Promise<ReaderDirectoryPageDto>
  reopenDirectoryBrowser?(sessionId: string, signal?: AbortSignal): Promise<ReaderDirectoryPageDto>
  watchDirectoryBrowser?(sessionId: string, afterGeneration: number, focusPath?: string, signal?: AbortSignal): Promise<ReaderDirectoryPageDto | undefined>
  listDirectoryRoots?(signal?: AbortSignal): Promise<readonly ReaderDirectoryRootDto[]>
  listDirectoryBrowser?(
    sessionId: string,
    cursor: number,
    limit: number,
    signal?: AbortSignal,
    metadataFields?: readonly ReaderDirectoryMetadataFieldDto[],
  ): Promise<ReaderDirectoryPageDto>
  navigateDirectoryBrowser?(sessionId: string, navigation: ReaderDirectoryNavigationDto, signal?: AbortSignal, focusPath?: string): Promise<ReaderDirectoryPageDto>
  searchDirectoryBrowser?(
    sessionId: string,
    query: string,
    options?: ReaderDirectorySearchOptionsDto,
    signal?: AbortSignal,
  ): Promise<ReaderDirectorySearchResultDto>
  treeDirectoryBrowser?(sessionId: string, path?: string, refresh?: boolean, signal?: AbortSignal): Promise<ReaderDirectoryTreePageDto>
  watchDirectoryTreeBrowser?(sessionId: string, afterRevision: number, signal?: AbortSignal): Promise<ReaderDirectoryTreeChangesDto | undefined>
  listSearchHistory?(scope: ReaderSearchHistoryScopeDto, limit?: number, signal?: AbortSignal): Promise<readonly ReaderSearchHistoryDto[]>
  recordSearchHistory?(scope: ReaderSearchHistoryScopeDto, query: string, signal?: AbortSignal): Promise<ReaderSearchHistoryDto>
  removeSearchHistory?(scope: ReaderSearchHistoryScopeDto, query: string, signal?: AbortSignal): Promise<boolean>
  clearSearchHistory?(scope: ReaderSearchHistoryScopeDto, signal?: AbortSignal): Promise<number>
  filterDirectoryBrowser?(sessionId: string, filter: ReaderDirectoryFilterDto, focusPath?: string, signal?: AbortSignal): Promise<ReaderDirectoryPageDto>
  sortDirectoryBrowser?(sessionId: string, sort: ReaderDirectorySortDto, focusPath?: string, signal?: AbortSignal): Promise<ReaderDirectoryPageDto>
  updateDirectorySortPreference?(
    sessionId: string,
    command: ReaderDirectorySortPreferenceCommandDto,
    focusPath?: string,
    signal?: AbortSignal,
  ): Promise<ReaderDirectoryPageDto>
  closeDirectoryBrowser?(sessionId: string, remember?: boolean): Promise<void>
  registerLibraryThumbnails?(
    contextId: string,
    generation: number,
    items: readonly ReaderLibraryThumbnailRegistrationDto[],
    signal?: AbortSignal,
  ): Promise<ReaderLibraryThumbnailBatchDto>
  releaseLibraryThumbnailContext?(contextId: string): Promise<void>
  listPages(sessionId: string, cursor: number, limit: number, signal?: AbortSignal): Promise<ReaderPageListDto>
  bookSettings?(sessionId: string, signal?: AbortSignal): Promise<ReaderBookSettingsSnapshotDto>
  updateBookSettings?(sessionId: string, expectedRevision: number, patch: ReaderBookSettingsPatchDto, signal?: AbortSignal): Promise<ReaderBookSettingsUpdateDto>
  listPageCatalog?(sessionId: string, cursor: number, limit: number, options: { query?: string; thumbnails?: boolean }, signal?: AbortSignal): Promise<ReaderPageListDto>
  pageAction?(sessionId: string, pageId: string, action: "copy" | "reveal" | "open", signal?: AbortSignal): Promise<ReaderPageCopyActionDto | void>
  releasePageActionLease?(sessionId: string, leaseToken: string): Promise<void>
  metadata?(sessionId: string, signal?: AbortSignal): Promise<ReaderMetadataDto>
  pageMediaInformation?(sessionId: string, signal?: AbortSignal): Promise<ReaderPageMediaInformationDto>
  diagnostics?(signal?: AbortSignal): Promise<ReaderStorageDiagnosticsDto>
  preloadDiagnostics?(sessionId: string, signal?: AbortSignal): Promise<ReaderStorageDiagnosticsDto>
  runPreloadAction?(sessionId: string, action: ReaderPreloadActionDto, signal?: AbortSignal): Promise<ReaderPreloadActionResultDto>
  thumbnailMaintenance?(signal?: AbortSignal): Promise<ReaderThumbnailMaintenanceSnapshotDto>
  cleanupThumbnails?(command: ReaderThumbnailCleanupCommandDto, signal?: AbortSignal): Promise<ReaderThumbnailCleanupResultDto>
  clearThumbnailFailures?(limit?: number, signal?: AbortSignal): Promise<number>
  openSystemPath?(path: string, signal?: AbortSignal): Promise<void>
  revealSystemPath?(path: string, signal?: AbortSignal): Promise<void>
  executeFileOperations?(operations: readonly ReaderFileMutationDto[], confirmed?: boolean, signal?: AbortSignal): Promise<ReaderFileOperationBatchResultDto>
  startDirectorySelectionOperation?(
    sessionId: string,
    selection: ReaderDirectorySelectionDescriptorDto,
    kind: "delete" | "trash",
    signal?: AbortSignal,
  ): Promise<ReaderDirectorySelectionOperationSnapshotDto>
  directorySelectionOperation?(id: string, signal?: AbortSignal): Promise<ReaderDirectorySelectionOperationSnapshotDto>
  cancelDirectorySelectionOperation?(id: string, signal?: AbortSignal): Promise<ReaderDirectorySelectionOperationSnapshotDto & { cancelRequested: boolean }>
  prepareDirectoryClipboard?(
    sessionId: string,
    selection: ReaderDirectorySelectionDescriptorDto,
    mode: "copy" | "move",
    signal?: AbortSignal,
  ): Promise<ReaderDirectoryClipboardSnapshotDto>
  directoryClipboard?(signal?: AbortSignal): Promise<ReaderDirectoryClipboardSnapshotDto>
  pasteDirectoryClipboard?(destinationPath: string, signal?: AbortSignal): Promise<ReaderDirectorySelectionOperationSnapshotDto>
  clearDirectoryClipboard?(signal?: AbortSignal): Promise<ReaderDirectoryClipboardSnapshotDto>
  listRecent?(offset: number, limit: number, signal?: AbortSignal): Promise<readonly ReaderRecentDto[]>
  removeRecent?(bookId: string, signal?: AbortSignal): Promise<void>
  removeRecents?(ids: readonly string[], signal?: AbortSignal): Promise<ReaderRecentBatchRemoveResultDto>
  cleanupRecents?(request: ReaderRecentCleanupRequestDto, signal?: AbortSignal): Promise<ReaderRecentCleanupResultDto>
  cleanupInvalidLibrary?(kind: "recents" | "bookmarks" | "both", signal?: AbortSignal): Promise<ReaderInvalidLibraryCleanupResultDto>
  listBookmarks?(offset: number, limit: number, listId?: string, signal?: AbortSignal): Promise<readonly ReaderBookmarkDto[]>
  findBookmarkByPath?(path: string, signal?: AbortSignal): Promise<ReaderBookmarkDto | undefined>
  saveBookmark?(bookmark: SaveReaderBookmarkDto, signal?: AbortSignal): Promise<ReaderBookmarkDto>
  updateBookmark?(id: string, patch: UpdateReaderBookmarkDto, signal?: AbortSignal): Promise<ReaderBookmarkDto>
  updateBookmarks?(updates: readonly ReaderBookmarkBatchUpdateDto[], signal?: AbortSignal): Promise<ReaderBookmarkBatchResultDto>
  removeBookmark?(id: string, signal?: AbortSignal): Promise<void>
  removeBookmarks?(ids: readonly string[], signal?: AbortSignal): Promise<ReaderBookmarkBatchRemoveResultDto>
  listBookmarkLists?(signal?: AbortSignal): Promise<readonly ReaderBookmarkListDto[]>
  saveBookmarkList?(list: { id?: string; name: string; isFavorite?: boolean; createdAt?: number }, signal?: AbortSignal): Promise<ReaderBookmarkListDto>
  removeBookmarkList?(id: string, signal?: AbortSignal): Promise<void>
  navigate(sessionId: string, action: "next" | "previous", signal?: AbortSignal): Promise<ReaderNavigationDto>
  goTo(sessionId: string, pageIndex: number, signal?: AbortSignal): Promise<ReaderNavigationDto>
  updateSessionOptions(sessionId: string, patch: { direction?: FrameSnapshot["direction"]; layout?: { pageMode: PageMode } }, signal?: AbortSignal): Promise<ReaderNavigationDto>
  close(sessionId: string): Promise<void>
}

export class ReaderHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = "ReaderHttpError"
  }
}

export function createReaderHttpClient(
  resolveConfig: () => LocalBackendConfig = resolveLocalBackendConfig,
): ReaderHttpClient {
  const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const config = resolveConfig()
    const url = new URL(path, config.baseUrl)
    const headers = new Headers(init.headers)
    if (config.token) headers.set("x-xiranite-token", config.token)
    const response = await fetch(url, { ...init, headers, cache: "no-store" })
    if (!response.ok) throw new ReaderHttpError(await responseError(response), response.status)
    if (response.status === 204) return undefined as T
    return await response.json() as T
  }

  return {
    config: (signal) => request<ReaderRuntimeConfigDto>("/reader/config", { signal }),
    updateSidebarLayout: (patch, signal) => request<{ shell: ReaderShellConfigDto }>("/reader/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      signal,
    }).then((value) => value.shell),
    updateCardLayout: (patch, signal) => request<{ shell: ReaderShellConfigDto }>("/reader/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      signal,
    }).then((value) => value.shell),
    updateBoardLayout: (patch, signal) => request<{ shell: ReaderShellConfigDto }>("/reader/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      signal,
    }).then((value) => value.shell),
    updateShellControl: (patch, signal) => request<{ shell: ReaderShellConfigDto }>("/reader/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      signal,
    }).then((value) => value.shell),
    updateViewDefaults: (patch, signal) => request<ReaderRuntimeConfigDto>("/reader/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      signal,
    }).then((value) => value.viewDefaults),
    updateHistoryList: (patch, signal) => request<ReaderRuntimeConfigDto>("/reader/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      signal,
    }).then((value) => value.historyList),
    updateBookmarkList: (patch, signal) => request<ReaderRuntimeConfigDto>("/reader/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      signal,
    }).then((value) => value.bookmarkList),
    updatePageList: (patch, signal) => request<ReaderRuntimeConfigDto>("/reader/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      signal,
    }).then((value) => value.pageList),
    updateFolderView: (patch, signal) => request<ReaderRuntimeConfigDto>("/reader/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      signal,
    }).then((value) => value.folderView),
    updateSlideshow: (patch, signal) => request<ReaderRuntimeConfigDto>("/reader/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      signal,
    }).then((value) => value.slideshow),
    updateInputBindings: (patch, signal) => request<ReaderRuntimeConfigDto>("/reader/config", {
      method: "PATCH",
      body: JSON.stringify(patch),
      signal,
    }).then((value) => value.inputBindings),
    updateRadialMenu: (patch, signal) => request<ReaderRuntimeConfigDto>("/reader/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      signal,
    }).then((value) => value.radialMenu),
    updateColorFilter: (patch, signal) => request<ReaderRuntimeConfigDto>("/reader/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      signal,
    }).then((value) => value.colorFilter),
    open: (path, signal) => request<ReaderSessionDto>("/reader/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
      signal,
    }),
    openAdjacentBook: (sessionId, direction, signal) => request<ReaderSessionDto | undefined>(
      `/reader/s/${encodeURIComponent(sessionId)}/adjacent-book`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ direction }),
        signal,
      },
    ),
    openDirectoryBrowser: (path, signal, scopeId, watch = false) => request<ReaderDirectoryPageDto>("/reader/browser/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, scopeId, ...(watch ? { watch: true } : {}) }),
      signal,
    }),
    cloneDirectoryBrowser: (sessionId, signal) => request<ReaderDirectoryPageDto>(
      `/reader/browser/s/${encodeURIComponent(sessionId)}/clone`,
      { method: "POST", signal },
    ),
    reopenDirectoryBrowser: (sessionId, signal) => request<ReaderDirectoryPageDto>(
      `/reader/browser/s/${encodeURIComponent(sessionId)}/reopen`,
      { method: "POST", signal },
    ),
    watchDirectoryBrowser: (sessionId, afterGeneration, focusPath, signal) => {
      const search = new URLSearchParams({ after: String(afterGeneration) })
      if (focusPath) search.set("focus", focusPath)
      return request<ReaderDirectoryPageDto | undefined>(
        `/reader/browser/s/${encodeURIComponent(sessionId)}/changes?${search}`,
        { signal },
      )
    },
    listDirectoryRoots: (signal) => request<{ roots: ReaderDirectoryRootDto[] }>("/reader/browser/roots", { signal })
      .then((value) => value.roots),
    listDirectoryBrowser: (sessionId, cursor, limit, signal, metadataFields) => {
      const search = new URLSearchParams({ cursor: String(cursor), limit: String(limit) })
      if (metadataFields?.length) search.set("fields", metadataFields.join(","))
      return request<ReaderDirectoryPageDto>(
        `/reader/browser/s/${encodeURIComponent(sessionId)}/entries?${search}`,
        { signal },
      )
    },
    navigateDirectoryBrowser: (sessionId, navigation, signal, focusPath) => request<ReaderDirectoryPageDto>(
      `/reader/browser/s/${encodeURIComponent(sessionId)}/navigate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...navigation, focusPath }),
        signal,
      },
    ),
    searchDirectoryBrowser: (sessionId, query, options = {}, signal) => {
      const config = resolveConfig()
      const search = new URLSearchParams({ q: query })
      if (options.mode) search.set("mode", options.mode)
      if (options.kind) search.set("kind", options.kind)
      if (options.caseSensitive !== undefined) search.set("case", options.caseSensitive ? "1" : "0")
      if (options.searchInPath !== undefined) search.set("path", options.searchInPath ? "1" : "0")
      if (options.maximumDepth !== undefined) search.set("depth", String(options.maximumDepth))
      if (options.maximumResults !== undefined) search.set("limit", String(options.maximumResults))
      for (const pattern of options.excludePatterns ?? []) search.append("exclude", pattern)
      return requestDirectorySearch(
        new URL(`/reader/browser/s/${encodeURIComponent(sessionId)}/search?${search}`, config.baseUrl),
        config.token,
        options.maximumResults ?? 512,
        options.onEntries,
        signal,
      )
    },
    treeDirectoryBrowser: (sessionId, path, refresh = false, signal) => {
      const search = new URLSearchParams()
      if (path) search.set("path", path)
      if (refresh) search.set("refresh", "1")
      const suffix = search.size ? `?${search}` : ""
      return request<ReaderDirectoryTreePageDto>(
        `/reader/browser/s/${encodeURIComponent(sessionId)}/tree${suffix}`,
        { signal },
      )
    },
    watchDirectoryTreeBrowser: (sessionId, afterRevision, signal) => request<ReaderDirectoryTreeChangesDto | undefined>(
      `/reader/browser/s/${encodeURIComponent(sessionId)}/tree/changes?after=${afterRevision}`,
      { signal },
    ),
    listSearchHistory: (scope, limit = 20, signal) => request<{ entries: ReaderSearchHistoryDto[] }>(
      `/reader/browser/search-history?scope=${encodeURIComponent(scope)}&limit=${limit}`,
      { signal },
    ).then((value) => value.entries),
    recordSearchHistory: (scope, query, signal) => request<ReaderSearchHistoryDto>("/reader/browser/search-history", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope, query }),
      signal,
    }),
    removeSearchHistory: (scope, query, signal) => {
      const search = new URLSearchParams({ scope, query })
      return request<{ removed: boolean }>(`/reader/browser/search-history?${search}`, { method: "DELETE", signal })
        .then((value) => value.removed)
    },
    clearSearchHistory: (scope, signal) => request<{ cleared: number }>(
      `/reader/browser/search-history?scope=${encodeURIComponent(scope)}`,
      { method: "DELETE", signal },
    ).then((value) => value.cleared),
    filterDirectoryBrowser: (sessionId, filter, focusPath, signal) => request<ReaderDirectoryPageDto>(
      `/reader/browser/s/${encodeURIComponent(sessionId)}/filter`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filter, focusPath }),
        signal,
      },
    ),
    sortDirectoryBrowser: (sessionId, sort, focusPath, signal) => request<ReaderDirectoryPageDto>(
      `/reader/browser/s/${encodeURIComponent(sessionId)}/sort`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...sort, focusPath }),
        signal,
      },
    ),
    updateDirectorySortPreference: (sessionId, command, focusPath, signal) => request<ReaderDirectoryPageDto>(
      `/reader/browser/s/${encodeURIComponent(sessionId)}/sort/preferences`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...command, focusPath }),
        signal,
      },
    ),
    closeDirectoryBrowser: (sessionId, remember = false) => request<void>(`/reader/browser/s/${encodeURIComponent(sessionId)}${remember ? "?remember=1" : ""}`, {
      method: "DELETE",
      keepalive: true,
    }),
    registerLibraryThumbnails: (contextId, generation, items, signal) => request<ReaderLibraryThumbnailBatchDto>(
      "/reader/library/thumbnails",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contextId, generation, items }),
        signal,
      },
    ),
    releaseLibraryThumbnailContext: (contextId) => request<void>(
      `/reader/library/contexts/${encodeURIComponent(contextId)}`,
      { method: "DELETE", keepalive: true },
    ),
    listPages: (sessionId, cursor, limit, signal) => request<ReaderPageListDto>(
      `/reader/s/${encodeURIComponent(sessionId)}/pages?cursor=${cursor}&limit=${limit}`,
      { signal },
    ),
    bookSettings: (sessionId, signal) => request<{ settings: ReaderBookSettingsSnapshotDto }>(
      `/reader/s/${encodeURIComponent(sessionId)}/book-settings`,
      { signal },
    ).then((value) => value.settings),
    updateBookSettings: (sessionId, expectedRevision, patch, signal) => request<ReaderBookSettingsUpdateDto>(
      `/reader/s/${encodeURIComponent(sessionId)}/book-settings`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision, patch }),
        signal,
      },
    ),
    listPageCatalog: (sessionId, cursor, limit, options, signal) => {
      const search = new URLSearchParams({ cursor: String(cursor), limit: String(limit) })
      if (options.query) search.set("query", options.query)
      if (options.thumbnails === false) search.set("thumbnails", "0")
      return request<ReaderPageListDto>(`/reader/s/${encodeURIComponent(sessionId)}/pages?${search}`, { signal })
    },
    pageAction: (sessionId, pageId, action, signal) => request<ReaderPageCopyActionDto | void>(
      `/reader/s/${encodeURIComponent(sessionId)}/pages/${encodeURIComponent(pageId)}/actions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
        signal,
      },
    ),
    releasePageActionLease: (sessionId, leaseToken) => request<void>(
      `/reader/s/${encodeURIComponent(sessionId)}/clipboard-materializations/${encodeURIComponent(leaseToken)}`,
      { method: "DELETE", keepalive: true },
    ),
    metadata: (sessionId, signal) => request<ReaderMetadataDto>(`/reader/s/${encodeURIComponent(sessionId)}/metadata`, { signal }),
    pageMediaInformation: (sessionId, signal) => request<ReaderPageMediaInformationDto>(`/reader/s/${encodeURIComponent(sessionId)}/page-media-information`, { signal }),
    diagnostics: (signal) => request<ReaderStorageDiagnosticsDto>("/reader/diagnostics", { signal }),
    preloadDiagnostics: (sessionId, signal) => request<ReaderStorageDiagnosticsDto>(`/reader/diagnostics?sessionId=${encodeURIComponent(sessionId)}`, { signal }),
    runPreloadAction: (sessionId, action, signal) => request<ReaderPreloadActionResultDto>(
      `/reader/s/${encodeURIComponent(sessionId)}/preload-actions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, confirmed: true }),
        signal,
      },
    ),
    thumbnailMaintenance: (signal) => request<{ snapshot: ReaderThumbnailMaintenanceSnapshotDto }>(
      "/reader/thumbnails/maintenance",
      { signal },
    ).then((value) => value.snapshot),
    cleanupThumbnails: async (command, signal) => {
      const response = await request<{
        deleted?: number
        cutoff?: string
        result?: Omit<Extract<ReaderThumbnailCleanupResultDto, { kind: "invalid" }>, "kind">
      }>("/reader/thumbnails/maintenance/cleanup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(command),
        signal,
      })
      if (command.kind === "invalid") return { kind: command.kind, ...response.result! }
      if (command.kind === "expired") return { kind: command.kind, deleted: response.deleted!, cutoff: response.cutoff! }
      return { kind: command.kind, deleted: response.deleted! }
    },
    clearThumbnailFailures: (limit = 500, signal) => request<{ deleted: number }>(
      "/reader/thumbnails/maintenance/failures/clear",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit }),
        signal,
      },
    ).then((value) => value.deleted),
    openSystemPath: (path, signal) => request<void>("/reader/files/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
      signal,
    }),
    revealSystemPath: (path, signal) => request<void>("/reader/files/reveal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
      signal,
    }),
    executeFileOperations: (operations, confirmed = false, signal) => request<ReaderFileOperationBatchResultDto>("/reader/files/operations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operations, ...(confirmed ? { confirmed: true } : {}) }),
      signal,
    }),
    startDirectorySelectionOperation: (sessionId, selection, kind, signal) => request<ReaderDirectorySelectionOperationSnapshotDto>(
      "/reader/files/selection-operations",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, selection, kind, confirmed: true }),
        signal,
      },
    ),
    directorySelectionOperation: (id, signal) => request<ReaderDirectorySelectionOperationSnapshotDto>(
      `/reader/files/selection-operations/${encodeURIComponent(id)}`,
      { signal },
    ),
    cancelDirectorySelectionOperation: (id, signal) => request<ReaderDirectorySelectionOperationSnapshotDto & { cancelRequested: boolean }>(
      `/reader/files/selection-operations/${encodeURIComponent(id)}`,
      { method: "DELETE", signal },
    ),
    prepareDirectoryClipboard: (sessionId, selection, mode, signal) => request<ReaderDirectoryClipboardSnapshotDto>(
      "/reader/files/clipboard",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, selection, mode }),
        signal,
      },
    ),
    directoryClipboard: (signal) => request<ReaderDirectoryClipboardSnapshotDto>("/reader/files/clipboard", { signal }),
    pasteDirectoryClipboard: (destinationPath, signal) => request<ReaderDirectorySelectionOperationSnapshotDto>(
      "/reader/files/clipboard/paste",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ destinationPath }),
        signal,
      },
    ),
    clearDirectoryClipboard: (signal) => request<ReaderDirectoryClipboardSnapshotDto>(
      "/reader/files/clipboard",
      { method: "DELETE", signal },
    ),
    listRecent: (offset, limit, signal) => request<{ items: ReaderRecentDto[] }>(
      `/reader/library/recents?offset=${offset}&limit=${limit}`,
      { signal },
    ).then((value) => value.items),
    removeRecent: (bookId, signal) => request<void>(`/reader/library/recents/${encodeURIComponent(bookId)}`, {
      method: "DELETE",
      signal,
    }),
    removeRecents: (ids, signal) => request<ReaderRecentBatchRemoveResultDto>("/reader/library/recents/batch", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
      signal,
    }),
    cleanupRecents: (cleanup, signal) => request<ReaderRecentCleanupResultDto>("/reader/library/recents/cleanup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cleanup.kind === "before"
        ? { before: cleanup.before, ...(cleanup.limit === undefined ? {} : { limit: cleanup.limit }) }
        : cleanup),
      signal,
    }),
    cleanupInvalidLibrary: (kind, signal) => request<ReaderInvalidLibraryCleanupResultDto>("/reader/library/cleanup-invalid", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind }),
      signal,
    }),
    listBookmarks: (offset, limit, listId, signal) => {
      const search = new URLSearchParams({ offset: String(offset), limit: String(limit) })
      if (listId) search.set("listId", listId)
      return request<{ items: ReaderBookmarkDto[] }>(`/reader/library/bookmarks?${search}`, { signal }).then((value) => value.items)
    },
    findBookmarkByPath: (path, signal) => request<{ item: ReaderBookmarkDto | null }>(
      `/reader/library/bookmarks/by-path?${new URLSearchParams({ path })}`,
      { signal },
    ).then((value) => value.item ?? undefined),
    saveBookmark: (bookmark, signal) => request<ReaderBookmarkDto>("/reader/library/bookmarks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(bookmark),
      signal,
    }),
    updateBookmark: (id, patch, signal) => request<ReaderBookmarkDto>(`/reader/library/bookmarks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      signal,
    }),
    updateBookmarks: (updates, signal) => request<ReaderBookmarkBatchResultDto>("/reader/library/bookmarks/batch", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ updates }),
      signal,
    }),
    removeBookmark: (id, signal) => request<void>(`/reader/library/bookmarks/${encodeURIComponent(id)}`, {
      method: "DELETE",
      signal,
    }),
    removeBookmarks: (ids, signal) => request<ReaderBookmarkBatchRemoveResultDto>("/reader/library/bookmarks/batch", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
      signal,
    }),
    listBookmarkLists: (signal) => request<{ items: ReaderBookmarkListDto[] }>(
      "/reader/library/bookmark-lists",
      { signal },
    ).then((value) => value.items),
    saveBookmarkList: (list, signal) => request<ReaderBookmarkListDto>("/reader/library/bookmark-lists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(list),
      signal,
    }),
    removeBookmarkList: (id, signal) => request<void>(`/reader/library/bookmark-lists/${encodeURIComponent(id)}`, {
      method: "DELETE",
      signal,
    }),
    navigate: (sessionId, action, signal) => request<ReaderNavigationDto>(
      `/reader/s/${encodeURIComponent(sessionId)}/navigate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
        signal,
      },
    ),
    goTo: (sessionId, pageIndex, signal) => request<ReaderNavigationDto>(
      `/reader/s/${encodeURIComponent(sessionId)}/navigate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "goTo", pageIndex }),
        signal,
      },
    ),
    updateSessionOptions: (sessionId, patch, signal) => request<ReaderNavigationDto>(
      `/reader/s/${encodeURIComponent(sessionId)}/options`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        signal,
      },
    ),
    close: (sessionId) => request<void>(`/reader/s/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
      keepalive: true,
    }),
  }
}

type ReaderDirectorySearchEvent =
  | { type: "meta"; sessionId: string; rootPath: string; generation: number; query: string; mode: ReaderDirectorySearchModeDto }
  | { type: "entry"; index: number; entry: { name: string; path: string; kind: "directory" | "file" | "other" } }
  | { type: "complete"; scanned: number; matched: number; truncated: boolean }
  | { type: "error"; error: string }

async function requestDirectorySearch(
  url: URL,
  token: string | undefined,
  maximumResults: number,
  onEntries: ((entries: readonly ReaderDirectoryEntryDto[]) => void) | undefined,
  signal?: AbortSignal,
): Promise<ReaderDirectorySearchResultDto> {
  const headers = new Headers()
  if (token) headers.set("x-xiranite-token", token)
  const response = await fetch(url, { headers, cache: "no-store", signal })
  signal?.throwIfAborted()
  if (!response.ok) throw new ReaderHttpError(await responseError(response), response.status)
  if (!response.body) throw new Error("Reader search response did not include a body.")
  const reader = response.body.getReader()
  const cancelOnAbort = () => { void reader.cancel(signal?.reason).catch(() => undefined) }
  signal?.addEventListener("abort", cancelOnAbort, { once: true })
  const decoder = new TextDecoder()
  let buffer = ""
  let meta: Extract<ReaderDirectorySearchEvent, { type: "meta" }> | undefined
  let complete: Extract<ReaderDirectorySearchEvent, { type: "complete" }> | undefined
  const entries: ReaderDirectoryEntryDto[] = []
  let publishedEntries = 0
  try {
    while (true) {
      const chunk = await reader.read()
      buffer += decoder.decode(chunk.value, { stream: !chunk.done })
      let newline = buffer.indexOf("\n")
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line) consumeDirectorySearchEvent(JSON.parse(line) as ReaderDirectorySearchEvent)
        newline = buffer.indexOf("\n")
      }
      if (chunk.done) break
    }
    const tail = buffer.trim()
    if (tail) consumeDirectorySearchEvent(JSON.parse(tail) as ReaderDirectorySearchEvent)
  } catch (error) {
    await reader.cancel(error).catch(() => undefined)
    throw error
  } finally {
    signal?.removeEventListener("abort", cancelOnAbort)
    reader.releaseLock()
  }
  signal?.throwIfAborted()
  if (!meta || !complete) throw new Error("Reader search stream ended before completion.")
  return {
    sessionId: meta.sessionId,
    rootPath: meta.rootPath,
    generation: meta.generation,
    query: meta.query,
    mode: meta.mode,
    entries,
    scanned: complete.scanned,
    matched: complete.matched,
    truncated: complete.truncated,
  }

  function consumeDirectorySearchEvent(event: ReaderDirectorySearchEvent) {
    if (complete) throw new Error("Reader search stream emitted data after completion.")
    if (event.type === "error") throw new Error(event.error)
    if (event.type === "meta") {
      if (meta) throw new Error("Reader search stream emitted duplicate metadata.")
      meta = event
      return
    }
    if (!meta) throw new Error("Reader search stream emitted data before metadata.")
    if (event.type === "entry") {
      if (event.index !== entries.length) throw new Error("Reader search stream entry indexes are not contiguous.")
      if (entries.length >= maximumResults) throw new Error("Reader search stream exceeded the requested result limit.")
      entries.push({
        name: event.entry.name,
        path: event.entry.path,
        kind: event.entry.kind,
        readerSupported: event.entry.kind !== "other",
      })
      if (entries.length - publishedEntries >= 16) {
        publishedEntries = entries.length
        onEntries?.([...entries])
      }
      return
    }
    if (event.matched !== entries.length) throw new Error("Reader search stream result count does not match its entries.")
    complete = event
  }
}

async function responseError(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    const body = await response.json().catch(() => undefined) as { error?: unknown } | undefined
    if (typeof body?.error === "string" && body.error) return body.error
  }
  return await response.text().catch(() => "") || `Reader backend returned ${response.status}.`
}
