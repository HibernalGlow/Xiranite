import { DEFAULT_READER_LAYOUT, type PageMode } from "../../domain/frame/frame.js"
import type { TailOverflowBehavior } from "../../domain/navigation/navigation.js"
import {
  DEFAULT_READER_PRESENTATION,
  type ReaderAutoRotation,
  type ReaderFitMode,
  type ReaderOrientation,
  type ReaderWidePageStretch,
} from "../../domain/presentation/presentation.js"
import { DEFAULT_READER_IMAGE_FORMATS, DEFAULT_READER_VIDEO_FORMATS, ReaderMediaFormatRegistry } from "../../domain/page/media.js"
import type { ReaderSessionOptions } from "../reader/contracts.js"
import { READER_CARD_MANIFEST, READER_PANEL_MANIFEST, readerCardCanMoveTo } from "./ReaderLayoutManifest.js"
import { unwrapNeoviewConfigEnvelope } from "./NeoviewConfigEnvelope.js"
import { parseNeoviewInputBindingsConfig } from "./ReaderInputBindingsConfig.js"
import type { ReaderInputBindingsConfig } from "../../domain/input/ReaderInputBindings.js"
import { parseReaderRadialMenuConfig, type ReaderRadialMenuConfig } from "./ReaderRadialMenuConfig.js"
import { DEFAULT_READER_VOICE_CONTROL_CONFIG, type ReaderVoiceControlConfig } from "./ReaderVoiceControlConfig.js"
import type { SuperResolutionCustomModelManifest } from "../../ports/SuperResolutionProvider.js"
import { DEFAULT_NEOVIEW_IMAGE_PROCESSING_CONFIG, parseNeoviewImageProcessingConfig, type NeoviewImageProcessingConfig } from "./ReaderImageProcessingConfig.js"
import { parseSuperResolutionPreferences, type SuperResolutionPreferences } from "../../domain/super-resolution/super-resolution-preferences.js"
import {
  DEFAULT_READER_COLOR_FILTER,
  normalizeReaderColorFilter,
  parseReaderColorFilterPatch,
  type ReaderColorFilterPatch,
  type ReaderColorFilterSettings,
} from "../../domain/color-filter/ReaderColorFilter.js"
import {
  DEFAULT_READER_PAGE_TRANSITION,
  normalizeReaderPageTransition,
  parseReaderPageTransitionPatch,
  type ReaderPageTransitionPatch,
  type ReaderPageTransitionSettings,
} from "../../domain/page-transition/ReaderPageTransition.js"
import {
  DEFAULT_READER_SWITCH_TOAST,
  normalizeReaderSwitchToast,
  parseReaderSwitchToastPatch,
  type ReaderSwitchToastPatch,
  type ReaderSwitchToastSettings,
} from "../switch-toast/ReaderSwitchToast.js"
import {
  DEFAULT_READER_INFO_OVERLAY,
  normalizeReaderInfoOverlay,
  parseReaderInfoOverlayPatch,
  type ReaderInfoOverlayPatch,
  type ReaderInfoOverlaySettings,
} from "../info-overlay/ReaderInfoOverlay.js"
import {
  DEFAULT_READER_IMAGE_TRIM,
  normalizeReaderImageTrim,
  parseReaderImageTrimPatch,
  projectReaderImageTrimPatch,
  type ReaderImageTrimPatch,
  type ReaderImageTrimSettings,
} from "../image-trim/ReaderImageTrim.js"
import { DEFAULT_READER_ANIMATED_VIDEO_KEYWORDS, normalizeReaderAnimatedVideoKeywords } from "../animated-video/ReaderAnimatedVideoMode.js"
import { READER_MEDIA_PRIORITY_MODES, READER_PAGE_SORT_MODES, type ReaderMediaPriorityMode, type ReaderPageSortMode } from "../reader/ReaderPageOrder.js"

const READER_CARD_MANIFEST_BY_ID = new Map(READER_CARD_MANIFEST.map((card) => [card.id as string, card]))

export interface NeoviewRuntimeConfig {
  schemaVersion: 1
  sessionOptions: Partial<ReaderSessionOptions>
  shellOptions: NeoviewShellConfig
  viewDefaults: NeoviewViewDefaults
  book: NeoviewBookConfig
  pageList: NeoviewPageListConfig
  bookmarkList: NeoviewBookmarkListConfig
  historyList: NeoviewHistoryListConfig
  folderView: NeoviewFolderViewConfig
  fileTree: NeoviewFileTreeConfig
  slideshow: NeoviewSlideshowConfig
  media: NeoviewMediaConfig
  imageProcessing: NeoviewImageProcessingConfig
  colorFilter: ReaderColorFilterSettings
  pageTransition: ReaderPageTransitionSettings
  switchToast: ReaderSwitchToastSettings
  infoOverlay: ReaderInfoOverlaySettings
  imageTrim: ReaderImageTrimSettings
  superResolution: NeoviewSuperResolutionConfig
  presentationDiskCache: NeoviewPresentationDiskCacheConfig
  inputBindings: ReaderInputBindingsConfig
  radialMenu: ReaderRadialMenuConfig
  voiceControl: ReaderVoiceControlConfig
  preload: NeoviewPreloadConfig
  systemMonitor: NeoviewSystemMonitorConfig
  emm: NeoviewEmmConfig
  aiTranslation: NeoviewAiTranslationConfig
}

export interface NeoviewEmmConfig {
  enabled: boolean
  databasePaths: readonly string[]
  settingPath?: string
  translationDatabasePath?: string
  translationPath?: string
  defaultRating: number
}

export interface NeoviewEmmPatch {
  emm: Partial<NeoviewEmmConfig>
}

export const NEOVIEW_AI_TRANSLATION_SERVICES = ["disabled", "ollama"] as const
export type NeoviewAiTranslationService = (typeof NEOVIEW_AI_TRANSLATION_SERVICES)[number]

export interface NeoviewAiTranslationConfig {
  enabled: boolean
  autoTranslate: boolean
  service: NeoviewAiTranslationService
  ollamaUrl: string
  ollamaModel: string
  sourceLanguage: string
  targetLanguage: string
  promptTemplate: string
  memoryCacheEntries: number
}

export interface NeoviewAiTranslationPatch {
  aiTranslation: Partial<NeoviewAiTranslationConfig>
}

export interface NeoviewPreloadConfig {
  maxCandidatePages: number
}

export interface NeoviewPreloadPatch {
  preload: Partial<NeoviewPreloadConfig>
}

export const NEOVIEW_SYSTEM_MONITOR_INTERVALS = [500, 1_000, 2_000, 5_000] as const
export type NeoviewSystemMonitorInterval = (typeof NEOVIEW_SYSTEM_MONITOR_INTERVALS)[number]

export interface NeoviewSystemMonitorConfig {
  enabled: boolean
  refreshIntervalMs: NeoviewSystemMonitorInterval
  maxSamples: number
}

export interface NeoviewSystemMonitorPatch {
  systemMonitor: Partial<NeoviewSystemMonitorConfig>
}

export interface NeoviewFileTreeConfig {
  excludedPaths: string[]
}

export const NEOVIEW_FOLDER_VIEW_MODES = ["compact", "cover-list", "mosaic-list", "details", "cover-grid", "mosaic-grid"] as const
export const NEOVIEW_FOLDER_EMPTY_AREA_ACTIONS = ["none", "goUp", "goBack"] as const
export const NEOVIEW_FOLDER_TREE_LAYOUTS = ["left", "right", "top", "bottom"] as const
export const NEOVIEW_FOLDER_REGION_POSITIONS = ["none", "top", "bottom", "left", "right"] as const
export const NEOVIEW_FOLDER_DETAIL_COLUMNS = ["name", "path", "type", "extension", "size", "modifiedAt", "dimensions", "pageCount", "rating", "tags"] as const
export const NEOVIEW_FOLDER_HOVER_PREVIEW_DELAYS = [200, 500, 800, 1200] as const
export type NeoviewFolderViewMode = (typeof NEOVIEW_FOLDER_VIEW_MODES)[number]
export type NeoviewFolderEmptyAreaAction = (typeof NEOVIEW_FOLDER_EMPTY_AREA_ACTIONS)[number]
export type NeoviewFolderTreeLayout = (typeof NEOVIEW_FOLDER_TREE_LAYOUTS)[number]
export type NeoviewFolderRegionPosition = (typeof NEOVIEW_FOLDER_REGION_POSITIONS)[number]
export type NeoviewFolderDetailColumn = (typeof NEOVIEW_FOLDER_DETAIL_COLUMNS)[number]
export type NeoviewFolderHoverPreviewDelay = (typeof NEOVIEW_FOLDER_HOVER_PREVIEW_DELAYS)[number]

export interface NeoviewFolderDetailsConfig {
  columnOrder: NeoviewFolderDetailColumn[]
  hiddenColumns: NeoviewFolderDetailColumn[]
  pinnedLeft: NeoviewFolderDetailColumn[]
  pinnedRight: NeoviewFolderDetailColumn[]
  columnWidths: Record<NeoviewFolderDetailColumn, number>
}

export interface NeoviewFolderSearchConfig {
  includeSubfolders: boolean
  showHistoryOnFocus: boolean
  searchInPath: boolean
}

export interface NeoviewFolderEmptyAreaConfig {
  singleClickAction: NeoviewFolderEmptyAreaAction
  doubleClickAction: NeoviewFolderEmptyAreaAction
  showBackButton: boolean
}

export interface NeoviewFolderTreeViewConfig {
  visible: boolean
  layout: NeoviewFolderTreeLayout
  size: number
  pinnedPaths: string[]
}

export interface NeoviewFolderPinnedTab {
  path: string
  title: string
}

export interface NeoviewFolderTabsConfig {
  pinned: NeoviewFolderPinnedTab[]
  layout: NeoviewFolderRegionPosition
  width: number
  breadcrumbPosition: NeoviewFolderRegionPosition
  toolbarPosition: NeoviewFolderRegionPosition
}

export const NEOVIEW_FOLDER_TYPE_FILTERS = ["all", "library", "archive", "directory", "video", "image", "other"] as const
export type NeoviewFolderTypeFilter = (typeof NEOVIEW_FOLDER_TYPE_FILTERS)[number]
export const NEOVIEW_FOLDER_PENETRATION_TARGETS = ["archive", "document", "media-directory", "file"] as const
export type NeoviewFolderPenetrationTarget = (typeof NEOVIEW_FOLDER_PENETRATION_TARGETS)[number]

export interface NeoviewFolderPenetrationConfig {
  enabled: boolean
  maxDepth: number
  terminalTargets: NeoviewFolderPenetrationTarget[]
}

export interface NeoviewFolderTagDisplayConfig {
  tagMode: "all" | "collect" | "none"
  showRating: boolean
  showCollectTagCount: boolean
  showTags: boolean
  maxTags: number
  showTooltips: boolean
}

export interface NeoviewFolderViewConfig {
  homePath: string
  viewMode: NeoviewFolderViewMode
  previewGridEnabled: boolean
  previewCount: 4 | 9 | 16
  contentWidthPercent: number
  thumbnailWidthPercent: number
  bannerWidthPercent: number
  hoverPreviewEnabled: boolean
  hoverPreviewDelayMs: NeoviewFolderHoverPreviewDelay
  /** Preferred directory listing type filter; applied when a browser session opens. */
  typeFilter: NeoviewFolderTypeFilter
  /** Keep development/configuration directories out of normal media browsing. */
  showHiddenFolders: boolean
  /** Require an explicit confirmation before trash or permanent-delete operations. */
  confirmDelete: boolean
  tagDisplay: NeoviewFolderTagDisplayConfig
  penetration: NeoviewFolderPenetrationConfig
  emptyArea: NeoviewFolderEmptyAreaConfig
  details: NeoviewFolderDetailsConfig
  search: NeoviewFolderSearchConfig
  tree: NeoviewFolderTreeViewConfig
  tabs: NeoviewFolderTabsConfig
}

export interface NeoviewFolderDetailsPatch {
  columnOrder?: NeoviewFolderDetailColumn[]
  hiddenColumns?: NeoviewFolderDetailColumn[]
  pinnedLeft?: NeoviewFolderDetailColumn[]
  pinnedRight?: NeoviewFolderDetailColumn[]
  columnWidths?: Partial<Record<NeoviewFolderDetailColumn, number>>
}

export interface NeoviewFolderViewPatch {
  folderView: {
    homePath?: string
    viewMode?: NeoviewFolderViewMode
    previewGridEnabled?: boolean
    previewCount?: 4 | 9 | 16
    contentWidthPercent?: number
    thumbnailWidthPercent?: number
    bannerWidthPercent?: number
    hoverPreviewEnabled?: boolean
    hoverPreviewDelayMs?: NeoviewFolderHoverPreviewDelay
    typeFilter?: NeoviewFolderTypeFilter
    showHiddenFolders?: boolean
    confirmDelete?: boolean
    tagDisplay?: Partial<NeoviewFolderTagDisplayConfig>
    penetration?: Partial<NeoviewFolderPenetrationConfig>
    emptyArea?: Partial<NeoviewFolderEmptyAreaConfig>
    details?: NeoviewFolderDetailsPatch
    search?: Partial<NeoviewFolderSearchConfig>
    tree?: Partial<NeoviewFolderTreeViewConfig>
    tabs?: Partial<NeoviewFolderTabsConfig>
  }
}

export interface NeoviewPresentationDiskCacheConfig {
  enabled: boolean
  directory?: string
  maxBytes: number
  maxEntryBytes: number
  maxAgeMs: number
  trimRatio: number
  minFreeBytes: number
}

export type NeoviewSuperResolutionProvider = "opencomic-system" | "disabled"

export interface NeoviewSuperResolutionArtifactCacheConfig {
  directory?: string
  retentionDays: number
  cleanupIntervalMinutes: number
}

export interface NeoviewSuperResolutionConfig {
  provider: NeoviewSuperResolutionProvider
  upscaylPath?: string
  waifu2xPath?: string
  realcuganPath?: string
  modelsDirectory?: string
  modelSources: readonly string[]
  maxDaemonsPerGpu: number
  daemonIdleTimeoutMs: number
  taskTimeoutMs: number
  artifactCache: NeoviewSuperResolutionArtifactCacheConfig
  customModels: readonly SuperResolutionCustomModelManifest[]
  preferences: SuperResolutionPreferences
}

export interface NeoviewBookConfig {
  lockedSortMode: ReaderPageSortMode | null
  lockedMediaPriority: Exclude<ReaderMediaPriorityMode, "none"> | null
  lockedReadingDirection: "left-to-right" | "right-to-left" | null
}

export interface NeoviewBookPatch {
  book: Partial<NeoviewBookConfig>
}

export type NeoviewSuperResolutionPreferencesPatch = Partial<Omit<SuperResolutionPreferences, "schemaVersion">>
export interface NeoviewSuperResolutionPatch {
  modelsDirectory?: string
  modelSources?: readonly string[]
  artifactCache?: Partial<NeoviewSuperResolutionArtifactCacheConfig>
  preferences?: NeoviewSuperResolutionPreferencesPatch
}

export interface NeoviewHistoryListConfig {
  viewMode: "compact" | "content" | "banner" | "thumbnail"
}

export interface NeoviewHistoryListPatch {
  historyList: Partial<NeoviewHistoryListConfig>
}

export interface NeoviewBookmarkListConfig {
  activeListId: string
}

export interface NeoviewBookmarkListPatch {
  bookmarkList: Partial<NeoviewBookmarkListConfig>
}

export interface NeoviewPageListConfig {
  viewMode: "list" | "details" | "thumbnails"
  followProgress: boolean
}

export interface NeoviewPageListPatch {
  pageList: Partial<NeoviewPageListConfig>
}

export interface NeoviewViewDefaults {
  fitMode: ReaderFitMode
  pageMode: PageMode
  doublePageGap: number
  splitWidePages: boolean
  hoverScrollEnabled: boolean
  hoverScrollSpeed: number
  magnifierZoom: number
  magnifierSize: number
  orientation?: ReaderOrientation
  autoRotation?: ReaderAutoRotation
  widePageStretch?: ReaderWidePageStretch
}

export interface NeoviewViewDefaultsPatch {
  viewDefaults: Partial<NeoviewViewDefaults>
}

export interface NeoviewSlideshowConfig {
  intervalSeconds: number
  loop: boolean
  random: boolean
  fadeTransition: boolean
}

export interface NeoviewSlideshowPatch {
  slideshow: Partial<NeoviewSlideshowConfig>
}

export interface NeoviewSubtitleConfig {
  fontSize: number
  color: string
  backgroundOpacity: number
  bottomPercent: number
}

export interface NeoviewMediaConfig {
  supportedImageFormats: readonly string[]
  videoFormats: readonly string[]
  mediaMimeTypes: Readonly<Record<string, string>>
  autoPlayAnimatedImages: boolean
  animatedVideoEnabled: boolean
  animatedVideoKeywords: readonly string[]
  videoMinPlaybackRate: number
  videoMaxPlaybackRate: number
  videoPlaybackRateStep: number
  subtitle: NeoviewSubtitleConfig
}

export interface NeoviewMediaPatch {
  media: {
    supportedImageFormats?: readonly string[]
    videoFormats?: readonly string[]
    mediaMimeTypes?: Readonly<Record<string, string>>
    autoPlayAnimatedImages?: boolean
    animatedVideoEnabled?: boolean
    animatedVideoKeywords?: readonly string[]
    videoMinPlaybackRate?: number
    videoMaxPlaybackRate?: number
    videoPlaybackRateStep?: number
    subtitle?: Partial<NeoviewSubtitleConfig>
  }
}

export interface NeoviewShellEdgeConfig {
  enabled: boolean
  initialVisible: boolean
  pinned: boolean
  triggerSize: number
  lockMode: NeoviewShellEdgeLockMode
}

export type NeoviewShellEdgeLockMode = "auto" | "locked-open" | "locked-hidden"

export interface NeoviewShellFloatingControlConfig {
  enabled: boolean
  position: { x: number; y: number }
}

export interface NeoviewShellSidebarConfig {
  width: number
  height: "full" | "two-thirds" | "half" | "one-third" | "custom"
  customHeight: number
  verticalAlign: number
  horizontalPosition: number
}

export interface NeoviewShellSidebarInteractionConfig {
  showDragHandle: boolean
  enableBlankAreaCollapse: boolean
  blankAreaCollapseMode: "single" | "double"
}

export const NEOVIEW_WORKSPACE_MODES = ["edges", "swimlane"] as const
export type NeoviewWorkspaceMode = (typeof NEOVIEW_WORKSPACE_MODES)[number]

export const NEOVIEW_SWIMLANE_IDS = ["left", "reader", "right"] as const
export type NeoviewSwimlaneId = string

export const NEOVIEW_PANEL_BAR_MODES = ["pinned", "floating"] as const
export type NeoviewPanelBarMode = (typeof NEOVIEW_PANEL_BAR_MODES)[number]
export const NEOVIEW_PANEL_BAR_DOCKS = ["left", "right", "top", "bottom"] as const
export type NeoviewPanelBarDock = (typeof NEOVIEW_PANEL_BAR_DOCKS)[number]
export const NEOVIEW_BAR_HANDLE_STYLES = ["grip", "groove", "move", "grab", "edge"] as const
export type NeoviewBarHandleStyle = (typeof NEOVIEW_BAR_HANDLE_STYLES)[number]
export const NEOVIEW_BAR_HANDLE_POSITIONS = ["left", "right"] as const
export type NeoviewBarHandlePosition = (typeof NEOVIEW_BAR_HANDLE_POSITIONS)[number]
export const NEOVIEW_LANE_NAVIGATOR_DOCKS = ["floating", "reader-title"] as const
export type NeoviewLaneNavigatorDock = (typeof NEOVIEW_LANE_NAVIGATOR_DOCKS)[number]

export interface NeoviewSwimlaneLaneConfig {
  width: number
  collapsed: boolean
  title?: string
  activePanelId?: string
  panelBarMode?: NeoviewPanelBarMode
  panelBarDock?: NeoviewPanelBarDock
  panelBarPositionX?: number
  panelBarPositionY?: number
  panelBarConstrained?: boolean
}

export interface NeoviewSwimlaneRevealZone {
  x: number
  y: number
  width: number
  height: number
}

export const NEOVIEW_SWIMLANE_REVEAL_EDGES = ["left", "right", "top", "bottom"] as const
export type NeoviewSwimlaneRevealEdge = (typeof NEOVIEW_SWIMLANE_REVEAL_EDGES)[number]

export interface NeoviewSwimlaneConfig {
  laneOrder: NeoviewSwimlaneId[]
  activeLane: NeoviewSwimlaneId
  readerSolo: boolean
  readerSoloOnFocus: boolean
  soloLaneId?: NeoviewSwimlaneId
  readerWidthRatio: number
  edgeRevealDelayMs: number
  edgeRevealZones: Record<NeoviewSwimlaneRevealEdge, NeoviewSwimlaneRevealZone>
  readerFocusOnHover: boolean
  readerFocusHoverDelayMs: number
  showLaneNavigatorInReaderSolo: boolean
  barHandleStyle: NeoviewBarHandleStyle
  barHandlePosition: NeoviewBarHandlePosition
  laneNavigatorPositionX: number
  laneNavigatorPositionY: number
  laneNavigatorDock: NeoviewLaneNavigatorDock
  lanes: Record<NeoviewSwimlaneId, NeoviewSwimlaneLaneConfig>
}

export interface NeoviewWorkspaceConfig {
  mode: NeoviewWorkspaceMode
  swimlane: NeoviewSwimlaneConfig
}

export type NeoviewShellSurface = "top" | "bottom" | "sidebar"
export type NeoviewShellMaterialPreset = "solid" | "soft" | "frosted" | "custom"
export type NeoviewShellSurfaceValues = Record<NeoviewShellSurface, number>

export interface NeoviewShellMaterialConfig {
  preset: NeoviewShellMaterialPreset
  saturation: NeoviewShellSurfaceValues
  highlight: NeoviewShellSurfaceValues
  shadow: NeoviewShellSurfaceValues
}

export interface NeoviewShellMaterialPatch {
  preset?: NeoviewShellMaterialPreset
  opacity?: Partial<NeoviewShellSurfaceValues>
  blur?: Partial<NeoviewShellSurfaceValues>
  saturation?: Partial<NeoviewShellSurfaceValues>
  highlight?: Partial<NeoviewShellSurfaceValues>
  shadow?: Partial<NeoviewShellSurfaceValues>
}

export interface NeoviewShellConfig {
  showDelayMs: number
  hideDelayMs: number
  opacity: { top: number; bottom: number; sidebar: number }
  blur: { top: number; bottom: number; sidebar: number }
  material?: NeoviewShellMaterialConfig
  floatingControl: NeoviewShellFloatingControlConfig
  edges: Record<"top" | "right" | "bottom" | "left", NeoviewShellEdgeConfig>
  sidebars: Record<"left" | "right", NeoviewShellSidebarConfig>
  sidebarInteraction: NeoviewShellSidebarInteractionConfig
  workspace: NeoviewWorkspaceConfig
  panelLayout: Record<string, NeoviewPanelLayout>
  cardLayout: Record<string, NeoviewCardLayout>
}

export interface NeoviewPanelLayout {
  visible: boolean
  order: number
  position: "left" | "right" | "bottom" | "floating"
}

export interface NeoviewCardLayout {
  panelId: string
  visible: boolean
  expanded: boolean
  order: number
  height?: number
}

export interface NeoviewSidebarLayoutPatch {
  side: "left" | "right"
  pinned?: boolean
  width?: number
  height?: NeoviewShellSidebarConfig["height"]
  customHeight?: number
  verticalAlign?: number
  horizontalPosition?: number
}

export interface NeoviewCardLayoutPatch {
  cardId: string
  panelId?: string
  visible?: boolean
  expanded?: boolean
  order?: number
  height?: number | null
}

export interface NeoviewBoardLayoutPatch {
  expectedRevision: number
  board: {
    panels: Array<{
      id: string
      visible: boolean
      order: number
      position: NeoviewPanelLayout["position"]
    }>
    cards: Array<{
      cardId: string
      panelId: string
      visible: boolean
      order: number
    }>
  }
}

export interface NeoviewShellControlPatch {
  expectedRevision: number
  shellControl: {
    floating?: {
      enabled?: boolean
      position?: { x: number; y: number }
    }
    edges?: Partial<Record<"top" | "right" | "bottom" | "left", Partial<NeoviewShellEdgeConfig>>>
    sidebarInteraction?: Partial<NeoviewShellSidebarInteractionConfig>
    workspace?: {
      mode?: NeoviewWorkspaceMode
      laneOrder?: NeoviewSwimlaneId[]
      activeLane?: NeoviewSwimlaneId
      readerSolo?: boolean
      readerSoloOnFocus?: boolean
      soloLaneId?: NeoviewSwimlaneId | null
      readerWidthRatio?: number
      edgeRevealDelayMs?: number
      edgeRevealZones?: Record<NeoviewSwimlaneRevealEdge, NeoviewSwimlaneRevealZone>
      readerFocusOnHover?: boolean
      readerFocusHoverDelayMs?: number
      showLaneNavigatorInReaderSolo?: boolean
      barHandleStyle?: NeoviewBarHandleStyle
      barHandlePosition?: NeoviewBarHandlePosition
      laneNavigatorPositionX?: number
      laneNavigatorPositionY?: number
      laneNavigatorDock?: NeoviewLaneNavigatorDock
      lanes?: Partial<Record<NeoviewSwimlaneId, Partial<NeoviewSwimlaneLaneConfig>>>
    }
    material?: NeoviewShellMaterialPatch
    reset?: "known-defaults"
  }
}

export type NeoviewShellConfigPatch = NeoviewSidebarLayoutPatch | NeoviewCardLayoutPatch | NeoviewBoardLayoutPatch | NeoviewShellControlPatch

export const DEFAULT_NEOVIEW_HISTORY_LIST_CONFIG: NeoviewHistoryListConfig = {
  viewMode: "compact",
}

export const DEFAULT_NEOVIEW_BOOKMARK_LIST_CONFIG: NeoviewBookmarkListConfig = {
  activeListId: "all",
}

export const DEFAULT_NEOVIEW_PAGE_LIST_CONFIG: NeoviewPageListConfig = {
  viewMode: "list",
  followProgress: true,
}

export const DEFAULT_NEOVIEW_VIEW_DEFAULTS: NeoviewViewDefaults = {
  fitMode: DEFAULT_READER_PRESENTATION.fitMode,
  pageMode: DEFAULT_READER_LAYOUT.pageMode,
  doublePageGap: 0,
  splitWidePages: DEFAULT_READER_LAYOUT.splitWidePages ?? false,
  hoverScrollEnabled: true,
  hoverScrollSpeed: 2,
  magnifierZoom: 2,
  magnifierSize: 200,
  orientation: DEFAULT_READER_PRESENTATION.orientation,
  autoRotation: DEFAULT_READER_PRESENTATION.autoRotation,
  widePageStretch: DEFAULT_READER_PRESENTATION.widePageStretch,
}

export const DEFAULT_NEOVIEW_BOOK_CONFIG: NeoviewBookConfig = {
  lockedSortMode: null,
  lockedMediaPriority: null,
  lockedReadingDirection: null,
}

export const DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG: NeoviewFolderViewConfig = {
  homePath: "",
  viewMode: "compact",
  previewGridEnabled: false,
  previewCount: 4,
  contentWidthPercent: 35,
  thumbnailWidthPercent: 20,
  bannerWidthPercent: 50,
  hoverPreviewEnabled: true,
  hoverPreviewDelayMs: 500,
  typeFilter: "library",
  showHiddenFolders: false,
  confirmDelete: true,
  tagDisplay: {
    tagMode: "collect",
    showRating: true,
    showCollectTagCount: true,
    showTags: true,
    maxTags: 3,
    showTooltips: true,
  },
  penetration: {
    enabled: false,
    maxDepth: 3,
    terminalTargets: [...NEOVIEW_FOLDER_PENETRATION_TARGETS],
  },
  emptyArea: {
    singleClickAction: "none",
    doubleClickAction: "goUp",
    showBackButton: false,
  },
  details: {
    columnOrder: [...NEOVIEW_FOLDER_DETAIL_COLUMNS],
    hiddenColumns: [],
    pinnedLeft: ["name"],
    pinnedRight: [],
    columnWidths: {
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
    },
  },
  search: {
    includeSubfolders: true,
    showHistoryOnFocus: true,
    searchInPath: false,
  },
  tree: {
    visible: false,
    layout: "left",
    size: 200,
    pinnedPaths: [],
  },
  tabs: {
    pinned: [],
    layout: "top",
    width: 160,
    breadcrumbPosition: "top",
    toolbarPosition: "top",
  },
}

export const DEFAULT_NEOVIEW_FILE_TREE_CONFIG: NeoviewFileTreeConfig = {
  excludedPaths: [],
}

export const DEFAULT_NEOVIEW_SLIDESHOW_CONFIG: NeoviewSlideshowConfig = {
  intervalSeconds: 5,
  loop: false,
  random: false,
  fadeTransition: true,
}

export const DEFAULT_NEOVIEW_MEDIA_CONFIG: NeoviewMediaConfig = {
  supportedImageFormats: DEFAULT_READER_IMAGE_FORMATS,
  videoFormats: DEFAULT_READER_VIDEO_FORMATS,
  mediaMimeTypes: Object.freeze({}),
  autoPlayAnimatedImages: true,
  animatedVideoEnabled: false,
  animatedVideoKeywords: DEFAULT_READER_ANIMATED_VIDEO_KEYWORDS,
  videoMinPlaybackRate: 0.25,
  videoMaxPlaybackRate: 16,
  videoPlaybackRateStep: 0.25,
  subtitle: {
    fontSize: 1,
    color: "#ffffff",
    backgroundOpacity: 0.7,
    bottomPercent: 5,
  },
}

export const DEFAULT_NEOVIEW_PRESENTATION_DISK_CACHE_CONFIG: NeoviewPresentationDiskCacheConfig = {
  enabled: true,
  maxBytes: 2 * 1024 * 1024 * 1024,
  maxEntryBytes: 24 * 1024 * 1024,
  maxAgeMs: 30 * 24 * 60 * 60 * 1000,
  trimRatio: 0.8,
  minFreeBytes: 512 * 1024 * 1024,
}

export const DEFAULT_NEOVIEW_PRELOAD_CONFIG: NeoviewPreloadConfig = {
  maxCandidatePages: 4,
}

export const DEFAULT_NEOVIEW_SYSTEM_MONITOR_CONFIG: NeoviewSystemMonitorConfig = {
  enabled: true,
  refreshIntervalMs: 1_000,
  maxSamples: 60,
}

export const DEFAULT_NEOVIEW_EMM_CONFIG: NeoviewEmmConfig = {
  enabled: true,
  databasePaths: Object.freeze([]),
  defaultRating: 4.2,
}

export const DEFAULT_NEOVIEW_AI_TRANSLATION_CONFIG: NeoviewAiTranslationConfig = {
  enabled: false,
  autoTranslate: false,
  service: "disabled",
  ollamaUrl: "http://127.0.0.1:11434",
  ollamaModel: "",
  sourceLanguage: "ja",
  targetLanguage: "zh",
  promptTemplate: "请将以下{source_lang}文本翻译成{target_lang}，只返回翻译结果，不要解释：\n{text}",
  memoryCacheEntries: 1_000,
}

export const DEFAULT_NEOVIEW_SUPER_RESOLUTION_CONFIG: NeoviewSuperResolutionConfig = {
  provider: "opencomic-system",
  maxDaemonsPerGpu: 1,
  daemonIdleTimeoutMs: 300_000,
  taskTimeoutMs: 10 * 60_000,
  artifactCache: {
    retentionDays: 30,
    cleanupIntervalMinutes: 24 * 60,
  },
  modelSources: Object.freeze([
    "D:/scoop/persist/python311/Lib/site-packages/sr_vulkan_model_realsr",
    "D:/scoop/persist/python311/Lib/site-packages/sr_vulkan_model_realcugan",
    "D:/scoop/persist/python311/Lib/site-packages/sr_vulkan_model_realesrgan",
  ]),
  customModels: Object.freeze([]),
  preferences: parseSuperResolutionPreferences(undefined),
}

export interface NeoviewColorFilterPatch {
  colorFilter: ReaderColorFilterPatch | { reset: "defaults" }
}

export interface NeoviewPageTransitionPatch {
  pageTransition: ReaderPageTransitionPatch | { reset: "defaults" }
}

export interface NeoviewSwitchToastPatch {
  switchToast: ReaderSwitchToastPatch | { reset: "defaults" }
}

export interface NeoviewInfoOverlayPatch {
  infoOverlay: ReaderInfoOverlayPatch | { reset: "defaults" }
}

export interface NeoviewImageTrimPatch {
  imageTrim: ReaderImageTrimPatch | { reset: "defaults" }
}

export const DEFAULT_NEOVIEW_SHELL_MATERIAL_CONFIG: NeoviewShellMaterialConfig = {
  preset: "frosted",
  saturation: { top: 115, bottom: 115, sidebar: 115 },
  highlight: { top: 35, bottom: 35, sidebar: 35 },
  shadow: { top: 45, bottom: 45, sidebar: 45 },
}

export const DEFAULT_NEOVIEW_SHELL_CONFIG: NeoviewShellConfig = {
  showDelayMs: 0,
  hideDelayMs: 0,
  opacity: { top: 85, bottom: 85, sidebar: 85 },
  blur: { top: 12, bottom: 12, sidebar: 12 },
  material: DEFAULT_NEOVIEW_SHELL_MATERIAL_CONFIG,
  floatingControl: { enabled: true, position: { x: 100, y: 100 } },
  edges: {
    top: {
      enabled: true,
      initialVisible: true,
      pinned: false,
      triggerSize: 32,
      lockMode: "auto",
    },
    right: {
      enabled: true,
      initialVisible: true,
      pinned: false,
      triggerSize: 32,
      lockMode: "auto",
    },
    bottom: {
      enabled: true,
      initialVisible: false,
      pinned: false,
      triggerSize: 32,
      lockMode: "auto",
    },
    left: {
      enabled: true,
      initialVisible: true,
      pinned: true,
      triggerSize: 32,
      lockMode: "auto",
    },
  },
  sidebars: {
    left: {
      width: 320,
      height: "full",
      customHeight: 100,
      verticalAlign: 0,
      horizontalPosition: 0,
    },
    right: {
      width: 280,
      height: "full",
      customHeight: 100,
      verticalAlign: 0,
      horizontalPosition: 0,
    },
  },
  sidebarInteraction: {
    showDragHandle: false,
    enableBlankAreaCollapse: true,
    blankAreaCollapseMode: "single",
  },
  workspace: {
    mode: "edges",
    swimlane: {
      laneOrder: ["left", "reader", "right"],
      activeLane: "reader",
      readerSolo: true,
      readerSoloOnFocus: true,
      readerWidthRatio: 0.5,
      edgeRevealDelayMs: 180,
      edgeRevealZones: {
        left: { x: 0, y: 10, width: 1, height: 80 },
        right: { x: 99, y: 10, width: 1, height: 80 },
        top: { x: 10, y: 0, width: 80, height: 1 },
        bottom: { x: 10, y: 99, width: 80, height: 1 },
      },
      readerFocusOnHover: true,
      readerFocusHoverDelayMs: 650,
      showLaneNavigatorInReaderSolo: false,
      barHandleStyle: "grip",
      barHandlePosition: "left",
      laneNavigatorPositionX: 92,
      laneNavigatorPositionY: 96,
      laneNavigatorDock: "floating",
      lanes: {
        left: { width: 320, collapsed: false, activePanelId: "folder", panelBarMode: "pinned", panelBarDock: "left", panelBarPositionX: 8, panelBarPositionY: 50, panelBarConstrained: true },
        reader: { width: 960, collapsed: false },
        right: { width: 280, collapsed: false, activePanelId: "info", panelBarMode: "pinned", panelBarDock: "right", panelBarPositionX: 92, panelBarPositionY: 50, panelBarConstrained: true },
      },
    },
  },
  panelLayout: Object.fromEntries(
    READER_PANEL_MANIFEST.map((panel) => [
      panel.id,
      {
        visible: panel.defaultVisible,
        order: panel.defaultOrder,
        position: panel.defaultPosition,
      },
    ]),
  ),
  cardLayout: Object.fromEntries(
    READER_CARD_MANIFEST.map((card) => [
      card.id,
      {
        panelId: card.defaultPanelId,
        visible: card.defaultVisible,
        expanded: card.defaultExpanded,
        order: card.defaultOrder,
      },
    ]),
  ),
}
