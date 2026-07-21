import type { FrameSnapshot, PageDimensions, PageMediaKind, PageMode, ReaderAutoRotation, ReaderFitMode, ReaderLayout, ReaderOrientation, ReaderWidePageStretch, TailOverflowBehavior, ViewSource } from "@xiranite/node-neoview/ui-core"
import type { ReaderColorFilterPatch, ReaderColorFilterSettings } from "@xiranite/node-neoview/color-filter"
import type { ReaderPageTransitionPatch, ReaderPageTransitionSettings } from "@xiranite/node-neoview/page-transition"
import type { ReaderSwitchToastPatch, ReaderSwitchToastSettings } from "@xiranite/node-neoview/switch-toast"
import type { ReaderInfoOverlayPatch, ReaderInfoOverlaySettings } from "@xiranite/node-neoview/info-overlay"
import type { ReaderImageTrimPatch, ReaderImageTrimSettings } from "@xiranite/node-neoview/image-trim"
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
  pageOrder?: ReaderPageOrderDto
  preload?: ReaderPreloadPlanDto
}

export interface ReaderNavigationDto {
  frame: FrameSnapshot
  visiblePages: ReaderPageDto[]
  pageOrder?: ReaderPageOrderDto
  preload?: ReaderPreloadPlanDto
}

export type ReaderPreloadOutcomeDto = "started" | "ready" | "failed" | "cancelled" | "evicted"
export interface ReaderPreloadCandidateDto {
  tier: "near" | "ahead" | "background"
  priority: "interactive" | "view" | "ahead" | "background"
  anchorPageIndex: number
  pageIndexes: number[]
  pageIds: string[]
}
export interface ReaderPreloadPlanDto {
  generation: number
  frameGeneration: number
  direction: "forward" | "backward"
  directionConfidence: number
  mode: "paged" | "continuous" | "scrub"
  admission: "normal" | "reduced" | "paused"
  velocityPagesPerSecond: number
  stableForMs: number
  focused: boolean
  queueWaitMs: number
  memoryPressure: "normal" | "elevated" | "critical"
  currentPageIndexes: number[]
  candidates: ReaderPreloadCandidateDto[]
}
export interface ReaderPreloadEventDto {
  pageId: string
  outcome: ReaderPreloadOutcomeDto
  metrics?: { ttfbMs?: number; decodeMs?: number; retainedBytes?: number; activeLeases?: number }
}
export interface ReaderPreloadReportResultDto {
  generation: number
  accepted: number
  rejected: number
  stale: number
}
export interface ReaderPreloadContextDto {
  mode?: "paged" | "continuous" | "scrub"
  velocityPagesPerSecond?: number
  stableForMs?: number
  focused?: boolean
}

export interface ReaderSourceChangeDto {
  revision: number
  state: "changed" | "unavailable"
  kinds: Array<"create" | "update" | "delete">
  count: number
}

export type ReaderPageSortModeDto = "fileName" | "fileNameDescending" | "fileSize" | "fileSizeDescending" | "timeStamp" | "timeStampDescending" | "entry" | "entryDescending" | "random"
export type ReaderMediaPriorityModeDto = "none" | "videoFirst" | "imageFirst"
export interface ReaderPageOrderDto {
  sortMode: ReaderPageSortModeDto
  mediaPriority: ReaderMediaPriorityModeDto
  randomSeed?: string
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

export interface ReaderFrameWindowDto {
  frames: FrameSnapshot[]
  centerIndex: number
  radius: number
  visiblePages: ReaderPageDto[]
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

export interface ReaderFileUndoStateDto {
  available: boolean
  count: number
  latestId?: string
  latestCreatedAt?: number
  supportedKinds: readonly ReaderFileMutationDto["kind"][]
  trashRestore: boolean
  persistent: boolean
  persistenceError?: string
}

export interface ReaderFileUndoResultDto {
  undoId?: string
  results: ReaderFileOperationResultDto[]
  succeeded: number
  failed: number
  remaining: number
  journalPersisted?: boolean
}

export interface ReaderFileUndoDiscardResultDto {
  undoId?: string
  discarded: boolean
  remaining: number
  journalPersisted?: boolean
}

export interface ReaderExplorerContextMenuPlanItemDto {
  entryKey: string
  hive: "HKCU" | "HKCR" | "HKLM"
  scope: "file" | "directory" | "background"
  registryPath: string
  label: string
  icon: string
  command: string
  enabled: boolean
}

export interface ReaderExplorerContextMenuPreviewDto {
  available: boolean
  plan: readonly ReaderExplorerContextMenuPlanItemDto[]
  registryFile: string
  reason?: string
}

export interface ReaderExplorerContextMenuStatusDto {
  available: boolean
  enabled: boolean
  reason?: string
}

export interface ReaderDirectorySelectionDescriptorDto {
  generation: number
  allSelected: boolean
  ranges: readonly { start: number; end: number }[]
  explicit: readonly { path: string; index?: number }[]
}

export type ReaderFolderPenetrationTerminalKindDto = "archive" | "document" | "media-directory" | "file"
export interface ReaderFolderPenetrationPolicyDto {
  maxDepth?: number
  terminalTargets?: readonly ReaderFolderPenetrationTerminalKindDto[]
}
export interface ReaderFolderPenetrationResolutionDto {
  status: "resolved" | "branch" | "empty" | "blocked"
  originPath: string
  terminal?: { kind: ReaderFolderPenetrationTerminalKindDto; path: string }
  directMediaCount?: number
  deferredDirectoryCount?: number
  chain: readonly { path: string; canonicalPath: string; ignoredSidecars: number }[]
  reason: "archive" | "document" | "media-directory" | "mixed-media-directory" | "file" | "multiple-primary-items" | "empty" | "depth-limit" | "cycle" | "permission" | "unsupported-content"
}
export interface ReaderActivationProvenanceDto {
  browserOriginPath: string
  browserOriginEntryPath: string
  browserOriginSelfTerminal?: boolean
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
    emm?: {
      translatedTitle?: string
      tags?: readonly { namespace: string; tag: string; translatedLabel?: string }[]
    }
    emmRaw?: {
      schemaVersion: 1
      fields: readonly {
        key: string
        type: "string" | "number" | "boolean" | "bytes" | "datetime" | "timestamp" | "path" | "url"
        value: string | number | boolean
      }[]
    }
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
  sampledAtMs?: number
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
    thumbnails: {
      demands?: number
      activeFlights?: number
      queuedFlights?: number
      runningFlights?: number
      cachedEntries?: number
      cachedBytes: number
      telemetry?: {
        cacheHits: number
        cacheMisses: number
        completed: number
        failed: number
        cancelled: number
        evictions: number
        byLane: Readonly<Record<string, {
          demands: number
          cacheHits: number
          cacheMisses: number
          completed: number
          failed: number
          cancelled: number
        }>>
      }
    } | null
  }
  presentationDiskCache: { enabled: boolean; bytes?: number }
  solidArchiveCache: { retainedBytes: number }
}

export type ReaderSystemMonitorIntervalDto = 500 | 1_000 | 2_000 | 5_000

export interface ReaderSystemMonitorConfigDto {
  enabled: boolean
  refreshIntervalMs: ReaderSystemMonitorIntervalDto
  maxSamples: number
}

export interface ReaderSystemMonitorSnapshotDto {
  schemaVersion: 1
  sampledAtMs: number
  uptimeSeconds: number
  loadAverage: readonly [number, number, number]
  cpu: {
    averageUsagePercent: number
    cores: readonly { index: number; usagePercent: number }[]
  }
  memory: { totalBytes: number; usedBytes: number; freeBytes: number; cachedBytes: number | null }
  network: {
    available: boolean
    reason?: string
    receiveBytesPerSecond: number | null
    transmitBytesPerSecond: number | null
  }
  disk: {
    available: boolean
    reason?: string
    totalBytes: number | null
    usedBytes: number | null
    freeBytes: number | null
  }
  gpu: { available: boolean; reason?: string }
}

export interface ReaderSystemMonitorConfigPatch {
  systemMonitor: Partial<ReaderSystemMonitorConfigDto>
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
  | { kind: "path-prefix"; prefix: string; limit?: number }

export type ReaderThumbnailCleanupResultDto =
  | { kind: "empty"; deleted: number }
  | { kind: "expired"; deleted: number; cutoff: string }
  | { kind: "invalid"; scanned: number; deleted: number; unavailableVolumeRowsPreserved: number; wrapped: boolean }
  | { kind: "path-prefix"; prefix: string; deleted: number }

export interface ReaderRecentDto {
  bookId: string
  source: ViewSource
  displayName: string
  pageIndex: number
  pageCount: number
  updatedAt: number
}

export type ReaderLibrarySortFieldDto = "name" | "path" | "date" | "type"
export type ReaderLibrarySortOrderDto = "asc" | "desc"

export interface ReaderLibraryQueryDto {
  search?: string
  sort?: {
    field: ReaderLibrarySortFieldDto
    order: ReaderLibrarySortOrderDto
  }
}

export interface ReaderFolderProgressSummaryDto {
  path: string
  bookCount: number
  completedBooks: number
  readPages: number
  totalPages: number
  progressPercent?: number
  lastReadAt?: number
  scannedRecords: number
  truncated: boolean
}

export interface ReaderOpdsLinkDto {
  href: string
  rel?: string
  type?: string
  title?: string
  price?: { value: number; currency?: string }
}

export interface ReaderOpdsCatalogDto {
  url: string
  title?: string
  subtitle?: string
  id?: string
  navigation: readonly { title: string; href: string; type?: string; rel?: string }[]
  publications: readonly {
    id?: string
    title: string
    summary?: string
    language?: string
    images: readonly string[]
    acquisition: readonly ReaderOpdsLinkDto[]
    links: readonly ReaderOpdsLinkDto[]
  }[]
  links: readonly ReaderOpdsLinkDto[]
  next?: string
  previous?: string
  first?: string
  last?: string
  search?: string
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

export interface ReaderLibraryStatisticsDto {
  recentCount: number
  bookmarkCount: number
  bookmarkListCount: number
  mediaProgressCount: number
}

export type ReaderAiTranslationServiceDto = "disabled" | "ollama"
export interface ReaderAiTranslationConfigDto {
  enabled: boolean
  autoTranslate: boolean
  service: ReaderAiTranslationServiceDto
  ollamaUrl: string
  ollamaModel: string
  sourceLanguage: string
  targetLanguage: string
  promptTemplate: string
  memoryCacheEntries: number
}
export interface ReaderAiTranslationConfigPatch {
  aiTranslation: Partial<ReaderAiTranslationConfigDto>
}
export interface ReaderEmmConfigDto {
  enabled: boolean
  databasePaths: readonly string[]
  settingPath?: string
  translationDatabasePath?: string
  translationPath?: string
  defaultRating: number
}
export interface ReaderEmmConfigPatch {
  emm: Partial<ReaderEmmConfigDto>
}
export interface ReaderOllamaModelDto {
  name: string
  digest?: string
  size?: number
  parameterSize?: string
  quantizationLevel?: string
}
export interface ReaderAiTranslationResultDto {
  text: string
  cached: boolean
}
export interface ReaderAiCacheStatsDto {
  memoryEntries: number
  persistentEntries: number | null
  totalTranslations?: number
  cacheHits?: number
  apiCalls?: number
  hitRate?: number
}
export interface ReaderAiCheckDto {
  online: boolean
  service: ReaderAiTranslationServiceDto
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
  collectTags?: readonly string[]
  manualTags?: readonly string[]
}

export type ReaderDirectorySizeBatchItemDto =
  | { path: string; status: "ok"; bytes: number; fileCount: number }
  | { path: string; status: "failed"; error: string }

export interface ReaderDirectorySizeBatchDto {
  sessionId: string
  generation: number
  results: readonly ReaderDirectorySizeBatchItemDto[]
}

export interface ReaderDirectorySelectionResolutionDto {
  sessionId: string
  generation: number
  total: number
  selectedCount: number
  preview: readonly string[]
  truncated: boolean
}

export interface ReaderEmmTagDto {
  namespace: string
  tag: string
}

export interface ReaderEmmTagSuggestionDto {
  category: string
  tag: string
  favorite: boolean
  translatedTag?: string
}

export interface ReaderEmmMetadataSnapshotDto {
  revision: number
  overrides: {
    rating?: number
    manualTags?: readonly ReaderEmmTagDto[]
    translatedTitle?: string
  }
  inherited: readonly ("rating" | "manualTags" | "translatedTitle")[]
  updatedAt?: number
}

export interface ReaderDirectoryEmmReadResultDto {
  generation: number
  items: readonly { path: string; metadata: ReaderEmmMetadataSnapshotDto }[]
}

export interface ReaderEmmMetadataPatchDto {
  rating?: number | null
  manualTags?: readonly ReaderEmmTagDto[] | null
  translatedTitle?: string | null
}

export interface ReaderDirectoryEmmEditCommandDto {
  generation: number
  updates: readonly {
    path: string
    expectedRevision: number
    patch: ReaderEmmMetadataPatchDto
  }[]
  concurrency?: number
}

export type ReaderDirectoryEmmEditResultItemDto =
  | { index: number; status: "succeeded"; metadata: ReaderEmmMetadataSnapshotDto }
  | { index: number; status: "conflict"; actualRevision: number }
  | { index: number; status: "failed"; error: string }

export interface ReaderDirectoryEmmEditResultDto {
  generation: number | null
  refreshRequired: boolean
  entries: readonly ReaderDirectoryEntryDto[]
  results: readonly ReaderDirectoryEmmEditResultItemDto[]
  succeeded: number
  conflicts: number
  failed: number
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
  includeTags?: readonly string[]
  excludeTags?: readonly string[]
  tagMode?: "all" | "any"
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
  thumbnailUrls?: readonly string[]
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

export interface ReaderLibraryThumbnailWarmupSummaryDto {
  total: number
  completed: number
  failed: number
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
  material?: ReaderShellMaterialDto
  edges: Record<ReaderShellEdge, { enabled: boolean; initialVisible: boolean; pinned: boolean; triggerSize: number; lockMode?: ReaderShellLockMode }>
  floatingControl?: { enabled: boolean; position: { x: number; y: number } }
  sidebars: Record<"left" | "right", { width: number; height: "full" | "two-thirds" | "half" | "one-third" | "custom"; customHeight: number; verticalAlign: number; horizontalPosition: number }>
  sidebarInteraction?: { showDragHandle: boolean; enableBlankAreaCollapse: boolean; blankAreaCollapseMode: "single" | "double" }
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

export interface ReaderBookDefaultsDto {
  lockedSortMode: ReaderPageSortModeDto | null
  lockedMediaPriority: Exclude<ReaderMediaPriorityModeDto, "none"> | null
}

export interface ReaderBookDefaultsPatch {
  book: Partial<ReaderBookDefaultsDto>
}

export interface ReaderImageProcessingConfigDto {
  enabled: boolean
  readerTransformEnabled: boolean
  jxlTransformEnabled: boolean
  wicNativeEnabled: boolean
  windowsShellNativeEnabled: boolean
  thumbnailTransformEnabled: boolean
  folderMosaicEnabled: boolean
  sharpFallbackEnabled: boolean
  jxlLossless: boolean
  jxlQuality: number
  thumbnailLossless: boolean
  thumbnailQuality: number
  mosaicLossless: boolean
  mosaicQuality: number
}

export interface ReaderImageProcessingPatchDto {
  imageProcessing: Partial<ReaderImageProcessingConfigDto>
}

export interface ReaderRuntimeConfigDto {
  shell: ReaderShellConfigDto
  viewDefaults: { fitMode: ReaderFitMode; pageMode: PageMode; splitWidePages?: boolean; hoverScrollEnabled?: boolean; hoverScrollSpeed?: number; magnifierZoom?: number; magnifierSize?: number; orientation?: ReaderOrientation; autoRotation?: ReaderAutoRotation; widePageStretch?: ReaderWidePageStretch }
  book: ReaderBookDefaultsDto
  /** Optional because older backends omit it; GUI falls back to stay-on-last-page. */
  sessionOptions?: {
    direction?: "left-to-right" | "right-to-left"
    layout?: Partial<ReaderLayout>
    tailOverflow?: TailOverflowBehavior
  }
  pageList: ReaderPageListPreferencesDto
  bookmarkList: ReaderBookmarkListPreferencesDto
  historyList: ReaderHistoryListPreferencesDto
  folderView: ReaderFolderViewConfig
  slideshow: ReaderSlideshowConfig
  media: ReaderMediaConfigDto
  imageProcessing?: ReaderImageProcessingConfigDto
  colorFilter: ReaderColorFilterSettings
  pageTransition: ReaderPageTransitionSettings
  switchToast?: ReaderSwitchToastSettings
  infoOverlay?: ReaderInfoOverlaySettings
  systemMonitor: ReaderSystemMonitorConfigDto
  emm?: ReaderEmmConfigDto
  aiTranslation?: ReaderAiTranslationConfigDto
  imageTrim?: ReaderImageTrimSettings
  superResolution?: ReaderSuperResolutionConfigDto
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

export interface ReaderSuperResolutionPreferencesDto {
  autoUpscaleEnabled?: boolean
  preUpscaleEnabled?: boolean
  globalUpscaleEnabled?: boolean
  currentImageUpscaleEnabled?: boolean
  preloadPages?: number
  backgroundConcurrency?: number
  showPanelPreview?: boolean
  defaultModelId?: string
  defaultScale?: number
  defaultTileSize?: number
  defaultTileEnabled?: boolean
  defaultNoise?: number
  defaultGpuId?: string
  defaultTta?: boolean
  progressiveEnabled?: boolean
  progressiveDwellTimeMs?: number
  progressiveMaxPages?: number
  conditionalEnabled?: boolean
  conditionalMinWidth?: number
  conditionalMinHeight?: number
  conditions?: readonly ReaderSuperResolutionConditionDto[]
}

export interface ReaderSuperResolutionConditionDto {
  id: string
  name: string
  enabled: boolean
  priority: number
  match: {
    minWidth?: number
    minHeight?: number
    maxWidth?: number
    maxHeight?: number
    minMegapixels?: number
    maxMegapixels?: number
    dimensionMode?: "and" | "or"
    createdBetween?: readonly [number, number]
    modifiedBetween?: readonly [number, number]
    bookPathRegex?: string
    imagePathRegex?: string
    matchInnerPath?: boolean
    excludeFromPreload?: boolean
    metadata?: Readonly<Record<string, { operator: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "regex" | "contains"; value: string | number }>>
  }
  action: {
    skip: boolean
    modelId?: string
    scale?: number
    tileSize?: number
    tileEnabled?: boolean
    noise?: number
    gpuId?: string
    useCache?: boolean
    tta?: boolean
  }
}

export interface ReaderSuperResolutionConfigDto {
  provider: "opencomic-system" | "disabled"
  modelsDirectory?: string
  modelSources?: readonly string[]
  preferences: ReaderSuperResolutionPreferencesDto
}

export interface ReaderSuperResolutionPatchDto {
  superResolution: {
    modelsDirectory?: string
    modelSources?: readonly string[]
    preferences?: ReaderSuperResolutionPreferencesDto
  }
}

export interface ReaderUpscaleArtifactResultDto {
  status: "hit" | "shared" | "generated" | "skipped" | "bypassed" | "rejected"
  artifactUrl?: string
  contentType?: string
  bytes?: number
  version?: string
  decision?: {
    kind: "disabled" | "skip" | "run"
    reason: string
    modelId?: string
    scale?: number
  }
}

export interface ReaderUpscaleModelDto {
  id: string
  displayName: string
  engine: "upscayl" | "waifu2x" | "realcugan"
  scales: readonly number[]
  modelType?: "upscale" | "descreen" | "artifact-removal"
  family?: string
  category?: string
  sizeBytes?: number
  installed?: boolean
  sourceDirectories?: readonly string[]
  noise?: readonly number[]
  noiseByScale?: Readonly<Record<number, readonly number[]>>
}

export type ReaderUpscaleCapabilityDto =
  | { available: false; reason: string; models: readonly []; engines: readonly [] }
  | { available: true; models: readonly ReaderUpscaleModelDto[]; engines: readonly unknown[]; probedAt: number }

export interface ReaderUpscalePreloadSnapshotDto {
  contextId: string
  generation: number
  mode: "nearby" | "progressive"
  state: "queued" | "countdown" | "running" | "completed" | "disabled" | "empty" | "paused" | "cancelled" | "failed"
  planned: number
  settled: number
  failed: number
  cancelled: number
  pending: number
  progress: number
  totalPages?: number
  scheduledPages?: number
  upscaledPages?: number
  startedAt: number
  updatedAt: number
  completedAt?: number
}

export interface ReaderUpscaleCacheSnapshotDto {
  entries: number
  bytes: number
  maxBytes: number
  maxEntryBytes: number
  activeLeases: number
  hits: number
  misses: number
  writes: number
  rejectedWrites: number
  evictions: number
  integrityFailures: number
}

export interface ReaderUpscaleCacheCleanupDto extends ReaderUpscaleCacheSnapshotDto {
  reason: "age" | "budget" | "book" | "explicit" | "low-disk"
  removedEntries: number
  removedBytes: number
}

export interface ReaderSubtitleConfigDto {
  fontSize: number
  color: string
  backgroundOpacity: number
  bottomPercent: number
}

export interface ReaderMediaConfigDto {
  supportedImageFormats: readonly string[]
  videoFormats: readonly string[]
  mediaMimeTypes: Readonly<Record<string, string>>
  autoPlayAnimatedImages: boolean
  animatedVideoEnabled: boolean
  animatedVideoKeywords: readonly string[]
  videoMinPlaybackRate: number
  videoMaxPlaybackRate: number
  videoPlaybackRateStep: number
  subtitle: ReaderSubtitleConfigDto
}

export interface ReaderMediaPatchDto {
  media: {
    autoPlayAnimatedImages?: boolean
    animatedVideoEnabled?: boolean
    animatedVideoKeywords?: readonly string[]
    subtitle?: Partial<ReaderSubtitleConfigDto>
  }
}

export interface ReaderMediaProgressDto {
  position: number
  duration: number
  completed: boolean
  updatedAt: number
}

export interface ReaderSubtitleTrackDto {
  id: string
  name: string
  format: "srt" | "ass" | "ssa" | "vtt"
  contentVersion: string
  assetUrl: string
}

export type ReaderShellSurface = "top" | "bottom" | "sidebar"
export type ReaderShellMaterialPreset = "solid" | "soft" | "frosted" | "custom"
export type ReaderShellSurfaceValues = Record<ReaderShellSurface, number>

export interface ReaderShellMaterialDto {
  preset: ReaderShellMaterialPreset
  saturation: ReaderShellSurfaceValues
  highlight: ReaderShellSurfaceValues
  shadow: ReaderShellSurfaceValues
}

export interface ReaderShellMaterialPatch {
  preset?: ReaderShellMaterialPreset
  opacity?: Partial<ReaderShellSurfaceValues>
  blur?: Partial<ReaderShellSurfaceValues>
  saturation?: Partial<ReaderShellSurfaceValues>
  highlight?: Partial<ReaderShellSurfaceValues>
  shadow?: Partial<ReaderShellSurfaceValues>
}

export type ReaderDirectoryFilterDto = "all" | "library" | "archive" | "directory" | "video" | "image" | "other"

export interface ReaderRadialMenuPatch {
  radialMenu: { config?: ReaderRadialMenuConfig; reset?: "defaults" }
}

export interface ReaderSettingsMigrationReport {
  codecVersion: number
  sourceKind: string
  sourceVersion?: string
  entries: readonly {
    sourcePath: string
    targetPath?: string
    disposition: string
    message?: string
  }[]
  summary: Readonly<Record<string, number>>
  fullyRecognized: boolean
}

export interface ReaderSettingsMigrationInspection {
  report: ReaderSettingsMigrationReport
  configPatch: Record<string, unknown>
}

export interface ReaderSettingsMigrationImportResult extends ReaderSettingsMigrationInspection {
  strategy: "merge" | "overwrite"
  changed: boolean
  backupCreated: boolean
}

export interface ReaderColorFilterConfigPatch {
  colorFilter: ReaderColorFilterPatch | { reset: "defaults" }
}

export interface ReaderPageTransitionConfigPatch {
  pageTransition: ReaderPageTransitionPatch | { reset: "defaults" }
}

export interface ReaderSwitchToastConfigPatch {
  switchToast: ReaderSwitchToastPatch | { reset: "defaults" }
}

export interface ReaderInfoOverlayConfigPatch {
  infoOverlay: ReaderInfoOverlayPatch | { reset: "defaults" }
}

export interface ReaderImageTrimConfigPatch {
  imageTrim: ReaderImageTrimPatch | { reset: "defaults" }
}

export type ReaderFolderViewMode = "compact" | "cover-list" | "mosaic-list" | "details" | "cover-grid"
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

export interface ReaderFolderPenetrationConfig {
  enabled: boolean
  maxDepth: number
  terminalTargets: ReaderFolderPenetrationTerminalKindDto[]
}

export interface ReaderFolderTagDisplayConfig {
  tagMode: "all" | "collect" | "none"
  showRating: boolean
  showCollectTagCount: boolean
  showTags: boolean
  maxTags: number
  showTooltips: boolean
}

export interface ReaderFolderViewConfig {
  homePath: string
  viewMode: ReaderFolderViewMode
  previewGridEnabled?: boolean
  previewCount: 4 | 9 | 16
  contentWidthPercent: number
  thumbnailWidthPercent: number
  bannerWidthPercent: number
  hoverPreviewEnabled: boolean
  hoverPreviewDelayMs: 200 | 500 | 800 | 1200
  /** Preferred directory listing type filter; applied when a browser session opens. */
  typeFilter?: ReaderDirectoryFilterDto
  showHiddenFolders?: boolean
  confirmDelete?: boolean
  tagDisplay: ReaderFolderTagDisplayConfig
  penetration: ReaderFolderPenetrationConfig
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
    previewGridEnabled?: boolean
    previewCount?: 4 | 9 | 16
    contentWidthPercent?: number
    thumbnailWidthPercent?: number
    bannerWidthPercent?: number
    hoverPreviewEnabled?: boolean
    hoverPreviewDelayMs?: 200 | 500 | 800 | 1200
    typeFilter?: ReaderDirectoryFilterDto
    showHiddenFolders?: boolean
    confirmDelete?: boolean
    tagDisplay?: Partial<ReaderFolderTagDisplayConfig>
    penetration?: Partial<ReaderFolderPenetrationConfig>
    emptyArea?: Partial<ReaderFolderEmptyAreaConfig>
    details?: ReaderFolderDetailsPatch
    search?: Partial<ReaderFolderSearchConfig>
    tree?: Partial<ReaderFolderTreeViewConfig>
    tabs?: Partial<ReaderFolderTabsConfig>
  }
}

export interface ReaderViewDefaultsPatch {
  viewDefaults: { fitMode?: ReaderFitMode; pageMode?: PageMode; splitWidePages?: boolean; hoverScrollEnabled?: boolean; hoverScrollSpeed?: number; magnifierZoom?: number; magnifierSize?: number; orientation?: ReaderOrientation; autoRotation?: ReaderAutoRotation; widePageStretch?: ReaderWidePageStretch }
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
    sidebarInteraction?: Partial<NonNullable<ReaderShellConfigDto["sidebarInteraction"]>>
    material?: ReaderShellMaterialPatch
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
  updateBookDefaults?(patch: ReaderBookDefaultsPatch, signal?: AbortSignal): Promise<ReaderBookDefaultsDto>
  updatePageList?(patch: ReaderPageListPreferencesPatch, signal?: AbortSignal): Promise<ReaderPageListPreferencesDto>
  updateBookmarkList?(patch: ReaderBookmarkListPreferencesPatch, signal?: AbortSignal): Promise<ReaderBookmarkListPreferencesDto>
  updateHistoryList?(patch: ReaderHistoryListPreferencesPatch, signal?: AbortSignal): Promise<ReaderHistoryListPreferencesDto>
  updateFolderView?(patch: ReaderFolderViewPatch, signal?: AbortSignal): Promise<ReaderFolderViewConfig>
  updateSlideshow(patch: ReaderSlideshowPatch, signal?: AbortSignal): Promise<ReaderSlideshowConfig>
  updateMedia?(patch: ReaderMediaPatchDto, signal?: AbortSignal): Promise<ReaderMediaConfigDto>
  updateImageProcessing?(patch: ReaderImageProcessingPatchDto, signal?: AbortSignal): Promise<ReaderImageProcessingConfigDto>
  updateInputBindings?(patch: ReaderInputBindingsPatch, signal?: AbortSignal): Promise<ReaderInputBindingsConfig>
  updateRadialMenu?(patch: ReaderRadialMenuPatch, signal?: AbortSignal): Promise<ReaderRadialMenuConfig>
  inspectLegacySettings?(content: string, modules?: readonly string[], signal?: AbortSignal): Promise<ReaderSettingsMigrationInspection>
  importLegacySettings?(content: string, strategy?: "merge" | "overwrite", modules?: readonly string[], signal?: AbortSignal): Promise<ReaderSettingsMigrationImportResult>
  updateColorFilter?(patch: ReaderColorFilterConfigPatch, signal?: AbortSignal): Promise<ReaderColorFilterSettings>
  updatePageTransition?(patch: ReaderPageTransitionConfigPatch, signal?: AbortSignal): Promise<ReaderPageTransitionSettings>
  updateSwitchToast?(patch: ReaderSwitchToastConfigPatch, signal?: AbortSignal): Promise<ReaderSwitchToastSettings>
  updateInfoOverlay?(patch: ReaderInfoOverlayConfigPatch, signal?: AbortSignal): Promise<ReaderInfoOverlaySettings>
  updateSystemMonitor?(patch: ReaderSystemMonitorConfigPatch, signal?: AbortSignal): Promise<ReaderSystemMonitorConfigDto>
  updateEmm?(patch: ReaderEmmConfigPatch, signal?: AbortSignal): Promise<ReaderEmmConfigDto>
  updateAiTranslation?(patch: ReaderAiTranslationConfigPatch, signal?: AbortSignal): Promise<ReaderAiTranslationConfigDto>
  aiCheck?(signal?: AbortSignal): Promise<ReaderAiCheckDto>
  aiModels?(signal?: AbortSignal): Promise<readonly ReaderOllamaModelDto[]>
  aiTranslate?(request: { text: string; sourceLanguage?: string; targetLanguage?: string; model?: string; promptTemplate?: string }, signal?: AbortSignal): Promise<ReaderAiTranslationResultDto>
  aiCacheStats?(signal?: AbortSignal): Promise<ReaderAiCacheStatsDto>
  aiClearCache?(scope?: "memory" | "persistent" | "all", signal?: AbortSignal): Promise<{ cleared: number; scope: string }>
  updateImageTrim?(patch: ReaderImageTrimConfigPatch, signal?: AbortSignal): Promise<ReaderImageTrimSettings>
  updateSuperResolution?(patch: ReaderSuperResolutionPatchDto, signal?: AbortSignal): Promise<ReaderSuperResolutionConfigDto>
  upscalePage?(sessionId: string, pageId: string, trigger?: "manual" | "automatic-current", signal?: AbortSignal): Promise<ReaderUpscaleArtifactResultDto>
  upscaleCapabilities?(sessionId?: string, refresh?: boolean, signal?: AbortSignal): Promise<ReaderUpscaleCapabilityDto>
  upscalePreloadSnapshots?(sessionId: string, signal?: AbortSignal): Promise<readonly ReaderUpscalePreloadSnapshotDto[]>
  startUpscalePreload?(sessionId: string, mode: "nearby" | "progressive", signal?: AbortSignal): Promise<readonly ReaderUpscalePreloadSnapshotDto[]>
  upscaleCache?(sessionId: string, signal?: AbortSignal): Promise<ReaderUpscaleCacheSnapshotDto>
  cleanupUpscaleCache?(sessionId: string, kind: "age" | "book" | "all", signal?: AbortSignal): Promise<ReaderUpscaleCacheCleanupDto>
  open(path: string, signal?: AbortSignal, provenance?: ReaderActivationProvenanceDto): Promise<ReaderSessionDto>
  reload?(sessionId: string, signal?: AbortSignal): Promise<ReaderSessionDto>
  waitForSourceChanges?(sessionId: string, afterRevision: number, signal?: AbortSignal): Promise<ReaderSourceChangeDto | undefined>
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
  directorySizes?(sessionId: string, generation: number, paths: readonly string[], signal?: AbortSignal): Promise<ReaderDirectorySizeBatchDto>
  resolveDirectorySelection?(sessionId: string, selection: ReaderDirectorySelectionDescriptorDto, previewLimit?: number, signal?: AbortSignal): Promise<ReaderDirectorySelectionResolutionDto>
  resolveFolderPenetration?(sessionId: string, path: string, policy?: ReaderFolderPenetrationPolicyDto, signal?: AbortSignal): Promise<ReaderFolderPenetrationResolutionDto>
  readDirectoryEmm?(sessionId: string, generation: number, paths: readonly string[], signal?: AbortSignal): Promise<ReaderDirectoryEmmReadResultDto>
  editDirectoryEmm?(sessionId: string, command: ReaderDirectoryEmmEditCommandDto, signal?: AbortSignal): Promise<ReaderDirectoryEmmEditResultDto>
  suggestDirectoryEmmTags?(count?: number, signal?: AbortSignal): Promise<readonly ReaderEmmTagSuggestionDto[]>
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
  prewarmLibraryThumbnails?(
    items: readonly ReaderLibraryThumbnailRegistrationDto[],
    options?: { mode?: "ensure" | "refresh"; concurrency?: number },
    signal?: AbortSignal,
  ): Promise<ReaderLibraryThumbnailWarmupSummaryDto>
  releaseLibraryThumbnailContext?(contextId: string): Promise<void>
  listPages(sessionId: string, cursor: number, limit: number, signal?: AbortSignal): Promise<ReaderPageListDto>
  frameWindow?(sessionId: string, centerPageIndex: number, radius: number, signal?: AbortSignal): Promise<ReaderFrameWindowDto>
  mediaProgress?(sessionId: string, signal?: AbortSignal): Promise<ReaderMediaProgressDto | undefined>
  updateMediaProgress?(sessionId: string, progress: Pick<ReaderMediaProgressDto, "position" | "duration" | "completed">, flush?: boolean, signal?: AbortSignal): Promise<ReaderMediaProgressDto>
  subtitleTracks?(sessionId: string, pageId: string, signal?: AbortSignal): Promise<readonly ReaderSubtitleTrackDto[]>
  bookSettings?(sessionId: string, signal?: AbortSignal): Promise<ReaderBookSettingsSnapshotDto>
  updateBookSettings?(sessionId: string, expectedRevision: number, patch: ReaderBookSettingsPatchDto, signal?: AbortSignal): Promise<ReaderBookSettingsUpdateDto>
  listPageCatalog?(sessionId: string, cursor: number, limit: number, options: { query?: string; thumbnails?: boolean }, signal?: AbortSignal): Promise<ReaderPageListDto>
  pageAction?(sessionId: string, pageId: string, action: "copy" | "reveal" | "open", signal?: AbortSignal): Promise<ReaderPageCopyActionDto | void>
  releasePageActionLease?(sessionId: string, leaseToken: string): Promise<void>
  metadata?(sessionId: string, signal?: AbortSignal): Promise<ReaderMetadataDto>
  pageMediaInformation?(sessionId: string, signal?: AbortSignal): Promise<ReaderPageMediaInformationDto>
  diagnostics?(signal?: AbortSignal): Promise<ReaderStorageDiagnosticsDto>
  systemMonitorSnapshot?(signal?: AbortSignal): Promise<ReaderSystemMonitorSnapshotDto>
  preloadDiagnostics?(sessionId: string, signal?: AbortSignal): Promise<ReaderStorageDiagnosticsDto>
  runPreloadAction?(sessionId: string, action: ReaderPreloadActionDto, signal?: AbortSignal): Promise<ReaderPreloadActionResultDto>
  updatePreloadContext?(sessionId: string, context: ReaderPreloadContextDto, signal?: AbortSignal): Promise<ReaderPreloadPlanDto>
  reportPreloadEvents?(sessionId: string, generation: number, events: readonly ReaderPreloadEventDto[], signal?: AbortSignal): Promise<ReaderPreloadReportResultDto>
  thumbnailMaintenance?(signal?: AbortSignal): Promise<ReaderThumbnailMaintenanceSnapshotDto>
  cleanupThumbnails?(command: ReaderThumbnailCleanupCommandDto, signal?: AbortSignal): Promise<ReaderThumbnailCleanupResultDto>
  clearThumbnailFolderManifests?(prefix: string, limit?: number, signal?: AbortSignal): Promise<number>
  clearThumbnailFailures?(limit?: number, signal?: AbortSignal): Promise<number>
  openSystemPath?(path: string, signal?: AbortSignal): Promise<void>
  revealSystemPath?(path: string, signal?: AbortSignal): Promise<void>
  explorerContextMenuPreview?(signal?: AbortSignal): Promise<ReaderExplorerContextMenuPreviewDto>
  explorerContextMenuStatus?(signal?: AbortSignal): Promise<ReaderExplorerContextMenuStatusDto>
  setExplorerContextMenuEnabled?(enabled: boolean, confirmed?: boolean, signal?: AbortSignal): Promise<ReaderExplorerContextMenuStatusDto>
  executeFileOperations?(operations: readonly ReaderFileMutationDto[], confirmed?: boolean, signal?: AbortSignal): Promise<ReaderFileOperationBatchResultDto>
  fileUndoState?(signal?: AbortSignal): Promise<ReaderFileUndoStateDto>
  undoLatestFileOperations?(confirmed?: boolean, signal?: AbortSignal): Promise<ReaderFileUndoResultDto>
  discardFileUndo?(confirmed?: boolean, signal?: AbortSignal): Promise<ReaderFileUndoDiscardResultDto>
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
  listRecent?(offset: number, limit: number, signal?: AbortSignal, query?: ReaderLibraryQueryDto): Promise<readonly ReaderRecentDto[]>
  summarizeFolderProgress?(path: string, signal?: AbortSignal): Promise<ReaderFolderProgressSummaryDto>
  readOpdsCatalog?(url: string, signal?: AbortSignal): Promise<ReaderOpdsCatalogDto>
  searchOpdsCatalog?(template: string, query: string, signal?: AbortSignal): Promise<ReaderOpdsCatalogDto>
  removeRecent?(bookId: string, signal?: AbortSignal): Promise<void>
  removeRecents?(ids: readonly string[], signal?: AbortSignal): Promise<ReaderRecentBatchRemoveResultDto>
  cleanupRecents?(request: ReaderRecentCleanupRequestDto, signal?: AbortSignal): Promise<ReaderRecentCleanupResultDto>
  cleanupInvalidLibrary?(kind: "recents" | "bookmarks" | "both", signal?: AbortSignal): Promise<ReaderInvalidLibraryCleanupResultDto>
  listBookmarks?(offset: number, limit: number, listId?: string, signal?: AbortSignal, query?: ReaderLibraryQueryDto): Promise<readonly ReaderBookmarkDto[]>
  findBookmarkByPath?(path: string, signal?: AbortSignal): Promise<ReaderBookmarkDto | undefined>
  saveBookmark?(bookmark: SaveReaderBookmarkDto, signal?: AbortSignal): Promise<ReaderBookmarkDto>
  updateBookmark?(id: string, patch: UpdateReaderBookmarkDto, signal?: AbortSignal): Promise<ReaderBookmarkDto>
  updateBookmarks?(updates: readonly ReaderBookmarkBatchUpdateDto[], signal?: AbortSignal): Promise<ReaderBookmarkBatchResultDto>
  removeBookmark?(id: string, signal?: AbortSignal): Promise<void>
  removeBookmarks?(ids: readonly string[], signal?: AbortSignal): Promise<ReaderBookmarkBatchRemoveResultDto>
  listBookmarkLists?(signal?: AbortSignal): Promise<readonly ReaderBookmarkListDto[]>
  libraryStatistics?(signal?: AbortSignal): Promise<ReaderLibraryStatisticsDto>
  saveBookmarkList?(list: { id?: string; name: string; isFavorite?: boolean; createdAt?: number }, signal?: AbortSignal): Promise<ReaderBookmarkListDto>
  removeBookmarkList?(id: string, signal?: AbortSignal): Promise<void>
  navigate(sessionId: string, action: "next" | "previous", signal?: AbortSignal): Promise<ReaderNavigationDto>
  goTo(sessionId: string, pageIndex: number, signal?: AbortSignal): Promise<ReaderNavigationDto>
  updateSessionOptions(sessionId: string, patch: { direction?: FrameSnapshot["direction"]; layout?: Partial<ReaderLayout> }, signal?: AbortSignal): Promise<ReaderNavigationDto>
  updatePageOrder?(sessionId: string, patch: Partial<ReaderPageOrderDto>, signal?: AbortSignal): Promise<ReaderNavigationDto & { pageOrder: ReaderPageOrderDto }>
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
    updateBookDefaults: (patch, signal) => request<ReaderRuntimeConfigDto>("/reader/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      signal,
    }).then((value) => value.book),
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
    updateMedia: (patch, signal) => request<ReaderRuntimeConfigDto>("/reader/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      signal,
    }).then((value) => value.media),
    updateImageProcessing: (patch, signal) => request<ReaderRuntimeConfigDto>("/reader/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      signal,
    }).then((value) => {
      if (!value.imageProcessing) throw new Error("Reader backend omitted image processing config")
      return value.imageProcessing
    }),
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
    inspectLegacySettings: (content, modules, signal) => request<ReaderSettingsMigrationInspection>("/reader/settings/migration/inspect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content, ...(modules ? { modules } : {}) }),
        signal,
    }),
    importLegacySettings: (content, strategy = "merge", modules, signal) => request<ReaderSettingsMigrationImportResult>("/reader/settings/migration/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content, strategy, confirmed: true, ...(modules ? { modules } : {}) }),
        signal,
    }),
    updateColorFilter: (patch, signal) => request<ReaderRuntimeConfigDto>("/reader/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      signal,
    }).then((value) => value.colorFilter),
    updatePageTransition: (patch, signal) => request<ReaderRuntimeConfigDto>("/reader/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      signal,
    }).then((value) => value.pageTransition),
    updateSwitchToast: (patch, signal) => request<ReaderRuntimeConfigDto>("/reader/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      signal,
    }).then((value) => value.switchToast),
    updateInfoOverlay: (patch, signal) => request<ReaderRuntimeConfigDto>("/reader/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      signal,
    }).then((value) => value.infoOverlay),
    updateSystemMonitor: (patch, signal) => request<ReaderRuntimeConfigDto>("/reader/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      signal,
    }).then((value) => value.systemMonitor),
    updateImageTrim: (patch, signal) => request<ReaderRuntimeConfigDto>("/reader/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      signal,
    }).then((value) => value.imageTrim),
    updateSuperResolution: (patch, signal) => request<ReaderRuntimeConfigDto>("/reader/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      signal,
    }).then((value) => value.superResolution!),
    upscalePage: (sessionId, pageId, trigger = "automatic-current", signal) => request<ReaderUpscaleArtifactResultDto>(
      `/reader/s/${encodeURIComponent(sessionId)}/pages/${encodeURIComponent(pageId)}/upscale-artifact?${new URLSearchParams({ trigger })}`,
      { method: "POST", signal },
    ),
    upscaleCapabilities: (sessionId, refresh = false, signal) => {
      const search = refresh ? "?refresh=true" : ""
      const path = sessionId
        ? `/reader/s/${encodeURIComponent(sessionId)}/upscale-capabilities`
        : "/reader/upscale-capabilities"
      return request<ReaderUpscaleCapabilityDto>(`${path}${search}`, { signal })
    },
    upscalePreloadSnapshots: (sessionId, signal) => request<{ snapshots: ReaderUpscalePreloadSnapshotDto[] }>(
      `/reader/s/${encodeURIComponent(sessionId)}/upscale-preload`,
      { signal },
    ).then((value) => value.snapshots),
    startUpscalePreload: (sessionId, mode, signal) => request<{ snapshots: ReaderUpscalePreloadSnapshotDto[] }>(
      `/reader/s/${encodeURIComponent(sessionId)}/upscale-preload/start?${new URLSearchParams({ mode })}`,
      { method: "POST", signal },
    ).then((value) => value.snapshots),
    upscaleCache: (sessionId, signal) => request<ReaderUpscaleCacheSnapshotDto>(
      `/reader/s/${encodeURIComponent(sessionId)}/upscale-artifact-cache`,
      { signal },
    ),
    cleanupUpscaleCache: (sessionId, kind, signal) => request<ReaderUpscaleCacheCleanupDto>(
      `/reader/s/${encodeURIComponent(sessionId)}/upscale-artifact-cache?${new URLSearchParams({ kind, confirmed: "true" })}`,
      { method: "POST", signal },
    ),
    open: (path, signal, provenance) => request<ReaderSessionDto>("/reader/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, ...(provenance ? { provenance } : {}) }),
      signal,
    }),
    reload: (sessionId, signal) => request<ReaderSessionDto>(
      `/reader/s/${encodeURIComponent(sessionId)}/reload`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        signal,
      },
    ),
    waitForSourceChanges: (sessionId, afterRevision, signal) => request<ReaderSourceChangeDto | undefined>(
      `/reader/s/${encodeURIComponent(sessionId)}/source-changes?after=${encodeURIComponent(String(afterRevision))}`,
      { signal },
    ),
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
    resolveFolderPenetration: (sessionId, path, policy, signal) => request<ReaderFolderPenetrationResolutionDto>(
      `/reader/browser/s/${encodeURIComponent(sessionId)}/penetration/resolve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path, ...(policy ? { policy } : {}) }),
        signal,
      },
    ),
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
      for (const tag of options.includeTags ?? []) search.append("tag", tag)
      for (const tag of options.excludeTags ?? []) search.append("excludeTag", tag)
      if (options.tagMode) search.set("tagMode", options.tagMode)
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
    directorySizes: (sessionId, generation, paths, signal) => request<ReaderDirectorySizeBatchDto>(
      `/reader/browser/s/${encodeURIComponent(sessionId)}/directory-sizes`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ generation, paths }),
        signal,
      },
    ),
    resolveDirectorySelection: (sessionId, selection, previewLimit = 64, signal) => request<ReaderDirectorySelectionResolutionDto>(
      `/reader/browser/s/${encodeURIComponent(sessionId)}/selection`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ selection, previewLimit }),
        signal,
      },
    ),
    readDirectoryEmm: (sessionId, generation, paths, signal) => request<ReaderDirectoryEmmReadResultDto>(
      `/reader/browser/s/${encodeURIComponent(sessionId)}/emm-metadata/read`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ generation, paths }),
        signal,
      },
    ),
    editDirectoryEmm: (sessionId, command, signal) => request<ReaderDirectoryEmmEditResultDto>(
      `/reader/browser/s/${encodeURIComponent(sessionId)}/emm-metadata`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(command),
        signal,
      },
    ),
    suggestDirectoryEmmTags: (count = 8, signal) => request<{ tags: ReaderEmmTagSuggestionDto[] }>(
      `/reader/browser/emm-tags/suggestions?count=${count}`,
      { signal },
    ).then((value) => value.tags),
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
    prewarmLibraryThumbnails: (items, options, signal) => requestLibraryThumbnailWarmup(
      resolveConfig,
      items,
      options,
      signal,
    ),
    releaseLibraryThumbnailContext: (contextId) => request<void>(
      `/reader/library/contexts/${encodeURIComponent(contextId)}`,
      { method: "DELETE", keepalive: true },
    ),
    listPages: (sessionId, cursor, limit, signal) => request<ReaderPageListDto>(
      `/reader/s/${encodeURIComponent(sessionId)}/pages?cursor=${cursor}&limit=${limit}`,
      { signal },
    ),
    frameWindow: (sessionId, centerPageIndex, radius, signal) => request<ReaderFrameWindowDto>(
      `/reader/s/${encodeURIComponent(sessionId)}/frame-window?center=${centerPageIndex}&radius=${radius}`,
      { signal },
    ),
    mediaProgress: (sessionId, signal) => request<{ progress: ReaderMediaProgressDto | null }>(
      `/reader/s/${encodeURIComponent(sessionId)}/media-progress`,
      { signal },
    ).then((value) => value.progress ?? undefined),
    updateMediaProgress: (sessionId, progress, flush = false, signal) => request<{ progress: ReaderMediaProgressDto }>(
      `/reader/s/${encodeURIComponent(sessionId)}/media-progress`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...progress, flush }),
        signal,
      },
    ).then((value) => value.progress),
    subtitleTracks: (sessionId, pageId, signal) => request<{ tracks: ReaderSubtitleTrackDto[] }>(
      `/reader/s/${encodeURIComponent(sessionId)}/subtitles?pageId=${encodeURIComponent(pageId)}`,
      { signal },
    ).then((value) => value.tracks),
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
    systemMonitorSnapshot: (signal) => request<ReaderSystemMonitorSnapshotDto>("/reader/diagnostics/system", { signal }),
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
    updatePreloadContext: (sessionId, context, signal) => request<{ preload: ReaderPreloadPlanDto }>(
      `/reader/s/${encodeURIComponent(sessionId)}/preload-context`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(context),
        signal,
      },
    ).then((value) => value.preload),
    reportPreloadEvents: (sessionId, generation, events, signal) => request<ReaderPreloadReportResultDto>(
      `/reader/s/${encodeURIComponent(sessionId)}/preload-events`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ generation, events }),
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
      if (command.kind === "path-prefix") return { kind: command.kind, prefix: command.prefix.trim(), deleted: response.deleted! }
      return { kind: command.kind, deleted: response.deleted! }
    },
    clearThumbnailFolderManifests: (prefix, limit = 500, signal) => request<{ deleted: number }>(
      "/reader/thumbnails/maintenance/folder-manifests/clear",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prefix, limit }),
        signal,
      },
    ).then((value) => value.deleted),
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
    explorerContextMenuPreview: (signal) => request<ReaderExplorerContextMenuPreviewDto>("/reader/system/explorer-context-menu/preview", { signal }),
    explorerContextMenuStatus: (signal) => request<ReaderExplorerContextMenuStatusDto>("/reader/system/explorer-context-menu/status", { signal }),
    setExplorerContextMenuEnabled: (enabled, confirmed = false, signal) => request<ReaderExplorerContextMenuStatusDto>("/reader/system/explorer-context-menu", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled, ...(confirmed ? { confirmed: true } : {}) }),
      signal,
    }),
    executeFileOperations: (operations, confirmed = false, signal) => request<ReaderFileOperationBatchResultDto>("/reader/files/operations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operations, ...(confirmed ? { confirmed: true } : {}) }),
      signal,
    }),
    fileUndoState: (signal) => request<ReaderFileUndoStateDto>("/reader/files/operations", { signal }),
    undoLatestFileOperations: (confirmed = false, signal) => request<ReaderFileUndoResultDto>("/reader/files/undo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(confirmed ? { confirmed: true } : {}),
      signal,
    }),
    discardFileUndo: (confirmed = false, signal) => request<ReaderFileUndoDiscardResultDto>("/reader/files/undo/discard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(confirmed ? { confirmed: true } : {}),
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
    listRecent: (offset, limit, signal, query) => {
      const search = libraryQueryParams(offset, limit, query)
      return request<{ items: ReaderRecentDto[] }>(`/reader/library/recents?${search}`, { signal }).then((value) => value.items)
    },
    summarizeFolderProgress: (path, signal) => request<ReaderFolderProgressSummaryDto>(
      `/reader/library/progress/folder?path=${encodeURIComponent(path)}`,
      { signal },
    ),
    readOpdsCatalog: (url, signal) => request<ReaderOpdsCatalogDto>(
      `/reader/opds/catalog?url=${encodeURIComponent(url)}`,
      { signal },
    ),
    searchOpdsCatalog: (template, query, signal) => request<ReaderOpdsCatalogDto>(
      `/reader/opds/search?template=${encodeURIComponent(template)}&query=${encodeURIComponent(query)}`,
      { signal },
    ),
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
    listBookmarks: (offset, limit, listId, signal, query) => {
      const search = libraryQueryParams(offset, limit, query)
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
    libraryStatistics: (signal) => request<ReaderLibraryStatisticsDto>(
      "/reader/library/statistics",
      { signal },
    ),
    updateAiTranslation: (patch, signal) => request<ReaderRuntimeConfigDto>("/reader/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      signal,
    }).then((config) => config.aiTranslation ?? {
      enabled: false,
      autoTranslate: false,
      service: "disabled",
      ollamaUrl: "http://127.0.0.1:11434",
      ollamaModel: "",
      sourceLanguage: "ja",
      targetLanguage: "zh",
      promptTemplate: "",
      memoryCacheEntries: 1000,
    }),
    updateEmm: (patch, signal) => request<ReaderRuntimeConfigDto>("/reader/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      signal,
    }).then((config) => config.emm ?? { enabled: true, databasePaths: [], defaultRating: 4.2 }),
    aiCheck: (signal) => request<ReaderAiCheckDto>("/reader/ai/check", { signal }),
    aiModels: (signal) => request<{ items: ReaderOllamaModelDto[] }>("/reader/ai/models", { signal }).then((value) => value.items),
    aiTranslate: (body, signal) => request<ReaderAiTranslationResultDto>("/reader/ai/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    }),
    aiCacheStats: (signal) => request<ReaderAiCacheStatsDto>("/reader/ai/cache", { signal }),
    aiClearCache: (scope = "memory", signal) => request<{ cleared: number; scope: string }>(`/reader/ai/cache?scope=${encodeURIComponent(scope)}`, {
      method: "DELETE",
      signal,
    }),
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
    updatePageOrder: (sessionId, patch, signal) => request<ReaderNavigationDto & { pageOrder: ReaderPageOrderDto }>(
      `/reader/s/${encodeURIComponent(sessionId)}/page-order`,
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

type ReaderLibraryThumbnailWarmupEvent =
  | { type: "start"; total: number }
  | { type: "item"; index: number; id: string; status: "completed" | "failed"; error?: string }
  | ({ type: "complete" } & ReaderLibraryThumbnailWarmupSummaryDto)

async function requestLibraryThumbnailWarmup(
  resolveConfig: () => LocalBackendConfig,
  items: readonly ReaderLibraryThumbnailRegistrationDto[],
  options: { mode?: "ensure" | "refresh"; concurrency?: number } | undefined,
  signal?: AbortSignal,
): Promise<ReaderLibraryThumbnailWarmupSummaryDto> {
  const config = resolveConfig()
  const headers = new Headers({ "content-type": "application/json" })
  if (config.token) headers.set("x-xiranite-token", config.token)
  const response = await fetch(new URL("/reader/library/thumbnails/prewarm", config.baseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify({
      items: items.map(({ id, path, kind, previewCount }) => ({ id, path, kind, previewCount })),
      mode: options?.mode ?? "ensure",
      concurrency: options?.concurrency ?? 2,
    }),
    cache: "no-store",
    signal,
  })
  signal?.throwIfAborted()
  if (!response.ok) throw new ReaderHttpError(await responseError(response), response.status)
  if (!response.body) throw new Error("Thumbnail warmup response did not include a body.")
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let summary: ReaderLibraryThumbnailWarmupSummaryDto | undefined
  try {
    while (true) {
      const chunk = await reader.read()
      buffer += decoder.decode(chunk.value, { stream: !chunk.done })
      let newline = buffer.indexOf("\n")
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line) summary = consumeLibraryThumbnailWarmupEvent(JSON.parse(line) as ReaderLibraryThumbnailWarmupEvent, summary)
        newline = buffer.indexOf("\n")
      }
      if (chunk.done) break
    }
    const tail = buffer.trim()
    if (tail) summary = consumeLibraryThumbnailWarmupEvent(JSON.parse(tail) as ReaderLibraryThumbnailWarmupEvent, summary)
  } catch (error) {
    await reader.cancel(error).catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }
  signal?.throwIfAborted()
  if (!summary) throw new Error("Thumbnail warmup stream ended before completion.")
  return summary
}

function consumeLibraryThumbnailWarmupEvent(
  event: ReaderLibraryThumbnailWarmupEvent,
  summary: ReaderLibraryThumbnailWarmupSummaryDto | undefined,
): ReaderLibraryThumbnailWarmupSummaryDto | undefined {
  if (summary) throw new Error("Thumbnail warmup stream emitted data after completion.")
  if (event.type !== "complete") return undefined
  if (![event.total, event.completed, event.failed].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new Error("Thumbnail warmup stream returned an invalid summary.")
  }
  return { total: event.total, completed: event.completed, failed: event.failed }
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

function libraryQueryParams(offset: number, limit: number, query?: ReaderLibraryQueryDto): URLSearchParams {
  const search = new URLSearchParams({ offset: String(offset), limit: String(limit) })
  if (query?.search) search.set("search", query.search)
  if (query?.sort) {
    search.set("sort", query.sort.field)
    search.set("order", query.sort.order)
  }
  return search
}
