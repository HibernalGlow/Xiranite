import type { Stats } from "node:fs"
import { createHash } from "node:crypto"
import { stat } from "node:fs/promises"
import { z } from "zod"

import { DEFAULT_READER_LAYOUT, type FrameSnapshot, type ReaderLayout } from "../../domain/frame/frame.js"
import type { ViewSource } from "../../domain/book/book.js"
import type { ReaderPage } from "../../domain/page/page.js"
import { ReaderMediaFormatRegistryRef } from "../../domain/page/media.js"
import {
  DEFAULT_READER_COLOR_FILTER,
  type ReaderColorFilterSettings,
} from "../../domain/color-filter/ReaderColorFilter.js"
import {
  DEFAULT_READER_PAGE_TRANSITION,
  type ReaderPageTransitionSettings,
} from "../../domain/page-transition/ReaderPageTransition.js"
import {
  DEFAULT_READER_SWITCH_TOAST,
  type ReaderSwitchToastSettings,
} from "../../application/switch-toast/ReaderSwitchToast.js"
import {
  DEFAULT_READER_INFO_OVERLAY,
  type ReaderInfoOverlaySettings,
} from "../../application/info-overlay/ReaderInfoOverlay.js"
import {
  DEFAULT_READER_IMAGE_TRIM,
  type ReaderImageTrimSettings,
} from "../../application/image-trim/ReaderImageTrim.js"
import { CoreReaderService } from "../../application/reader/ReaderService.js"
import { ReaderCacheService } from "../../application/cache/ReaderCacheService.js"
import type { ReaderSession, ReaderSessionId, ReaderSessionOptions } from "../../application/reader/contracts.js"
import type { ReaderPageOrder, ReaderPageOrderPatch } from "../../application/reader/ReaderPageOrder.js"
import {
  ReaderBookSettingsRevisionConflict,
  ReaderBookSettingsService,
  readerBookSettingsDefaults,
} from "../../application/reader/ReaderBookSettingsService.js"
import type { ArchivePasswordInput } from "../../ports/ReaderBookLoader.js"
import type { ReaderThumbnailStore } from "../../ports/ReaderThumbnailStore.js"
import type { ReaderProgressStore } from "../../ports/ReaderProgressStore.js"
import type { ReaderMediaProgressStore } from "../../ports/ReaderMediaProgressStore.js"
import type { ReaderSearchHistoryStore } from "../../ports/ReaderSearchHistoryStore.js"
import type { ReaderFileUndoJournalStore } from "../../ports/ReaderFileUndoJournalStore.js"
import type { ReaderBookSettingsStore } from "../../ports/ReaderBookSettingsStore.js"
import type { ReaderEmmOverrideStore } from "../../ports/ReaderEmmOverrideStore.js"
import { ReaderSearchHistoryService } from "../../application/browser/ReaderSearchHistoryService.js"
import {
  ReaderHierarchicalBookTraversal,
  type ReaderBookTraversalCursor,
} from "../../application/reader/ReaderHierarchicalBookTraversal.js"
import { ReaderFolderPenetrationResolver } from "../../application/browser/ReaderFolderPenetrationResolver.js"
import { ReaderEmmMetadataRevisionConflict, ReaderEmmMetadataService } from "../../application/metadata/ReaderEmmMetadataService.js"
import { legacyEmmBookPathKey } from "../../application/metadata/LegacyEmmBookMetadataCodec.js"
import { isReaderDirectorySortField, type ReaderDirectorySortRule } from "../../application/browser/ReaderDirectorySort.js"
import { ReaderMediaProgressService, type ReaderMediaProgressUpdate } from "../../application/reader/ReaderMediaProgressService.js"
import { ReaderClipboardMaterializationService } from "../../application/reader/ReaderClipboardMaterializationService.js"
import { ReaderSeekableMediaCache } from "../../application/reader/ReaderSeekableMediaCache.js"
import { ReaderSubtitleService } from "../../application/reader/ReaderSubtitleService.js"
import {
  ReaderDiagnosticsService,
  type ReaderSchedulerPoolDiagnostics,
  type ReaderSharedSchedulerDiagnostics,
  type ReaderVideoProcessDiagnostics,
} from "../../application/diagnostics/ReaderDiagnosticsService.js"
import { exportReaderDiagnosticsHistory, type ReaderDiagnosticsHistoryExportFormat } from "../../application/diagnostics/ReaderDiagnosticsHistoryExport.js"
import { ReaderBookMetadataService, type ReaderBookStaticMetadata } from "../../application/metadata/ReaderBookMetadataService.js"
import { ReaderPageMediaInformationService } from "../../application/metadata/ReaderPageMediaInformationService.js"
import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"
import type { ReaderPresentationDiskCache } from "../../ports/ReaderPresentationDiskCache.js"
import type { SuperResolutionArtifactPagePort } from "../../ports/SuperResolutionArtifactPagePort.js"
import type { SuperResolutionArtifactStore } from "../../ports/SuperResolutionArtifactStore.js"
import type { SuperResolutionPreloadControlPort } from "../../ports/SuperResolutionPreloadControlPort.js"
import type { ReaderLibraryService } from "../../application/library/ReaderLibraryService.js"
import type { ReaderDirectorySortPreferenceStore } from "../../application/browser/ReaderDirectorySortPreferences.js"
import type { ReaderDirectoryEmmRecordStore } from "../../ports/ReaderDirectoryEmmRecordStore.js"
import type { ReaderPreloadContext, ReaderPreloadCoordinatorOptions, ReaderPreloadPlan } from "../../application/preloading/PreloadCoordinator.js"
import type { ReaderPreloadOutcome, ReaderPreloadPerformanceMetrics } from "../../application/preloading/PreloadTelemetry.js"
import { deriveReaderPreloadResourceContext } from "../../application/preloading/PreloadResourceContext.js"
import type { SystemThumbnailProviderLoader } from "../../ports/SystemThumbnailProvider.js"
import type { VideoThumbnailProviderLoader } from "../../ports/VideoThumbnailProvider.js"
import type { ReaderPageMediaMetadataProviderLoader } from "../../ports/ReaderPageMediaMetadataProvider.js"
import { createPlatformReaderBookLoader } from "../books/PlatformReaderBookLoader.js"
import type { PlatformReaderBookLoaderOptions } from "../books/PlatformReaderBookLoader.js"
import { StreamingImageMetadataProbe } from "../images/StreamingImageMetadataProbe.js"
import { PlatformDirectoryMediaMetadataProvider } from "../filesystem/PlatformDirectoryMediaMetadataProvider.js"
import { PlatformDirectoryListingProvider } from "../filesystem/PlatformDirectoryListingProvider.js"
import { PlatformDirectoryMetadataProvider } from "../filesystem/PlatformDirectoryMetadataProvider.js"
import { platformReaderBookCandidate } from "../filesystem/PlatformReaderBookCandidate.js"
import { WeightedLruPresentationCache } from "../cache/WeightedLruPresentationCache.js"
import { SolidArchiveCache } from "../archives/sevenzip/SolidArchiveCache.js"
import { VideoProcessScheduler, type VideoProcessSchedulerSnapshot } from "../video/VideoProcessScheduler.js"
import { ReaderArchivePreloadDemandBridge } from "../archives/ReaderArchivePreloadDemandBridge.js"
import { defaultImageTransformScheduler, type PriorityResourceSchedulerSnapshot } from "../scheduler/PriorityResourceScheduler.js"
import { ReaderAssetRoute, type ReaderAssetRouteOptions } from "./ReaderAssetRoute.js"
import { SuperResolutionArtifactRoute } from "./SuperResolutionArtifactRoute.js"
import { LibraryThumbnailRoute } from "./LibraryThumbnailRoute.js"
import { PlatformThumbnailPipeline } from "../thumbnails/PlatformThumbnailPipeline.js"
import { ThumbnailMaintenanceRoute } from "./ThumbnailMaintenanceRoute.js"
import { ReaderDirectoryBrowserRoute } from "./ReaderDirectoryBrowserRoute.js"
import { ReaderLibraryHttpController } from "./ReaderLibraryHttpController.js"
import { ReaderAiHttpController } from "./ReaderAiHttpController.js"
import { ReaderOpdsHttpController, type ReaderOpdsCatalogReader } from "./ReaderOpdsHttpController.js"
import { ReaderFileOperationHttpController } from "./ReaderFileOperationHttpController.js"
import { ReaderSystemIntegrationHttpController } from "./ReaderSystemIntegrationHttpController.js"
import { ReaderSettingsMigrationHttpController } from "./ReaderSettingsMigrationHttpController.js"
import { ReaderBookSettingsMigrationHttpController } from "./ReaderBookSettingsMigrationHttpController.js"
import { ReaderSourceWatchService } from "../../application/reader/ReaderSourceWatchService.js"
import type { ReaderSourceWatcher } from "../../ports/ReaderSourceWatcher.js"
import type { ReaderExplorerContextMenuProvider } from "../../ports/ReaderExplorerContextMenuProvider.js"
import { PlatformReaderSourceWatcher } from "../filesystem/PlatformReaderSourceWatcher.js"
import type { ReaderSettingsMigrationService } from "../../application/migration/ReaderSettingsMigrationService.js"
import type { ReaderSettingsPortableService } from "../../application/migration/ReaderSettingsPortableService.js"
import type { ReaderBookSettingsMigrationService } from "../../application/migration/ReaderBookSettingsMigrationService.js"
import { ReaderLibraryCleanupService } from "../../application/library/ReaderLibraryCleanupService.js"
import { PlatformReaderPathStatusProvider } from "../filesystem/PlatformReaderPathStatusProvider.js"
import { PlatformReaderPageMaterializer } from "../content/PlatformReaderPageMaterializer.js"
import { PlatformEmmTranslationSource } from "../emm/PlatformEmmTranslationSource.js"
import { WINDOWS_PRESENTATION_PRODUCER_VERSION } from "../cache/PresentationCacheKey.js"
import { ReaderMemoryPressureMonitor } from "../memory/ReaderMemoryPressureMonitor.js"
import { ReaderSystemMonitorService } from "../diagnostics/ReaderSystemMonitorService.js"
import {
  parseNeoviewFolderViewPatch,
  DEFAULT_NEOVIEW_BOOKMARK_LIST_CONFIG,
  DEFAULT_NEOVIEW_HISTORY_LIST_CONFIG,
  DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG,
  DEFAULT_NEOVIEW_SHELL_CONFIG,
  DEFAULT_NEOVIEW_SLIDESHOW_CONFIG,
  DEFAULT_NEOVIEW_MEDIA_CONFIG,
  DEFAULT_NEOVIEW_PAGE_LIST_CONFIG,
  DEFAULT_NEOVIEW_BOOK_CONFIG,
  DEFAULT_NEOVIEW_VIEW_DEFAULTS,
  DEFAULT_NEOVIEW_SUPER_RESOLUTION_CONFIG,
  DEFAULT_NEOVIEW_SYSTEM_MONITOR_CONFIG,
  parseNeoviewBoardLayoutPatch,
  parseNeoviewCardLayoutPatch,
  parseNeoviewShellControlPatch,
  parseNeoviewSidebarLayoutPatch,
  parseNeoviewSlideshowPatch,
  parseNeoviewMediaPatch,
  parseNeoviewColorFilterPatch,
  parseNeoviewPageTransitionPatch,
  parseNeoviewSwitchToastPatch,
  parseNeoviewInfoOverlayPatch,
  parseNeoviewSystemMonitorPatch,
  parseNeoviewAiTranslationPatch,
  DEFAULT_NEOVIEW_AI_TRANSLATION_CONFIG,
  parseNeoviewImageTrimPatch,
  parseNeoviewSuperResolutionPreferencesPatch,
  parseNeoviewBookmarkListPatch,
  parseNeoviewHistoryListPatch,
  parseNeoviewPageListPatch,
  parseNeoviewBookPatch,
  parseNeoviewViewDefaultsPatch,
  type NeoviewSlideshowConfig,
  type NeoviewSlideshowPatch,
  type NeoviewMediaConfig,
  type NeoviewMediaPatch,
  type NeoviewColorFilterPatch,
  type NeoviewPageTransitionPatch,
  type NeoviewSwitchToastPatch,
  type NeoviewInfoOverlayPatch,
  type NeoviewSystemMonitorConfig,
  type NeoviewAiTranslationConfig,
  type NeoviewAiTranslationPatch,
  type NeoviewSystemMonitorPatch,
  type NeoviewImageTrimPatch,
  type NeoviewSuperResolutionConfig,
  type NeoviewSuperResolutionPatch,
  type NeoviewShellConfig,
  type NeoviewShellConfigPatch,
  type NeoviewViewDefaults,
  type NeoviewViewDefaultsPatch,
  type NeoviewBookmarkListConfig,
  type NeoviewBookmarkListPatch,
  type NeoviewHistoryListConfig,
  type NeoviewHistoryListPatch,
  type NeoviewPageListConfig,
  type NeoviewPageListPatch,
  type NeoviewBookConfig,
  type NeoviewBookPatch,
  type NeoviewFolderViewConfig,
  type NeoviewFolderViewPatch,
  type NeoviewFileTreeConfig,
} from "../../application/config/ReaderRuntimeConfig.js"
import {
  parseNeoviewInputBindingsPatch,
  type NeoviewInputBindingsPatch,
} from "../../application/config/ReaderInputBindingsConfig.js"
import {
  cloneReaderRadialMenuConfig,
  DEFAULT_READER_RADIAL_MENU_CONFIG,
  parseReaderRadialMenuPatch,
  type NeoviewRadialMenuPatch,
  type ReaderRadialMenuConfig,
} from "../../application/config/ReaderRadialMenuConfig.js"
import {
  DEFAULT_READER_INPUT_BINDINGS,
  cloneReaderInputBindings,
  type ReaderInputBindingsConfig,
} from "../../domain/input/ReaderInputBindings.js"

const SESSION_PATH = /^\/reader\/s\/([^/]+)$/
const SESSION_RELOAD_PATH = /^\/reader\/s\/([^/]+)\/reload$/
const SESSION_SOURCE_CHANGES_PATH = /^\/reader\/s\/([^/]+)\/source-changes$/
const SESSION_PAGES_PATH = /^\/reader\/s\/([^/]+)\/pages$/
const SESSION_FRAME_WINDOW_PATH = /^\/reader\/s\/([^/]+)\/frame-window$/
const SESSION_ADJACENT_BOOK_PATH = /^\/reader\/s\/([^/]+)\/adjacent-book$/
const SESSION_PAGE_ACTION_PATH = /^\/reader\/s\/([^/]+)\/pages\/([^/]+)\/actions$/
const SESSION_NAVIGATE_PATH = /^\/reader\/s\/([^/]+)\/navigate$/
const SESSION_PRELOAD_EVENTS_PATH = /^\/reader\/s\/([^/]+)\/preload-events$/
const SESSION_PRELOAD_CONTEXT_PATH = /^\/reader\/s\/([^/]+)\/preload-context$/
const SESSION_PRELOAD_ACTIONS_PATH = /^\/reader\/s\/([^/]+)\/preload-actions$/
const SESSION_OPTIONS_PATH = /^\/reader\/s\/([^/]+)\/options$/
const SESSION_PAGE_ORDER_PATH = /^\/reader\/s\/([^/]+)\/page-order$/
const SESSION_BOOK_SETTINGS_PATH = /^\/reader\/s\/([^/]+)\/book-settings$/
const SESSION_METADATA_PATH = /^\/reader\/s\/([^/]+)\/metadata$/
const SESSION_PAGE_MEDIA_INFORMATION_PATH = /^\/reader\/s\/([^/]+)\/page-media-information$/
const SESSION_EMM_METADATA_PATH = /^\/reader\/s\/([^/]+)\/emm-metadata$/
const SESSION_MEDIA_PROGRESS_PATH = /^\/reader\/s\/([^/]+)\/media-progress$/
const SESSION_SUBTITLES_PATH = /^\/reader\/s\/([^/]+)\/subtitles$/
const SESSION_SUBTITLE_ASSET_PATH = /^\/reader\/s\/([^/]+)\/subtitle\/([^/]+)\/([^/]+)$/
const SESSION_CLIPBOARD_MATERIALIZATION_PATH = /^\/reader\/s\/([^/]+)\/clipboard-materializations(?:\/([^/]+))?$/
const PRESENTATION_CACHE_PATH = "/reader/cache/presentation"
const PRESENTATION_CACHE_CLEANUP_PATH = "/reader/cache/presentation/cleanup"
const MAX_CONTROL_BODY_BYTES = 64 * 1024
const PRELOAD_CONTEXT_FIELDS = new Set(["mode", "velocityPagesPerSecond", "stableForMs", "focused"])

export interface ReaderPageDto {
  id: string
  index: number
  name: string
  mediaKind: ReaderPage["mediaKind"]
  mimeType?: string
  byteLength?: number
  dimensions?: ReaderPage["dimensions"]
  contentVersion: string
  assetUrl: string
  thumbnailUrl?: string
}

export interface ReaderSessionDto {
  sessionId: string
  book: {
    id: string
    displayName: string
    pageCount: number
  }
  frame: FrameSnapshot
  visiblePages: ReaderPageDto[]
  pageOrder: ReaderPageOrder
  preload?: ReaderPreloadPlan
}

export type ReaderHttpControllerOptions = ReaderAssetRouteOptions & PlatformReaderBookLoaderOptions & {
  memoryPressureMonitor?: ReaderMemoryPressureMonitor
  sessionOptions?: Partial<ReaderSessionOptions>
  preloadOptions?: ReaderPreloadCoordinatorOptions
  thumbnailStore?: ReaderThumbnailStore
  loadSystemThumbnailProvider?: SystemThumbnailProviderLoader
  loadVideoThumbnailProvider?: VideoThumbnailProviderLoader
  videoProcessScheduler?: ResourceScheduler
  loadPageMediaMetadataProvider?: ReaderPageMediaMetadataProviderLoader
  disposeThumbnailStore?: () => void | Promise<void>
  progressStore?: ReaderProgressStore | false
  bookSettingsStore?: ReaderBookSettingsStore
  mediaProgressStore?: ReaderMediaProgressStore
  libraryService?: ReaderLibraryService
  directorySortPreferenceStore?: ReaderDirectorySortPreferenceStore
  directoryEmmRecordStore?: ReaderDirectoryEmmRecordStore
  emmOverrideStore?: ReaderEmmOverrideStore
  searchHistoryStore?: ReaderSearchHistoryStore
  fileUndoJournalStore?: ReaderFileUndoJournalStore
  disposeLibraryService?: boolean
  presentationDiskCache?: ReaderPresentationDiskCache
  disposePresentationDiskCache?: boolean
  superResolutionArtifactPages?: SuperResolutionArtifactPagePort
  superResolutionArtifactStore?: SuperResolutionArtifactStore
  superResolutionPreload?: SuperResolutionPreloadControlPort
  disposeSuperResolutionArtifacts?: () => void | Promise<void>
  shellOptions?: NeoviewShellConfig
  updateShellOptions?: (patch: NeoviewShellConfigPatch, tomlPatch: Record<string, unknown>) => Promise<NeoviewShellConfig>
  viewDefaults?: NeoviewViewDefaults
  updateViewDefaults?: (patch: NeoviewViewDefaultsPatch, tomlPatch: Record<string, unknown>) => Promise<NeoviewViewDefaults>
  book?: NeoviewBookConfig
  updateBook?: (patch: NeoviewBookPatch, tomlPatch: Record<string, unknown>) => Promise<NeoviewBookConfig>
  pageList?: NeoviewPageListConfig
  updatePageList?: (patch: NeoviewPageListPatch, tomlPatch: Record<string, unknown>) => Promise<NeoviewPageListConfig>
  bookmarkList?: NeoviewBookmarkListConfig
  updateBookmarkList?: (patch: NeoviewBookmarkListPatch, tomlPatch: Record<string, unknown>) => Promise<NeoviewBookmarkListConfig>
  historyList?: NeoviewHistoryListConfig
  updateHistoryList?: (patch: NeoviewHistoryListPatch, tomlPatch: Record<string, unknown>) => Promise<NeoviewHistoryListConfig>
  folderView?: NeoviewFolderViewConfig
  updateFolderView?: (patch: NeoviewFolderViewPatch, tomlPatch: Record<string, unknown>) => Promise<NeoviewFolderViewConfig>
  fileTree?: NeoviewFileTreeConfig
  updateFileTreeExclusions?: (paths: readonly string[]) => Promise<readonly string[]>
  slideshow?: NeoviewSlideshowConfig
  updateSlideshow?: (patch: NeoviewSlideshowPatch, tomlPatch: Record<string, unknown>) => Promise<NeoviewSlideshowConfig>
  media?: NeoviewMediaConfig
  updateMedia?: (patch: NeoviewMediaPatch, tomlPatch: Record<string, unknown>) => Promise<NeoviewMediaConfig>
  colorFilter?: ReaderColorFilterSettings
  updateColorFilter?: (patch: NeoviewColorFilterPatch, tomlPatch: Record<string, unknown>) => Promise<ReaderColorFilterSettings>
  pageTransition?: ReaderPageTransitionSettings
  updatePageTransition?: (patch: NeoviewPageTransitionPatch, tomlPatch: Record<string, unknown>) => Promise<ReaderPageTransitionSettings>
  switchToast?: ReaderSwitchToastSettings
  updateSwitchToast?: (patch: NeoviewSwitchToastPatch, tomlPatch: Record<string, unknown>) => Promise<ReaderSwitchToastSettings>
  infoOverlay?: ReaderInfoOverlaySettings
  updateInfoOverlay?: (patch: NeoviewInfoOverlayPatch, tomlPatch: Record<string, unknown>) => Promise<ReaderInfoOverlaySettings>
  systemMonitor?: NeoviewSystemMonitorConfig
  updateSystemMonitor?: (patch: NeoviewSystemMonitorPatch, tomlPatch: Record<string, unknown>) => Promise<NeoviewSystemMonitorConfig>
  systemMonitorService?: Pick<ReaderSystemMonitorService, "sample">
  aiTranslation?: NeoviewAiTranslationConfig
  updateAiTranslation?: (patch: NeoviewAiTranslationPatch, tomlPatch: Record<string, unknown>) => Promise<NeoviewAiTranslationConfig>
  aiTranslationCache?: import("../../ports/ReaderAiTranslation.js").ReaderAiTranslationPersistentCache
  imageTrim?: ReaderImageTrimSettings
  updateImageTrim?: (patch: NeoviewImageTrimPatch, tomlPatch: Record<string, unknown>) => Promise<ReaderImageTrimSettings>
  superResolution?: NeoviewSuperResolutionConfig
  updateSuperResolution?: (patch: NeoviewSuperResolutionPatch, tomlPatch: Record<string, unknown>) => Promise<NeoviewSuperResolutionConfig>
  inputBindings?: ReaderInputBindingsConfig
  updateInputBindings?: (patch: NeoviewInputBindingsPatch, tomlPatch: Record<string, unknown>) => Promise<ReaderInputBindingsConfig>
  radialMenu?: ReaderRadialMenuConfig
  updateRadialMenu?: (patch: NeoviewRadialMenuPatch, tomlPatch: Record<string, unknown>) => Promise<ReaderRadialMenuConfig>
  maxSeekableMediaEntryBytes?: number
  maxSeekableMediaTotalBytes?: number
  loadSettingsMigrationService?: () => Promise<ReaderSettingsMigrationService>
  loadSettingsPortableService?: () => Promise<ReaderSettingsPortableService>
  loadBookSettingsMigrationService?: () => Promise<ReaderBookSettingsMigrationService>
  sourceWatcher?: ReaderSourceWatcher
  explorerContextMenu?: ReaderExplorerContextMenuProvider
  opdsClient?: ReaderOpdsCatalogReader
}

export class ReaderHttpController implements AsyncDisposable {
  readonly #service: CoreReaderService
  readonly #assets: ReaderAssetRoute
  readonly #superResolutionArtifacts?: SuperResolutionArtifactRoute
  readonly #libraryThumbnails: LibraryThumbnailRoute
  readonly #thumbnailPipeline: PlatformThumbnailPipeline
  readonly #thumbnailMaintenance: ThumbnailMaintenanceRoute
  readonly #directoryBrowser: ReaderDirectoryBrowserRoute
  readonly #fileOperations: ReaderFileOperationHttpController
  readonly #systemIntegration: ReaderSystemIntegrationHttpController
  readonly #settingsMigration?: ReaderSettingsMigrationHttpController
  readonly #bookSettingsMigration?: ReaderBookSettingsMigrationHttpController
  readonly #library?: ReaderLibraryHttpController
  readonly #opds: ReaderOpdsHttpController
  readonly #libraryService?: ReaderLibraryService
  readonly #disposeLibraryService: boolean
  readonly #cacheService: ReaderCacheService
  readonly #mediaProgress?: ReaderMediaProgressService
  readonly #bookSettings?: ReaderBookSettingsService
  readonly #emmMetadata?: ReaderEmmMetadataService
  readonly #sourceChanges: ReaderSourceWatchService
  readonly #clipboardMaterializations: ReaderClipboardMaterializationService
  readonly #openPageMaterializationTokens = new Map<string, string>()
  readonly #seekableMedia: ReaderSeekableMediaCache
  readonly #subtitles: ReaderSubtitleService
  readonly #diagnostics: ReaderDiagnosticsService
  readonly #systemMonitorService: Pick<ReaderSystemMonitorService, "sample">
  readonly #schedulerSnapshot?: () => Readonly<Record<"cpu" | "io" | "gpu", ReaderSchedulerPoolDiagnostics>> | undefined
  readonly #sharedSchedulerSnapshot?: () => ReaderSharedSchedulerDiagnostics | undefined
  readonly #videoProcessScheduler: ResourceScheduler
  readonly #ownedVideoProcessScheduler?: VideoProcessScheduler
  readonly #videoProcessSnapshot?: () => ReaderVideoProcessDiagnostics
  readonly #bookMetadata: ReaderBookMetadataService
  readonly #pageMediaInformation: ReaderPageMediaInformationService
  readonly #bookTraversal: ReaderHierarchicalBookTraversal
  readonly #bookTraversalCursors = new Map<ReaderSessionId, ReaderBookTraversalCursor>()
  readonly #mediaFormats: ReaderMediaFormatRegistryRef
  readonly #token: string
  readonly #baseUrl: string
  readonly #solidArchiveCache: SolidArchiveCache
  readonly #ownsSolidArchiveCache: boolean
  readonly #archivePreloadDemand = new ReaderArchivePreloadDemandBridge()
  readonly #disposeThumbnailStore?: () => void | Promise<void>
  readonly #disposeSuperResolutionArtifacts?: () => void | Promise<void>
  #shellOptions: NeoviewShellConfig
  #shellRevision = 0
  #viewDefaults: NeoviewViewDefaults
  #book: NeoviewBookConfig
  #pageList: NeoviewPageListConfig
  #bookmarkList: NeoviewBookmarkListConfig
  #historyList: NeoviewHistoryListConfig
  #folderView: NeoviewFolderViewConfig
  #slideshow: NeoviewSlideshowConfig
  #media: NeoviewMediaConfig
  #colorFilter: ReaderColorFilterSettings
  #pageTransition: ReaderPageTransitionSettings
  #switchToast: ReaderSwitchToastSettings
  #infoOverlay: ReaderInfoOverlaySettings
  #systemMonitor: NeoviewSystemMonitorConfig
  #aiTranslation: NeoviewAiTranslationConfig
  readonly #ai: ReaderAiHttpController
  #imageTrim: ReaderImageTrimSettings
  #superResolution: NeoviewSuperResolutionConfig
  #inputBindings: ReaderInputBindingsConfig
  #radialMenu: ReaderRadialMenuConfig
  #sessionOptions: Partial<ReaderSessionOptions>
  readonly #updateShellOptions?: ReaderHttpControllerOptions["updateShellOptions"]
  readonly #updateViewDefaults?: ReaderHttpControllerOptions["updateViewDefaults"]
  readonly #updateBook?: ReaderHttpControllerOptions["updateBook"]
  readonly #updatePageList?: ReaderHttpControllerOptions["updatePageList"]
  readonly #updateBookmarkList?: ReaderHttpControllerOptions["updateBookmarkList"]
  readonly #updateHistoryList?: ReaderHttpControllerOptions["updateHistoryList"]
  readonly #updateFolderView?: ReaderHttpControllerOptions["updateFolderView"]
  readonly #updateSlideshow?: ReaderHttpControllerOptions["updateSlideshow"]
  readonly #updateMedia?: ReaderHttpControllerOptions["updateMedia"]
  readonly #updateColorFilter?: ReaderHttpControllerOptions["updateColorFilter"]
  readonly #updatePageTransition?: ReaderHttpControllerOptions["updatePageTransition"]
  readonly #updateSwitchToast?: ReaderHttpControllerOptions["updateSwitchToast"]
  readonly #updateInfoOverlay?: ReaderHttpControllerOptions["updateInfoOverlay"]
  readonly #updateSystemMonitor?: ReaderHttpControllerOptions["updateSystemMonitor"]
  readonly #updateAiTranslation?: ReaderHttpControllerOptions["updateAiTranslation"]
  readonly #updateImageTrim?: ReaderHttpControllerOptions["updateImageTrim"]
  readonly #updateSuperResolution?: ReaderHttpControllerOptions["updateSuperResolution"]
  readonly #updateInputBindings?: ReaderHttpControllerOptions["updateInputBindings"]
  readonly #updateRadialMenu?: ReaderHttpControllerOptions["updateRadialMenu"]
  #configUpdateQueue: Promise<void> = Promise.resolve()
  #hibernateCheck?: Promise<void>
  readonly #bookMetadataLoads = new Map<string, {
    bookId: string
    controller: AbortController
    promise: Promise<ReaderBookStaticMetadata>
  }>()

  constructor(options: ReaderHttpControllerOptions) {
    if (Boolean(options.superResolutionArtifactPages) !== Boolean(options.superResolutionArtifactStore)) {
      throw new TypeError("superResolutionArtifactPages and superResolutionArtifactStore must be provided together")
    }
    const resourceScheduler = options.resourceScheduler ?? defaultImageTransformScheduler
    const initialMedia = options.media ?? DEFAULT_NEOVIEW_MEDIA_CONFIG
    this.#mediaFormats = new ReaderMediaFormatRegistryRef(initialMedia)
    this.#ownsSolidArchiveCache = !options.solidArchiveCache
    this.#solidArchiveCache = options.solidArchiveCache ?? new SolidArchiveCache({
      maxBytes: options.maxSolidArchiveCacheBytes,
    })
    const ownedVideoProcessScheduler = options.videoProcessScheduler === undefined
      ? new VideoProcessScheduler()
      : undefined
    this.#ownedVideoProcessScheduler = ownedVideoProcessScheduler
    this.#videoProcessScheduler = options.videoProcessScheduler ?? ownedVideoProcessScheduler!
    this.#videoProcessSnapshot = videoProcessSnapshot(this.#videoProcessScheduler)
    const bookLoader = createPlatformReaderBookLoader({ ...options, solidArchiveCache: this.#solidArchiveCache, mediaFormats: this.#mediaFormats })
    const imageMetadataProbe = new StreamingImageMetadataProbe()
    const loadImageTransformer = async () => {
      const { SharpImageTransformer } = await import("../images/sharp/SharpImageTransformer.js")
      const sharp = new SharpImageTransformer(resourceScheduler)
      if (process.platform !== "win32") return sharp
      const { WindowsWicImageTransformer } = await import("../images/WindowsWicImageTransformer.js")
      return new WindowsWicImageTransformer(sharp, { resourceScheduler: resourceScheduler })
    }
    const loadVideoThumbnailProvider = options.loadVideoThumbnailProvider ?? (async () => {
      const { FfmpegVideoThumbnailProvider } = await import("../video/FfmpegVideoThumbnailProvider.js")
      return new FfmpegVideoThumbnailProvider({
        resourceScheduler: resourceScheduler,
        processScheduler: this.#videoProcessScheduler,
      })
    })
    const loadMosaicImageComposer = async () => {
      const { SharpMosaicImageComposer } = await import("../images/sharp/SharpMosaicImageComposer.js")
      return new SharpMosaicImageComposer(resourceScheduler)
    }
    const loadSystemThumbnailProvider = options.loadSystemThumbnailProvider ?? (process.platform === "win32"
      ? async () => {
          const { WindowsSystemThumbnailProvider } = await import("../windows/WindowsSystemThumbnailProvider.js")
          return new WindowsSystemThumbnailProvider({ resourceScheduler: resourceScheduler })
        }
      : undefined)
    this.#thumbnailPipeline = new PlatformThumbnailPipeline({
      bookLoader,
      loadImageTransformer,
      loadSystemThumbnailProvider,
      loadVideoThumbnailProvider,
      loadMosaicImageComposer,
      thumbnailStore: options.thumbnailStore,
      maxMemoryBytes: 32 * 1024 * 1024,
      maxEntryBytes: 512 * 1024,
      resourceScheduler: resourceScheduler,
      mediaFormats: this.#mediaFormats,
    })
    this.#service = new CoreReaderService(
      bookLoader,
      imageMetadataProbe,
      options.sessionOptions,
      options.progressStore || undefined,
      options.bookSettingsStore,
      lockedPageOrder(options.book),
      options.preloadOptions,
    )
    this.#bookSettings = options.bookSettingsStore ? new ReaderBookSettingsService(options.bookSettingsStore) : undefined
    this.#emmMetadata = options.emmOverrideStore ? new ReaderEmmMetadataService(options.emmOverrideStore) : undefined
    const emmTranslations = new PlatformEmmTranslationSource()
    const directoryMetadata = new PlatformDirectoryMetadataProvider(
      options.directoryEmmRecordStore,
      undefined,
      undefined,
      new PlatformDirectoryMediaMetadataProvider(bookLoader, imageMetadataProbe, this.#mediaFormats),
    )
    const traversalListingProvider = new PlatformDirectoryListingProvider(this.#mediaFormats)
    this.#bookTraversal = new ReaderHierarchicalBookTraversal(
      traversalListingProvider,
      directoryMetadata,
      (entry) => platformReaderBookCandidate(entry, this.#mediaFormats),
      new ReaderFolderPenetrationResolver(traversalListingProvider, { mediaFormats: this.#mediaFormats }),
    )
    this.#sourceChanges = new ReaderSourceWatchService(options.sourceWatcher ?? new PlatformReaderSourceWatcher())
    this.#bookMetadata = new ReaderBookMetadataService(options.directoryEmmRecordStore, emmTranslations)
    this.#pageMediaInformation = new ReaderPageMediaInformationService(
      options.loadPageMediaMetadataProvider ?? (async () => {
        const { FfprobePageMediaMetadataProvider } = await import("../video/FfprobePageMediaMetadataProvider.js")
        return new FfprobePageMediaMetadataProvider({
          resourceScheduler: resourceScheduler,
          processScheduler: this.#videoProcessScheduler,
        })
      }),
    )
    this.#clipboardMaterializations = new ReaderClipboardMaterializationService(
      this.#service,
      new PlatformReaderPageMaterializer({
        tempDirectory: options.archiveTempDirectory,
        resourceScheduler: resourceScheduler,
      }),
    )
    this.#seekableMedia = new ReaderSeekableMediaCache(
      new PlatformReaderPageMaterializer({
        tempDirectory: options.archiveTempDirectory,
        resourceScheduler: resourceScheduler,
        purpose: "seekable-media",
      }),
      {
        maxEntryBytes: options.maxSeekableMediaEntryBytes,
        maxTotalBytes: options.maxSeekableMediaTotalBytes,
      },
    )
    this.#subtitles = new ReaderSubtitleService(this.#service, async () => {
      const { SubsrtSubtitleConverter } = await import("../subtitles/SubsrtSubtitleConverter.js")
      return new SubsrtSubtitleConverter()
    })
    const memoryPressureMonitor = options.memoryPressureMonitor ?? new ReaderMemoryPressureMonitor()
    this.#assets = new ReaderAssetRoute(this.#service, options, {
      presentationCache: new WeightedLruPresentationCache(),
      presentationDiskCache: options.presentationDiskCache,
      presentationProducerVersion: process.platform === "win32" ? WINDOWS_PRESENTATION_PRODUCER_VERSION : undefined,
      loadImageTransformer,
      thumbnailPipeline: this.#thumbnailPipeline,
      resourceScheduler: resourceScheduler,
      seekableMediaCache: this.#seekableMedia,
      memoryPressureMonitor,
      relieveHostMemoryPressure: async (level) => {
        const snapshot = this.#solidArchiveCache.snapshot()
        await this.#solidArchiveCache.trimTo(level === "critical" ? 0 : Math.floor(snapshot.maxBytes * 0.25))
        this.#directoryBrowser.releaseMemoryPressure()
      },
    })
    this.#superResolutionArtifacts = options.superResolutionArtifactPages && options.superResolutionArtifactStore
      ? new SuperResolutionArtifactRoute(
          this.#service,
          options.superResolutionArtifactPages,
          options.superResolutionArtifactStore,
          options,
          options.superResolutionPreload,
        )
      : undefined
    this.#libraryThumbnails = new LibraryThumbnailRoute(this.#thumbnailPipeline, options)
    this.#thumbnailMaintenance = new ThumbnailMaintenanceRoute({ token: options.token, thumbnailStore: options.thumbnailStore })
    this.#directoryBrowser = new ReaderDirectoryBrowserRoute(
      options.directorySortPreferenceStore,
      options.directoryEmmRecordStore,
      new PlatformDirectoryMediaMetadataProvider(bookLoader, imageMetadataProbe, this.#mediaFormats),
      {
        excludedPaths: options.fileTree?.excludedPaths,
        updateExcludedPaths: options.updateFileTreeExclusions,
      },
      resourceScheduler,
      options.searchHistoryStore ? new ReaderSearchHistoryService(options.searchHistoryStore) : undefined,
      undefined,
      this.#mediaFormats,
      options.emmOverrideStore,
      undefined,
      emmTranslations,
    )
    this.#fileOperations = new ReaderFileOperationHttpController(async () => {
      const { ReaderFileOperationService } = await import("../../application/files/ReaderFileOperationService.js")
      const { PlatformReaderFileMutationProvider } = await import("../filesystem/PlatformReaderFileMutationProvider.js")
      return new ReaderFileOperationService(new PlatformReaderFileMutationProvider({ scheduler: resourceScheduler }), {
        journal: options.fileUndoJournalStore,
      })
    }, (sessionId, descriptor, signal) => this.#directoryBrowser.resolveSelection(sessionId, descriptor, signal))
    this.#systemIntegration = new ReaderSystemIntegrationHttpController(async () => {
      const { ReaderSystemIntegrationService } = await import("../../application/files/ReaderSystemIntegrationService.js")
      const { PlatformReaderSystemIntegrationProvider } = await import("../filesystem/PlatformReaderSystemIntegrationProvider.js")
      const { WindowsReaderExplorerContextMenuProvider } = await import("../windows/WindowsReaderExplorerContextMenuProvider.js")
      return new ReaderSystemIntegrationService(new PlatformReaderSystemIntegrationProvider({
        scheduler: resourceScheduler,
        explorerContextMenu: options.explorerContextMenu ?? new WindowsReaderExplorerContextMenuProvider({ resourceScheduler: resourceScheduler }),
      }))
    })
    this.#settingsMigration = options.loadSettingsMigrationService
      ? new ReaderSettingsMigrationHttpController(
          options.loadSettingsMigrationService,
          (operation) => this.#runConfigMutation(operation),
          options.loadSettingsPortableService,
        )
      : undefined
    this.#bookSettingsMigration = options.loadBookSettingsMigrationService
      ? new ReaderBookSettingsMigrationHttpController(options.loadBookSettingsMigrationService)
      : undefined
    this.#libraryService = options.libraryService
    this.#library = options.libraryService ? new ReaderLibraryHttpController(
      options.libraryService,
      new ReaderLibraryCleanupService(options.libraryService, new PlatformReaderPathStatusProvider(resourceScheduler)),
    ) : undefined
    this.#opds = new ReaderOpdsHttpController(options.opdsClient)
    this.#disposeLibraryService = options.disposeLibraryService ?? false
    this.#cacheService = new ReaderCacheService(options.presentationDiskCache, {
      ownsPresentationCache: options.disposePresentationDiskCache,
    })
    this.#schedulerSnapshot = schedulerSnapshot(resourceScheduler)
    this.#sharedSchedulerSnapshot = sharedSchedulerSnapshot(resourceScheduler)
    this.#diagnostics = new ReaderDiagnosticsService({
      activeSessions: () => this.#service.sessionCount,
      preload: () => this.#service.preloadDiagnostics(),
      runtimeResources: () => this.#service.runtimeResourceDiagnostics(),
      browserMemory: () => this.#directoryBrowser.memorySnapshot(),
      assets: () => this.#assets.snapshot(),
      presentationDiskCache: () => this.#cacheService.status(),
      solidArchiveCache: () => this.#solidArchiveCache.snapshot(),
      videoProcess: this.#videoProcessSnapshot,
      scheduler: this.#schedulerSnapshot,
      sharedScheduler: this.#sharedSchedulerSnapshot,
    })
    this.#mediaProgress = options.mediaProgressStore
      ? new ReaderMediaProgressService(options.mediaProgressStore)
      : undefined
    this.#disposeThumbnailStore = options.disposeThumbnailStore
    this.#disposeSuperResolutionArtifacts = options.disposeSuperResolutionArtifacts
    this.#token = options.token
    this.#baseUrl = options.baseUrl.replace(/\/$/, "")
    this.#shellOptions = options.shellOptions ?? DEFAULT_NEOVIEW_SHELL_CONFIG
    this.#viewDefaults = options.viewDefaults ?? DEFAULT_NEOVIEW_VIEW_DEFAULTS
    this.#book = options.book ?? DEFAULT_NEOVIEW_BOOK_CONFIG
    this.#pageList = options.pageList ?? DEFAULT_NEOVIEW_PAGE_LIST_CONFIG
    this.#bookmarkList = options.bookmarkList ?? DEFAULT_NEOVIEW_BOOKMARK_LIST_CONFIG
    this.#historyList = options.historyList ?? DEFAULT_NEOVIEW_HISTORY_LIST_CONFIG
    this.#folderView = options.folderView ?? DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG
    this.#slideshow = options.slideshow ?? DEFAULT_NEOVIEW_SLIDESHOW_CONFIG
    this.#media = initialMedia
    this.#colorFilter = options.colorFilter ?? DEFAULT_READER_COLOR_FILTER
    this.#pageTransition = options.pageTransition ?? DEFAULT_READER_PAGE_TRANSITION
    this.#switchToast = options.switchToast ?? DEFAULT_READER_SWITCH_TOAST
    this.#infoOverlay = options.infoOverlay ?? DEFAULT_READER_INFO_OVERLAY
    this.#systemMonitor = options.systemMonitor ?? DEFAULT_NEOVIEW_SYSTEM_MONITOR_CONFIG
    this.#aiTranslation = options.aiTranslation ?? DEFAULT_NEOVIEW_AI_TRANSLATION_CONFIG
    this.#ai = new ReaderAiHttpController({
      config: this.#aiTranslation,
      persistentCache: options.aiTranslationCache,
    })
    this.#systemMonitorService = options.systemMonitorService ?? new ReaderSystemMonitorService()
    this.#imageTrim = options.imageTrim ?? DEFAULT_READER_IMAGE_TRIM
    this.#superResolution = options.superResolution ?? DEFAULT_NEOVIEW_SUPER_RESOLUTION_CONFIG
    this.#inputBindings = options.inputBindings ?? cloneReaderInputBindings(DEFAULT_READER_INPUT_BINDINGS)
    this.#radialMenu = options.radialMenu ?? cloneReaderRadialMenuConfig(DEFAULT_READER_RADIAL_MENU_CONFIG)
    this.#sessionOptions = options.sessionOptions ?? {}
    this.#updateShellOptions = options.updateShellOptions
    this.#updateViewDefaults = options.updateViewDefaults
    this.#updateBook = options.updateBook
    this.#updatePageList = options.updatePageList
    this.#updateBookmarkList = options.updateBookmarkList
    this.#updateHistoryList = options.updateHistoryList
    this.#updateFolderView = options.updateFolderView
    this.#updateSlideshow = options.updateSlideshow
    this.#updateMedia = options.updateMedia
    this.#updateColorFilter = options.updateColorFilter
    this.#updatePageTransition = options.updatePageTransition
    this.#updateSwitchToast = options.updateSwitchToast
    this.#updateInfoOverlay = options.updateInfoOverlay
    this.#updateSystemMonitor = options.updateSystemMonitor
    this.#updateAiTranslation = options.updateAiTranslation
    this.#updateImageTrim = options.updateImageTrim
    this.#updateSuperResolution = options.updateSuperResolution
    this.#updateInputBindings = options.updateInputBindings
    this.#updateRadialMenu = options.updateRadialMenu
  }

  async handle(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith("/reader/")) return undefined
    if (!this.#isAuthorized(request, url)) return jsonResponse({ error: "Unauthorized" }, 401)

    const assetResponse = await this.#assets.handle(request)
    if (assetResponse) return assetResponse
    const superResolutionArtifactResponse = await this.#superResolutionArtifacts?.handle(request)
    if (superResolutionArtifactResponse) return superResolutionArtifactResponse
    const libraryThumbnailResponse = await this.#libraryThumbnails.handle(request)
    if (libraryThumbnailResponse) return libraryThumbnailResponse
    const thumbnailMaintenanceResponse = await this.#thumbnailMaintenance.handle(request)
    if (thumbnailMaintenanceResponse) return thumbnailMaintenanceResponse
    const directoryBrowserResponse = await this.#directoryBrowser.handle(request)
    if (directoryBrowserResponse) return directoryBrowserResponse
    const fileOperationResponse = await this.#fileOperations.handle(request)
    if (fileOperationResponse) return fileOperationResponse
    const systemIntegrationResponse = await this.#systemIntegration.handle(request)
    if (systemIntegrationResponse) return systemIntegrationResponse
    const settingsMigrationResponse = await this.#settingsMigration?.handle(request)
    if (settingsMigrationResponse) return settingsMigrationResponse
    const bookSettingsMigrationResponse = await this.#bookSettingsMigration?.handle(request)
    if (bookSettingsMigrationResponse) return bookSettingsMigrationResponse
    const libraryResponse = await this.#library?.handle(request)
    if (libraryResponse) return libraryResponse
    const aiResponse = await this.#ai.handle(request)
    if (aiResponse) return aiResponse
    const opdsResponse = await this.#opds.handle(request)
    if (opdsResponse) return opdsResponse

    if (url.pathname === PRESENTATION_CACHE_PATH && request.method === "GET") {
      return jsonResponse(await this.#cacheService.status())
    }
    if (url.pathname === "/reader/diagnostics/history" && request.method === "GET") {
      const sinceMs = parseOptionalDiagnosticsInteger(url.searchParams.get("sinceMs"))
      const limit = parseOptionalDiagnosticsInteger(url.searchParams.get("limit"))
      if (sinceMs === "invalid" || limit === "invalid") {
        return jsonResponse({ error: "sinceMs and limit must be finite integers." }, 400)
      }
      return jsonResponse(await this.#diagnostics.history({ sinceMs, limit }))
    }
    if (url.pathname === "/reader/diagnostics/history/export" && request.method === "GET") {
      const sinceMs = parseOptionalDiagnosticsInteger(url.searchParams.get("sinceMs"))
      const limit = parseOptionalDiagnosticsInteger(url.searchParams.get("limit"))
      const format = diagnosticsHistoryExportFormat(url.searchParams.get("format"))
      if (sinceMs === "invalid" || limit === "invalid") {
        return jsonResponse({ error: "sinceMs and limit must be finite integers." }, 400)
      }
      if (!format) return jsonResponse({ error: "format must be json or csv." }, 400)
      const exported = exportReaderDiagnosticsHistory(await this.#diagnostics.history({ sinceMs, limit }), format)
      return new Response(exported.body, {
        headers: {
          "cache-control": "no-store",
          "content-disposition": `attachment; filename="${exported.filename}"`,
          "content-type": exported.contentType,
          "x-content-type-options": "nosniff",
        },
      })
    }
    if (url.pathname === "/reader/diagnostics/history/sample") {
      if (request.method !== "POST") return methodNotAllowed("POST")
      return jsonResponse(await this.#diagnostics.sample())
    }
    if (url.pathname === "/reader/diagnostics/history/reset") {
      if (request.method !== "POST") return methodNotAllowed("POST")
      return jsonResponse({ cleared: this.#diagnostics.resetHistory() })
    }
    if (url.pathname === "/reader/diagnostics" && request.method === "GET") {
      const diagnostics = await this.#diagnostics.snapshot()
      const sessionId = url.searchParams.get("sessionId")
      if (!sessionId) return jsonResponse(diagnostics)
      const session = this.#service.getSession(sessionId)
      if (!session) return jsonResponse({ error: "Reader session was not found." }, 404)
      const telemetry = session.preloadTelemetry()
      const pages = telemetry.outcomes.flatMap(({ pageId, outcome }) => {
        const page = session.getPage(pageId)
        return page ? [{ pageIndex: page.index, outcome }] : []
      })
      return jsonResponse({
        ...diagnostics,
        reader: { ...diagnostics.reader, sessionPreload: { generation: telemetry.generation, pages } },
      })
    }
    if (url.pathname === "/reader/diagnostics/system" && request.method === "GET") {
      return jsonResponse(await this.#systemMonitorService.sample())
    }
    if (url.pathname === PRESENTATION_CACHE_PATH && request.method === "DELETE") {
      return jsonResponse(await this.#cacheService.clear())
    }
    if (url.pathname === PRESENTATION_CACHE_CLEANUP_PATH && request.method === "POST") {
      const body = await readControlJson(request)
      const reason = body?.reason ?? "age"
      if (reason !== "age" && reason !== "budget" && reason !== "explicit") {
        return jsonResponse({ error: "reason must be age, budget or explicit" }, 400)
      }
      return jsonResponse(await this.#cacheService.cleanup(reason))
    }

    if (url.pathname === "/reader/sessions" && request.method === "POST") {
      return this.#openSession(request)
    }
    if (url.pathname === "/reader/config" && request.method === "GET") {
      return jsonResponse(this.#configDto())
    }
    if (url.pathname === "/reader/config" && request.method === "PATCH") {
      return this.#patchShellConfig(request)
    }

    const pagesMatch = SESSION_PAGES_PATH.exec(url.pathname)
    if (pagesMatch && request.method === "GET") return this.#listPages(pagesMatch[1]!, url, request.signal)
    const frameWindowMatch = SESSION_FRAME_WINDOW_PATH.exec(url.pathname)
    if (frameWindowMatch && request.method === "GET") return this.#frameWindow(frameWindowMatch[1]!, url, request.signal)
    const adjacentBookMatch = SESSION_ADJACENT_BOOK_PATH.exec(url.pathname)
    if (adjacentBookMatch && request.method === "POST") return this.#openAdjacentBook(adjacentBookMatch[1]!, request)
    const pageActionMatch = SESSION_PAGE_ACTION_PATH.exec(url.pathname)
    if (pageActionMatch && request.method === "POST") return this.#pageAction(pageActionMatch[1]!, pageActionMatch[2]!, request)
    const metadataMatch = SESSION_METADATA_PATH.exec(url.pathname)
    if (metadataMatch && request.method === "GET") return this.#metadata(metadataMatch[1]!, request.signal)
    const emmMetadataMatch = SESSION_EMM_METADATA_PATH.exec(url.pathname)
    if (emmMetadataMatch && (request.method === "GET" || request.method === "PATCH")) {
      return this.#emmMetadataResponse(emmMetadataMatch[1]!, request)
    }
    const pageMediaInformationMatch = SESSION_PAGE_MEDIA_INFORMATION_PATH.exec(url.pathname)
    if (pageMediaInformationMatch && request.method === "GET") {
      return this.#pageMediaInformationResponse(pageMediaInformationMatch[1]!, request.signal)
    }
    const mediaProgressMatch = SESSION_MEDIA_PROGRESS_PATH.exec(url.pathname)
    if (mediaProgressMatch && (request.method === "GET" || request.method === "PATCH")) {
      return this.#handleMediaProgress(mediaProgressMatch[1]!, request)
    }
    const subtitlesMatch = SESSION_SUBTITLES_PATH.exec(url.pathname)
    if (subtitlesMatch && request.method === "GET") {
      return this.#subtitleTracks(subtitlesMatch[1]!, url)
    }
    const subtitleAssetMatch = SESSION_SUBTITLE_ASSET_PATH.exec(url.pathname)
    if (subtitleAssetMatch && (request.method === "GET" || request.method === "HEAD")) {
      return this.#subtitleAsset(subtitleAssetMatch[1]!, subtitleAssetMatch[2]!, subtitleAssetMatch[3]!, request, url)
    }
    const clipboardMaterializationMatch = SESSION_CLIPBOARD_MATERIALIZATION_PATH.exec(url.pathname)
    if (clipboardMaterializationMatch && request.method === "POST" && !clipboardMaterializationMatch[2]) {
      return this.#materializeClipboardPage(clipboardMaterializationMatch[1]!, request)
    }
    if (clipboardMaterializationMatch && request.method === "DELETE" && clipboardMaterializationMatch[2]) {
      return this.#releaseClipboardMaterialization(clipboardMaterializationMatch[1]!, clipboardMaterializationMatch[2]!)
    }
    const navigateMatch = SESSION_NAVIGATE_PATH.exec(url.pathname)
    if (navigateMatch && request.method === "POST") return this.#navigate(navigateMatch[1]!, request)
    const reloadMatch = SESSION_RELOAD_PATH.exec(url.pathname)
    if (reloadMatch && request.method === "POST") return this.#reloadSession(reloadMatch[1]!, request)
    const sourceChangesMatch = SESSION_SOURCE_CHANGES_PATH.exec(url.pathname)
    if (sourceChangesMatch && request.method === "GET") {
      return this.#waitForSourceChanges(sourceChangesMatch[1]!, url, request.signal)
    }
    const preloadEventsMatch = SESSION_PRELOAD_EVENTS_PATH.exec(url.pathname)
    if (preloadEventsMatch && request.method === "POST") return this.#reportPreloadEvents(preloadEventsMatch[1]!, request)
    const preloadContextMatch = SESSION_PRELOAD_CONTEXT_PATH.exec(url.pathname)
    if (preloadContextMatch && request.method === "PATCH") return this.#updatePreloadContext(preloadContextMatch[1]!, request)
    const preloadActionsMatch = SESSION_PRELOAD_ACTIONS_PATH.exec(url.pathname)
    if (preloadActionsMatch) {
      if (request.method !== "POST") return methodNotAllowed("POST")
      return this.#preloadAction(preloadActionsMatch[1]!, request)
    }
    const optionsMatch = SESSION_OPTIONS_PATH.exec(url.pathname)
    if (optionsMatch && request.method === "PATCH") return this.#updateSessionOptions(optionsMatch[1]!, request)
    const pageOrderMatch = SESSION_PAGE_ORDER_PATH.exec(url.pathname)
    if (pageOrderMatch && request.method === "PATCH") return this.#updateSessionPageOrder(pageOrderMatch[1]!, request)
    const bookSettingsMatch = SESSION_BOOK_SETTINGS_PATH.exec(url.pathname)
    if (bookSettingsMatch && (request.method === "GET" || request.method === "PATCH")) {
      return this.#handleBookSettings(bookSettingsMatch[1]!, request)
    }
    const sessionMatch = SESSION_PATH.exec(url.pathname)
    if (sessionMatch && request.method === "GET") return this.#getSession(sessionMatch[1]!)
    if (sessionMatch && request.method === "DELETE") return this.#closeSession(sessionMatch[1]!)
    return jsonResponse({ error: "Reader route not found" }, 404)
  }

  async [Symbol.asyncDispose](): Promise<void> {
    for (const load of this.#bookMetadataLoads.values()) load.controller.abort()
    this.#bookMetadataLoads.clear()
    this.#assets.close()
    this.#superResolutionArtifacts?.close()
    this.#libraryThumbnails.close()
    const errors: unknown[] = []
    try {
      await this.#fileOperations[Symbol.asyncDispose]()
    } catch (error) {
      errors.push(error)
    }
    try {
      await this.#directoryBrowser[Symbol.asyncDispose]()
    } catch (error) {
      errors.push(error)
    }
    try {
      await this.#thumbnailPipeline.dispose()
    } catch (error) {
      errors.push(error)
    }
    try {
      await this.#mediaProgress?.close()
    } catch (error) {
      errors.push(error)
    }
    try {
      await this.#clipboardMaterializations[Symbol.asyncDispose]()
    } catch (error) {
      errors.push(error)
    }
    try {
      await this.#seekableMedia[Symbol.asyncDispose]()
    } catch (error) {
      errors.push(error)
    }
    try {
      await this.#pageMediaInformation[Symbol.asyncDispose]()
    } catch (error) {
      errors.push(error)
    }
    if (this.#ownedVideoProcessScheduler) {
      try {
        await this.#ownedVideoProcessScheduler[Symbol.asyncDispose]()
      } catch (error) {
        errors.push(error)
      }
    }
    try {
      await this.#sourceChanges[Symbol.asyncDispose]()
    } catch (error) {
      errors.push(error)
    }
    try {
      await this.#archivePreloadDemand.close()
    } catch (error) {
      errors.push(error)
    }
    try {
      await this.#service[Symbol.asyncDispose]()
    } catch (error) {
      errors.push(error)
    }
    if (this.#disposeLibraryService && this.#libraryService) {
      try {
        await this.#libraryService.close()
      } catch (error) {
        errors.push(error)
      }
    }
    if (this.#ownsSolidArchiveCache) {
      try {
        await this.#solidArchiveCache.close()
      } catch (error) {
        errors.push(error)
      }
    }
    if (this.#disposeThumbnailStore) {
      try {
        await this.#disposeThumbnailStore()
      } catch (error) {
        errors.push(error)
      }
    }
    if (this.#disposeSuperResolutionArtifacts) {
      try {
        await this.#disposeSuperResolutionArtifacts()
      } catch (error) {
        errors.push(error)
      }
    }
    try {
      await this.#diagnostics.close()
    } catch (error) {
      errors.push(error)
    }
    try {
      await this.#cacheService.close()
    } catch (error) {
      errors.push(error)
    }
    if (errors.length) throw new AggregateError(errors, "Failed to close the reader HTTP controller.")
  }

  async #openSession(request: Request): Promise<Response> {
    const body = await readControlJson(request)
    if (!body || typeof body.path !== "string" || !body.path.trim()) {
      return jsonResponse({ error: "path must be a non-empty string" }, 400)
    }
    const initialPageValue = body.initialPage
    if (initialPageValue !== undefined && (
      typeof initialPageValue !== "number"
      || !Number.isSafeInteger(initialPageValue)
      || initialPageValue < 0
    )) {
      return jsonResponse({ error: "initialPage must be a non-negative integer" }, 400)
    }
    const initialPage = typeof initialPageValue === "number" ? initialPageValue : undefined
    const entryPaths = parseEntryPaths(body)
    if (entryPaths === "invalid") {
      return jsonResponse({ error: "entryPath/entryPaths must contain non-empty archive paths and cannot be combined" }, 400)
    }
    const archivePasswords = parseArchivePasswords(body)
    if (archivePasswords === "invalid") {
      return jsonResponse({ error: "password/archivePasswords must contain valid, uniquely scoped password entries and cannot be combined" }, 400)
    }
    const provenance = parseReaderActivationProvenance(body.provenance)
    if (body.provenance !== undefined && !provenance) {
      return jsonResponse({ error: "provenance must contain browserOriginPath and browserOriginEntryPath" }, 400)
    }
    try {
      const source: ViewSource = entryPaths
        ? { kind: "archive", path: body.path, entryPaths }
        : { kind: "path", path: body.path }
      const session = await this.#service.openViewSource(
        source,
        { initialPage, signal: request.signal, archivePasswords },
      )
      if (provenance) this.#bookTraversalCursors.set(session.id, {
        rootPath: provenance.browserOriginPath,
        frames: [{
          directoryPath: provenance.browserOriginPath,
          currentEntryPath: provenance.browserOriginEntryPath,
          selfTerminal: provenance.browserOriginSelfTerminal,
        }],
      })
      this.#retainSessionFrame(session, session.snapshot())
      return jsonResponse(this.#sessionDto(session), 201)
    } catch (error) {
      if (request.signal.aborted) throw error
      return jsonResponse({ error: errorMessage(error) }, 400)
    }
  }

  async #patchShellConfig(request: Request): Promise<Response> {
    const body = await readControlJson(request)
    if (!body) return jsonResponse({ error: "Reader config patch must be a JSON object" }, 400)
    if (Object.hasOwn(body, "superResolution")) {
      if (!this.#updateSuperResolution) return jsonResponse({ error: "Reader super-resolution preferences are read-only" }, 405)
      let parsed: ReturnType<typeof parseNeoviewSuperResolutionPreferencesPatch>
      try {
        parsed = parseNeoviewSuperResolutionPreferencesPatch(body)
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 400)
      }
      let updated: NeoviewSuperResolutionConfig | undefined
      const operation = this.#configUpdateQueue.then(async () => {
        updated = await this.#updateSuperResolution!(parsed.patch.superResolution, parsed.tomlPatch)
        this.#superResolution = updated
      })
      this.#configUpdateQueue = operation.catch(() => undefined)
      try {
        await operation
        return jsonResponse(this.#configDto())
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 500)
      }
    }
    if (Object.hasOwn(body, "inputBindings")) {
      if (!this.#updateInputBindings) return jsonResponse({ error: "Reader input bindings are read-only" }, 405)
      let parsed: ReturnType<typeof parseNeoviewInputBindingsPatch>
      try {
        parsed = parseNeoviewInputBindingsPatch(body)
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 400)
      }
      let updated: ReaderInputBindingsConfig | undefined
      const operation = this.#configUpdateQueue.then(async () => {
        updated = await this.#updateInputBindings!(parsed.patch, parsed.tomlPatch)
        this.#inputBindings = updated
      })
      this.#configUpdateQueue = operation.catch(() => undefined)
      try {
        await operation
        return jsonResponse(this.#configDto())
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 500)
      }
    }
    if (Object.hasOwn(body, "radialMenu")) {
      if (!this.#updateRadialMenu) return jsonResponse({ error: "Reader radial menu is read-only" }, 405)
      let parsed: ReturnType<typeof parseReaderRadialMenuPatch>
      try {
        parsed = parseReaderRadialMenuPatch(body)
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 400)
      }
      let updated: ReaderRadialMenuConfig | undefined
      const operation = this.#configUpdateQueue.then(async () => {
        updated = await this.#updateRadialMenu!(parsed.patch, parsed.tomlPatch)
        this.#radialMenu = updated
      })
      this.#configUpdateQueue = operation.catch(() => undefined)
      try {
        await operation
        return jsonResponse(this.#configDto())
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 500)
      }
    }
    if (Object.hasOwn(body, "colorFilter")) {
      if (!this.#updateColorFilter) return jsonResponse({ error: "Reader color filter config is read-only" }, 405)
      let parsed: ReturnType<typeof parseNeoviewColorFilterPatch>
      try {
        parsed = parseNeoviewColorFilterPatch(body)
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 400)
      }
      let updated: ReaderColorFilterSettings | undefined
      const operation = this.#configUpdateQueue.then(async () => {
        updated = await this.#updateColorFilter!(parsed.patch, parsed.tomlPatch)
        this.#colorFilter = updated
      })
      this.#configUpdateQueue = operation.catch(() => undefined)
      try {
        await operation
        return jsonResponse(this.#configDto())
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 500)
      }
    }
    if (Object.hasOwn(body, "pageTransition")) {
      if (!this.#updatePageTransition) return jsonResponse({ error: "Reader page transition config is read-only" }, 405)
      let parsed: ReturnType<typeof parseNeoviewPageTransitionPatch>
      try {
        parsed = parseNeoviewPageTransitionPatch(body)
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 400)
      }
      let updated: ReaderPageTransitionSettings | undefined
      const operation = this.#configUpdateQueue.then(async () => {
        updated = await this.#updatePageTransition!(parsed.patch, parsed.tomlPatch)
        this.#pageTransition = updated
      })
      this.#configUpdateQueue = operation.catch(() => undefined)
      try {
        await operation
        return jsonResponse(this.#configDto())
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 500)
      }
    }
    if (Object.hasOwn(body, "switchToast")) {
      if (!this.#updateSwitchToast) return jsonResponse({ error: "Reader switch toast config is read-only" }, 405)
      let parsed: ReturnType<typeof parseNeoviewSwitchToastPatch>
      try {
        parsed = parseNeoviewSwitchToastPatch(body)
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 400)
      }
      let updated: ReaderSwitchToastSettings | undefined
      const operation = this.#configUpdateQueue.then(async () => {
        updated = await this.#updateSwitchToast!(parsed.patch, parsed.tomlPatch)
        this.#switchToast = updated
      })
      this.#configUpdateQueue = operation.catch(() => undefined)
      try {
        await operation
        return jsonResponse(this.#configDto())
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 500)
      }
    }
    if (Object.hasOwn(body, "infoOverlay")) {
      if (!this.#updateInfoOverlay) return jsonResponse({ error: "Reader info overlay config is read-only" }, 405)
      let parsed: ReturnType<typeof parseNeoviewInfoOverlayPatch>
      try {
        parsed = parseNeoviewInfoOverlayPatch(body)
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 400)
      }
      let updated: ReaderInfoOverlaySettings | undefined
      const operation = this.#configUpdateQueue.then(async () => {
        updated = await this.#updateInfoOverlay!(parsed.patch, parsed.tomlPatch)
        this.#infoOverlay = updated
      })
      this.#configUpdateQueue = operation.catch(() => undefined)
      try {
        await operation
        return jsonResponse(this.#configDto())
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 500)
      }
    }
    if (Object.hasOwn(body, "systemMonitor")) {
      if (!this.#updateSystemMonitor) return jsonResponse({ error: "Reader system monitor config is read-only" }, 405)
      let parsed: ReturnType<typeof parseNeoviewSystemMonitorPatch>
      try {
        parsed = parseNeoviewSystemMonitorPatch(body)
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 400)
      }
      const operation = this.#configUpdateQueue.then(async () => {
        this.#systemMonitor = await this.#updateSystemMonitor!(parsed.patch, parsed.tomlPatch)
      })
      this.#configUpdateQueue = operation.catch(() => undefined)
      try {
        await operation
        return jsonResponse(this.#configDto())
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 500)
      }
    }
    if (Object.hasOwn(body, "aiTranslation")) {
      if (!this.#updateAiTranslation) return jsonResponse({ error: "Reader AI translation config is read-only" }, 405)
      let parsed: ReturnType<typeof parseNeoviewAiTranslationPatch>
      try {
        parsed = parseNeoviewAiTranslationPatch(body)
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 400)
      }
      const operation = this.#configUpdateQueue.then(async () => {
        this.#aiTranslation = await this.#updateAiTranslation!(parsed.patch, parsed.tomlPatch)
        this.#ai.setConfig(this.#aiTranslation)
      })
      this.#configUpdateQueue = operation.catch(() => undefined)
      try {
        await operation
        return jsonResponse(this.#configDto())
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 500)
      }
    }
    if (Object.hasOwn(body, "imageTrim")) {
      if (!this.#updateImageTrim) return jsonResponse({ error: "Reader image trim config is read-only" }, 405)
      try {
        parseNeoviewImageTrimPatch(body)
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 400)
      }
      let updated: ReaderImageTrimSettings | undefined
      const operation = this.#configUpdateQueue.then(async () => {
        const parsed = parseNeoviewImageTrimPatch(body, this.#imageTrim)
        updated = await this.#updateImageTrim!(parsed.patch, parsed.tomlPatch)
        this.#imageTrim = updated
      })
      this.#configUpdateQueue = operation.catch(() => undefined)
      try {
        await operation
        return jsonResponse(this.#configDto())
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 500)
      }
    }
    if (Object.hasOwn(body, "media")) {
      if (!this.#updateMedia) return jsonResponse({ error: "Reader media config is read-only" }, 405)
      let updated: NeoviewMediaConfig | undefined
      const operation = this.#configUpdateQueue.then(async () => {
        let parsed: ReturnType<typeof parseNeoviewMediaPatch>
        try {
          parsed = parseNeoviewMediaPatch(body, this.#media)
        } catch (error) {
          throw new ReaderConfigPatchInvalid(errorMessage(error))
        }
        updated = await this.#updateMedia!(parsed.patch, parsed.tomlPatch)
        this.#media = updated
        this.#mediaFormats.replace(updated)
      })
      this.#configUpdateQueue = operation.catch(() => undefined)
      try {
        await operation
        return jsonResponse(this.#configDto())
      } catch (error) {
        if (error instanceof ReaderConfigPatchInvalid) return jsonResponse({ error: error.message }, 400)
        return jsonResponse({ error: errorMessage(error) }, 500)
      }
    }
    if (Object.hasOwn(body, "slideshow")) {
      if (!this.#updateSlideshow) return jsonResponse({ error: "Reader slideshow config is read-only" }, 405)
      let parsed: ReturnType<typeof parseNeoviewSlideshowPatch>
      try {
        parsed = parseNeoviewSlideshowPatch(body)
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 400)
      }
      let updated: NeoviewSlideshowConfig | undefined
      const operation = this.#configUpdateQueue.then(async () => {
        updated = await this.#updateSlideshow!(parsed.patch, parsed.tomlPatch)
        this.#slideshow = updated
      })
      this.#configUpdateQueue = operation.catch(() => undefined)
      try {
        await operation
        return jsonResponse(this.#configDto())
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 500)
      }
    }
    if (Object.hasOwn(body, "historyList")) {
      if (!this.#updateHistoryList) return jsonResponse({ error: "Reader history list config is read-only" }, 405)
      let parsed: ReturnType<typeof parseNeoviewHistoryListPatch>
      try {
        parsed = parseNeoviewHistoryListPatch(body)
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 400)
      }
      let updated: NeoviewHistoryListConfig | undefined
      const operation = this.#configUpdateQueue.then(async () => {
        updated = await this.#updateHistoryList!(parsed.patch, parsed.tomlPatch)
        this.#historyList = updated
      })
      this.#configUpdateQueue = operation.catch(() => undefined)
      try {
        await operation
        return jsonResponse(this.#configDto())
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 500)
      }
    }
    if (Object.hasOwn(body, "bookmarkList")) {
      if (!this.#updateBookmarkList) return jsonResponse({ error: "Reader bookmark list config is read-only" }, 405)
      let parsed: ReturnType<typeof parseNeoviewBookmarkListPatch>
      try {
        parsed = parseNeoviewBookmarkListPatch(body)
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 400)
      }
      let updated: NeoviewBookmarkListConfig | undefined
      const operation = this.#configUpdateQueue.then(async () => {
        updated = await this.#updateBookmarkList!(parsed.patch, parsed.tomlPatch)
        this.#bookmarkList = updated
      })
      this.#configUpdateQueue = operation.catch(() => undefined)
      try {
        await operation
        return jsonResponse(this.#configDto())
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 500)
      }
    }
    if (Object.hasOwn(body, "pageList")) {
      if (!this.#updatePageList) return jsonResponse({ error: "Reader page list config is read-only" }, 405)
      let parsed: ReturnType<typeof parseNeoviewPageListPatch>
      try {
        parsed = parseNeoviewPageListPatch(body)
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 400)
      }
      let updated: NeoviewPageListConfig | undefined
      const operation = this.#configUpdateQueue.then(async () => {
        updated = await this.#updatePageList!(parsed.patch, parsed.tomlPatch)
        this.#pageList = updated
      })
      this.#configUpdateQueue = operation.catch(() => undefined)
      try {
        await operation
        return jsonResponse(this.#configDto())
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 500)
      }
    }
    if (Object.hasOwn(body, "book")) {
      if (!this.#updateBook) return jsonResponse({ error: "Reader book defaults are read-only" }, 405)
      let parsed: ReturnType<typeof parseNeoviewBookPatch>
      try {
        parsed = parseNeoviewBookPatch(body)
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 400)
      }
      let updated: NeoviewBookConfig | undefined
      const operation = this.#configUpdateQueue.then(async () => {
        updated = await this.#updateBook!(parsed.patch, parsed.tomlPatch)
        this.#book = updated
        this.#service.updatePageOrderDefaults(lockedPageOrder(updated))
        if (updated.lockedReadingDirection) {
          this.#sessionOptions = { ...this.#sessionOptions, direction: updated.lockedReadingDirection }
          this.#service.updateSessionDefaults(this.#sessionOptions)
        }
      })
      this.#configUpdateQueue = operation.catch(() => undefined)
      try {
        await operation
        return jsonResponse(this.#configDto())
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 500)
      }
    }
    if (Object.hasOwn(body, "viewDefaults")) {
      if (!this.#updateViewDefaults) return jsonResponse({ error: "Reader view defaults are read-only" }, 405)
      let parsed: ReturnType<typeof parseNeoviewViewDefaultsPatch>
      try {
        parsed = parseNeoviewViewDefaultsPatch(body)
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 400)
      }
      let updated: NeoviewViewDefaults | undefined
      const operation = this.#configUpdateQueue.then(async () => {
        updated = await this.#updateViewDefaults!(parsed.patch, parsed.tomlPatch)
        this.#viewDefaults = updated
        if (parsed.patch.viewDefaults.pageMode || parsed.patch.viewDefaults.splitWidePages !== undefined) {
          const layout = {
            ...DEFAULT_READER_LAYOUT,
            ...this.#sessionOptions.layout,
            ...(parsed.patch.viewDefaults.pageMode === undefined ? {} : { pageMode: parsed.patch.viewDefaults.pageMode }),
            ...(parsed.patch.viewDefaults.splitWidePages === undefined ? {} : { splitWidePages: parsed.patch.viewDefaults.splitWidePages }),
          }
          this.#sessionOptions = { ...this.#sessionOptions, layout }
          this.#service.updateSessionDefaults(this.#sessionOptions)
        }
      })
      this.#configUpdateQueue = operation.catch(() => undefined)
      try {
        await operation
        return jsonResponse(this.#configDto())
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 500)
      }
    }
    if (Object.hasOwn(body, "folderView")) {
      if (!this.#updateFolderView) return jsonResponse({ error: "Reader folder view config is read-only" }, 405)
      let parsed: ReturnType<typeof parseNeoviewFolderViewPatch>
      try {
        parsed = parseNeoviewFolderViewPatch(body)
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 400)
      }
      let updated: NeoviewFolderViewConfig | undefined
      const operation = this.#configUpdateQueue.then(async () => {
        updated = await this.#updateFolderView!(parsed.patch, parsed.tomlPatch)
        this.#folderView = updated
      })
      this.#configUpdateQueue = operation.catch(() => undefined)
      try {
        await operation
        return jsonResponse(this.#configDto())
      } catch (error) {
        return jsonResponse({ error: errorMessage(error) }, 500)
      }
    }
    if (!this.#updateShellOptions) return jsonResponse({ error: "Reader shell config is read-only" }, 405)
    let parsed: ReturnType<typeof parseNeoviewSidebarLayoutPatch> | ReturnType<typeof parseNeoviewCardLayoutPatch> | ReturnType<typeof parseNeoviewBoardLayoutPatch> | ReturnType<typeof parseNeoviewShellControlPatch>
    try {
      parsed = Object.hasOwn(body, "shellControl")
        ? parseNeoviewShellControlPatch(body)
        : Object.hasOwn(body, "board")
        ? parseNeoviewBoardLayoutPatch(body)
        : Object.hasOwn(body, "cardId")
          ? parseNeoviewCardLayoutPatch(body)
          : parseNeoviewSidebarLayoutPatch(body)
    } catch (error) {
      return jsonResponse({ error: errorMessage(error) }, 400)
    }
    let updated: NeoviewShellConfig | undefined
    const operation = this.#configUpdateQueue.then(async () => {
      if ("expectedRevision" in parsed.patch && parsed.patch.expectedRevision !== this.#shellRevision) {
        throw new ReaderShellRevisionConflict(parsed.patch.expectedRevision, this.#shellRevision)
      }
      updated = await this.#updateShellOptions!(parsed.patch, parsed.tomlPatch)
      this.#shellOptions = updated
      this.#shellRevision += 1
    })
    this.#configUpdateQueue = operation.catch(() => undefined)
    try {
      await operation
      return jsonResponse(this.#configDto())
    } catch (error) {
      if (error instanceof ReaderShellRevisionConflict) {
        return jsonResponse({ error: error.message, ...this.#configDto() }, 409)
      }
      return jsonResponse({ error: errorMessage(error) }, 500)
    }
  }

  #configDto() {
    return {
      schemaVersion: 1 as const,
      shell: { ...this.#shellOptions, revision: this.#shellRevision },
      viewDefaults: this.#viewDefaults,
      book: this.#book,
      // Shared session defaults used by GUI/CLI/TUI. Only the fields that are
      // currently configured are included so older clients remain compatible.
      sessionOptions: this.#sessionOptions,
      pageList: this.#pageList,
      bookmarkList: this.#bookmarkList,
      historyList: this.#historyList,
      folderView: this.#folderView,
      slideshow: this.#slideshow,
      media: this.#media,
      colorFilter: this.#colorFilter,
      pageTransition: this.#pageTransition,
      switchToast: this.#switchToast,
      infoOverlay: this.#infoOverlay,
      systemMonitor: this.#systemMonitor,
      aiTranslation: this.#aiTranslation,
      imageTrim: this.#imageTrim,
      superResolution: {
        provider: this.#superResolution.provider,
        modelsDirectory: this.#superResolution.modelsDirectory,
        modelSources: this.#superResolution.modelSources,
        preferences: this.#superResolution.preferences,
      },
      inputBindings: this.#inputBindings,
      radialMenu: this.#radialMenu,
    }
  }

  #getSession(encodedSessionId: string): Response {
    const session = this.#findSession(encodedSessionId)
    return session ? jsonResponse(this.#sessionDto(session)) : jsonResponse({ error: "Reader session not found" }, 404)
  }

  async #listPages(encodedSessionId: string, url: URL, signal?: AbortSignal): Promise<Response> {
    const session = this.#findSession(encodedSessionId)
    if (!session) return jsonResponse({ error: "Reader session not found" }, 404)
    const query = url.searchParams.get("query")?.trim() ?? ""
    if (query.length > 128) return jsonResponse({ error: "Page query must not exceed 128 characters" }, 400)
    const normalizedQuery = query.toLocaleLowerCase()
    const catalog = normalizedQuery
      ? session.pages.filter((page, index) => page.name.toLocaleLowerCase().includes(normalizedQuery) || String(index + 1).includes(normalizedQuery))
      : session.pages
    const cursor = boundedInteger(url.searchParams.get("cursor"), 0, catalog.length, 0)
    const limit = boundedInteger(url.searchParams.get("limit"), 1, 500, 100)
    const sourcePages = catalog.slice(cursor, cursor + limit)
    if (url.searchParams.get("thumbnails") !== "0") {
      await this.#assets.prewarmThumbnails(sourcePages, signal).catch((error) => {
        if (signal?.aborted) throw error
      })
    }
    const pages = sourcePages.map((page) => this.#pageDto(session, page))
    const nextCursor = cursor + pages.length < catalog.length ? cursor + pages.length : undefined
    return jsonResponse({ pages, nextCursor, total: catalog.length })
  }

  async #frameWindow(encodedSessionId: string, url: URL, signal?: AbortSignal): Promise<Response> {
    const session = this.#findSession(encodedSessionId)
    if (!session) return jsonResponse({ error: "Reader session not found" }, 404)
    if (typeof session.frameWindow !== "function") {
      return jsonResponse({ error: "Reader session does not support frame windows" }, 501)
    }
    const pageCount = session.pages.length
    if (!pageCount) return jsonResponse({ frames: [], centerIndex: 0, radius: 0 })
    const defaultCenter = session.snapshot().anchorPageIndex
    const center = boundedInteger(url.searchParams.get("center"), 0, pageCount - 1, defaultCenter)
    const radius = boundedInteger(url.searchParams.get("radius"), 0, 8, 1)
    try {
      const frames = await session.frameWindow(center, radius, signal)
      signal?.throwIfAborted()
      return jsonResponse({
        frames,
        centerIndex: center,
        radius,
        visiblePages: frames.flatMap((frame) => this.#visiblePages(session, frame)),
      })
    } catch (error) {
      if (signal?.aborted) throw error
      return jsonResponse({ error: errorMessage(error) }, 400)
    }
  }

  async #metadata(encodedSessionId: string, signal?: AbortSignal): Promise<Response> {
    const session = this.#findSession(encodedSessionId)
    if (!session) return jsonResponse({ error: "Reader session not found" }, 404)
    const snapshot = session.snapshot()
    const page = session.pages[snapshot.anchorPageIndex]
    const sourcePath = session.book.source.path
    const pageFilePath = page && !page.timestamps && !page.entryPath && page.sourcePath !== sourcePath
      ? page.sourcePath
      : undefined
    const [staticMetadata, bookStats, pageStats] = await Promise.all([
      waitForSignal(this.#loadBookMetadata(session), signal),
      safeStat(sourcePath, signal),
      pageFilePath && pageFilePath !== sourcePath ? safeStat(pageFilePath, signal) : Promise.resolve(undefined),
    ])
    signal?.throwIfAborted()
    return jsonResponse({
      book: {
        ...staticMetadata,
        currentPage: snapshot.anchorPageIndex + 1,
        progressPercent: session.pages.length ? Math.min(snapshot.anchorPageIndex + 1, session.pages.length) / session.pages.length * 100 : undefined,
        byteLength: bookStats?.isFile() ? bookStats.size : undefined,
        createdAtMs: validTime(bookStats?.birthtimeMs),
        modifiedAtMs: validTime(bookStats?.mtimeMs),
        accessedAtMs: validTime(bookStats?.atimeMs),
      },
      page: page ? pageMetadata(page, pageStats ?? (!page.timestamps && !page.entryPath ? bookStats : undefined)) : undefined,
    })
  }

  async #pageMediaInformationResponse(encodedSessionId: string, signal?: AbortSignal): Promise<Response> {
    const session = this.#findSession(encodedSessionId)
    if (!session) return jsonResponse({ error: "Reader session not found" }, 404)
    const page = session.pages[session.snapshot().anchorPageIndex]
    if (!page) return jsonResponse({ error: "Reader session has no current page" }, 404)
    try {
      return jsonResponse(await this.#pageMediaInformation.inspect(session.id, page, signal))
    } catch (error) {
      if (signal?.aborted) throw error
      return jsonResponse({ error: errorMessage(error) }, 503)
    }
  }

  async #emmMetadataResponse(encodedSessionId: string, request: Request): Promise<Response> {
    const session = this.#findSession(encodedSessionId)
    if (!session) return jsonResponse({ error: "Reader session not found" }, 404)
    if (!this.#emmMetadata) return jsonResponse({ error: "Reader EMM metadata is unavailable" }, 503)
    const path = legacyEmmBookPathKey(session.book.source.path)
    try {
      if (request.method === "GET") return jsonResponse(await this.#emmMetadata.read(path, request.signal))
      const body = await readControlJson(request)
      if (!body || Object.keys(body).some((key) => key !== "expectedRevision" && key !== "patch")) {
        return jsonResponse({ error: "Reader EMM metadata patch is invalid" }, 400)
      }
      if (!Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 0) {
        return jsonResponse({ error: "expectedRevision must be a non-negative integer" }, 400)
      }
      if (!body.patch || typeof body.patch !== "object" || Array.isArray(body.patch)) {
        return jsonResponse({ error: "patch must be an object" }, 400)
      }
      if (!Object.keys(body.patch as Record<string, unknown>).length) {
        return jsonResponse({ error: "patch must change at least one field" }, 400)
      }
      const updated = await this.#emmMetadata.update(
        path,
        body.expectedRevision as number,
        body.patch as Record<string, unknown>,
        request.signal,
      )
      this.#releaseBookMetadata(session.id)
      return jsonResponse(updated)
    } catch (error) {
      if (request.signal.aborted) throw error
      if (error instanceof ReaderEmmMetadataRevisionConflict) {
        return jsonResponse({ error: error.message, actualRevision: error.actualRevision }, 409)
      }
      if (error instanceof z.ZodError || error instanceof RangeError) {
        return jsonResponse({ error: errorMessage(error) }, 400)
      }
      return jsonResponse({ error: errorMessage(error) }, 500)
    }
  }

  async #navigate(encodedSessionId: string, request: Request): Promise<Response> {
    const session = this.#findSession(encodedSessionId)
    if (!session) return jsonResponse({ error: "Reader session not found" }, 404)
    const body = await readControlJson(request)
    if (!body || (body.action !== "next" && body.action !== "previous" && body.action !== "goTo")) {
      return jsonResponse({ error: "action must be next, previous or goTo" }, 400)
    }
    try {
      const previousPreloadGeneration = session.preloadPlan()?.generation
      const frame = body.action === "next"
        ? await session.next(request.signal)
        : body.action === "previous"
          ? await session.previous(request.signal)
          : await session.goTo(requirePageIndex(body.pageIndex), request.signal)
      await this.#releaseStaleSuperResolutionPreload(session.id, previousPreloadGeneration, session.preloadPlan()?.generation)
      this.#retainSessionFrame(session, frame)
      return jsonResponse({ frame, visiblePages: this.#visiblePages(session, frame), preload: session.preloadPlan() })
    } catch (error) {
      if (request.signal.aborted) throw error
      return jsonResponse({ error: errorMessage(error) }, 400)
    }
  }

  async #reportPreloadEvents(encodedSessionId: string, request: Request): Promise<Response> {
    const session = this.#findSession(encodedSessionId)
    if (!session) return jsonResponse({ error: "Reader session not found" }, 404)
    const body = await readControlJson(request)
    if (!body || !Number.isSafeInteger(body.generation) || !Array.isArray(body.events) || body.events.length < 1 || body.events.length > 64) {
      return jsonResponse({ error: "Preload report requires generation and 1..64 events" }, 400)
    }
    const events: Array<{ pageId: string; outcome: ReaderPreloadOutcome; metrics?: ReaderPreloadPerformanceMetrics }> = []
    for (const value of body.events) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return jsonResponse({ error: "Invalid preload event" }, 400)
      const event = value as Record<string, unknown>
      if (typeof event.pageId !== "string" || !event.pageId || !isPreloadOutcome(event.outcome)) {
        return jsonResponse({ error: "Preload event requires pageId and a valid outcome" }, 400)
      }
      const metrics = parsePreloadPerformanceMetrics(event.metrics)
      if (metrics === "invalid") return jsonResponse({ error: "Invalid preload event metrics" }, 400)
      events.push({ pageId: event.pageId, outcome: event.outcome, metrics })
    }
    const results = events.map((event) => session.reportPreload({ generation: body.generation as number, ...event }))
    const accepted = results.filter((result) => result.accepted).length
    const stale = results.filter((result) => result.reason === "stale-generation").length
    const rejected = results.length - accepted
    const status = accepted > 0 ? 202 : stale > 0 ? 409 : 400
    const demandedPageIds = new Set(
      session.preloadTelemetry().outcomes
        .filter((event) => event.outcome === "started")
        .map((event) => event.pageId),
    )
    void this.#archivePreloadDemand.update(session.id, session.pages, session.preloadPlan(), demandedPageIds)
      .catch(() => undefined)
    return jsonResponse({ generation: body.generation, accepted, rejected, stale }, status)
  }

  async #updatePreloadContext(encodedSessionId: string, request: Request): Promise<Response> {
    const session = this.#findSession(encodedSessionId)
    if (!session) return jsonResponse({ error: "Reader session not found" }, 404)
    const body = await readControlJson(request)
    if (!body || Array.isArray(body) || Object.keys(body).some((key) => !PRELOAD_CONTEXT_FIELDS.has(key))) {
      return jsonResponse({ error: "Preload context contains unsupported fields" }, 400)
    }
    const context = parsePreloadViewportContext(body)
    if (context === "invalid") return jsonResponse({ error: "Invalid preload viewport context" }, 400)
    try {
      const previousPreloadGeneration = session.preloadPlan()?.generation
      const resources = deriveReaderPreloadResourceContext({
        scheduler: this.#schedulerSnapshot?.(),
        sharedScheduler: this.#sharedSchedulerSnapshot?.(),
        memoryPressure: this.#assets.snapshot().memoryPressure,
      })
      const preload = session.updatePreloadContext({ ...context, ...resources })
      await this.#releaseStaleSuperResolutionPreload(session.id, previousPreloadGeneration, preload.generation)
      this.#retainSessionFrame(session, session.snapshot(), preload)
      return jsonResponse({ preload })
    } catch (error) {
      return jsonResponse({ error: errorMessage(error) }, 400)
    }
  }

  async #preloadAction(encodedSessionId: string, request: Request): Promise<Response> {
    const session = this.#findSession(encodedSessionId)
    if (!session) return jsonResponse({ error: "Reader session not found" }, 404)
    const body = await readControlJson(request)
    if (!body || Object.keys(body).length !== 2 || body.confirmed !== true
      || (body.action !== "cancel-speculative" && body.action !== "release-retained")) {
      return jsonResponse({ error: "Preload action must be cancel-speculative or release-retained with confirmed=true" }, 400)
    }
    const frame = session.snapshot()
    const visiblePageIds = [...new Set(frame.pages.map((page) => page.pageId))]
    if (body.action === "cancel-speculative") {
      const before = session.preloadTelemetry().cancelled
      const previousPreloadGeneration = session.preloadPlan()?.generation
      const preload = session.cancelSpeculativePreload()
      await this.#releaseStaleSuperResolutionPreload(session.id, previousPreloadGeneration, preload.generation)
      const cancelled = session.preloadTelemetry().cancelled - before
      return jsonResponse({
        action: body.action,
        generation: preload.generation,
        cancelled,
        released: 0,
        visibleRetained: visiblePageIds.length,
      })
    }
    const retention = this.#assets.releaseSessionRetainedPresentations(session.id, visiblePageIds)
    return jsonResponse({
      action: body.action,
      generation: session.preloadPlan()?.generation ?? 0,
      cancelled: 0,
      released: retention.released,
      visibleRetained: visiblePageIds.length,
    })
  }

  async #updateSessionOptions(encodedSessionId: string, request: Request): Promise<Response> {
    const session = this.#findSession(encodedSessionId)
    if (!session) return jsonResponse({ error: "Reader session not found" }, 404)
    const body = await readControlJson(request)
    if (!body || !Object.keys(body).length || Object.keys(body).some((key) => key !== "direction" && key !== "layout")) {
      return jsonResponse({ error: "Reader session options must contain only direction or layout" }, 400)
    }
    const direction = body.direction
    if (direction !== undefined && direction !== "left-to-right" && direction !== "right-to-left") {
      return jsonResponse({ error: "Reader session options.direction must be left-to-right or right-to-left" }, 400)
    }
    const layout = body.layout
    let layoutPatch: Partial<ReaderLayout> | undefined
    if (layout !== undefined) {
      if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
        return jsonResponse({ error: "Reader session options.layout must be an object" }, 400)
      }
      const record = layout as Record<string, unknown>
      const layoutKeys = new Set(["pageMode", "panorama", "singleFirstPage", "singleLastPage", "treatWidePageAsSingle", "splitWidePages"])
      if (!Object.keys(record).length || Object.keys(record).some((key) => !layoutKeys.has(key))) {
        return jsonResponse({ error: "Reader session options.layout contains unsupported fields" }, 400)
      }
      if (record.pageMode !== undefined && record.pageMode !== "single" && record.pageMode !== "double") {
        return jsonResponse({ error: "Reader session options.layout.pageMode must be single or double" }, 400)
      }
      for (const key of ["panorama", "singleFirstPage", "singleLastPage", "treatWidePageAsSingle", "splitWidePages"] as const) {
        if (record[key] !== undefined && typeof record[key] !== "boolean") {
          return jsonResponse({ error: `Reader session options.layout.${key} must be boolean` }, 400)
        }
      }
      layoutPatch = record as typeof layoutPatch
    }
    try {
      const previousPreloadGeneration = session.preloadPlan()?.generation
      const current = session.snapshot().layout
      const frame = await session.updateOptions({
        ...(direction === undefined ? {} : { direction }),
        ...(layoutPatch === undefined ? {} : { layout: { ...current, ...layoutPatch } }),
      }, request.signal)
      await this.#releaseStaleSuperResolutionPreload(session.id, previousPreloadGeneration, session.preloadPlan()?.generation)
      this.#retainSessionFrame(session, frame)
      return jsonResponse({ frame, visiblePages: this.#visiblePages(session, frame), preload: session.preloadPlan() })
    } catch (error) {
      if (request.signal.aborted) throw error
      return jsonResponse({ error: errorMessage(error) }, 400)
    }
  }

  async #updateSessionPageOrder(encodedSessionId: string, request: Request): Promise<Response> {
    const session = this.#findSession(encodedSessionId)
    if (!session) return jsonResponse({ error: "Reader session not found" }, 404)
    const body = await readControlJson(request)
    const allowed = new Set(["sortMode", "mediaPriority", "randomSeed"])
    if (!body || !Object.keys(body).length || Object.keys(body).some((key) => !allowed.has(key))) {
      return jsonResponse({ error: "Reader page order must contain only sortMode, mediaPriority or randomSeed" }, 400)
    }
    try {
      const previousPreloadGeneration = session.preloadPlan()?.generation
      const frame = await session.updatePageOrder(body, request.signal)
      await this.#releaseStaleSuperResolutionPreload(session.id, previousPreloadGeneration, session.preloadPlan()?.generation)
      this.#retainSessionFrame(session, frame)
      return jsonResponse({ frame, visiblePages: this.#visiblePages(session, frame), pageOrder: session.pageOrder, preload: session.preloadPlan() })
    } catch (error) {
      if (request.signal.aborted) throw error
      return jsonResponse({ error: errorMessage(error) }, 400)
    }
  }

  async #handleBookSettings(encodedSessionId: string, request: Request): Promise<Response> {
    const session = this.#findSession(encodedSessionId)
    if (!session) return jsonResponse({ error: "Reader session not found" }, 404)
    if (!this.#bookSettings) return jsonResponse({ error: "Reader book settings are unavailable" }, 501)
    const defaults = readerBookSettingsDefaults(this.#sessionOptions)
    try {
      if (request.method === "GET") {
        return jsonResponse({ settings: await this.#bookSettings.read(session.book.id, defaults, request.signal) })
      }
      const body = await readControlJson(request)
      if (!body || Object.keys(body).some((key) => key !== "expectedRevision" && key !== "patch")) {
        return jsonResponse({ error: "Book settings request must contain expectedRevision and patch" }, 400)
      }
      const settings = await this.#bookSettings.update(
        session.book.id,
        body.expectedRevision as number,
        body.patch,
        defaults,
        async (effective, signal) => {
          const previousPreloadGeneration = session.preloadPlan()?.generation
          const current = session.snapshot()
          const frame = await session.updateOptions({
            direction: effective.direction,
            layout: {
              ...current.layout,
              pageMode: effective.pageMode,
              treatWidePageAsSingle: effective.horizontalBook,
            },
          }, signal)
          await this.#releaseStaleSuperResolutionPreload(session.id, previousPreloadGeneration, session.preloadPlan()?.generation)
          this.#retainSessionFrame(session, frame)
        },
        request.signal,
      )
      const frame = session.snapshot()
      return jsonResponse({
        settings,
        frame,
        visiblePages: this.#visiblePages(session, frame),
        preload: session.preloadPlan(),
      })
    } catch (error) {
      if (request.signal.aborted) throw error
      if (error instanceof ReaderBookSettingsRevisionConflict) {
        return jsonResponse({ error: error.message, actualRevision: error.actualRevision }, 409)
      }
      if (error instanceof z.ZodError || error instanceof RangeError) {
        return jsonResponse({ error: errorMessage(error) }, 400)
      }
      return jsonResponse({ error: errorMessage(error) }, 500)
    }
  }

  async #closeSession(encodedSessionId: string): Promise<Response> {
    const session = this.#findSession(encodedSessionId)
    if (!session) return jsonResponse({ error: "Reader session not found" }, 404)
    await this.#releaseSession(session)
    await this.#hibernateIfIdle()
    return new Response(null, { status: 204 })
  }

  async #reloadSession(encodedSessionId: string, request: Request): Promise<Response> {
    const current = this.#findSession(encodedSessionId)
    if (!current) return jsonResponse({ error: "Reader session not found" }, 404)
    const body = await readControlJson(request)
    if (!body || Object.keys(body).some((key) => key !== "password" && key !== "archivePasswords")) {
      return jsonResponse({ error: "Reader reload accepts only password or archivePasswords" }, 400)
    }
    const archivePasswords = parseArchivePasswords(body)
    if (archivePasswords === "invalid") {
      return jsonResponse({ error: "password/archivePasswords must contain valid, uniquely scoped password entries and cannot be combined" }, 400)
    }

    const frame = current.snapshot()
    const anchor = current.pages[frame.anchorPageIndex]
    let replacement: ReaderSession | undefined
    try {
      replacement = await this.#service.openViewSource(current.book.source, {
        initialPage: 0,
        direction: frame.direction,
        layout: frame.layout,
        signal: request.signal,
        archivePasswords,
      })
      const target = reloadTargetPage(replacement.book.pages, anchor, frame.anchorPageIndex)
      if (target !== 0) await replacement.goTo(target, request.signal)
      request.signal.throwIfAborted()
      this.#retainSessionFrame(replacement, replacement.snapshot())
      const cursor = this.#bookTraversalCursors.get(current.id)
      if (cursor) this.#bookTraversalCursors.set(replacement.id, cursor)
    } catch (error) {
      await replacement?.close().catch(() => undefined)
      if (request.signal.aborted) throw error
      return jsonResponse({ error: errorMessage(error) }, 400)
    }

    await this.#releaseSession(current)
    return jsonResponse(this.#sessionDto(replacement), 201)
  }

  async #openAdjacentBook(encodedSessionId: string, request: Request): Promise<Response> {
    const current = this.#findSession(encodedSessionId)
    if (!current) return jsonResponse({ error: "Reader session not found" }, 404)
    const body = await readControlJson(request)
    const parsed = parseAdjacentBookRequest(body)
    if (!parsed) return jsonResponse({ error: "Adjacent-book request must contain a valid direction and optional sort rule" }, 400)
    let replacement: ReaderSession | undefined
    try {
      const candidate = await this.#bookTraversal.resolve({
        source: current.book.source,
        direction: parsed.direction,
        cursor: this.#bookTraversalCursors.get(current.id),
        sort: parsed.sort,
        penetration: {
          maxDepth: this.#folderView.penetration.maxDepth,
          terminalTargets: this.#folderView.penetration.terminalTargets,
        },
        randomSeed: current.id,
      }, request.signal)
      if (!candidate) return new Response(null, { status: 204 })
      replacement = await this.#service.openViewSource({ kind: "path", path: candidate.path }, { signal: request.signal })
      if (parsed.direction === "previous" && replacement.pages.length > 1) {
        await replacement.goTo(replacement.pages.length - 1, request.signal)
      }
      request.signal.throwIfAborted()
      this.#bookTraversalCursors.set(replacement.id, candidate.cursor)
      this.#retainSessionFrame(replacement, replacement.snapshot())
    } catch (error) {
      await replacement?.close().catch(() => undefined)
      if (request.signal.aborted) throw error
      return jsonResponse({ error: errorMessage(error) }, 400)
    }
    await this.#releaseSession(current)
    return jsonResponse(this.#sessionDto(replacement), 201)
  }

  async #releaseSession(session: ReaderSession): Promise<void> {
    const errors: unknown[] = []
    const superResolutionRelease = this.#superResolutionArtifacts?.releaseSession(session.id) ?? Promise.resolve()
    try {
      await this.#archivePreloadDemand.release(session.id)
    } catch (error) {
      errors.push(error)
    }
    try {
      await this.#service.closeSession(session.id)
    } catch (error) {
      errors.push(error)
    }
    const results = await Promise.allSettled([
      this.#sourceChanges.release(session.id),
      this.#mediaProgress?.flush(session.book.id) ?? Promise.resolve(),
      this.#clipboardMaterializations.releaseSession(session.id),
      this.#pageMediaInformation.releaseSession(session.id),
      this.#assets.releaseSession(session.id),
      superResolutionRelease,
    ])
    for (const result of results) if (result.status === "rejected") errors.push(result.reason)
    this.#openPageMaterializationTokens.delete(session.id)
    this.#bookTraversalCursors.delete(session.id)
    try {
      this.#releaseBookMetadata(session.id)
    } catch (error) {
      errors.push(error)
    }
    if (errors.length) throw new AggregateError(errors, `Failed to release reader session ${session.id}.`)
  }

  async #waitForSourceChanges(encodedSessionId: string, url: URL, signal: AbortSignal): Promise<Response> {
    const session = this.#findSession(encodedSessionId)
    if (!session) return jsonResponse({ error: "Reader session not found" }, 404)
    const after = parseNonNegativeInteger(url.searchParams.get("after"))
    if (after === undefined) return jsonResponse({ error: "after must be a non-negative integer" }, 400)
    try {
      const change = await this.#sourceChanges.waitForChange(session.id, session.book.source, after, signal)
      return change ? jsonResponse(change) : new Response(null, { status: 204 })
    } catch (error) {
      if (signal.aborted) throw error
      return jsonResponse({ error: "Reader source watch unavailable" }, 503)
    }
  }

  async #materializeClipboardPage(encodedSessionId: string, request: Request): Promise<Response> {
    const session = this.#findSession(encodedSessionId)
    if (!session) return jsonResponse({ error: "Reader session not found" }, 404)
    const body = await readControlJson(request)
    if (!body || typeof body.pageId !== "string" || !body.pageId) {
      return jsonResponse({ error: "pageId must be a non-empty string" }, 400)
    }
    try {
      const materialization = await this.#clipboardMaterializations.materialize(session.id, body.pageId, request.signal)
      return jsonResponse(materialization, 201)
    } catch (error) {
      if (request.signal.aborted) throw error
      return jsonResponse({ error: errorMessage(error) }, 400)
    }
  }

  async #pageAction(encodedSessionId: string, encodedPageId: string, request: Request): Promise<Response> {
    const session = this.#findSession(encodedSessionId)
    if (!session) return jsonResponse({ error: "Reader session not found" }, 404)
    const pageId = safeDecode(encodedPageId)
    const page = pageId ? session.getPage(pageId) : undefined
    if (!page) return jsonResponse({ error: "Reader page not found" }, 404)
    const body = await readControlJson(request)
    if (!body || (body.action !== "copy" && body.action !== "reveal" && body.action !== "open")) {
      return jsonResponse({ error: "action must be copy, reveal or open" }, 400)
    }
    try {
      if (body.action === "copy") {
        if (!page.entryPath) return jsonResponse({ path: page.sourcePath })
        const materialization = await this.#clipboardMaterializations.materialize(session.id, page.id, request.signal)
        return jsonResponse({
          path: materialization.path,
          leaseToken: materialization.token,
          expiresAt: materialization.expiresAt,
        }, 201)
      }
      if (body.action === "open" && page.entryPath) {
        const materialization = await this.#clipboardMaterializations.materialize(session.id, page.id, request.signal)
        try {
          await this.#systemIntegration.run("open", materialization.path, request.signal)
          request.signal.throwIfAborted()
          const previousToken = this.#openPageMaterializationTokens.get(session.id)
          this.#openPageMaterializationTokens.set(session.id, materialization.token)
          if (previousToken && previousToken !== materialization.token) {
            await this.#clipboardMaterializations.release(previousToken, session.id).catch(() => undefined)
          }
          return new Response(null, { status: 204 })
        } catch (error) {
          await this.#clipboardMaterializations.release(materialization.token, session.id).catch(() => undefined)
          throw error
        }
      }
      const path = page.entryPath ? session.book.source.path : page.sourcePath
      await this.#systemIntegration.run(body.action, path, request.signal)
      return new Response(null, { status: 204 })
    } catch (error) {
      if (request.signal.aborted) throw error
      return jsonResponse({ error: errorMessage(error) }, 400)
    }
  }

  async #releaseClipboardMaterialization(encodedSessionId: string, encodedToken: string): Promise<Response> {
    const session = this.#findSession(encodedSessionId)
    if (!session) return jsonResponse({ error: "Reader session not found" }, 404)
    const token = safeDecode(encodedToken)
    if (!token || !await this.#clipboardMaterializations.release(token, session.id)) {
      return jsonResponse({ error: "Reader clipboard materialization not found" }, 404)
    }
    return new Response(null, { status: 204 })
  }

  async #handleMediaProgress(encodedSessionId: string, request: Request): Promise<Response> {
    const session = this.#findSession(encodedSessionId)
    if (!session) return jsonResponse({ error: "Reader session not found" }, 404)
    if (!this.#mediaProgress) return jsonResponse({ error: "Reader media progress is unavailable" }, 501)
    if (!session.pages.some((page) => page.mediaKind === "video")) {
      return jsonResponse({ error: "Reader session does not contain video media" }, 409)
    }
    if (request.method === "GET") {
      try {
        return jsonResponse({ progress: await this.#mediaProgress.get(session.book.id) ?? null })
      } catch (error) {
        if (request.signal.aborted) throw error
        return jsonResponse({ error: errorMessage(error) }, 500)
      }
    }
    const body = await readControlJson(request)
    if (!body) return jsonResponse({ error: "Media progress patch must be a JSON object" }, 400)
    if (body.flush !== undefined && typeof body.flush !== "boolean") {
      return jsonResponse({ error: "Media progress flush must be a boolean" }, 400)
    }
    const { flush, ...update } = body
    let progress
    try {
      progress = this.#mediaProgress.record(session.book.id, update as ReaderMediaProgressUpdate)
    } catch (error) {
      return jsonResponse({ error: errorMessage(error) }, 400)
    }
    if (flush) {
      try {
        await this.#mediaProgress.flush(session.book.id)
      } catch (error) {
        if (request.signal.aborted) throw error
        return jsonResponse({ error: errorMessage(error) }, 500)
      }
    }
    return jsonResponse({ progress, durable: Boolean(flush) }, flush ? 200 : 202)
  }

  #subtitleTracks(encodedSessionId: string, url: URL): Response {
    const session = this.#findSession(encodedSessionId)
    if (!session) return jsonResponse({ error: "Reader session not found" }, 404)
    const pageId = url.searchParams.get("pageId")
    if (!pageId) return jsonResponse({ error: "pageId is required" }, 400)
    try {
      const tracks = this.#subtitles.list(session.id, pageId).map((track) => ({
        ...track,
        assetUrl: this.#subtitleUrl(session.id, pageId, track.id, track.contentVersion),
      }))
      return jsonResponse({ tracks })
    } catch (error) {
      return jsonResponse({ error: errorMessage(error) }, 404)
    }
  }

  async #subtitleAsset(
    encodedSessionId: string,
    encodedPageId: string,
    encodedAssetId: string,
    request: Request,
    url: URL,
  ): Promise<Response> {
    const session = this.#findSession(encodedSessionId)
    const pageId = safeDecode(encodedPageId)
    const assetId = safeDecode(encodedAssetId)
    if (!session || !pageId || !assetId) return jsonResponse({ error: "Reader subtitle track not found" }, 404)
    let track: ReturnType<ReaderSubtitleService["list"]>[number] | undefined
    try {
      track = this.#subtitles.list(session.id, pageId).find((candidate) => candidate.id === assetId)
    } catch {
      return jsonResponse({ error: "Reader subtitle track not found" }, 404)
    }
    if (!track) return jsonResponse({ error: "Reader subtitle track not found" }, 404)
    if (url.searchParams.get("version") !== track.contentVersion) {
      return jsonResponse({ error: "Reader subtitle version is stale" }, 410)
    }
    const etag = subtitleEtag(session.id, pageId, track.id, track.contentVersion)
    const headers = new Headers({
      "cache-control": "private, max-age=31536000, immutable",
      "content-type": "text/vtt; charset=utf-8",
      "etag": etag,
      "x-content-type-options": "nosniff",
    })
    if (request.headers.get("if-none-match")?.split(",").some((value) => value.trim() === etag)) {
      return new Response(null, { status: 304, headers })
    }
    if (request.method === "HEAD") return new Response(null, { status: 200, headers })
    try {
      const rendered = await this.#subtitles.render(session.id, pageId, assetId, request.signal)
      headers.set("content-length", String(rendered.bytes.byteLength))
      return new Response(rendered.bytes, { status: 200, headers })
    } catch (error) {
      if (request.signal.aborted) throw error
      return jsonResponse({ error: errorMessage(error) }, 422)
    }
  }

  #subtitleUrl(sessionId: string, pageId: string, assetId: string, version: string): string {
    const url = new URL(
      `/reader/s/${encodeURIComponent(sessionId)}/subtitle/${encodeURIComponent(pageId)}/${encodeURIComponent(assetId)}`,
      this.#baseUrl,
    )
    url.searchParams.set("version", version)
    url.searchParams.set("token", this.#token)
    return url.href
  }

  #hibernateIfIdle(): Promise<void> {
    if (this.#hibernateCheck) return this.#hibernateCheck
    const pending = Promise.resolve().then(() => {
      if (this.#service.sessionCount === 0) this.#assets.hibernate()
    }).finally(() => {
      if (this.#hibernateCheck === pending) this.#hibernateCheck = undefined
    })
    this.#hibernateCheck = pending
    return pending
  }

  #runConfigMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#configUpdateQueue.then(operation)
    this.#configUpdateQueue = result.then(() => undefined, () => undefined)
    return result
  }

  #sessionDto(session: ReaderSession): ReaderSessionDto {
    const frame = session.snapshot()
    return {
      sessionId: session.id,
      book: {
        id: session.book.id,
        displayName: session.book.displayName,
        pageCount: session.pages.length,
      },
      frame,
      visiblePages: this.#visiblePages(session, frame),
      pageOrder: session.pageOrder,
      preload: session.preloadPlan(),
    }
  }

  async #releaseStaleSuperResolutionPreload(
    sessionId: ReaderSessionId,
    previousGeneration: number | undefined,
    nextGeneration: number | undefined,
  ): Promise<void> {
    if (previousGeneration === undefined || nextGeneration === undefined || previousGeneration === nextGeneration) return
    await this.#superResolutionArtifacts?.advanceGeneration(sessionId, nextGeneration)
  }

  #retainSessionFrame(session: ReaderSession, frame: FrameSnapshot, preload = session.preloadPlan()): void {
    const pageIds = frame.pages.map((page) => page.pageId)
    for (const candidate of preload?.candidates ?? []) {
      if (candidate.tier === "near") pageIds.push(...candidate.pageIds)
    }
    this.#assets.retainSessionPages(session.id, pageIds)
    // Do not consume adjacent archive pages merely because the backend built a
    // plan. Only explicit client "started" telemetry becomes archive demand.
    void this.#archivePreloadDemand.update(session.id, session.pages, preload, new Set()).catch(() => undefined)
  }

  #visiblePages(session: ReaderSession, frame: FrameSnapshot): ReaderPageDto[] {
    return frame.pages.flatMap(({ pageId }) => {
      const page = session.getPage(pageId)
      return page ? [this.#pageDto(session, page)] : []
    })
  }

  #pageDto(session: ReaderSession, page: ReaderPage): ReaderPageDto {
    return {
      id: page.id,
      index: session.pageIndex(page.id) ?? page.index,
      name: page.name,
      mediaKind: page.mediaKind,
      mimeType: page.mimeType,
      byteLength: page.byteLength,
      dimensions: page.dimensions,
      contentVersion: page.contentVersion,
      assetUrl: this.#assets.pageUrl(session.id, page.id),
      thumbnailUrl: this.#assets.thumbnailUrl(session.id, page.id),
    }
  }

  #findSession(encodedSessionId: string): ReaderSession | undefined {
    const sessionId = safeDecode(encodedSessionId)
    return sessionId ? this.#service.getSession(sessionId) : undefined
  }

  #loadBookMetadata(session: ReaderSession): Promise<ReaderBookStaticMetadata> {
    const existing = this.#bookMetadataLoads.get(session.id)
    if (existing?.bookId === session.book.id) return existing.promise
    if (existing) existing.controller.abort()
    const controller = new AbortController()
    const load = {
      bookId: session.book.id,
      controller,
      promise: this.#bookMetadata.load(session.book, controller.signal),
    }
    this.#bookMetadataLoads.set(session.id, load)
    load.promise.catch(() => {
      if (this.#bookMetadataLoads.get(session.id) === load) this.#bookMetadataLoads.delete(session.id)
    })
    return load.promise
  }

  #releaseBookMetadata(sessionId: string): void {
    const load = this.#bookMetadataLoads.get(sessionId)
    load?.controller.abort()
    this.#bookMetadataLoads.delete(sessionId)
  }

  #isAuthorized(request: Request, url: URL): boolean {
    return request.headers.get("x-xiranite-token") === this.#token || url.searchParams.get("token") === this.#token
  }
}

function waitForSignal<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener("abort", abort, { once: true })
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
  })
}

class ReaderShellRevisionConflict extends Error {
  constructor(expected: number, actual: number) {
    super(`Reader layout changed while editing (expected revision ${expected}, current revision ${actual}).`)
    this.name = "ReaderShellRevisionConflict"
  }
}

class ReaderConfigPatchInvalid extends Error {}

async function readControlJson(request: Request): Promise<Record<string, unknown> | undefined> {
  const length = Number(request.headers.get("content-length") ?? 0)
  if (Number.isFinite(length) && length > MAX_CONTROL_BODY_BYTES) return undefined
  return request.json().catch(() => undefined) as Promise<Record<string, unknown> | undefined>
}

function requirePageIndex(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error("pageIndex must be a non-negative integer")
  return value as number
}

function parseEntryPaths(body: Record<string, unknown>): readonly string[] | undefined | "invalid" {
  if (body.entryPath !== undefined && body.entryPaths !== undefined) return "invalid"
  if (body.entryPath !== undefined) {
    return typeof body.entryPath === "string" && body.entryPath.trim() ? [body.entryPath] : "invalid"
  }
  if (body.entryPaths === undefined) return undefined
  if (!Array.isArray(body.entryPaths) || body.entryPaths.length === 0 || body.entryPaths.length > 16) return "invalid"
  return body.entryPaths.every((path) => typeof path === "string" && path.trim())
    ? body.entryPaths as string[]
    : "invalid"
}

function parseArchivePasswords(body: Record<string, unknown>): readonly ArchivePasswordInput[] | undefined | "invalid" {
  if (body.password !== undefined && body.archivePasswords !== undefined) return "invalid"
  if (body.password !== undefined) {
    return typeof body.password === "string" && body.password.length > 0 ? [{ password: body.password }] : "invalid"
  }
  if (body.archivePasswords === undefined) return undefined
  if (!Array.isArray(body.archivePasswords) || body.archivePasswords.length === 0 || body.archivePasswords.length > 16) {
    return "invalid"
  }
  const scopes = new Set<string>()
  const inputs: ArchivePasswordInput[] = []
  for (const value of body.archivePasswords) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "invalid"
    const record = value as Record<string, unknown>
    if (typeof record.password !== "string" || record.password.length === 0) return "invalid"
    if (record.entryPaths !== undefined && (
      !Array.isArray(record.entryPaths)
      || record.entryPaths.length > 16
      || !record.entryPaths.every((path) => typeof path === "string" && path.trim())
    )) return "invalid"
    const entryPaths = record.entryPaths as string[] | undefined
    const key = entryPaths?.join("\0") ?? ""
    if (scopes.has(key)) return "invalid"
    scopes.add(key)
    inputs.push({ password: record.password, entryPaths })
  }
  return inputs
}

function reloadTargetPage(pages: readonly ReaderPage[], anchor: ReaderPage | undefined, previousIndex: number): number {
  if (!pages.length) return 0
  if (anchor) {
    const matched = pages.find((page) => (
      (anchor.entryPath !== undefined && page.entryPath === anchor.entryPath)
      || (anchor.entryPath === undefined && page.sourcePath === anchor.sourcePath)
    ))
    if (matched) return matched.index
  }
  return Math.min(previousIndex, pages.length - 1)
}

function parseAdjacentBookRequest(body: Record<string, unknown> | undefined): {
  direction: "next" | "previous"
  sort?: ReaderDirectorySortRule
} | undefined {
  if (!body || Object.keys(body).some((key) => key !== "direction" && key !== "sort")) return undefined
  if (body.direction !== "next" && body.direction !== "previous") return undefined
  if (body.sort === undefined) return { direction: body.direction }
  if (!body.sort || typeof body.sort !== "object" || Array.isArray(body.sort)) return undefined
  const sort = body.sort as Record<string, unknown>
  if (Object.keys(sort).some((key) => key !== "field" && key !== "order" && key !== "directoriesFirst")) return undefined
  if (!isReaderDirectorySortField(sort.field)) return undefined
  if (sort.order !== "asc" && sort.order !== "desc") return undefined
  if (typeof sort.directoriesFirst !== "boolean") return undefined
  return {
    direction: body.direction,
    sort: { field: sort.field, order: sort.order, directoriesFirst: sort.directoriesFirst },
  }
}

function parseReaderActivationProvenance(value: unknown): {
  browserOriginPath: string
  browserOriginEntryPath: string
  browserOriginSelfTerminal?: boolean
} | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((key) => key !== "browserOriginPath" && key !== "browserOriginEntryPath" && key !== "browserOriginSelfTerminal")) return undefined
  if (typeof record.browserOriginPath !== "string" || !record.browserOriginPath.trim()) return undefined
  if (typeof record.browserOriginEntryPath !== "string" || !record.browserOriginEntryPath.trim()) return undefined
  if (record.browserOriginSelfTerminal !== undefined && typeof record.browserOriginSelfTerminal !== "boolean") return undefined
  return {
    browserOriginPath: record.browserOriginPath,
    browserOriginEntryPath: record.browserOriginEntryPath,
    ...(record.browserOriginSelfTerminal === true ? { browserOriginSelfTerminal: true } : {}),
  }
}

function boundedInteger(value: string | null, minimum: number, maximum: number, fallback: number): number {
  if (value === null) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : fallback
}

function safeDecode(value: string): string | undefined {
  try {
    return decodeURIComponent(value)
  } catch {
    return undefined
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function subtitleEtag(sessionId: string, pageId: string, assetId: string, version: string): string {
  const digest = createHash("sha256")
    .update(sessionId)
    .update("\0")
    .update(pageId)
    .update("\0")
    .update(assetId)
    .update("\0")
    .update(version)
    .digest("base64url")
  return `"${digest}"`
}

function isPreloadOutcome(value: unknown): value is ReaderPreloadOutcome {
  return value === "started" || value === "ready" || value === "failed" || value === "cancelled" || value === "evicted"
}

function parsePreloadViewportContext(body: Record<string, unknown>): ReaderPreloadContext | "invalid" {
  if (body.mode !== undefined && body.mode !== "paged" && body.mode !== "continuous" && body.mode !== "scrub") return "invalid"
  if (body.velocityPagesPerSecond !== undefined && (
    typeof body.velocityPagesPerSecond !== "number"
    || !Number.isFinite(body.velocityPagesPerSecond)
    || Math.abs(body.velocityPagesPerSecond) > 10_000
  )) return "invalid"
  if (body.stableForMs !== undefined && (
    !Number.isSafeInteger(body.stableForMs)
    || (body.stableForMs as number) < 0
  )) return "invalid"
  if (body.focused !== undefined && typeof body.focused !== "boolean") return "invalid"
  return {
    mode: body.mode as ReaderPreloadContext["mode"],
    velocityPagesPerSecond: body.velocityPagesPerSecond as number | undefined,
    stableForMs: body.stableForMs as number | undefined,
    focused: body.focused as boolean | undefined,
  }
}

function parsePreloadPerformanceMetrics(value: unknown): ReaderPreloadPerformanceMetrics | undefined | "invalid" {
  if (value === undefined) return undefined
  if (!value || typeof value !== "object" || Array.isArray(value)) return "invalid"
  const metrics = value as Record<string, unknown>
  if (Object.keys(metrics).some((key) => !PRELOAD_METRIC_FIELDS.has(key))) return "invalid"
  if (!validPreloadDuration(metrics.ttfbMs) || !validPreloadDuration(metrics.decodeMs)) return "invalid"
  if (!validPreloadCount(metrics.retainedBytes, Number.MAX_SAFE_INTEGER) || !validPreloadCount(metrics.activeLeases, 1_000_000)) return "invalid"
  return {
    ttfbMs: metrics.ttfbMs as number | undefined,
    decodeMs: metrics.decodeMs as number | undefined,
    retainedBytes: metrics.retainedBytes as number | undefined,
    activeLeases: metrics.activeLeases as number | undefined,
  }
}

const PRELOAD_METRIC_FIELDS = new Set(["ttfbMs", "decodeMs", "retainedBytes", "activeLeases"])

function validPreloadDuration(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10 * 60_000)
}

function validPreloadCount(value: unknown, maximum: number): boolean {
  return value === undefined || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum)
}

function parseNonNegativeInteger(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

function parseOptionalDiagnosticsInteger(value: string | null): number | undefined | "invalid" {
  if (value === null) return undefined
  if (!/^\d+$/.test(value)) return "invalid"
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : "invalid"
}

function diagnosticsHistoryExportFormat(value: string | null): ReaderDiagnosticsHistoryExportFormat | undefined {
  if (value === null || value === "json") return "json"
  if (value === "csv") return "csv"
  return undefined
}

async function safeStat(path: string, signal?: AbortSignal): Promise<Stats | undefined> {
  signal?.throwIfAborted()
  try {
    const result = await stat(path)
    signal?.throwIfAborted()
    return result
  } catch (error) {
    if (signal?.aborted) throw error
    return undefined
  }
}

function pageMetadata(page: ReaderPage, fallbackStats?: Stats): Record<string, unknown> {
  const timestamps = page.timestamps
  return {
    index: page.index,
    name: page.name,
    displayPath: page.entryPath ?? page.sourcePath,
    mediaKind: page.mediaKind,
    mimeType: page.mimeType,
    byteLength: page.byteLength ?? (fallbackStats?.isFile() ? fallbackStats.size : undefined),
    dimensions: page.dimensions,
    timeSource: timestamps?.source ?? (fallbackStats ? "book-source" : undefined),
    createdAtMs: timestamps?.createdAtMs ?? validTime(fallbackStats?.birthtimeMs),
    modifiedAtMs: timestamps?.modifiedAtMs ?? validTime(fallbackStats?.mtimeMs),
    accessedAtMs: timestamps?.accessedAtMs ?? validTime(fallbackStats?.atimeMs),
  }
}

function validTime(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined
}

function lockedPageOrder(config: NeoviewBookConfig | undefined): ReaderPageOrderPatch | undefined {
  if (!config || (config.lockedSortMode === null && config.lockedMediaPriority === null)) return undefined
  return {
    sortMode: config.lockedSortMode ?? "fileName",
    mediaPriority: config.lockedMediaPriority ?? "none",
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  })
}

function methodNotAllowed(allow: string): Response {
  return new Response("Method not allowed", { status: 405, headers: { allow } })
}

function videoProcessSnapshot(
  scheduler: ResourceScheduler | undefined,
): (() => ReaderVideoProcessDiagnostics) | undefined {
  const source = scheduler as (ResourceScheduler & {
    snapshot?: () => Readonly<VideoProcessSchedulerSnapshot>
  }) | undefined
  if (typeof source?.snapshot !== "function") return undefined
  return () => {
    const snapshot = source.snapshot!()
    return {
      active: snapshot.active,
      queued: snapshot.queued,
      maxConcurrent: snapshot.maxConcurrent,
    }
  }
}

function schedulerSnapshot(
  scheduler: ResourceScheduler | undefined,
): (() => Readonly<Record<"cpu" | "io" | "gpu", ReaderSchedulerPoolDiagnostics>> | undefined) | undefined {
  const source = scheduler as (ResourceScheduler & {
    snapshot?: () => Readonly<Record<"cpu" | "io" | "gpu", ReaderSchedulerPoolDiagnostics>>
  }) | undefined
  if (typeof source?.snapshot !== "function") return undefined
  return () => {
    const snapshot = source.snapshot!()
    return isSchedulerPoolSnapshot(snapshot) ? snapshot : undefined
  }
}

function sharedSchedulerSnapshot(
  scheduler: ResourceScheduler | undefined,
): (() => ReaderSharedSchedulerDiagnostics | undefined) | undefined {
  const source = scheduler as (ResourceScheduler & { snapshot?: () => unknown }) | undefined
  if (typeof source?.snapshot !== "function") return undefined
  return () => {
    const snapshot = source.snapshot!()
    return isSharedSchedulerSnapshot(snapshot) ? snapshot : undefined
  }
}

function isSchedulerPoolSnapshot(
  value: unknown,
): value is Readonly<Record<"cpu" | "io" | "gpu", ReaderSchedulerPoolDiagnostics>> {
  if (!value || typeof value !== "object" || "topology" in value) return false
  return ["cpu", "io", "gpu"].every((resource) => {
    const pool = (value as Record<string, unknown>)[resource]
    return Boolean(pool) && typeof pool === "object"
      && typeof (pool as { active?: unknown }).active === "number"
      && typeof (pool as { queued?: unknown }).queued === "number"
  })
}

function isSharedSchedulerSnapshot(value: unknown): value is PriorityResourceSchedulerSnapshot {
  if (!value || typeof value !== "object") return false
  const snapshot = value as Partial<PriorityResourceSchedulerSnapshot>
  return snapshot.topology === "shared-queue"
    && typeof snapshot.active === "number"
    && typeof snapshot.queued === "number"
    && Boolean(snapshot.queuedByPriority)
}
