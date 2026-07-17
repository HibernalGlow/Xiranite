export {
  runNeoview,
  type NeoViewInput,
  type NeoViewMigrationStatus,
  type NeoViewNodeData,
  type NeoViewRuntime,
} from "./application/node/runNeoview.js"
export { CoreReaderService } from "./application/reader/ReaderService.js"
export {
  ReaderBookMetadataService,
  type ReaderBookStaticMetadata,
} from "./application/metadata/ReaderBookMetadataService.js"
export {
  ReaderPageMediaInformationService,
  type ReaderPageMediaInformation,
} from "./application/metadata/ReaderPageMediaInformationService.js"
export type {
  ReaderPageMediaDetails,
  ReaderPageMediaMetadataInput,
  ReaderPageMediaMetadataProvider,
  ReaderPageMediaMetadataProviderLoader,
  ReaderPageMediaMetadataRequest,
} from "./ports/ReaderPageMediaMetadataProvider.js"
export {
  legacyEmmBookPathKey,
  parseLegacyEmmBookMetadata,
  type ReaderBookEmmMetadata,
} from "./application/metadata/LegacyEmmBookMetadataCodec.js"
export {
  ReaderEmmMetadataRevisionConflict,
  ReaderEmmMetadataService,
  ReaderEmmMetadataPatchSchema,
  ReaderEmmMetadataSnapshotSchema,
  type ReaderEmmMetadataPatch,
  type ReaderEmmMetadataSnapshot,
} from "./application/metadata/ReaderEmmMetadataService.js"
export {
  ReaderDirectoryEmmEditCommandSchema,
  ReaderDirectoryEmmEditService,
  ReaderDirectoryEmmEditSessionNotFound,
  type ReaderDirectoryEmmEditCommand,
  type ReaderDirectoryEmmEditResult,
  type ReaderDirectoryEmmEditResultItem,
  type ReaderDirectoryEmmEditScope,
} from "./application/metadata/ReaderDirectoryEmmEditService.js"
export type {
  ReaderEmmOverrideRecord,
  ReaderEmmOverrides,
  ReaderEmmOverrideStore,
  ReaderEmmTag,
} from "./ports/ReaderEmmOverrideStore.js"
export {
  READER_DIRECTORY_FILTERS,
  ReaderFileTreeService,
  type ReaderDirectoryEntryType,
  type ReaderDirectoryFilter,
  type ReaderDirectoryNavigation,
  type ReaderDirectoryPage,
  type ReaderDirectorySizeBatch,
  type ReaderDirectorySizeBatchItem,
  type ReaderDirectorySortPreferenceCommand,
  type ReaderFileTreeServiceOptions,
} from "./application/browser/ReaderFileTreeService.js"
export type { ReaderDirectorySize, ReaderDirectorySizeProvider } from "./ports/ReaderDirectorySizeProvider.js"
export {
  ReaderFileTreeIndex,
  type ReaderFileTreeExclusionCommand,
  type ReaderFileTreeIndexOptions,
  type ReaderFileTreeNodePage,
} from "./application/browser/ReaderFileTreeIndex.js"
export {
  ReaderSearchHistoryService,
  READER_SEARCH_HISTORY_SCOPES,
  type ReaderSearchHistoryScope,
} from "./application/browser/ReaderSearchHistoryService.js"
export type {
  ReaderSearchHistoryRecord,
  ReaderSearchHistoryStore,
} from "./ports/ReaderSearchHistoryStore.js"
export {
  searchReaderFileTree,
  type ReaderFileTreeSearchEvent,
  type ReaderFileTreeSearchHandle,
  type ReaderFileTreeSearchKind,
  type ReaderFileTreeSearchMode,
  type ReaderFileTreeSearchOptions,
} from "./application/browser/ReaderFileTreeSearch.js"
export {
  DEFAULT_READER_DIRECTORY_SORT,
  READER_DIRECTORY_SORT_FIELDS,
  sortReaderDirectoryEntries,
  type ReaderDirectorySortField,
  type ReaderDirectorySortOrder,
  type ReaderDirectorySortRule,
} from "./application/browser/ReaderDirectorySort.js"
export {
  CoreReaderDirectorySortPreferences,
  MemoryReaderDirectorySortPreferenceStore,
  normalizeDirectorySortPath,
  type ReaderDirectorySortDefaultScope,
  type ReaderDirectorySortPreferenceSnapshot,
  type ReaderDirectorySortPreferenceStore,
  type ReaderDirectorySortSource,
} from "./application/browser/ReaderDirectorySortPreferences.js"
export {
  ReaderCacheService,
  type ReaderCacheMaintenanceReason,
  type ReaderCacheMaintenanceResult,
  type ReaderCacheStatus,
} from "./application/cache/ReaderCacheService.js"
export {
  ReaderDiagnosticsService,
  type ReaderAssetDiagnostics,
  type ReaderDiagnosticsSnapshot,
  type ReaderDiagnosticsSources,
  type ReaderSchedulerPoolDiagnostics,
} from "./application/diagnostics/ReaderDiagnosticsService.js"
export {
  ReaderDiagnosticsWireSchema,
  parseReaderDiagnosticsSnapshot,
} from "./application/diagnostics/ReaderDiagnosticsWireSchema.js"
export {
  ReaderThumbnailMaintenanceService,
  type ReaderThumbnailCleanupCommand,
  type ReaderThumbnailCleanupResult,
  type ReaderThumbnailFailureCleanupResult,
  type ReaderThumbnailMaintenancePort,
  type ReaderThumbnailMaintenanceStatus,
} from "./application/thumbnails/ReaderThumbnailMaintenanceService.js"
export {
  ReaderPreloadCoordinator,
  type ReaderNavigationIntent,
  type ReaderPreloadCandidate,
  type ReaderPreloadCoordinatorOptions,
  type ReaderPreloadDirection,
  type ReaderPreloadPlan,
  type ReaderPreloadTier,
} from "./application/preloading/PreloadCoordinator.js"
export {
  ReaderPreloadTelemetry,
  aggregateReaderPreloadTelemetry,
  type ReaderPreloadDiagnostics,
  type ReaderPreloadOutcome,
  type ReaderPreloadReport,
  type ReaderPreloadReportResult,
  type ReaderPreloadTelemetrySnapshot,
} from "./application/preloading/PreloadTelemetry.js"
export type { ReaderProgressRecord, ReaderProgressStore } from "./ports/ReaderProgressStore.js"
export type { ReaderMediaProgressRecord, ReaderMediaProgressStore } from "./ports/ReaderMediaProgressStore.js"
export type {
  ReaderBookSettingsOverrides,
  ReaderBookSettingsRecord,
  ReaderBookSettingsImportRecord,
  ReaderBookSettingsImportResult,
  ReaderBookSettingsStore,
} from "./ports/ReaderBookSettingsStore.js"
export {
  ReaderBookSettingsPatchSchema,
  ReaderBookSettingsSnapshotSchema,
  ReaderBookSettingsRevisionConflict,
  ReaderBookSettingsService,
  parseReaderBookSettingsSnapshot,
  readerBookSettingsDefaults,
} from "./application/reader/ReaderBookSettingsService.js"
export type {
  ReaderBookSettingsDefaults,
  ReaderBookSettingsPatch,
  ReaderBookSettingsSnapshot,
} from "./application/reader/ReaderBookSettingsService.js"
export { ReaderBookSettingsMigrationService } from "./application/migration/ReaderBookSettingsMigrationService.js"
export type { ReaderBookSettingsMigrationInspection } from "./application/migration/ReaderBookSettingsMigrationService.js"
export { LegacyBookSettingsCodec } from "./migration/LegacyBookSettingsCodec.js"
export type {
  DecodedLegacyBookSettings,
  LegacyBookSettingsEntry,
  LegacyBookSettingsReport,
} from "./migration/LegacyBookSettingsCodec.js"
export { LegacyBookSettingsImporter } from "./migration/LegacyBookSettingsImporter.js"
export type {
  LegacyBookSettingsImportResult,
  ResolvedBookSettingsIdentity,
} from "./migration/LegacyBookSettingsImporter.js"
export { ReaderMediaProgressService, type ReaderMediaProgressUpdate } from "./application/reader/ReaderMediaProgressService.js"
export {
  ReaderClipboardMaterializationService,
  type ReaderClipboardMaterialization,
  type ReaderClipboardMaterializationServiceOptions,
} from "./application/reader/ReaderClipboardMaterializationService.js"
export type {
  ReaderPageMaterializer,
  ReaderPageMaterializationLease,
} from "./ports/ReaderPageMaterializer.js"
export type {
  ReaderThumbnailDatabaseBackupResult,
  ReaderThumbnailDatabaseCompatibility,
  ReaderThumbnailDatabaseMaintenance,
  ReaderThumbnailDatabaseOptimizeResult,
} from "./ports/ReaderThumbnailDatabaseMaintenance.js"
export {
  ReaderLibraryService,
  READER_SYSTEM_BOOKMARK_LIST_IDS,
  type SaveReaderBookmarkInput,
  type SaveReaderBookmarkListInput,
  type UpdateReaderBookmarkInput,
} from "./application/library/ReaderLibraryService.js"
export type {
  ReaderBookmarkListRecord,
  ReaderBookmarkQuery,
  ReaderBookmarkRecord,
  ReaderBookmarkUpdate,
  ReaderLibraryStore,
  ReaderRecentQuery,
} from "./ports/ReaderLibraryStore.js"
export { CoreReaderSession } from "./application/reader/ReaderSession.js"
export {
  ReaderAdjacentBookService,
  type ReaderAdjacentBookCandidate,
  type ReaderAdjacentBookDirection,
  type ReaderAdjacentBookRequest,
  type ReaderBookCandidatePredicate,
  type ReaderPathIdentity,
} from "./application/reader/ReaderAdjacentBookService.js"
export {
  ReaderSlideshow,
  type ReaderSlideshowConfig,
  type ReaderSlideshowOptions,
  type ReaderSlideshowPosition,
  type ReaderSlideshowSnapshot,
  type ReaderSlideshowState,
} from "./application/slideshow/ReaderSlideshow.js"
export {
  ReaderHeadlessController,
  type HeadlessPageStream,
  type HeadlessReaderBookSnapshot,
  type HeadlessReaderBookSettingsUpdate,
  type HeadlessReaderEmmMetadataUpdate,
  type HeadlessReaderPageSnapshot,
  type HeadlessReaderSnapshot,
  type OpenHeadlessReaderInput,
  type ReaderHeadlessBookSettingsOptions,
} from "./application/headless/ReaderHeadlessController.js"
export {
  ReaderFileTreeHeadlessController,
  type OpenHeadlessFileTreeInput,
} from "./application/headless/ReaderFileTreeHeadlessController.js"
export {
  ReaderLibraryHeadlessController,
  type ReaderLibrarySourceIdentity,
  type SavePathBookmarkInput,
} from "./application/headless/ReaderLibraryHeadlessController.js"
export {
  ReaderLibraryCleanupService,
  type ReaderLibraryCleanupKind,
  type ReaderLibraryCleanupRequest,
  type ReaderLibraryCleanupResult,
} from "./application/library/ReaderLibraryCleanupService.js"
export type { ReaderPathStatus, ReaderPathStatusProvider } from "./ports/ReaderPathStatusProvider.js"
export type {
  ReaderFileMutation,
  ReaderFileMutationGuard,
  ReaderFileMutationProvider,
  ReaderFileUndoReceipt,
} from "./ports/ReaderFileMutationProvider.js"
export {
  ReaderFileOperationService,
  type ReaderFileOperationBatchResult,
  type ReaderFileOperationRequest,
  type ReaderFileOperationResult,
  type ReaderFileOperationStatus,
  type ReaderFileUndoResult,
  type ReaderFileUndoDiscardResult,
  type ReaderFileUndoState,
} from "./application/files/ReaderFileOperationService.js"
export type {
  ReaderFileUndoJournalRecord,
  ReaderFileUndoJournalStore,
} from "./ports/ReaderFileUndoJournalStore.js"
export { ReaderSystemIntegrationService } from "./application/files/ReaderSystemIntegrationService.js"
export type { ReaderSystemIntegrationProvider } from "./ports/ReaderSystemIntegrationProvider.js"
export {
  DEFAULT_READER_SESSION_OPTIONS,
  type OpenViewSourceOptions,
  type ReaderService,
  type ReaderSession,
  type ReaderSessionEvent,
  type ReaderSessionId,
  type ReaderSessionOptions,
} from "./application/reader/contracts.js"
export type { ReaderBook, ViewSource } from "./domain/book/book.js"
export { normalizeArchivePath } from "./domain/archive/archive-path.js"
export { normalizeArchiveRange } from "./domain/archive/archive-range.js"
export { buildFrameSnapshot, type BuildFrameInput } from "./domain/frame/frame-builder.js"
export {
  DEFAULT_READER_LAYOUT,
  type FramePage,
  type FrameSnapshot,
  type PageMode,
  type ReaderGeneration,
  type ReaderLayout,
} from "./domain/frame/frame.js"
export {
  calculateReaderFrameSize,
  calculateReaderScale,
  DEFAULT_READER_PRESENTATION,
  normalizeReaderManualScale,
  normalizeReaderRotation,
  rotatePresentationSize,
  rotateReaderPresentation,
  stepReaderManualScale,
  type PresentationSize,
  type ReaderFitMode,
  type ReaderPresentation,
  type ReaderRotation,
} from "./domain/presentation/presentation.js"
export type { ReadingDirection, TailOverflowBehavior } from "./domain/navigation/navigation.js"
export type {
  PageDimensions,
  PageId,
  PageMediaKind,
  ReaderPage,
  ReaderPageTimestamps,
  ReaderPageTimeSource,
} from "./domain/page/page.js"
export {
  READER_CARD_MANIFEST,
  READER_PANEL_MANIFEST,
  readerCardCanMoveTo,
  readerPanelAcceptsCards,
  type ReaderCardId,
  type ReaderCardManifestEntry,
  type ReaderPanelId,
  type ReaderPanelManifestEntry,
  type ReaderPanelPosition,
} from "./application/config/ReaderLayoutManifest.js"
export type { PageByteRange, PageContent, PageSource } from "./domain/page/page-content.js"
export type { ImageMetadataProbe, ProbedImageFormat, ProbedImageMetadata } from "./ports/ImageMetadataProbe.js"
export type { ImageTransformer, ImageTransformerLoader, ImageTransformResult } from "./ports/ImageTransformer.js"
export type {
  CachedPresentation,
  ReaderPresentationCache,
  ReaderPresentationCacheSnapshot,
} from "./ports/ReaderPresentationCache.js"
export type {
  ResourceClass,
  ResourceLease,
  ResourcePriority,
  ResourceScheduler,
  ResourceTaskRequest,
} from "./ports/ResourceScheduler.js"
export {
  appendImageTransform,
  imageTransformCacheKey,
  imageTransformContentType,
  parseImageTransform,
  type ImageTransformFit,
  type ImageTransformFormat,
  type ImageTransformRequest,
} from "./domain/image/image-transform.js"
export {
  type ArchiveByteRange,
  type ArchiveCapabilities,
  type ArchiveEntry,
  type ArchiveEntryKind,
  type ArchiveProvider,
  type MaterializedEntryLease,
  type OpenArchiveEntryOptions,
} from "./ports/ArchiveProvider.js"
export type {
  ArchivePasswordInput,
  ReaderBookLoader,
  ReaderBookLoadOptions,
} from "./ports/ReaderBookLoader.js"
