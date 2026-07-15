export {
  runNeoview,
  type NeoViewInput,
  type NeoViewMigrationStatus,
  type NeoViewNodeData,
  type NeoViewRuntime,
} from "./application/node/runNeoview.js"
export { CoreReaderService } from "./application/reader/ReaderService.js"
export {
  ReaderCacheService,
  type ReaderCacheMaintenanceReason,
  type ReaderCacheMaintenanceResult,
  type ReaderCacheStatus,
} from "./application/cache/ReaderCacheService.js"
export {
  ReaderPreloadCoordinator,
  type ReaderNavigationIntent,
  type ReaderPreloadCandidate,
  type ReaderPreloadCoordinatorOptions,
  type ReaderPreloadDirection,
  type ReaderPreloadPlan,
  type ReaderPreloadTier,
} from "./application/preloading/PreloadCoordinator.js"
export type { ReaderProgressRecord, ReaderProgressStore } from "./ports/ReaderProgressStore.js"
export {
  ReaderLibraryService,
  READER_SYSTEM_BOOKMARK_LIST_IDS,
  type SaveReaderBookmarkInput,
  type SaveReaderBookmarkListInput,
} from "./application/library/ReaderLibraryService.js"
export type {
  ReaderBookmarkListRecord,
  ReaderBookmarkQuery,
  ReaderBookmarkRecord,
  ReaderLibraryStore,
  ReaderRecentQuery,
} from "./ports/ReaderLibraryStore.js"
export { CoreReaderSession } from "./application/reader/ReaderSession.js"
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
  type HeadlessReaderPageSnapshot,
  type HeadlessReaderSnapshot,
  type OpenHeadlessReaderInput,
} from "./application/headless/ReaderHeadlessController.js"
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
export type { PageDimensions, PageId, PageMediaKind, ReaderPage } from "./domain/page/page.js"
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
