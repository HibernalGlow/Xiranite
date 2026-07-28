import type { PageDimensions, PageMediaKind, ViewSource } from "@xiranite/node-neoview/ui-core"
import type { ReaderFolderPenetrationTerminalKindDto } from "./reader-folder-penetration-contract"
import type { ReaderActivationTraversalFrameDto, ReaderFileOperationResultDto } from "./reader-http-core-contract"

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
  state?: "disabled" | "registered" | "needs-repair" | "conflict" | "unavailable"
  reason?: string
}
export interface ReaderDirectorySelectionDescriptorDto {
  generation: number
  allSelected: boolean
  ranges: readonly { start: number; end: number }[]
  explicit: readonly { path: string; index?: number }[]
}
export interface ReaderFolderPenetrationPolicyDto {
  maxDepth?: number
  terminalTargets?: readonly ReaderFolderPenetrationTerminalKindDto[]
}
export interface ReaderFolderPenetrationResolutionDto {
  status: "resolved" | "branch" | "empty" | "blocked"
  originPath: string
  terminal?: { kind: ReaderFolderPenetrationTerminalKindDto; path: string }
  directMediaCount?: number
  directDirectoryCount?: number
  directFileCount?: number
  deferredDirectoryCount?: number
  chain: readonly {
    path: string
    canonicalPath: string
    ignoredSidecars: number
  }[]
  reason:
    | "archive"
    | "document"
    | "media-directory"
    | "mixed-media-directory"
    | "file"
    | "multiple-primary-items"
    | "empty"
    | "depth-limit"
    | "cycle"
    | "permission"
    | "unsupported-content"
}
export interface ReaderFolderPenetrationDescriptionDto {
  path: string
  internalFiles: readonly { name: string; path: string; kind: "file" | "directory" }[]
}
export interface ReaderActivationProvenanceDto {
  browserOriginPath: string
  browserOriginEntryPath: string
  browserOriginSelfTerminal?: boolean
  browserOriginTraversalFrames?: readonly ReaderActivationTraversalFrameDto[]
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
  | {
      available: true
      mode: "copy" | "move"
      generation: number
      total: number
      createdAt: number
    }
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
      tags?: readonly {
        namespace: string
        tag: string
        translatedLabel?: string
      }[]
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
        byLane: Readonly<
          Record<
            string,
            {
              demands: number
              cacheHits: number
              cacheMisses: number
              completed: number
              failed: number
              cancelled: number
            }
          >
        >
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
  memory: {
    totalBytes: number
    usedBytes: number
    freeBytes: number
    cachedBytes: number | null
  }
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
  | {
      kind: "invalid"
      scanned: number
      deleted: number
      unavailableVolumeRowsPreserved: number
      wrapped: boolean
    }
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
  navigation: readonly {
    title: string
    href: string
    type?: string
    rel?: string
  }[]
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
  { kind: "oldest"; limit: number } | { kind: "before"; before: number; limit?: number } | { kind: "folder"; path: string } | { kind: "all"; confirmed: true }
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
export interface ReaderPlaylistDto {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}
export interface ReaderPlaylistEntryDto {
  id: string
  playlistId: string
  source: { kind: "path" | "archive" | "directory"; path: string; entryPath?: string; entryPaths?: readonly string[] }
  name: string
  position: number
  createdAt: number
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
export interface ReaderEmmConnectionProbeDto {
  enabled: boolean
  automatic: boolean
  connected: boolean
  readOnly: true
  sources: readonly {
    path: string
    status: "compatible" | "missing" | "incompatible" | "unreadable"
    readOnly: true
    error?: string
  }[]
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
  directoryEmpty?: boolean
  collectTags?: readonly string[]
  manualTags?: readonly string[]
}
export type ReaderDirectorySizeBatchItemDto =
  { path: string; status: "ok"; bytes: number; fileCount: number } | { path: string; status: "failed"; error: string }
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
export interface ReaderManualTagSummaryDto { namespace: string; tag: string; count: number }
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
  | {
      index: number
      status: "succeeded"
      metadata: ReaderEmmMetadataSnapshotDto
    }
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
export type ReaderDirectoryMetadataFieldDto = "date" | "size" | "rating" | "collectTagCount" | "dimensions" | "pageCount" | "directoryEmpty" | "tags"
export type ReaderDirectorySortOrderDto = "asc" | "desc"
export interface ReaderDirectorySortDto {
  field: ReaderDirectorySortFieldDto
  order: ReaderDirectorySortOrderDto
  directoriesFirst: boolean
}
export type ReaderDirectorySortSourceDto = "temporary" | "memory" | "tab-default" | "global-default"
export type ReaderDirectorySortPreferenceCommandDto =
  { action: "temporary"; enabled: boolean } | { action: "set-default"; scope: "global" | "tab" } | { action: "clear-memory"; scope: "current" | "all" }
export interface ReaderDirectoryPageDto {
  sessionId: string
  navigationEntryId: number
  path: string
  parentPath?: string
  sourceKind?: "directory" | "efu"
  entries: ReaderDirectoryEntryDto[]
  cursor: number
  nextCursor?: number
  total: number
  canGoBack: boolean
  canGoForward: boolean
  generation: number
  filter?: ReaderDirectoryFilterDto
  filterOptions?: ReaderDirectoryFilterDto[]
  showHiddenFolders?: boolean
  hideMissingEfuEntries?: boolean
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
export type ReaderDirectoryNavigationDto = { action: "path"; path: string } | { action: "back" | "forward" | "up" | "refresh" }
export type ReaderDirectoryFilterDto = "all" | "library" | "archive" | "directory" | "video" | "image" | "other"
