import type { Stats } from "node:fs"
import { createHash } from "node:crypto"
import { stat } from "node:fs/promises"
import { z } from "zod"

import { DEFAULT_READER_LAYOUT, type FrameSnapshot, type ReaderLayout } from "../../domain/frame/frame.js"
import type { ViewSource } from "../../domain/book/book.js"
import type { ReaderPage } from "../../domain/page/page.js"
import { ReaderMediaFormatRegistryRef } from "../../domain/page/media.js"
import { DEFAULT_READER_COLOR_FILTER, type ReaderColorFilterSettings } from "../../domain/color-filter/ReaderColorFilter.js"
import { DEFAULT_READER_PAGE_TRANSITION, type ReaderPageTransitionSettings } from "../../domain/page-transition/ReaderPageTransition.js"
import { DEFAULT_READER_SWITCH_TOAST, type ReaderSwitchToastSettings } from "../../application/switch-toast/ReaderSwitchToast.js"
import { DEFAULT_READER_INFO_OVERLAY, type ReaderInfoOverlaySettings } from "../../application/info-overlay/ReaderInfoOverlay.js"
import { DEFAULT_READER_IMAGE_TRIM, type ReaderImageTrimSettings } from "../../application/image-trim/ReaderImageTrim.js"
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
import { ReaderHierarchicalBookTraversal, type ReaderBookTraversalCursor } from "../../application/reader/ReaderHierarchicalBookTraversal.js"
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
import type { ImageTransformExecution, ImageTransformer } from "../../ports/ImageTransformer.js"
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
import { PlatformThumbnailPipeline, ThumbnailUnavailableError } from "../thumbnails/PlatformThumbnailPipeline.js"
import { ThumbnailMaintenanceRoute } from "./ThumbnailMaintenanceRoute.js"
import { ReaderDirectoryBrowserRoute } from "./ReaderDirectoryBrowserRoute.js"
import { ReaderLibraryHttpController } from "./ReaderLibraryHttpController.js"
import { ReaderAiHttpController } from "./ReaderAiHttpController.js"
import { ReaderOpdsHttpController, type ReaderOpdsCatalogReader } from "./ReaderOpdsHttpController.js"
import { ReaderFileOperationHttpController } from "./ReaderFileOperationHttpController.js"
import { ReaderSystemIntegrationHttpController } from "./ReaderSystemIntegrationHttpController.js"
import { ReaderSettingsMigrationHttpController } from "./ReaderSettingsMigrationHttpController.js"
import { ReaderBookSettingsMigrationHttpController } from "./ReaderBookSettingsMigrationHttpController.js"
import type { ReaderFolderRatingService } from "../../application/metadata/ReaderFolderRatingService.js"
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
import { PlatformEmmCollectTagSource } from "../emm/PlatformEmmCollectTagSource.js"
import { WINDOWS_PRESENTATION_PRODUCER_VERSION } from "../cache/PresentationCacheKey.js"
import { NeoViewImageProcessingRuntimePolicy } from "../images/SharpRuntimePolicy.js"
import {
  DEFAULT_NEOVIEW_IMAGE_PROCESSING_CONFIG,
  parseNeoviewImageProcessingPatch,
  type NeoviewImageProcessingConfig,
  type NeoviewImageProcessingPatch,
} from "../../application/config/ReaderImageProcessingConfig.js"
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
  parseNeoviewEmmPatch,
  parseNeoviewAiTranslationPatch,
  DEFAULT_NEOVIEW_EMM_CONFIG,
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
  type NeoviewEmmConfig,
  type NeoviewEmmPatch,
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
import { parseNeoviewInputBindingsPatch, type NeoviewInputBindingsPatch } from "../../application/config/ReaderInputBindingsConfig.js"
import {
  cloneReaderRadialMenuConfig,
  DEFAULT_READER_RADIAL_MENU_CONFIG,
  parseReaderRadialMenuPatch,
  type NeoviewRadialMenuPatch,
  type ReaderRadialMenuConfig,
} from "../../application/config/ReaderRadialMenuConfig.js"
import type { NeoviewVoiceControlPatch, ReaderVoiceControlConfig } from "../../application/config/ReaderVoiceControlConfig.js"
import { DEFAULT_READER_INPUT_BINDINGS, cloneReaderInputBindings, type ReaderInputBindingsConfig } from "../../domain/input/ReaderInputBindings.js"

const SESSION_PATH = /^\/reader\/s\/([^/]+)$/
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

export interface ReaderEmmConnectionProbeSource {
  path: string
  status: "compatible" | "missing" | "incompatible" | "unreadable"
  readOnly: true
  error?: string
}

export interface ReaderEmmConnectionProbeResult {
  enabled: boolean
  automatic: boolean
  connected: boolean
  readOnly: true
  sources: readonly ReaderEmmConnectionProbeSource[]
}

export type ReaderHttpControllerOptions = ReaderAssetRouteOptions &
  PlatformReaderBookLoaderOptions & {
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
    manualTagCatalogStore?: import("../../ports/ReaderManualTagCatalogStore.js").ReaderManualTagCatalogStore
    emmOverrideStore?: ReaderEmmOverrideStore
    emmCollectTagSource?: PlatformEmmCollectTagSource
    emmTranslationSource?: PlatformEmmTranslationSource
    searchHistoryStore?: ReaderSearchHistoryStore
    fileUndoJournalStore?: ReaderFileUndoJournalStore
    folderRatingService?: ReaderFolderRatingService
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
    imageProcessing?: NeoviewImageProcessingConfig
    updateImageProcessing?: (patch: NeoviewImageProcessingPatch, tomlPatch: Record<string, unknown>) => Promise<NeoviewImageProcessingConfig>
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
    preload?: NeoviewPreloadConfig
    updatePreload?: (patch: NeoviewPreloadPatch, tomlPatch: Record<string, unknown>) => Promise<NeoviewPreloadConfig>
    emm?: NeoviewEmmConfig
    updateEmm?: (patch: NeoviewEmmPatch, tomlPatch: Record<string, unknown>) => Promise<NeoviewEmmConfig>
    probeEmm?: (config: NeoviewEmmConfig) => Promise<ReaderEmmConnectionProbeResult>
    disposeEmmResources?: () => void | Promise<void>
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
    voiceControl?: ReaderVoiceControlConfig
    updateVoiceControl?: (patch: NeoviewVoiceControlPatch, tomlPatch: Record<string, unknown>) => Promise<ReaderVoiceControlConfig>
    maxSeekableMediaEntryBytes?: number
    maxSeekableMediaTotalBytes?: number
    loadSettingsMigrationService?: () => Promise<ReaderSettingsMigrationService>
    loadSettingsPortableService?: () => Promise<ReaderSettingsPortableService>
    loadBookSettingsMigrationService?: () => Promise<ReaderBookSettingsMigrationService>
    sourceWatcher?: ReaderSourceWatcher
    explorerContextMenu?: ReaderExplorerContextMenuProvider
    opdsClient?: ReaderOpdsCatalogReader
  }
