export {
  runNeoview,
  type NeoViewInput,
  type NeoViewMigrationStatus,
  type NeoViewNodeData,
  type NeoViewRuntime,
} from "./application/node/runNeoview.js"
export { CoreReaderService } from "./application/reader/ReaderService.js"
export { CoreReaderSession } from "./application/reader/ReaderSession.js"
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
export type { ReadingDirection, TailOverflowBehavior } from "./domain/navigation/navigation.js"
export type { PageDimensions, PageId, PageMediaKind, ReaderPage } from "./domain/page/page.js"
export type { PageByteRange, PageContent, PageSource } from "./domain/page/page-content.js"
export type { ImageMetadataProbe, ProbedImageFormat, ProbedImageMetadata } from "./ports/ImageMetadataProbe.js"
export {
  type ArchiveByteRange,
  type ArchiveCapabilities,
  type ArchiveEntry,
  type ArchiveEntryKind,
  type ArchiveProvider,
  type MaterializedEntryLease,
  type OpenArchiveEntryOptions,
} from "./ports/ArchiveProvider.js"
export type { ReaderBookLoader } from "./ports/ReaderBookLoader.js"
