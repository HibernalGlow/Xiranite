import type { PageMode, ReaderAutoRotation, ReaderFitMode, ReaderLayout, ReaderMouseCursorSettings, ReaderOrientation, ReaderWidePageStretch, TailOverflowBehavior } from "@xiranite/node-neoview/ui-core"
import type { ReaderColorFilterPatch, ReaderColorFilterSettings } from "@xiranite/node-neoview/ui-core"
import type { ReaderPageTransitionPatch, ReaderPageTransitionSettings } from "@xiranite/node-neoview/ui-core"
import type { ReaderSwitchToastPatch, ReaderSwitchToastSettings } from "@xiranite/node-neoview/ui-core"
import type { ReaderInfoOverlayPatch, ReaderInfoOverlaySettings } from "@xiranite/node-neoview/ui-core"
import type { ReaderImageTrimPatch, ReaderImageTrimSettings } from "@xiranite/node-neoview/ui-core"
import type { ReaderMediaConfigDto } from "./reader-media-http-contract"
import type { ReaderInputBindingsConfig, ReaderRadialMenuConfig, ReaderVoiceControlConfig } from "@xiranite/node-neoview/ui-core"
import type { ReaderFolderPenetrationConfig } from "./reader-folder-penetration-contract"
import type { ReaderPageSortModeDto, ReaderMediaPriorityModeDto } from "./reader-http-core-contract"
import type { ReaderSystemMonitorConfigDto, ReaderAiTranslationConfigDto, ReaderEmmConfigDto, ReaderDirectoryFilterDto } from "./reader-http-services-contract"

export interface ReaderShellConfigDto {
  revision?: number
  showDelayMs: number
  hideDelayMs: number
  opacity: { top: number; bottom: number; sidebar: number }
  blur: { top: number; bottom: number; sidebar: number }
  material?: ReaderShellMaterialDto
  edges: Record<
    ReaderShellEdge,
    {
      enabled: boolean
      initialVisible: boolean
      pinned: boolean
      triggerSize: number
      lockMode?: ReaderShellLockMode
    }
  >
  floatingControl?: { enabled: boolean; position: { x: number; y: number } }
  sidebars: Record<
    "left" | "right",
    {
      width: number
      height: "full" | "two-thirds" | "half" | "one-third" | "custom"
      customHeight: number
      verticalAlign: number
      horizontalPosition: number
    }
  >
  sidebarInteraction?: {
    showDragHandle: boolean
    enableBlankAreaCollapse: boolean
    blankAreaCollapseMode: "single" | "double"
  }
  workspace?: {
    mode: "edges" | "swimlane"
    swimlane: {
      laneOrder: ReaderSwimlaneId[]
      activeLane: ReaderSwimlaneId
      readerSolo: boolean
      readerSoloOnFocus: boolean
      soloLaneId?: ReaderSwimlaneId
      readerWidthRatio: number
      edgeRevealDelayMs: number
      edgeRevealZones: Record<"left" | "right" | "top" | "bottom", { x: number; y: number; width: number; height: number }>
      readerFocusOnHover: boolean
      readerFocusHoverDelayMs: number
      manualScrollEnabled: boolean
      showLaneNavigatorInReaderSolo: boolean
      autoFitToViewport: boolean
      barHandleStyle: "grip" | "groove" | "move" | "grab" | "edge"
      barHandlePosition: "left" | "right"
      laneNavigatorPositionX: number
      laneNavigatorPositionY: number
      laneNavigatorDock: "floating" | "reader-title" | "window-title"
      windowControlsPlacement?: "lane" | "titlebar"
      windowControlsOwnerLaneId?: ReaderSwimlaneId
      windowControlsExpanded?: boolean
      lanes: Record<ReaderSwimlaneId, ReaderSwimlaneLaneDto>
    }
  }
  panelLayout: Record<
    string,
    {
      visible: boolean
      order: number
      position: "left" | "right" | "bottom" | "floating"
    }
  >
  cardLayout: Record<
    string,
    {
      panelId: string
      visible: boolean
      expanded: boolean
      order: number
      height?: number
    }
  >
}
export type ReaderSwimlaneId = string
export interface ReaderSwimlaneLaneDto {
  width: number
  landscapeWidth?: number
  portraitWidth?: number
  landscapeReaderSoloWidth?: number
  portraitReaderSoloWidth?: number
  collapsed: boolean
  title?: string
  activePanelId?: string
  panelBarMode?: "pinned" | "floating"
  panelBarDock?: "left" | "right" | "top" | "bottom"
  panelBarPositionX?: number
  panelBarPositionY?: number
  panelBarConstrained?: boolean
}
export type ReaderShellEdge = "top" | "right" | "bottom" | "left"
export type ReaderShellLockMode = "auto" | "locked-open" | "locked-hidden"
export type ReaderFilePresentationViewMode = "compact" | "cover-list" | "mosaic-list" | "cover-grid"
export interface ReaderFilePresentationOverridesDto {
  viewMode?: ReaderFilePresentationViewMode
  contentWidthPercent?: number
  thumbnailWidthPercent?: number
  bannerWidthPercent?: number
}
export interface ReaderFilePresentationOverridesPatch {
  viewMode?: ReaderFilePresentationViewMode | null
  contentWidthPercent?: number | null
  thumbnailWidthPercent?: number | null
  bannerWidthPercent?: number | null
}
export interface ReaderHistoryListPreferencesDto {
  /** @deprecated Compatibility projection for older Reader hosts. */
  viewMode: "compact" | "content" | "banner" | "thumbnail"
  viewOverrides?: ReaderFilePresentationOverridesDto
}
export interface ReaderHistoryListPreferencesPatch {
  historyList: {
    /** @deprecated Accepted by older Reader hosts. */
    viewMode?: ReaderHistoryListPreferencesDto["viewMode"]
    viewOverrides?: ReaderFilePresentationOverridesPatch
  }
}
export interface ReaderBookmarkListPreferencesDto {
  activeListId: string
  viewOverrides?: ReaderFilePresentationOverridesDto
}
export interface ReaderBookmarkListPreferencesPatch {
  bookmarkList: {
    activeListId?: string
    viewOverrides?: ReaderFilePresentationOverridesPatch
  }
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
export interface ReaderStartupConfigDto {
  restoreLastBook: boolean
}
export interface ReaderStartupConfigPatch {
  startup: Partial<ReaderStartupConfigDto>
}
export interface ReaderRuntimeConfigDto {
  shell: ReaderShellConfigDto
  viewDefaults: {
    fitMode: ReaderFitMode
    pageMode: PageMode
    doublePageGap?: number
    splitWidePages?: boolean
    hoverScrollEnabled?: boolean
    hoverScrollSpeed?: number
    magnifierZoom?: number
    magnifierSize?: number; mouseCursor?: ReaderMouseCursorSettings
    orientation?: ReaderOrientation
    autoRotation?: ReaderAutoRotation
    widePageStretch?: ReaderWidePageStretch
    background?: ReaderBackgroundConfigDto
  }
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
  /** Optional because older backends did not expose startup preferences. */
  startup?: ReaderStartupConfigDto
  systemMonitor: ReaderSystemMonitorConfigDto
  preload: {
    maxCandidatePages: number
    browserPredecodeEnabled: boolean
    browserPredecodePages: number
  }
  emm?: ReaderEmmConfigDto
  aiTranslation?: ReaderAiTranslationConfigDto
  imageTrim?: ReaderImageTrimSettings
  superResolution?: ReaderSuperResolutionConfigDto
  inputBindings: ReaderInputBindingsConfig
  radialMenu: ReaderRadialMenuConfig
  voiceControl?: ReaderVoiceControlConfig
}
export type ReaderBackgroundMode = "solid" | "auto" | "edge" | "ambient" | "aurora" | "spotlight"
export type ReaderAmbientStyle = "gentle" | "vibrant" | "dynamic"
export interface ReaderBackgroundConfigDto {
  color: string
  mode: ReaderBackgroundMode
  ambient: { style: ReaderAmbientStyle; speed: number; blur: number; opacity: number }
  aurora: { showRadialGradient: boolean }
  spotlight: { color: string }
}
export interface ReaderBackgroundPatchDto {
  color?: string
  mode?: ReaderBackgroundMode
  ambient?: Partial<ReaderBackgroundConfigDto["ambient"]>
  aurora?: Partial<ReaderBackgroundConfigDto["aurora"]>
  spotlight?: Partial<ReaderBackgroundConfigDto["spotlight"]>
}
export interface ReaderInputBindingsPatch {
  inputBindings: {
    bindings?: ReaderInputBindingsConfig["bindings"]
    reset?: "defaults"
  }
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
    metadata?: Readonly<
      Record<
        string,
        {
          operator: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "regex" | "contains"
          value: string | number
        }
      >
    >
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
  artifactCache?: ReaderSuperResolutionArtifactCacheDto
  preferences: ReaderSuperResolutionPreferencesDto
}
export interface ReaderSuperResolutionArtifactCacheDto {
  directory?: string
  retentionDays: number
  cleanupIntervalMinutes: number
}
export interface ReaderSuperResolutionPatchDto {
  superResolution: {
    modelsDirectory?: string
    modelSources?: readonly string[]
    artifactCache?: Partial<ReaderSuperResolutionArtifactCacheDto>
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
export interface ReaderUpscaleEngineCapabilityDto {
  engine: "upscayl" | "waifu2x" | "realcugan"
  available: boolean
  executablePath?: string
  version?: string
  architecture?: string
  daemonSupported?: boolean
  performanceMode?: "daemon" | "process-per-page"
  managed?: boolean
  warning?: string
  reason?: string
}
export type ReaderUpscaleCapabilityDto =
  | {
      available: false
      reason: string
      models: readonly []
      engines: readonly []
    }
  | {
      available: true
      models: readonly ReaderUpscaleModelDto[]
      engines: readonly ReaderUpscaleEngineCapabilityDto[]
      probedAt: number
    }
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
  queuedPageIndexes?: readonly number[]
  processingPageIndexes?: readonly number[]
  upscaledPageIndexes?: readonly number[]
  startedAt: number
  updatedAt: number
  completedAt?: number
  events?: readonly ReaderUpscalePreloadLogEntryDto[]
}
export interface ReaderUpscalePreloadLogEntryDto {
  id: string
  at: number
  level: "info" | "success" | "error"
  message: string
  pageIndex?: number
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
export interface ReaderRadialMenuPatch {
  radialMenu: { config?: ReaderRadialMenuConfig; reset?: "defaults" }
}
export interface ReaderFolderRatingEntryDto { path: string; averageRating: number; count: number; direct: boolean }
export interface ReaderFolderRatingCacheDto { entries: readonly ReaderFolderRatingEntryDto[]; updatedAt?: number }
export interface ReaderVoiceControlPatch {
  voiceControl: Partial<ReaderVoiceControlConfig>
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
export type ReaderUpscaleArtifactProbeResultDto = ReaderUpscaleArtifactResultDto | { status: "miss" | "pending" }
export interface ReaderFolderTagDisplayConfig {
  tagMode: "all" | "collect" | "none"
  showRating: boolean
  showCollectTagCount: boolean
  showTags: boolean
  maxTags: number
  showTooltips: boolean
}
export type ReaderFolderTitleWrapConfig = Record<ReaderFolderViewMode, boolean>
export interface ReaderFolderConfirmationConfig {
  trash: boolean
  permanentDelete: boolean
  batchTrash: boolean
  batchPermanentDelete: boolean
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
  titleWrap: ReaderFolderTitleWrapConfig
  /** Preferred directory listing type filter; applied when a browser session opens. */
  typeFilter?: ReaderDirectoryFilterDto
  showHiddenFolders?: boolean
  hideMissingEfuEntries?: boolean
  confirmations: ReaderFolderConfirmationConfig
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
    titleWrap?: Partial<ReaderFolderTitleWrapConfig>
    typeFilter?: ReaderDirectoryFilterDto
    showHiddenFolders?: boolean
    hideMissingEfuEntries?: boolean
    confirmations?: Partial<ReaderFolderConfirmationConfig>
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
  viewDefaults: {
    fitMode?: ReaderFitMode
    pageMode?: PageMode
    doublePageGap?: number
    splitWidePages?: boolean
    hoverScrollEnabled?: boolean
    hoverScrollSpeed?: number
    magnifierZoom?: number
    magnifierSize?: number; mouseCursor?: Partial<ReaderMouseCursorSettings>
    orientation?: ReaderOrientation
    autoRotation?: ReaderAutoRotation
    widePageStretch?: ReaderWidePageStretch
    background?: ReaderBackgroundPatchDto
  }
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
    panels: Array<{
      id: string
      visible: boolean
      order: number
      position: ReaderShellConfigDto["panelLayout"][string]["position"]
    }>
    cards: Array<{
      cardId: string
      panelId: string
      visible: boolean
      order: number
    }>
  }
}
export interface ReaderShellControlPatch {
  expectedRevision: number
  shellControl: {
    floating?: { enabled?: boolean; position?: { x: number; y: number } }
    edges?: Partial<
      Record<
        ReaderShellEdge,
        {
          enabled?: boolean
          initialVisible?: boolean
          pinned?: boolean
          triggerSize?: number
          lockMode?: ReaderShellLockMode
        }
      >
    >
    sidebarInteraction?: Partial<NonNullable<ReaderShellConfigDto["sidebarInteraction"]>>
    workspace?: {
      mode?: NonNullable<ReaderShellConfigDto["workspace"]>["mode"]
      laneOrder?: ReaderSwimlaneId[]
      activeLane?: ReaderSwimlaneId
      readerSolo?: boolean
      readerSoloOnFocus?: boolean
      soloLaneId?: ReaderSwimlaneId | null
      readerWidthRatio?: number
      edgeRevealDelayMs?: number
      edgeRevealZones?: Record<"left" | "right" | "top" | "bottom", { x: number; y: number; width: number; height: number }>
      readerFocusOnHover?: boolean
      readerFocusHoverDelayMs?: number
      manualScrollEnabled?: boolean
      showLaneNavigatorInReaderSolo?: boolean
      autoFitToViewport?: boolean
      barHandleStyle?: "grip" | "groove" | "move" | "grab" | "edge"
      barHandlePosition?: "left" | "right"
      laneNavigatorPositionX?: number
      laneNavigatorPositionY?: number
      laneNavigatorDock?: "floating" | "reader-title" | "window-title"
      windowControlsPlacement?: "lane" | "titlebar"
      windowControlsOwnerLaneId?: ReaderSwimlaneId
      windowControlsExpanded?: boolean
      lanes?: Partial<Record<ReaderSwimlaneId, Partial<ReaderSwimlaneLaneDto>>>
    }
    material?: ReaderShellMaterialPatch
    reset?: "known-defaults"
  }
}
