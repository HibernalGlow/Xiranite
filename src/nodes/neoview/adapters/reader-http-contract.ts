import type { FrameSnapshot, PageDimensions,
  PageMediaKind,
  PageMode,
  ReaderAutoRotation,
  ReaderFitMode,
  ReaderLayout,
  ReaderMouseCursorSettings,
  ReaderOrientation,
  ReaderWidePageStretch,
  TailOverflowBehavior,
  ViewSource,
} from "@xiranite/node-neoview/ui-core"
import type { ReaderColorFilterPatch, ReaderColorFilterSettings } from "@xiranite/node-neoview/ui-core"
import type { ReaderPageTransitionPatch, ReaderPageTransitionSettings } from "@xiranite/node-neoview/ui-core"
import type { ReaderSwitchToastPatch, ReaderSwitchToastSettings } from "@xiranite/node-neoview/ui-core"
import type { ReaderInfoOverlayPatch, ReaderInfoOverlaySettings } from "@xiranite/node-neoview/ui-core"
import type { ReaderImageTrimPatch, ReaderImageTrimSettings } from "@xiranite/node-neoview/ui-core"
import type {
  ReaderMediaConfigDto,
  ReaderMediaPatchDto,
  ReaderMediaProgressDto,
} from "./reader-media-http-contract"

export type {
  ReaderMediaConfigDto,
  ReaderMediaPatchDto,
  ReaderMediaProgressDto,
  ReaderSubtitleConfigDto,
} from "./reader-media-http-contract"















































































































export type {
  ReaderInputAction,
  ReaderInputBinding,
  ReaderInputBindingsConfig,
  ReaderInputContext,
  ReaderInputDescriptor,
} from "@xiranite/node-neoview/ui-core"
import type { ReaderInputBindingsConfig, ReaderRadialMenuConfig, ReaderVoiceControlConfig } from "@xiranite/node-neoview/ui-core"





















































export interface ReaderHttpClient {
  config(signal?: AbortSignal): Promise<ReaderRuntimeConfigDto>
  startupState?(signal?: AbortSignal): Promise<ReaderStartupStateDto>
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
  updateInputBindingsAndRadialMenu?(patch: ReaderInputBindingsPatch & ReaderRadialMenuPatch, signal?: AbortSignal): Promise<ReaderRuntimeConfigDto>
  folderRatingCache?(signal?: AbortSignal): Promise<ReaderFolderRatingCacheDto>
  rebuildFolderRatingCache?(signal?: AbortSignal): Promise<ReaderFolderRatingCacheDto>
  supplementFolderRatingCache?(path: string, signal?: AbortSignal): Promise<ReaderFolderRatingCacheDto>
  clearFolderRatingCache?(signal?: AbortSignal): Promise<void>
  updateVoiceControl?(patch: ReaderVoiceControlPatch, signal?: AbortSignal): Promise<ReaderVoiceControlConfig>
  inspectLegacySettings?(content: string, modules?: readonly string[], signal?: AbortSignal): Promise<ReaderSettingsMigrationInspection>
  importLegacySettings?(
    content: string,
    strategy?: "merge" | "overwrite",
    modules?: readonly string[],
    signal?: AbortSignal,
  ): Promise<ReaderSettingsMigrationImportResult>
  updateColorFilter?(patch: ReaderColorFilterConfigPatch, signal?: AbortSignal): Promise<ReaderColorFilterSettings>
  updatePageTransition?(patch: ReaderPageTransitionConfigPatch, signal?: AbortSignal): Promise<ReaderPageTransitionSettings>
  updateSwitchToast?(patch: ReaderSwitchToastConfigPatch, signal?: AbortSignal): Promise<ReaderSwitchToastSettings>
  updateInfoOverlay?(patch: ReaderInfoOverlayConfigPatch, signal?: AbortSignal): Promise<ReaderInfoOverlaySettings>
  updateStartup?(patch: { startup: { restoreLastBook: boolean } }, signal?: AbortSignal): Promise<NonNullable<ReaderRuntimeConfigDto["startup"]>>
  updateSystemMonitor?(patch: ReaderSystemMonitorConfigPatch, signal?: AbortSignal): Promise<ReaderSystemMonitorConfigDto>
  updatePreload?(patch: { preload: Partial<ReaderRuntimeConfigDto["preload"]> }, signal?: AbortSignal): Promise<ReaderRuntimeConfigDto["preload"]>
  updateEmm?(patch: ReaderEmmConfigPatch, signal?: AbortSignal): Promise<ReaderEmmConfigDto>
  probeEmm?(patch: ReaderEmmConfigPatch, signal?: AbortSignal): Promise<ReaderEmmConnectionProbeDto>
  updateAiTranslation?(patch: ReaderAiTranslationConfigPatch, signal?: AbortSignal): Promise<ReaderAiTranslationConfigDto>
  aiCheck?(signal?: AbortSignal): Promise<ReaderAiCheckDto>
  aiModels?(signal?: AbortSignal): Promise<readonly ReaderOllamaModelDto[]>
  aiTranslate?(
    request: {
      text: string
      sourceLanguage?: string
      targetLanguage?: string
      model?: string
      promptTemplate?: string
    },
    signal?: AbortSignal,
  ): Promise<ReaderAiTranslationResultDto>
  aiCacheStats?(signal?: AbortSignal): Promise<ReaderAiCacheStatsDto>
  aiClearCache?(scope?: "memory" | "persistent" | "all", signal?: AbortSignal): Promise<{ cleared: number; scope: string }>
  updateImageTrim?(patch: ReaderImageTrimConfigPatch, signal?: AbortSignal): Promise<ReaderImageTrimSettings>
  updateSuperResolution?(patch: ReaderSuperResolutionPatchDto, signal?: AbortSignal): Promise<ReaderSuperResolutionConfigDto>
  upscalePage?(sessionId: string, pageId: string, trigger?: "manual" | "automatic-current", signal?: AbortSignal): Promise<ReaderUpscaleArtifactResultDto>
  probeUpscalePage?(sessionId: string, pageId: string, signal?: AbortSignal): Promise<ReaderUpscaleArtifactProbeResultDto>
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
  navigateDirectoryBrowser?(
    sessionId: string,
    navigation: ReaderDirectoryNavigationDto,
    signal?: AbortSignal,
    focusPath?: string,
  ): Promise<ReaderDirectoryPageDto>
  searchDirectoryBrowser?(
    sessionId: string,
    query: string,
    options?: ReaderDirectorySearchOptionsDto,
    signal?: AbortSignal,
  ): Promise<ReaderDirectorySearchResultDto>
  treeDirectoryBrowser?(sessionId: string, path?: string, refresh?: boolean, signal?: AbortSignal): Promise<ReaderDirectoryTreePageDto>
  watchDirectoryTreeBrowser?(sessionId: string, afterRevision: number, signal?: AbortSignal): Promise<ReaderDirectoryTreeChangesDto | undefined>
  directorySizes?(sessionId: string, generation: number, paths: readonly string[], signal?: AbortSignal): Promise<ReaderDirectorySizeBatchDto>
  resolveDirectorySelection?(
    sessionId: string,
    selection: ReaderDirectorySelectionDescriptorDto,
    previewLimit?: number,
    signal?: AbortSignal,
  ): Promise<ReaderDirectorySelectionResolutionDto>
  resolveFolderPenetration?(
    sessionId: string,
    path: string,
    policy?: ReaderFolderPenetrationPolicyDto,
    signal?: AbortSignal,
  ): Promise<ReaderFolderPenetrationResolutionDto>
  describeFolderPenetration?(sessionId: string, paths: readonly string[], signal?: AbortSignal): Promise<{ entries: readonly ReaderFolderPenetrationDescriptionDto[] }>
  readDirectoryEmm?(sessionId: string, generation: number, paths: readonly string[], signal?: AbortSignal): Promise<ReaderDirectoryEmmReadResultDto>
  editDirectoryEmm?(sessionId: string, command: ReaderDirectoryEmmEditCommandDto, signal?: AbortSignal): Promise<ReaderDirectoryEmmEditResultDto>
  suggestDirectoryEmmTags?(count?: number, signal?: AbortSignal): Promise<readonly ReaderEmmTagSuggestionDto[]>
  listManualEmmTags?(limit?: number, signal?: AbortSignal): Promise<readonly ReaderManualTagSummaryDto[]>
  listSearchHistory?(scope: ReaderSearchHistoryScopeDto, limit?: number, signal?: AbortSignal): Promise<readonly ReaderSearchHistoryDto[]>
  recordSearchHistory?(scope: ReaderSearchHistoryScopeDto, query: string, signal?: AbortSignal): Promise<ReaderSearchHistoryDto>
  removeSearchHistory?(scope: ReaderSearchHistoryScopeDto, query: string, signal?: AbortSignal): Promise<boolean>
  clearSearchHistory?(scope: ReaderSearchHistoryScopeDto, signal?: AbortSignal): Promise<number>
  filterDirectoryBrowser?(
    sessionId: string,
    filter: ReaderDirectoryFilterDto,
    focusPath?: string,
    signal?: AbortSignal,
    showHiddenFolders?: boolean,
    hideMissingEfuEntries?: boolean,
  ): Promise<ReaderDirectoryPageDto>
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
  updateMediaProgress?(
    sessionId: string,
    progress: Pick<ReaderMediaProgressDto, "position" | "duration" | "completed">,
    flush?: boolean,
    signal?: AbortSignal,
  ): Promise<ReaderMediaProgressDto>
  subtitleTracks?(sessionId: string, pageId: string, signal?: AbortSignal): Promise<readonly ReaderSubtitleTrackDto[]>
  bookSettings?(sessionId: string, signal?: AbortSignal): Promise<ReaderBookSettingsSnapshotDto>
  updateBookSettings?(
    sessionId: string,
    expectedRevision: number,
    patch: ReaderBookSettingsPatchDto,
    signal?: AbortSignal,
  ): Promise<ReaderBookSettingsUpdateDto>
  listPageCatalog?(
    sessionId: string,
    cursor: number,
    limit: number,
    options: { query?: string; thumbnails?: boolean },
    signal?: AbortSignal,
  ): Promise<ReaderPageListDto>
  pageAction?(sessionId: string, pageId: string, action: "copy" | "reveal" | "open", signal?: AbortSignal): Promise<ReaderPageCopyActionDto | void>
  releasePageActionLease?(sessionId: string, leaseToken: string): Promise<void>
  metadata?(sessionId: string, signal?: AbortSignal): Promise<ReaderMetadataDto>
  getEmmMetadata?(sessionId: string, signal?: AbortSignal): Promise<ReaderEmmMetadataSnapshotDto>
  updateEmmMetadata?(
    sessionId: string,
    expectedRevision: number,
    patch: ReaderEmmMetadataPatchDto,
    signal?: AbortSignal,
  ): Promise<ReaderEmmMetadataSnapshotDto>
  pageMediaInformation?(sessionId: string, signal?: AbortSignal): Promise<ReaderPageMediaInformationDto>
  diagnostics?(signal?: AbortSignal): Promise<ReaderStorageDiagnosticsDto>
  systemMonitorSnapshot?(signal?: AbortSignal): Promise<ReaderSystemMonitorSnapshotDto>
  preloadDiagnostics?(sessionId: string, signal?: AbortSignal): Promise<ReaderStorageDiagnosticsDto>
  runPreloadAction?(sessionId: string, action: ReaderPreloadActionDto, signal?: AbortSignal): Promise<ReaderPreloadActionResultDto>
  updatePreloadContext?(sessionId: string, context: ReaderPreloadContextDto, signal?: AbortSignal): Promise<ReaderPreloadPlanDto>
  reportPreloadEvents?(
    sessionId: string,
    generation: number,
    events: readonly ReaderPreloadEventDto[],
    signal?: AbortSignal,
  ): Promise<ReaderPreloadReportResultDto>
  thumbnailMaintenance?(signal?: AbortSignal): Promise<ReaderThumbnailMaintenanceSnapshotDto>
  cleanupThumbnails?(command: ReaderThumbnailCleanupCommandDto, signal?: AbortSignal): Promise<ReaderThumbnailCleanupResultDto>
  clearThumbnailFolderManifests?(prefix: string, limit?: number, signal?: AbortSignal): Promise<number>
  clearThumbnailFailures?(limit?: number, signal?: AbortSignal): Promise<number>
  openSystemPath?(path: string, signal?: AbortSignal): Promise<void>
  revealSystemPath?(path: string, signal?: AbortSignal): Promise<void>
  openExternalUrl?(url: string, signal?: AbortSignal): Promise<void>
  explorerContextMenuPreview?(signal?: AbortSignal): Promise<ReaderExplorerContextMenuPreviewDto>
  explorerContextMenuStatus?(signal?: AbortSignal): Promise<ReaderExplorerContextMenuStatusDto>
  setExplorerContextMenuEnabled?(enabled: boolean, confirmed?: boolean, signal?: AbortSignal): Promise<ReaderExplorerContextMenuStatusDto>
  repairExplorerContextMenu?(confirmed?: boolean, signal?: AbortSignal): Promise<ReaderExplorerContextMenuStatusDto>
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
  saveBookmarkList?(
    list: {
      id?: string
      name: string
      isFavorite?: boolean
      createdAt?: number
    },
    signal?: AbortSignal,
  ): Promise<ReaderBookmarkListDto>
  removeBookmarkList?(id: string, signal?: AbortSignal): Promise<void>
  listPlaylists?(signal?: AbortSignal): Promise<readonly ReaderPlaylistDto[]>
  savePlaylist?(playlist: { id?: string; name: string; createdAt?: number }, signal?: AbortSignal): Promise<ReaderPlaylistDto>
  removePlaylist?(id: string, signal?: AbortSignal): Promise<void>
  listPlaylistEntries?(playlistId: string, signal?: AbortSignal): Promise<readonly ReaderPlaylistEntryDto[]>
  appendPlaylistEntries?(playlistId: string, entries: ReadonlyArray<{ id?: string; source: ReaderPlaylistEntryDto["source"]; name: string; createdAt?: number }>, signal?: AbortSignal): Promise<readonly ReaderPlaylistEntryDto[]>
  removePlaylistEntries?(playlistId: string, ids: readonly string[], signal?: AbortSignal): Promise<number>
  reorderPlaylistEntries?(playlistId: string, ids: readonly string[], signal?: AbortSignal): Promise<void>
  navigate(sessionId: string, action: "next" | "previous", signal?: AbortSignal): Promise<ReaderNavigationDto>
  goTo(sessionId: string, pageIndex: number, signal?: AbortSignal): Promise<ReaderNavigationDto>
  updateSessionOptions(
    sessionId: string,
    patch: {
      direction?: FrameSnapshot["direction"]
      layout?: Partial<ReaderLayout>
    },
    signal?: AbortSignal,
  ): Promise<ReaderNavigationDto>
  updatePageOrder?(
    sessionId: string,
    patch: Partial<ReaderPageOrderDto>,
    signal?: AbortSignal,
  ): Promise<ReaderNavigationDto & { pageOrder: ReaderPageOrderDto }>
  close(sessionId: string): Promise<void>
}

export interface ReaderStartupStateDto {
  lastFolder: { path: string; updatedAt: number } | null
  lastBook: ReaderRecentDto | null
}
import type { ReaderFolderPenetrationConfig, ReaderFolderPenetrationTerminalKindDto } from "./reader-folder-penetration-contract"
import type { ReaderSessionDto, ReaderNavigationDto, ReaderPreloadPlanDto, ReaderPreloadEventDto, ReaderPreloadReportResultDto, ReaderPreloadContextDto, ReaderSourceChangeDto, ReaderPageSortModeDto, ReaderMediaPriorityModeDto, ReaderPageOrderDto, ReaderBookSettingsSnapshotDto, ReaderBookSettingsPatchDto, ReaderBookSettingsUpdateDto, ReaderPageListDto, ReaderFrameWindowDto, ReaderPageCopyActionDto, ReaderFileMutationDto, ReaderFileOperationResultDto, ReaderFileOperationBatchResultDto, ReaderFileUndoStateDto, ReaderFileUndoResultDto, ReaderFileUndoDiscardResultDto } from "./reader-http-core-contract"
import type { ReaderExplorerContextMenuPreviewDto, ReaderExplorerContextMenuStatusDto, ReaderDirectorySelectionDescriptorDto, ReaderFolderPenetrationPolicyDto, ReaderFolderPenetrationResolutionDto, ReaderFolderPenetrationDescriptionDto, ReaderActivationProvenanceDto, ReaderDirectorySelectionOperationSnapshotDto, ReaderDirectoryClipboardSnapshotDto, ReaderMetadataDto, ReaderPageMediaInformationDto, ReaderStorageDiagnosticsDto, ReaderSystemMonitorConfigDto, ReaderSystemMonitorSnapshotDto, ReaderSystemMonitorConfigPatch, ReaderPreloadActionDto, ReaderPreloadActionResultDto, ReaderThumbnailMaintenanceSnapshotDto, ReaderThumbnailCleanupCommandDto, ReaderThumbnailCleanupResultDto, ReaderRecentDto, ReaderLibraryQueryDto, ReaderFolderProgressSummaryDto, ReaderOpdsCatalogDto, ReaderRecentBatchRemoveResultDto, ReaderRecentCleanupRequestDto, ReaderRecentCleanupResultDto, ReaderInvalidLibraryCleanupResultDto, ReaderBookmarkDto, ReaderBookmarkListDto, ReaderPlaylistDto, ReaderPlaylistEntryDto, ReaderLibraryStatisticsDto, ReaderAiTranslationConfigDto, ReaderAiTranslationConfigPatch, ReaderEmmConfigDto, ReaderEmmConfigPatch, ReaderEmmConnectionProbeDto, ReaderOllamaModelDto, ReaderAiTranslationResultDto, ReaderAiCacheStatsDto, ReaderAiCheckDto, SaveReaderBookmarkDto, UpdateReaderBookmarkDto, ReaderBookmarkBatchUpdateDto, ReaderBookmarkBatchResultDto, ReaderBookmarkBatchRemoveResultDto, ReaderDirectorySizeBatchDto, ReaderDirectorySelectionResolutionDto, ReaderEmmTagSuggestionDto, ReaderManualTagSummaryDto, ReaderEmmMetadataSnapshotDto, ReaderDirectoryEmmReadResultDto, ReaderEmmMetadataPatchDto, ReaderDirectoryEmmEditCommandDto, ReaderDirectoryEmmEditResultDto, ReaderDirectoryMetadataFieldDto, ReaderDirectorySortDto, ReaderDirectorySortPreferenceCommandDto, ReaderDirectoryPageDto, ReaderDirectorySearchOptionsDto, ReaderDirectorySearchResultDto, ReaderDirectoryTreePageDto, ReaderDirectoryTreeChangesDto, ReaderDirectoryRootDto, ReaderSearchHistoryScopeDto, ReaderSearchHistoryDto, ReaderLibraryThumbnailBatchDto, ReaderLibraryThumbnailRegistrationDto, ReaderLibraryThumbnailWarmupSummaryDto, ReaderDirectoryNavigationDto, ReaderDirectoryFilterDto } from "./reader-http-services-contract"
import type { ReaderShellConfigDto, ReaderHistoryListPreferencesDto, ReaderHistoryListPreferencesPatch, ReaderBookmarkListPreferencesDto, ReaderBookmarkListPreferencesPatch, ReaderPageListPreferencesDto, ReaderPageListPreferencesPatch, ReaderBookDefaultsDto, ReaderBookDefaultsPatch, ReaderImageProcessingConfigDto, ReaderImageProcessingPatchDto, ReaderRuntimeConfigDto, ReaderInputBindingsPatch, ReaderSuperResolutionConfigDto, ReaderSuperResolutionPatchDto, ReaderUpscaleArtifactResultDto, ReaderUpscaleCapabilityDto, ReaderUpscalePreloadSnapshotDto, ReaderUpscaleCacheSnapshotDto, ReaderUpscaleCacheCleanupDto, ReaderSubtitleTrackDto, ReaderRadialMenuPatch, ReaderFolderRatingCacheDto, ReaderVoiceControlPatch, ReaderSettingsMigrationInspection, ReaderSettingsMigrationImportResult, ReaderColorFilterConfigPatch, ReaderPageTransitionConfigPatch, ReaderSwitchToastConfigPatch, ReaderInfoOverlayConfigPatch, ReaderImageTrimConfigPatch, ReaderUpscaleArtifactProbeResultDto, ReaderFolderViewConfig, ReaderFolderViewPatch, ReaderViewDefaultsPatch, ReaderSlideshowConfig, ReaderSlideshowPatch, ReaderSidebarLayoutPatch, ReaderCardLayoutPatch, ReaderBoardLayoutPatch, ReaderShellControlPatch } from "./reader-http-runtime-contract"
export { READER_FOLDER_DETAIL_DEFAULT_WIDTHS } from "./reader-http-runtime-contract"
export type { ReaderShellConfigDto, ReaderSwimlaneId, ReaderSwimlaneLaneDto, ReaderShellEdge, ReaderShellLockMode, ReaderFilePresentationViewMode, ReaderFilePresentationOverridesDto, ReaderFilePresentationOverridesPatch, ReaderHistoryListPreferencesDto, ReaderHistoryListPreferencesPatch, ReaderBookmarkListPreferencesDto, ReaderBookmarkListPreferencesPatch, ReaderPageListPreferencesDto, ReaderPageListPreferencesPatch, ReaderBookDefaultsDto, ReaderBookDefaultsPatch, ReaderImageProcessingConfigDto, ReaderImageProcessingPatchDto, ReaderRuntimeConfigDto, ReaderBackgroundMode, ReaderAmbientStyle, ReaderBackgroundConfigDto, ReaderBackgroundPatchDto, ReaderInputBindingsPatch, ReaderSuperResolutionPreferencesDto, ReaderSuperResolutionConditionDto, ReaderSuperResolutionConfigDto, ReaderSuperResolutionArtifactCacheDto, ReaderSuperResolutionPatchDto, ReaderUpscaleArtifactResultDto, ReaderUpscaleModelDto, ReaderUpscaleEngineCapabilityDto, ReaderUpscaleCapabilityDto, ReaderUpscalePreloadSnapshotDto, ReaderUpscalePreloadLogEntryDto, ReaderUpscaleCacheSnapshotDto, ReaderUpscaleCacheCleanupDto, ReaderSubtitleTrackDto, ReaderShellSurface, ReaderShellMaterialPreset, ReaderShellSurfaceValues, ReaderShellMaterialDto, ReaderShellMaterialPatch, ReaderRadialMenuPatch, ReaderFolderRatingEntryDto, ReaderFolderRatingCacheDto, ReaderVoiceControlPatch, ReaderSettingsMigrationReport, ReaderSettingsMigrationInspection, ReaderSettingsMigrationImportResult, ReaderColorFilterConfigPatch, ReaderPageTransitionConfigPatch, ReaderSwitchToastConfigPatch, ReaderInfoOverlayConfigPatch, ReaderImageTrimConfigPatch, ReaderFolderViewMode, ReaderFolderTreeLayout, ReaderFolderDetailColumn, ReaderFolderDetailsConfig, ReaderFolderSearchConfig, ReaderFolderTreeViewConfig, ReaderFolderPinnedTab, ReaderFolderTabsConfig, ReaderFolderRegionPosition, ReaderFolderEmptyAreaAction, ReaderFolderEmptyAreaConfig, ReaderUpscaleArtifactProbeResultDto, ReaderFolderTagDisplayConfig, ReaderFolderTitleWrapConfig, ReaderFolderConfirmationConfig, ReaderFolderMigrationTarget, ReaderFolderMigrationConfig, ReaderFolderViewConfig, ReaderFolderDetailsPatch, ReaderFolderViewPatch, ReaderViewDefaultsPatch, ReaderSlideshowConfig, ReaderSlideshowPatch, ReaderSidebarLayoutPatch, ReaderCardLayoutPatch, ReaderBoardLayoutPatch, ReaderShellControlPatch } from "./reader-http-runtime-contract"
export type { ReaderExplorerContextMenuPlanItemDto, ReaderExplorerContextMenuPreviewDto, ReaderExplorerContextMenuStatusDto, ReaderDirectorySelectionDescriptorDto, ReaderFolderPenetrationPolicyDto, ReaderFolderPenetrationResolutionDto, ReaderFolderPenetrationDescriptionDto, ReaderActivationProvenanceDto, ReaderDirectorySelectionOperationSnapshotDto, ReaderDirectoryClipboardSnapshotDto, ReaderMetadataDto, ReaderPageMediaInformationDto, ReaderStorageDiagnosticsDto, ReaderSystemMonitorIntervalDto, ReaderSystemMonitorConfigDto, ReaderSystemMonitorSnapshotDto, ReaderSystemMonitorConfigPatch, ReaderPreloadActionDto, ReaderPreloadActionResultDto, ReaderThumbnailWriterSnapshotDto, ReaderThumbnailMaintenanceSnapshotDto, ReaderThumbnailCleanupCommandDto, ReaderThumbnailCleanupResultDto, ReaderRecentDto, ReaderLibrarySortFieldDto, ReaderLibrarySortOrderDto, ReaderLibraryQueryDto, ReaderFolderProgressSummaryDto, ReaderOpdsLinkDto, ReaderOpdsCatalogDto, ReaderRecentBatchRemoveResultDto, ReaderRecentCleanupRequestDto, ReaderRecentCleanupResultDto, ReaderInvalidLibraryCleanupResultDto, ReaderBookmarkDto, ReaderBookmarkListDto, ReaderPlaylistDto, ReaderPlaylistEntryDto, ReaderLibraryStatisticsDto, ReaderAiTranslationServiceDto, ReaderAiTranslationConfigDto, ReaderAiTranslationConfigPatch, ReaderEmmConfigDto, ReaderEmmConfigPatch, ReaderEmmConnectionProbeDto, ReaderOllamaModelDto, ReaderAiTranslationResultDto, ReaderAiCacheStatsDto, ReaderAiCheckDto, SaveReaderBookmarkDto, UpdateReaderBookmarkDto, ReaderBookmarkBatchUpdateDto, ReaderBookmarkBatchResultDto, ReaderBookmarkBatchRemoveResultDto, ReaderDirectoryEntryDto, ReaderDirectorySizeBatchItemDto, ReaderDirectorySizeBatchDto, ReaderDirectorySelectionResolutionDto, ReaderEmmTagDto, ReaderEmmTagSuggestionDto, ReaderManualTagSummaryDto, ReaderEmmMetadataSnapshotDto, ReaderDirectoryEmmReadResultDto, ReaderEmmMetadataPatchDto, ReaderDirectoryEmmEditCommandDto, ReaderDirectoryEmmEditResultItemDto, ReaderDirectoryEmmEditResultDto, ReaderDirectorySortFieldDto, ReaderDirectoryMetadataFieldDto, ReaderDirectorySortOrderDto, ReaderDirectorySortDto, ReaderDirectorySortSourceDto, ReaderDirectorySortPreferenceCommandDto, ReaderDirectoryPageDto, ReaderDirectorySearchModeDto, ReaderDirectorySearchKindDto, ReaderDirectorySearchOptionsDto, ReaderDirectorySearchResultDto, ReaderDirectoryTreePageDto, ReaderDirectoryTreeChangesDto, ReaderDirectoryRootDto, ReaderSearchHistoryScopeDto, ReaderSearchHistoryDto, ReaderLibraryThumbnailDto, ReaderLibraryThumbnailBatchDto, ReaderLibraryThumbnailRegistrationDto, ReaderLibraryThumbnailWarmupSummaryDto, ReaderDirectoryNavigationDto, ReaderDirectoryFilterDto } from "./reader-http-services-contract"
export type { ReaderPageDto, ReaderSessionDto, ReaderActivationIdentityDto, ReaderActivationTraversalFrameDto, ReaderNavigationDto, ReaderPreloadOutcomeDto, ReaderPreloadCandidateDto, ReaderPreloadPlanDto, ReaderPreloadEventDto, ReaderPreloadReportResultDto, ReaderPreloadContextDto, ReaderSourceChangeDto, ReaderPageSortModeDto, ReaderMediaPriorityModeDto, ReaderPageOrderDto, ReaderBookSettingsSnapshotDto, ReaderBookSettingsValuesDto, ReaderBookSettingsKeyDto, ReaderBookSettingsPatchDto, ReaderBookSettingsUpdateDto, ReaderPageListDto, ReaderFrameWindowDto, ReaderPageCopyActionDto, ReaderFileMutationDto, ReaderFileOperationResultDto, ReaderFileOperationBatchResultDto, ReaderFileUndoStateDto, ReaderFileUndoResultDto, ReaderFileUndoDiscardResultDto } from "./reader-http-core-contract"

export type { ReaderFolderPenetrationConfig, ReaderFolderPenetrationTerminalKindDto } from "./reader-folder-penetration-contract"
