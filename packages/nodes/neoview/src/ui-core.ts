export type { ReaderBook, ViewSource } from "./domain/book/book.js"
export {
  projectReaderBookInformation,
  type ReaderBookInformationInput,
  type ReaderBookInformationLanguage,
  type ReaderBookInformationProjection,
} from "./domain/book/BookInformationProjection.js"
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
export {
  cloneReaderInputBindings,
  DEFAULT_READER_INPUT_BINDINGS,
  matchingReaderInputBinding,
  READER_INPUT_ACTION_CATEGORIES,
  READER_INPUT_ACTION_CATEGORY_LABELS,
  READER_INPUT_ACTION_LABELS,
  READER_INPUT_ACTION_METADATA,
  READER_INPUT_ACTIONS,
  READER_INPUT_CONTEXT_LABELS,
  READER_INPUT_CONTEXT_PRIORITY,
  READER_INPUT_CONTEXTS,
  readerInputConflictKey,
  readerInputConflicts,
  readerInputDescriptorKey,
  type ReaderInputAction,
  type ReaderInputActionCategory,
  type ReaderInputActionMetadata,
  type ReaderInputBinding,
  type ReaderInputBindingsConfig,
  type ReaderInputConflict,
  type ReaderInputContext,
  type ReaderInputDescriptor,
} from "./domain/input/ReaderInputBindings.js"
export type {
  PageDimensions,
  PageId,
  PageMediaKind,
  ReaderPage,
  ReaderPageTimestamps,
  ReaderPageTimeSource,
} from "./domain/page/page.js"
export {
  formatReaderTimestamp,
  projectReaderTimeInformation,
  type ReaderTimeInformationLanguage,
  type ReaderTimeInformationInput,
  type ReaderTimeInformationProjection,
} from "./domain/page/TimeInformationProjection.js"
export {
  ReaderSlideshow,
  type ReaderSlideshowConfig,
  type ReaderSlideshowOptions,
  type ReaderSlideshowPosition,
  type ReaderSlideshowSnapshot,
  type ReaderSlideshowState,
} from "./application/slideshow/ReaderSlideshow.js"
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
