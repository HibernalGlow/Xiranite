import { DEFAULT_READER_LAYOUT, type PageMode } from "../../domain/frame/frame.js"
import type { TailOverflowBehavior } from "../../domain/navigation/navigation.js"
import { DEFAULT_READER_PRESENTATION, type ReaderFitMode } from "../../domain/presentation/presentation.js"
import {
  DEFAULT_READER_IMAGE_FORMATS,
  DEFAULT_READER_VIDEO_FORMATS,
  ReaderMediaFormatRegistry,
} from "../../domain/page/media.js"
import type { ReaderSessionOptions } from "../reader/contracts.js"
import { READER_CARD_MANIFEST, READER_PANEL_MANIFEST, readerCardCanMoveTo } from "./ReaderLayoutManifest.js"
import { parseNeoviewInputBindingsConfig } from "./ReaderInputBindingsConfig.js"
import type { ReaderInputBindingsConfig } from "../../domain/input/ReaderInputBindings.js"
import type { SuperResolutionCustomModelManifest } from "../../ports/SuperResolutionProvider.js"
import {
  parseSuperResolutionPreferences,
  type SuperResolutionPreferences,
} from "../../domain/super-resolution/super-resolution-preferences.js"

const READER_CARD_MANIFEST_BY_ID = new Map(READER_CARD_MANIFEST.map((card) => [card.id as string, card]))

export interface NeoviewRuntimeConfig {
  schemaVersion: 1
  sessionOptions: Partial<ReaderSessionOptions>
  shellOptions: NeoviewShellConfig
  viewDefaults: NeoviewViewDefaults
  pageList: NeoviewPageListConfig
  bookmarkList: NeoviewBookmarkListConfig
  historyList: NeoviewHistoryListConfig
  folderView: NeoviewFolderViewConfig
  fileTree: NeoviewFileTreeConfig
  slideshow: NeoviewSlideshowConfig
  media: NeoviewMediaConfig
  superResolution: NeoviewSuperResolutionConfig
  presentationDiskCache: NeoviewPresentationDiskCacheConfig
  inputBindings: ReaderInputBindingsConfig
}

export interface NeoviewFileTreeConfig {
  excludedPaths: string[]
}

export const NEOVIEW_FOLDER_VIEW_MODES = ["compact", "cover-list", "mosaic-list", "details", "cover-grid", "mosaic-grid"] as const
export const NEOVIEW_FOLDER_EMPTY_AREA_ACTIONS = ["none", "goUp", "goBack"] as const
export const NEOVIEW_FOLDER_TREE_LAYOUTS = ["left", "right", "top", "bottom"] as const
export const NEOVIEW_FOLDER_REGION_POSITIONS = ["none", "top", "bottom", "left", "right"] as const
export const NEOVIEW_FOLDER_DETAIL_COLUMNS = ["name", "path", "type", "extension", "size", "modifiedAt", "dimensions", "pageCount", "rating", "tags"] as const
export type NeoviewFolderViewMode = typeof NEOVIEW_FOLDER_VIEW_MODES[number]
export type NeoviewFolderEmptyAreaAction = typeof NEOVIEW_FOLDER_EMPTY_AREA_ACTIONS[number]
export type NeoviewFolderTreeLayout = typeof NEOVIEW_FOLDER_TREE_LAYOUTS[number]
export type NeoviewFolderRegionPosition = typeof NEOVIEW_FOLDER_REGION_POSITIONS[number]
export type NeoviewFolderDetailColumn = typeof NEOVIEW_FOLDER_DETAIL_COLUMNS[number]

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

export interface NeoviewFolderViewConfig {
  homePath: string
  viewMode: NeoviewFolderViewMode
  previewCount: 4 | 9 | 16
  thumbnailWidthPercent: number
  bannerWidthPercent: number
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
    previewCount?: 4 | 9 | 16
    thumbnailWidthPercent?: number
    bannerWidthPercent?: number
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

export interface NeoviewSuperResolutionConfig {
  provider: NeoviewSuperResolutionProvider
  upscaylPath?: string
  waifu2xPath?: string
  realcuganPath?: string
  modelsDirectory?: string
  maxDaemonsPerGpu: number
  daemonIdleTimeoutMs: number
  taskTimeoutMs: number
  customModels: readonly SuperResolutionCustomModelManifest[]
  preferences: SuperResolutionPreferences
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

export interface NeoviewShellConfig {
  showDelayMs: number
  hideDelayMs: number
  opacity: { top: number; bottom: number; sidebar: number }
  blur: { top: number; bottom: number; sidebar: number }
  floatingControl: NeoviewShellFloatingControlConfig
  edges: Record<"top" | "right" | "bottom" | "left", NeoviewShellEdgeConfig>
  sidebars: Record<"left" | "right", NeoviewShellSidebarConfig>
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
    panels: Array<{ id: string; visible: boolean; order: number; position: NeoviewPanelLayout["position"] }>
    cards: Array<{ cardId: string; panelId: string; visible: boolean; order: number }>
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
}

export const DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG: NeoviewFolderViewConfig = {
  homePath: "",
  viewMode: "compact",
  previewCount: 4,
  thumbnailWidthPercent: 20,
  bannerWidthPercent: 50,
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

export const DEFAULT_NEOVIEW_SUPER_RESOLUTION_CONFIG: NeoviewSuperResolutionConfig = {
  provider: "opencomic-system",
  maxDaemonsPerGpu: 1,
  daemonIdleTimeoutMs: 300_000,
  taskTimeoutMs: 10 * 60_000,
  customModels: Object.freeze([]),
  preferences: parseSuperResolutionPreferences(undefined),
}

export const DEFAULT_NEOVIEW_SHELL_CONFIG: NeoviewShellConfig = {
  showDelayMs: 0,
  hideDelayMs: 0,
  opacity: { top: 85, bottom: 85, sidebar: 85 },
  blur: { top: 12, bottom: 12, sidebar: 12 },
  floatingControl: { enabled: true, position: { x: 100, y: 100 } },
  edges: {
    top: { enabled: true, initialVisible: true, pinned: false, triggerSize: 32, lockMode: "auto" },
    right: { enabled: true, initialVisible: false, pinned: false, triggerSize: 32, lockMode: "auto" },
    bottom: { enabled: true, initialVisible: false, pinned: false, triggerSize: 32, lockMode: "auto" },
    left: { enabled: true, initialVisible: true, pinned: true, triggerSize: 32, lockMode: "auto" },
  },
  sidebars: {
    left: { width: 320, height: "full", customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
    right: { width: 280, height: "full", customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
  },
  panelLayout: Object.fromEntries(READER_PANEL_MANIFEST.map((panel) => [panel.id, {
    visible: panel.defaultVisible,
    order: panel.defaultOrder,
    position: panel.defaultPosition,
  }])),
  cardLayout: Object.fromEntries(READER_CARD_MANIFEST.map((card) => [card.id, {
    panelId: card.defaultPanelId,
    visible: card.defaultVisible,
    expanded: card.defaultExpanded,
    order: card.defaultOrder,
  }])),
}

export function parseNeoviewRuntimeConfig(value: unknown): NeoviewRuntimeConfig {
  if (value === undefined) return {
    schemaVersion: 1,
    sessionOptions: {},
    shellOptions: DEFAULT_NEOVIEW_SHELL_CONFIG,
    viewDefaults: DEFAULT_NEOVIEW_VIEW_DEFAULTS,
    pageList: DEFAULT_NEOVIEW_PAGE_LIST_CONFIG,
    bookmarkList: DEFAULT_NEOVIEW_BOOKMARK_LIST_CONFIG,
    historyList: DEFAULT_NEOVIEW_HISTORY_LIST_CONFIG,
    folderView: DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG,
    fileTree: DEFAULT_NEOVIEW_FILE_TREE_CONFIG,
    slideshow: DEFAULT_NEOVIEW_SLIDESHOW_CONFIG,
    media: DEFAULT_NEOVIEW_MEDIA_CONFIG,
    superResolution: DEFAULT_NEOVIEW_SUPER_RESOLUTION_CONFIG,
    presentationDiskCache: DEFAULT_NEOVIEW_PRESENTATION_DISK_CACHE_CONFIG,
    inputBindings: parseNeoviewInputBindingsConfig(undefined),
  }
  const config = requireRecord(value, "[nodes.neoview]")
  const schemaVersion = config.schema_version ?? 1
  if (schemaVersion !== 1) throw new Error(`[nodes.neoview].schema_version must be 1, received ${String(schemaVersion)}.`)
  const reader = optionalRecord(config.reader, "[nodes.neoview.reader]")
  const panels = optionalRecord(config.panels, "[nodes.neoview.panels]")
  const slideshow = optionalRecord(config.slideshow, "[nodes.neoview.slideshow]")
  const pageList = optionalRecord(config.page_list, "[nodes.neoview.page_list]")
  const bookmarkList = optionalRecord(config.bookmark_list, "[nodes.neoview.bookmark_list]")
  const historyList = optionalRecord(config.history_list, "[nodes.neoview.history_list]")
  const folder = optionalRecord(config.folder, "[nodes.neoview.folder]")
  const image = optionalRecord(config.image, "[nodes.neoview.image]")
  const subtitle = optionalRecord(reader?.subtitle, "[nodes.neoview.reader.subtitle]")
  const legacySlideshow = optionalRecord(reader?.slideshow, "[nodes.neoview.reader.slideshow]")
  const legacyBook = optionalRecord(reader?.book, "[nodes.neoview.reader.book]")
  const performance = optionalRecord(config.performance, "[nodes.neoview.performance]")
  const superResolution = optionalRecord(config.super_resolution, "[nodes.neoview.super_resolution]")
  const bindings = optionalRecord(config.bindings, "[nodes.neoview.bindings]")
  const presentationDiskCache = optionalRecord(
    performance?.presentation_disk_cache,
    "[nodes.neoview.performance.presentation_disk_cache]",
  )

  const direction = optionalEnum(
    reader?.reading_direction ?? nestedValue(reader, "book", "reading_direction"),
    "[nodes.neoview.reader].reading_direction",
    ["left-to-right", "right-to-left"] as const,
  )
  const doublePage = optionalBoolean(
    reader?.double_page_view ?? nestedValue(reader, "book", "double_page_view"),
    "[nodes.neoview.reader].double_page_view",
  )
  const tailOverflow = parseTailOverflow(
    reader?.tail_overflow_behavior ?? nestedValue(reader, "book", "tail_overflow_behavior"),
  )
  const fitMode = readerFitMode(
    reader?.default_zoom_mode ?? nestedValue(reader, "view", "default_zoom_mode") ?? nestedValue(reader, "view", "defaultZoomMode"),
    "[nodes.neoview.reader].default_zoom_mode",
  )
  const pageMode = doublePage === undefined ? DEFAULT_READER_LAYOUT.pageMode : doublePage ? "double" : "single"

  return {
    schemaVersion: 1,
    sessionOptions: {
      direction,
      layout: doublePage === undefined
        ? undefined
        : { ...DEFAULT_READER_LAYOUT, pageMode: doublePage ? "double" : "single" },
      tailOverflow,
    },
    shellOptions: parseShellOptions(panels, reader),
    viewDefaults: { fitMode, pageMode },
    pageList: {
      viewMode: optionalEnum(pageList?.view_mode, "[nodes.neoview.page_list].view_mode", ["list", "details", "thumbnails"] as const)
        ?? DEFAULT_NEOVIEW_PAGE_LIST_CONFIG.viewMode,
      followProgress: optionalBoolean(pageList?.follow_progress, "[nodes.neoview.page_list].follow_progress")
        ?? DEFAULT_NEOVIEW_PAGE_LIST_CONFIG.followProgress,
    },
    bookmarkList: {
      activeListId: bookmarkList?.active_list_id === undefined
        ? DEFAULT_NEOVIEW_BOOKMARK_LIST_CONFIG.activeListId
        : normalizedBookmarkListId(bookmarkList.active_list_id, "[nodes.neoview.bookmark_list].active_list_id"),
    },
    historyList: {
      viewMode: optionalEnum(historyList?.view_mode, "[nodes.neoview.history_list].view_mode", ["compact", "content", "banner", "thumbnail"] as const)
        ?? DEFAULT_NEOVIEW_HISTORY_LIST_CONFIG.viewMode,
    },
    folderView: parseFolderViewConfig(folder),
    fileTree: parseFileTreeConfig(optionalRecord(folder?.tree, "[nodes.neoview.folder.tree]")),
    slideshow: parseSlideshowConfig(slideshow, legacySlideshow, legacyBook),
    media: parseMediaConfig(image, subtitle),
    superResolution: parseSuperResolutionConfig(superResolution),
    presentationDiskCache: parsePresentationDiskCache(presentationDiskCache),
    inputBindings: parseNeoviewInputBindingsConfig(bindings),
  }
}

function parseSuperResolutionConfig(value: Record<string, unknown> | undefined): NeoviewSuperResolutionConfig {
  if (!value) return DEFAULT_NEOVIEW_SUPER_RESOLUTION_CONFIG
  return {
    provider: optionalEnum(
      value.provider,
      "[nodes.neoview.super_resolution].provider",
      ["opencomic-system", "disabled"] as const,
    ) ?? DEFAULT_NEOVIEW_SUPER_RESOLUTION_CONFIG.provider,
    upscaylPath: optionalConfigPath(value.upscayl_path, "[nodes.neoview.super_resolution].upscayl_path"),
    waifu2xPath: optionalConfigPath(value.waifu2x_path, "[nodes.neoview.super_resolution].waifu2x_path"),
    realcuganPath: optionalConfigPath(value.realcugan_path, "[nodes.neoview.super_resolution].realcugan_path"),
    modelsDirectory: optionalConfigPath(value.models_directory, "[nodes.neoview.super_resolution].models_directory"),
    maxDaemonsPerGpu: boundedIntegerWithFallback(
      value.max_daemons_per_gpu,
      0,
      8,
      DEFAULT_NEOVIEW_SUPER_RESOLUTION_CONFIG.maxDaemonsPerGpu,
      "[nodes.neoview.super_resolution].max_daemons_per_gpu",
    ),
    daemonIdleTimeoutMs: boundedIntegerWithFallback(
      value.daemon_idle_timeout_ms,
      1_000,
      3_600_000,
      DEFAULT_NEOVIEW_SUPER_RESOLUTION_CONFIG.daemonIdleTimeoutMs,
      "[nodes.neoview.super_resolution].daemon_idle_timeout_ms",
    ),
    taskTimeoutMs: boundedIntegerWithFallback(
      value.task_timeout_ms,
      1_000,
      24 * 60 * 60_000,
      DEFAULT_NEOVIEW_SUPER_RESOLUTION_CONFIG.taskTimeoutMs,
      "[nodes.neoview.super_resolution].task_timeout_ms",
    ),
    customModels: parseSuperResolutionCustomModels(value.custom_models),
    preferences: parseSuperResolutionPreferences(value.preferences),
  }
}

function parseSuperResolutionCustomModels(value: unknown): readonly SuperResolutionCustomModelManifest[] {
  if (value === undefined) return DEFAULT_NEOVIEW_SUPER_RESOLUTION_CONFIG.customModels
  if (!Array.isArray(value) || value.length > 64) {
    throw new Error("[nodes.neoview.super_resolution].custom_models must be an array of at most 64 tables.")
  }
  const ids = new Set<string>()
  return value.map((entry, index) => {
    const path = `[nodes.neoview.super_resolution].custom_models[${index}]`
    const model = requireRecord(entry, path)
    const id = requiredManifestIdentifier(model.id, `${path}.id`)
    if (ids.has(id)) throw new Error(`${path}.id duplicates custom model ${id}.`)
    ids.add(id)
    const files = requiredManifestPaths(model.files, `${path}.files`)
    const checksums = requiredStringRecord(model.checksums, `${path}.checksums`)
    if (Object.keys(checksums).some((file) => !files.includes(file))) throw new Error(`${path}.checksums contains an unknown model file.`)
    for (const file of files) {
      if (!/^[a-f0-9]{64}$/iu.test(checksums[file] ?? "")) throw new Error(`${path}.checksums must contain SHA-256 for ${file}.`)
    }
    const scales = requiredManifestScales(model.scales, `${path}.scales`)
    const scaleFiles = model.scale_files === undefined
      ? undefined
      : requiredManifestScaleFiles(model.scale_files, scales, `${path}.scale_files`)
    const downloadBaseUrl = optionalHttpsUrl(model.download_base_url, `${path}.download_base_url`)
    return {
      id,
      type: optionalEnum(model.type, `${path}.type`, ["upscale", "descreen", "artifact-removal"] as const) ?? "upscale",
      displayName: requiredManifestText(model.name, `${path}.name`),
      engine: requiredManifestEngine(model.engine, `${path}.engine`),
      scales,
      noise: model.noise === undefined ? undefined : requiredManifestNoise(model.noise, `${path}.noise`),
      latency: model.latency === undefined ? undefined : boundedNumber(model.latency, 0, 3600, 1, `${path}.latency`),
      modelDirectory: requiredManifestPath(model.directory, `${path}.directory`),
      modelFiles: files,
      scaleFiles,
      license: requiredManifestText(model.license, `${path}.license`),
      checksums: Object.fromEntries(Object.entries(checksums).map(([file, checksum]) => [file, checksum.toLowerCase()])),
      inputBlob: requiredManifestIdentifier(model.input_blob, `${path}.input_blob`),
      outputBlob: requiredManifestIdentifier(model.output_blob, `${path}.output_blob`),
      downloadBaseUrl,
    }
  })
}

function parseMediaConfig(
  image: Record<string, unknown> | undefined,
  subtitle: Record<string, unknown> | undefined,
): NeoviewMediaConfig {
  const formats = new ReaderMediaFormatRegistry({
    supportedImageFormats: optionalStringArray(
      image?.supported_formats,
      DEFAULT_NEOVIEW_MEDIA_CONFIG.supportedImageFormats,
      "[nodes.neoview.image].supported_formats",
    ),
    videoFormats: optionalStringArray(
      image?.video_formats,
      DEFAULT_NEOVIEW_MEDIA_CONFIG.videoFormats,
      "[nodes.neoview.image].video_formats",
    ),
    mediaMimeTypes: optionalStringRecord(
      image?.media_mime_types,
      DEFAULT_NEOVIEW_MEDIA_CONFIG.mediaMimeTypes,
      "[nodes.neoview.image].media_mime_types",
    ),
  })
  const videoMinPlaybackRate = boundedNumber(
    image?.video_min_playback_rate,
    0.05,
    64,
    DEFAULT_NEOVIEW_MEDIA_CONFIG.videoMinPlaybackRate,
    "[nodes.neoview.image].video_min_playback_rate",
  )
  const videoMaxPlaybackRate = boundedNumber(
    image?.video_max_playback_rate,
    0.05,
    64,
    DEFAULT_NEOVIEW_MEDIA_CONFIG.videoMaxPlaybackRate,
    "[nodes.neoview.image].video_max_playback_rate",
  )
  if (videoMaxPlaybackRate < videoMinPlaybackRate) {
    throw new Error("[nodes.neoview.image].video_max_playback_rate must not be less than video_min_playback_rate.")
  }
  return {
    supportedImageFormats: formats.supportedImageFormats,
    videoFormats: formats.videoFormats,
    mediaMimeTypes: formats.mediaMimeTypes,
    autoPlayAnimatedImages: optionalBoolean(
      image?.auto_play_animated_images,
      "[nodes.neoview.image].auto_play_animated_images",
    ) ?? DEFAULT_NEOVIEW_MEDIA_CONFIG.autoPlayAnimatedImages,
    videoMinPlaybackRate,
    videoMaxPlaybackRate,
    videoPlaybackRateStep: boundedNumber(
      image?.video_playback_rate_step,
      0.01,
      4,
      DEFAULT_NEOVIEW_MEDIA_CONFIG.videoPlaybackRateStep,
      "[nodes.neoview.image].video_playback_rate_step",
    ),
    subtitle: {
      fontSize: boundedNumber(
        subtitle?.font_size,
        0.5,
        3,
        DEFAULT_NEOVIEW_MEDIA_CONFIG.subtitle.fontSize,
        "[nodes.neoview.reader.subtitle].font_size",
      ),
      color: normalizedSubtitleColor(
        subtitle?.color,
        "[nodes.neoview.reader.subtitle].color",
        DEFAULT_NEOVIEW_MEDIA_CONFIG.subtitle.color,
      ),
      backgroundOpacity: boundedNumber(
        subtitle?.bg_opacity,
        0,
        1,
        DEFAULT_NEOVIEW_MEDIA_CONFIG.subtitle.backgroundOpacity,
        "[nodes.neoview.reader.subtitle].bg_opacity",
      ),
      bottomPercent: boundedNumber(
        subtitle?.bottom,
        0,
        30,
        DEFAULT_NEOVIEW_MEDIA_CONFIG.subtitle.bottomPercent,
        "[nodes.neoview.reader.subtitle].bottom",
      ),
    },
  }
}

export function parseNeoviewMediaPatch(
  value: unknown,
  current: NeoviewMediaConfig = DEFAULT_NEOVIEW_MEDIA_CONFIG,
): { patch: NeoviewMediaPatch; tomlPatch: Record<string, unknown> } {
  const record = requireRecord(value, "reader media patch")
  if (Object.keys(record).some((key) => key !== "media")) throw new Error("reader media patch contains unsupported fields.")
  const media = requireRecord(record.media, "reader media patch.media")
  const allowed = new Set(["supportedImageFormats", "videoFormats", "mediaMimeTypes", "autoPlayAnimatedImages", "videoMinPlaybackRate", "videoMaxPlaybackRate", "videoPlaybackRateStep", "subtitle"])
  const unknown = Object.keys(media).filter((key) => !allowed.has(key))
  if (unknown.length) throw new Error(`reader media patch contains unsupported fields: ${unknown.join(", ")}.`)
  const patch: NeoviewMediaPatch = { media: {} }
  const imageToml: Record<string, unknown> = {}
  const readerToml: Record<string, unknown> = {}
  if (media.supportedImageFormats !== undefined || media.videoFormats !== undefined || media.mediaMimeTypes !== undefined) {
    const formats = new ReaderMediaFormatRegistry({
      supportedImageFormats: media.supportedImageFormats === undefined
        ? current.supportedImageFormats
        : requiredStringArray(media.supportedImageFormats, "reader media patch.supportedImageFormats"),
      videoFormats: media.videoFormats === undefined
        ? current.videoFormats
        : requiredStringArray(media.videoFormats, "reader media patch.videoFormats"),
      mediaMimeTypes: media.mediaMimeTypes === undefined
        ? current.mediaMimeTypes
        : requiredStringRecord(media.mediaMimeTypes, "reader media patch.mediaMimeTypes"),
    })
    patch.media.supportedImageFormats = formats.supportedImageFormats
    patch.media.videoFormats = formats.videoFormats
    patch.media.mediaMimeTypes = formats.mediaMimeTypes
    imageToml.supported_formats = formats.supportedImageFormats
    imageToml.video_formats = formats.videoFormats
    imageToml.media_mime_types = formats.mediaMimeTypes
  }
  if (media.autoPlayAnimatedImages !== undefined) {
    patch.media.autoPlayAnimatedImages = requiredBoolean(media.autoPlayAnimatedImages, "reader media patch.autoPlayAnimatedImages")
    imageToml.auto_play_animated_images = patch.media.autoPlayAnimatedImages
  }
  if (media.videoMinPlaybackRate !== undefined) {
    patch.media.videoMinPlaybackRate = boundedNumber(media.videoMinPlaybackRate, 0.05, 64, current.videoMinPlaybackRate, "reader media patch.videoMinPlaybackRate")
    imageToml.video_min_playback_rate = patch.media.videoMinPlaybackRate
  }
  if (media.videoMaxPlaybackRate !== undefined) {
    patch.media.videoMaxPlaybackRate = boundedNumber(media.videoMaxPlaybackRate, 0.05, 64, current.videoMaxPlaybackRate, "reader media patch.videoMaxPlaybackRate")
    imageToml.video_max_playback_rate = patch.media.videoMaxPlaybackRate
  }
  if (media.videoPlaybackRateStep !== undefined) {
    patch.media.videoPlaybackRateStep = boundedNumber(media.videoPlaybackRateStep, 0.01, 4, current.videoPlaybackRateStep, "reader media patch.videoPlaybackRateStep")
    imageToml.video_playback_rate_step = patch.media.videoPlaybackRateStep
  }
  const nextMinimum = patch.media.videoMinPlaybackRate ?? current.videoMinPlaybackRate
  const nextMaximum = patch.media.videoMaxPlaybackRate ?? current.videoMaxPlaybackRate
  if (nextMaximum < nextMinimum) throw new Error("reader media patch.videoMaxPlaybackRate must not be less than videoMinPlaybackRate.")
  if (media.subtitle !== undefined) {
    const subtitle = requireRecord(media.subtitle, "reader media patch.subtitle")
    const subtitleAllowed = new Set(["fontSize", "color", "backgroundOpacity", "bottomPercent"])
    const unknownSubtitle = Object.keys(subtitle).filter((key) => !subtitleAllowed.has(key))
    if (unknownSubtitle.length) throw new Error(`reader media patch.subtitle contains unsupported fields: ${unknownSubtitle.join(", ")}.`)
    const subtitlePatch: Partial<NeoviewSubtitleConfig> = {}
    const subtitleToml: Record<string, unknown> = {}
    if (subtitle.fontSize !== undefined) {
      subtitlePatch.fontSize = boundedNumber(subtitle.fontSize, 0.5, 3, current.subtitle.fontSize, "reader media patch.subtitle.fontSize")
      subtitleToml.font_size = subtitlePatch.fontSize
    }
    if (subtitle.color !== undefined) {
      subtitlePatch.color = normalizedSubtitleColor(subtitle.color, "reader media patch.subtitle.color")
      subtitleToml.color = subtitlePatch.color
    }
    if (subtitle.backgroundOpacity !== undefined) {
      subtitlePatch.backgroundOpacity = boundedNumber(subtitle.backgroundOpacity, 0, 1, current.subtitle.backgroundOpacity, "reader media patch.subtitle.backgroundOpacity")
      subtitleToml.bg_opacity = subtitlePatch.backgroundOpacity
    }
    if (subtitle.bottomPercent !== undefined) {
      subtitlePatch.bottomPercent = boundedNumber(subtitle.bottomPercent, 0, 30, current.subtitle.bottomPercent, "reader media patch.subtitle.bottomPercent")
      subtitleToml.bottom = subtitlePatch.bottomPercent
    }
    if (!Object.keys(subtitlePatch).length) throw new Error("reader media patch.subtitle must change at least one field.")
    patch.media.subtitle = subtitlePatch
    readerToml.subtitle = subtitleToml
  }
  if (!Object.keys(patch.media).length) throw new Error("reader media patch must change at least one field.")
  const tomlPatch: Record<string, unknown> = {}
  if (Object.keys(imageToml).length) tomlPatch.image = imageToml
  if (Object.keys(readerToml).length) tomlPatch.reader = readerToml
  return { patch, tomlPatch }
}

function parseFileTreeConfig(value: Record<string, unknown> | undefined): NeoviewFileTreeConfig {
  if (!value) return DEFAULT_NEOVIEW_FILE_TREE_CONFIG
  const rawPaths = value.excluded_paths ?? []
  if (!Array.isArray(rawPaths) || rawPaths.length > 256) {
    throw new Error("[nodes.neoview.folder.tree].excluded_paths must be an array with at most 256 paths.")
  }
  const excludedPaths: string[] = []
  for (const rawPath of rawPaths) {
    if (typeof rawPath !== "string" || !rawPath.trim() || rawPath.length > 32_767 || rawPath.includes("\0")) {
      throw new Error("[nodes.neoview.folder.tree].excluded_paths must contain non-empty paths without NUL.")
    }
    const path = rawPath.trim()
    if (!excludedPaths.includes(path)) excludedPaths.push(path)
  }
  return { excludedPaths }
}

export function parseNeoviewFolderViewPatch(value: unknown): {
  patch: NeoviewFolderViewPatch
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader folder view patch")
  if (Object.keys(record).some((key) => key !== "folderView")) throw new Error("reader folder view patch contains unsupported fields.")
  const folder = requireRecord(record.folderView, "reader folder view patch.folderView")
  const allowed = new Set(["homePath", "viewMode", "previewCount", "thumbnailWidthPercent", "bannerWidthPercent", "emptyArea", "details", "search", "tree", "tabs"])
  const unknown = Object.keys(folder).filter((key) => !allowed.has(key))
  if (unknown.length) throw new Error(`reader folder view patch contains unsupported fields: ${unknown.join(", ")}.`)
  const patch: NeoviewFolderViewPatch = { folderView: {} }
  const toml: Record<string, unknown> = {}
  if (folder.homePath !== undefined) {
    patch.folderView.homePath = normalizedFolderHomePath(folder.homePath, "reader folder view patch.homePath")
    toml.home_path = patch.folderView.homePath
  }
  if (folder.viewMode !== undefined) {
    patch.folderView.viewMode = optionalEnum(folder.viewMode, "reader folder view patch.viewMode", NEOVIEW_FOLDER_VIEW_MODES)
    toml.view_mode = patch.folderView.viewMode
  }
  if (folder.previewCount !== undefined) {
    const count = boundedInteger(folder.previewCount, 4, 16, "reader folder view patch.previewCount")
    if (count !== 4 && count !== 9 && count !== 16) throw new Error("reader folder view patch.previewCount must be 4, 9 or 16.")
    patch.folderView.previewCount = count
    toml.preview_count = count
  }
  if (folder.thumbnailWidthPercent !== undefined) {
    const percent = boundedInteger(folder.thumbnailWidthPercent, 10, 90, "reader folder view patch.thumbnailWidthPercent")
    patch.folderView.thumbnailWidthPercent = percent
    toml.thumbnail_width_percent = percent
  }
  if (folder.bannerWidthPercent !== undefined) {
    const percent = boundedInteger(folder.bannerWidthPercent, 20, 100, "reader folder view patch.bannerWidthPercent")
    patch.folderView.bannerWidthPercent = percent
    toml.banner_width_percent = percent
  }
  if (folder.emptyArea !== undefined) {
    const emptyArea = requireRecord(folder.emptyArea, "reader folder view patch.emptyArea")
    const allowedEmptyArea = new Set(["singleClickAction", "doubleClickAction", "showBackButton"])
    const unknownEmptyArea = Object.keys(emptyArea).filter((key) => !allowedEmptyArea.has(key))
    if (unknownEmptyArea.length) throw new Error(`reader folder view patch.emptyArea contains unsupported fields: ${unknownEmptyArea.join(", ")}.`)
    const emptyAreaPatch: Partial<NeoviewFolderEmptyAreaConfig> = {}
    const emptyAreaToml: Record<string, unknown> = {}
    if (emptyArea.singleClickAction !== undefined) {
      emptyAreaPatch.singleClickAction = optionalEnum(emptyArea.singleClickAction, "reader folder view patch.emptyArea.singleClickAction", NEOVIEW_FOLDER_EMPTY_AREA_ACTIONS)
      emptyAreaToml.single_click_action = emptyAreaPatch.singleClickAction
    }
    if (emptyArea.doubleClickAction !== undefined) {
      emptyAreaPatch.doubleClickAction = optionalEnum(emptyArea.doubleClickAction, "reader folder view patch.emptyArea.doubleClickAction", NEOVIEW_FOLDER_EMPTY_AREA_ACTIONS)
      emptyAreaToml.double_click_action = emptyAreaPatch.doubleClickAction
    }
    if (emptyArea.showBackButton !== undefined) {
      emptyAreaPatch.showBackButton = optionalBoolean(emptyArea.showBackButton, "reader folder view patch.emptyArea.showBackButton")
      emptyAreaToml.show_back_button = emptyAreaPatch.showBackButton
    }
    if (!Object.keys(emptyAreaPatch).length) throw new Error("reader folder view patch.emptyArea must change at least one field.")
    patch.folderView.emptyArea = emptyAreaPatch
    toml.empty_area = emptyAreaToml
  }
  if (folder.details !== undefined) {
    const details = requireRecord(folder.details, "reader folder view patch.details")
    const detailKeys = new Set(["columnOrder", "hiddenColumns", "pinnedLeft", "pinnedRight", "columnWidths"])
    const unknownDetails = Object.keys(details).filter((key) => !detailKeys.has(key))
    if (unknownDetails.length) throw new Error(`reader folder view patch.details contains unsupported fields: ${unknownDetails.join(", ")}.`)
    const detailPatch: NeoviewFolderDetailsPatch = {}
    const detailToml: Record<string, unknown> = {}
    if (details.columnOrder !== undefined) {
      detailPatch.columnOrder = normalizedDetailColumns(details.columnOrder, "columnOrder", true)
      detailToml.column_order = detailPatch.columnOrder
    }
    if (details.hiddenColumns !== undefined) {
      detailPatch.hiddenColumns = normalizedDetailColumns(details.hiddenColumns, "hiddenColumns", false)
      if (detailPatch.hiddenColumns.includes("name")) throw new Error("reader folder view patch.details.hiddenColumns cannot hide name.")
      detailToml.hidden_columns = detailPatch.hiddenColumns
    }
    if (details.pinnedLeft !== undefined) {
      detailPatch.pinnedLeft = normalizedDetailColumns(details.pinnedLeft, "pinnedLeft", false)
      detailToml.pinned_left = detailPatch.pinnedLeft
    }
    if (details.pinnedRight !== undefined) {
      detailPatch.pinnedRight = normalizedDetailColumns(details.pinnedRight, "pinnedRight", false)
      detailToml.pinned_right = detailPatch.pinnedRight
    }
    if (details.columnWidths !== undefined) {
      detailPatch.columnWidths = normalizedDetailWidths(details.columnWidths, "reader folder view patch.details.columnWidths", true)
      detailToml.column_widths = detailPatch.columnWidths
    }
    if (!Object.keys(detailPatch).length) throw new Error("reader folder view patch.details must change at least one field.")
    if (detailPatch.pinnedLeft && detailPatch.pinnedRight && detailPatch.pinnedLeft.some((id) => detailPatch.pinnedRight!.includes(id))) {
      throw new Error("reader folder view patch.details cannot pin a column to both sides.")
    }
    patch.folderView.details = detailPatch
    toml.details = detailToml
  }
  if (folder.search !== undefined) {
    const search = requireRecord(folder.search, "reader folder view patch.search")
    const searchKeys = new Set(["includeSubfolders", "showHistoryOnFocus", "searchInPath"])
    const unknownSearch = Object.keys(search).filter((key) => !searchKeys.has(key))
    if (unknownSearch.length) throw new Error(`reader folder view patch.search contains unsupported fields: ${unknownSearch.join(", ")}.`)
    const searchPatch: Partial<NeoviewFolderSearchConfig> = {}
    const searchToml: Record<string, unknown> = {}
    if (search.includeSubfolders !== undefined) {
      searchPatch.includeSubfolders = optionalBoolean(search.includeSubfolders, "reader folder view patch.search.includeSubfolders")
      searchToml.include_subfolders = searchPatch.includeSubfolders
    }
    if (search.showHistoryOnFocus !== undefined) {
      searchPatch.showHistoryOnFocus = optionalBoolean(search.showHistoryOnFocus, "reader folder view patch.search.showHistoryOnFocus")
      searchToml.show_history_on_focus = searchPatch.showHistoryOnFocus
    }
    if (search.searchInPath !== undefined) {
      searchPatch.searchInPath = optionalBoolean(search.searchInPath, "reader folder view patch.search.searchInPath")
      searchToml.search_in_path = searchPatch.searchInPath
    }
    if (!Object.keys(searchPatch).length) throw new Error("reader folder view patch.search must change at least one field.")
    patch.folderView.search = searchPatch
    toml.search = searchToml
  }
  if (folder.tree !== undefined) {
    const tree = requireRecord(folder.tree, "reader folder view patch.tree")
    const treeKeys = new Set(["visible", "layout", "size", "pinnedPaths"])
    const unknownTree = Object.keys(tree).filter((key) => !treeKeys.has(key))
    if (unknownTree.length) throw new Error(`reader folder view patch.tree contains unsupported fields: ${unknownTree.join(", ")}.`)
    const treePatch: Partial<NeoviewFolderTreeViewConfig> = {}
    const treeToml: Record<string, unknown> = {}
    if (tree.visible !== undefined) {
      treePatch.visible = optionalBoolean(tree.visible, "reader folder view patch.tree.visible")
      treeToml.visible = treePatch.visible
    }
    if (tree.layout !== undefined) {
      treePatch.layout = optionalEnum(tree.layout, "reader folder view patch.tree.layout", NEOVIEW_FOLDER_TREE_LAYOUTS)
      treeToml.layout = treePatch.layout
    }
    if (tree.size !== undefined) {
      treePatch.size = boundedInteger(tree.size, 100, 500, "reader folder view patch.tree.size")
      treeToml.size = treePatch.size
    }
    if (tree.pinnedPaths !== undefined) {
      treePatch.pinnedPaths = normalizedTreePinnedPaths(tree.pinnedPaths, "reader folder view patch.tree.pinnedPaths")
      treeToml.pinned_paths = treePatch.pinnedPaths
    }
    if (!Object.keys(treePatch).length) throw new Error("reader folder view patch.tree must change at least one field.")
    patch.folderView.tree = treePatch
    toml.tree_view = treeToml
  }
  if (folder.tabs !== undefined) {
    const tabs = requireRecord(folder.tabs, "reader folder view patch.tabs")
    const tabKeys = new Set(["pinned", "layout", "width", "breadcrumbPosition", "toolbarPosition"])
    const unknownTabs = Object.keys(tabs).filter((key) => !tabKeys.has(key))
    if (unknownTabs.length) throw new Error(`reader folder view patch.tabs contains unsupported fields: ${unknownTabs.join(", ")}.`)
    const tabPatch: Partial<NeoviewFolderTabsConfig> = {}
    const tabToml: Record<string, unknown> = {}
    if (tabs.pinned !== undefined) {
      tabPatch.pinned = normalizedPinnedTabs(tabs.pinned, "reader folder view patch.tabs.pinned")
      tabToml.pinned = tabPatch.pinned
    }
    if (tabs.layout !== undefined) {
      tabPatch.layout = optionalEnum(tabs.layout, "reader folder view patch.tabs.layout", NEOVIEW_FOLDER_REGION_POSITIONS)
      tabToml.layout = tabPatch.layout
    }
    if (tabs.width !== undefined) {
      tabPatch.width = boundedInteger(tabs.width, 100, 400, "reader folder view patch.tabs.width")
      tabToml.width = tabPatch.width
    }
    if (tabs.breadcrumbPosition !== undefined) {
      tabPatch.breadcrumbPosition = optionalEnum(tabs.breadcrumbPosition, "reader folder view patch.tabs.breadcrumbPosition", NEOVIEW_FOLDER_REGION_POSITIONS)
      tabToml.breadcrumb_position = tabPatch.breadcrumbPosition
    }
    if (tabs.toolbarPosition !== undefined) {
      tabPatch.toolbarPosition = optionalEnum(tabs.toolbarPosition, "reader folder view patch.tabs.toolbarPosition", NEOVIEW_FOLDER_REGION_POSITIONS)
      tabToml.toolbar_position = tabPatch.toolbarPosition
    }
    if (!Object.keys(tabPatch).length) throw new Error("reader folder view patch.tabs must change at least one field.")
    patch.folderView.tabs = tabPatch
    toml.tabs = tabToml
  }
  if (!Object.keys(patch.folderView).length) throw new Error("reader folder view patch must change at least one field.")
  return { patch, tomlPatch: { folder: toml } }
}

function parseFolderViewConfig(value: Record<string, unknown> | undefined): NeoviewFolderViewConfig {
  if (!value) return DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG
  const details = optionalRecord(value.details, "[nodes.neoview.folder.details]")
  const search = optionalRecord(value.search, "[nodes.neoview.folder.search]")
  const emptyArea = optionalRecord(value.empty_area, "[nodes.neoview.folder.empty_area]")
  const tree = optionalRecord(value.tree_view, "[nodes.neoview.folder.tree_view]")
  const tabs = optionalRecord(value.tabs, "[nodes.neoview.folder.tabs]")
  const hiddenColumns = normalizedDetailColumns(details?.hidden_columns ?? [], "[nodes.neoview.folder.details].hidden_columns", false, false)
    .filter((id) => id !== "name")
  const pinnedLeft = normalizedDetailColumns(details?.pinned_left ?? ["name"], "[nodes.neoview.folder.details].pinned_left", false, false)
  const pinnedRight = normalizedDetailColumns(details?.pinned_right ?? [], "[nodes.neoview.folder.details].pinned_right", false, false)
    .filter((id) => !pinnedLeft.includes(id))
  const previewCount = value.preview_count === undefined
    ? DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.previewCount
    : boundedInteger(value.preview_count, 4, 16, "[nodes.neoview.folder].preview_count")
  if (previewCount !== 4 && previewCount !== 9 && previewCount !== 16) throw new Error("[nodes.neoview.folder].preview_count must be 4, 9 or 16.")
  return {
    homePath: value.home_path === undefined
      ? DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.homePath
      : normalizedFolderHomePath(value.home_path, "[nodes.neoview.folder].home_path"),
    viewMode: optionalEnum(value.view_mode, "[nodes.neoview.folder].view_mode", NEOVIEW_FOLDER_VIEW_MODES) ?? DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.viewMode,
    previewCount,
    thumbnailWidthPercent: value.thumbnail_width_percent === undefined
      ? DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.thumbnailWidthPercent
      : boundedInteger(value.thumbnail_width_percent, 10, 90, "[nodes.neoview.folder].thumbnail_width_percent"),
    bannerWidthPercent: value.banner_width_percent === undefined
      ? DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.bannerWidthPercent
      : boundedInteger(value.banner_width_percent, 20, 100, "[nodes.neoview.folder].banner_width_percent"),
    emptyArea: {
      singleClickAction: optionalEnum(emptyArea?.single_click_action, "[nodes.neoview.folder.empty_area].single_click_action", NEOVIEW_FOLDER_EMPTY_AREA_ACTIONS)
        ?? DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.emptyArea.singleClickAction,
      doubleClickAction: optionalEnum(emptyArea?.double_click_action, "[nodes.neoview.folder.empty_area].double_click_action", NEOVIEW_FOLDER_EMPTY_AREA_ACTIONS)
        ?? DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.emptyArea.doubleClickAction,
      showBackButton: optionalBoolean(emptyArea?.show_back_button, "[nodes.neoview.folder.empty_area].show_back_button")
        ?? DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.emptyArea.showBackButton,
    },
    details: {
      columnOrder: normalizedDetailColumns(details?.column_order ?? NEOVIEW_FOLDER_DETAIL_COLUMNS, "[nodes.neoview.folder.details].column_order", true, false),
      hiddenColumns,
      pinnedLeft,
      pinnedRight,
      columnWidths: {
        ...DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.details.columnWidths,
        ...normalizedDetailWidths(details?.column_widths ?? {}, "[nodes.neoview.folder.details].column_widths", false),
      },
    },
    search: {
      includeSubfolders: optionalBoolean(search?.include_subfolders, "[nodes.neoview.folder.search].include_subfolders")
        ?? DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.search.includeSubfolders,
      showHistoryOnFocus: optionalBoolean(search?.show_history_on_focus, "[nodes.neoview.folder.search].show_history_on_focus")
        ?? DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.search.showHistoryOnFocus,
      searchInPath: optionalBoolean(search?.search_in_path, "[nodes.neoview.folder.search].search_in_path")
        ?? DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.search.searchInPath,
    },
    tree: {
      visible: optionalBoolean(tree?.visible, "[nodes.neoview.folder.tree_view].visible")
        ?? DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.tree.visible,
      layout: optionalEnum(tree?.layout, "[nodes.neoview.folder.tree_view].layout", NEOVIEW_FOLDER_TREE_LAYOUTS)
        ?? DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.tree.layout,
      size: tree?.size === undefined
        ? DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.tree.size
        : boundedInteger(tree.size, 100, 500, "[nodes.neoview.folder.tree_view].size"),
      pinnedPaths: normalizedTreePinnedPaths(tree?.pinned_paths ?? [], "[nodes.neoview.folder.tree_view].pinned_paths"),
    },
    tabs: {
      pinned: normalizedPinnedTabs(tabs?.pinned ?? [], "[nodes.neoview.folder.tabs].pinned"),
      layout: optionalEnum(tabs?.layout, "[nodes.neoview.folder.tabs].layout", NEOVIEW_FOLDER_REGION_POSITIONS)
        ?? DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.tabs.layout,
      width: tabs?.width === undefined
        ? DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.tabs.width
        : boundedInteger(tabs.width, 100, 400, "[nodes.neoview.folder.tabs].width"),
      breadcrumbPosition: optionalEnum(tabs?.breadcrumb_position, "[nodes.neoview.folder.tabs].breadcrumb_position", NEOVIEW_FOLDER_REGION_POSITIONS)
        ?? DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.tabs.breadcrumbPosition,
      toolbarPosition: optionalEnum(tabs?.toolbar_position, "[nodes.neoview.folder.tabs].toolbar_position", NEOVIEW_FOLDER_REGION_POSITIONS)
        ?? DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.tabs.toolbarPosition,
    },
  }
}

function normalizedPinnedTabs(value: unknown, path: string): NeoviewFolderPinnedTab[] {
  if (!Array.isArray(value) || value.length > 7) throw new Error(`${path} must be an array containing at most 7 tabs.`)
  return value.map((item, index) => {
    const tab = requireRecord(item, `${path}[${index}]`)
    if (Object.keys(tab).some((key) => key !== "path" && key !== "title")) throw new Error(`${path}[${index}] contains unsupported fields.`)
    const tabPath = normalizedFolderHomePath(tab.path, `${path}[${index}].path`)
    if (!tabPath) throw new Error(`${path}[${index}].path must not be empty.`)
    if (typeof tab.title !== "string") throw new Error(`${path}[${index}].title must be a string.`)
    const title = tab.title.trim()
    if (!title || title.length > 256 || title.includes("\0")) throw new Error(`${path}[${index}].title must be 1 to 256 characters without NUL.`)
    return { path: tabPath, title }
  })
}

function normalizedBookmarkListId(value: unknown, path: string): string {
  if (typeof value !== "string") throw new Error(`${path} must be a string.`)
  const normalized = value.trim()
  if (!normalized || normalized.length > 256 || normalized.includes("\0")) {
    throw new Error(`${path} must be 1 to 256 characters without NUL.`)
  }
  return normalized
}

function normalizedFolderHomePath(value: unknown, path: string): string {
  if (typeof value !== "string") throw new Error(`${path} must be a string.`)
  const normalized = value.trim()
  if (normalized.length > 4096 || normalized.includes("\0")) throw new Error(`${path} must be at most 4096 characters without NUL.`)
  return normalized
}

function normalizedSubtitleColor(value: unknown, path: string, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{5})?$/.test(value)) {
    throw new Error(`${path} must be a #RGB, #RRGGBB or #RRGGBBAA color.`)
  }
  return value.toLowerCase()
}

function normalizedTreePinnedPaths(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length > 64) throw new Error(`${path} must be an array containing at most 64 paths.`)
  const result = new Map<string, string>()
  for (const item of value) {
    if (typeof item !== "string") throw new Error(`${path} must contain only string paths.`)
    const pinnedPath = item.trim()
    if (!pinnedPath || pinnedPath.length > 32_767 || pinnedPath.includes("\0")) throw new Error(`${path} contains an invalid path.`)
    const normalized = pinnedPath.replaceAll("\\", "/").replace(/\/+$/u, "") || "/"
    const key = /^(?:[A-Za-z]:|\/\/)/u.test(normalized) ? normalized.toLocaleLowerCase() : normalized
    if (!result.has(key)) result.set(key, pinnedPath)
  }
  return [...result.values()]
}

function normalizedDetailColumns(value: unknown, path: string, appendMissing: boolean, strict = true): NeoviewFolderDetailColumn[] {
  if (!Array.isArray(value) || value.length > (strict ? NEOVIEW_FOLDER_DETAIL_COLUMNS.length : 64)) throw new Error(`${path} must be a bounded array of known column IDs.`)
  const known = new Set<string>(NEOVIEW_FOLDER_DETAIL_COLUMNS)
  const result: NeoviewFolderDetailColumn[] = []
  for (const item of value) {
    if (typeof item !== "string" || !known.has(item)) {
      if (strict) throw new Error(`${path} contains an unknown column ID.`)
      continue
    }
    const column = item as NeoviewFolderDetailColumn
    if (!result.includes(column)) result.push(column)
  }
  if (appendMissing) for (const column of NEOVIEW_FOLDER_DETAIL_COLUMNS) if (!result.includes(column)) result.push(column)
  return result
}

function normalizedDetailWidths(
  value: unknown,
  path: string,
  strict: boolean,
): Partial<Record<NeoviewFolderDetailColumn, number>> {
  const record = requireRecord(value, path)
  const known = new Set<string>(NEOVIEW_FOLDER_DETAIL_COLUMNS)
  const result: Partial<Record<NeoviewFolderDetailColumn, number>> = {}
  for (const [id, width] of Object.entries(record)) {
    if (!known.has(id)) {
      if (strict) throw new Error(`${path} contains unknown column ${id}.`)
      continue
    }
    result[id as NeoviewFolderDetailColumn] = boundedInteger(width, 48, 800, `${path}.${id}`)
  }
  if (strict && !Object.keys(result).length) throw new Error(`${path} must change at least one known column.`)
  return result
}

function parsePresentationDiskCache(value: Record<string, unknown> | undefined): NeoviewPresentationDiskCacheConfig {
  if (!value) return DEFAULT_NEOVIEW_PRESENTATION_DISK_CACHE_CONFIG
  const maxBytes = mebibytes(
    value.max_size_mb,
    64,
    65_536,
    DEFAULT_NEOVIEW_PRESENTATION_DISK_CACHE_CONFIG.maxBytes,
    "[nodes.neoview.performance.presentation_disk_cache].max_size_mb",
  )
  const maxEntryBytes = mebibytes(
    value.max_entry_size_mb,
    1,
    256,
    DEFAULT_NEOVIEW_PRESENTATION_DISK_CACHE_CONFIG.maxEntryBytes,
    "[nodes.neoview.performance.presentation_disk_cache].max_entry_size_mb",
  )
  if (maxEntryBytes > maxBytes) {
    throw new Error("[nodes.neoview.performance.presentation_disk_cache].max_entry_size_mb must not exceed max_size_mb.")
  }
  const directory = value.directory
  if (directory !== undefined && (typeof directory !== "string" || !directory.trim())) {
    throw new Error("[nodes.neoview.performance.presentation_disk_cache].directory must be a non-empty path.")
  }
  return {
    enabled: optionalBoolean(value.enabled, "[nodes.neoview.performance.presentation_disk_cache].enabled") ?? true,
    directory: typeof directory === "string" ? directory : undefined,
    maxBytes,
    maxEntryBytes,
    maxAgeMs: boundedInteger(
      value.max_age_days ?? 30,
      1,
      3_650,
      "[nodes.neoview.performance.presentation_disk_cache].max_age_days",
    ) * 24 * 60 * 60 * 1000,
    trimRatio: boundedNumber(
      value.trim_ratio,
      0.5,
      0.95,
      DEFAULT_NEOVIEW_PRESENTATION_DISK_CACHE_CONFIG.trimRatio,
      "[nodes.neoview.performance.presentation_disk_cache].trim_ratio",
    ),
    minFreeBytes: mebibytes(
      value.min_free_space_mb,
      0,
      65_536,
      DEFAULT_NEOVIEW_PRESENTATION_DISK_CACHE_CONFIG.minFreeBytes,
      "[nodes.neoview.performance.presentation_disk_cache].min_free_space_mb",
    ),
  }
}

export function parseNeoviewSlideshowPatch(value: unknown): {
  patch: NeoviewSlideshowPatch
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader slideshow patch")
  if (Object.keys(record).some((key) => key !== "slideshow")) throw new Error("reader slideshow patch contains unsupported fields.")
  const slideshow = requireRecord(record.slideshow, "reader slideshow patch.slideshow")
  const allowed = new Set(["intervalSeconds", "loop", "random", "fadeTransition"])
  const unknown = Object.keys(slideshow).filter((key) => !allowed.has(key))
  if (unknown.length) throw new Error(`reader slideshow patch contains unsupported fields: ${unknown.join(", ")}.`)
  const patch: NeoviewSlideshowPatch = { slideshow: {} }
  const tomlPatch: Record<string, unknown> = {}
  if (slideshow.intervalSeconds !== undefined) {
    patch.slideshow.intervalSeconds = boundedInteger(slideshow.intervalSeconds, 1, 60, "reader slideshow patch.intervalSeconds")
    tomlPatch.interval_seconds = patch.slideshow.intervalSeconds
  }
  if (slideshow.loop !== undefined) {
    patch.slideshow.loop = requiredBoolean(slideshow.loop, "reader slideshow patch.loop")
    tomlPatch.loop = patch.slideshow.loop
  }
  if (slideshow.random !== undefined) {
    patch.slideshow.random = requiredBoolean(slideshow.random, "reader slideshow patch.random")
    tomlPatch.random = patch.slideshow.random
  }
  if (slideshow.fadeTransition !== undefined) {
    patch.slideshow.fadeTransition = requiredBoolean(slideshow.fadeTransition, "reader slideshow patch.fadeTransition")
    tomlPatch.fade_transition = patch.slideshow.fadeTransition
  }
  if (!Object.keys(patch.slideshow).length) throw new Error("reader slideshow patch must change at least one field.")
  return { patch, tomlPatch: { slideshow: tomlPatch } }
}

export function parseNeoviewHistoryListPatch(value: unknown): {
  patch: NeoviewHistoryListPatch
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader history list patch")
  if (Object.keys(record).some((key) => key !== "historyList")) throw new Error("reader history list patch contains unsupported fields.")
  const preferences = requireRecord(record.historyList, "reader history list patch.historyList")
  if (Object.keys(preferences).some((key) => key !== "viewMode")) throw new Error("reader history list patch contains unsupported fields.")
  if (preferences.viewMode === undefined) throw new Error("reader history list patch must change viewMode.")
  const viewMode = optionalEnum(preferences.viewMode, "reader history list patch.viewMode", ["compact", "content", "banner", "thumbnail"] as const)
  return {
    patch: { historyList: { viewMode } },
    tomlPatch: { history_list: { view_mode: viewMode } },
  }
}

export function parseNeoviewBookmarkListPatch(value: unknown): {
  patch: NeoviewBookmarkListPatch
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader bookmark list patch")
  if (Object.keys(record).some((key) => key !== "bookmarkList")) throw new Error("reader bookmark list patch contains unsupported fields.")
  const preferences = requireRecord(record.bookmarkList, "reader bookmark list patch.bookmarkList")
  if (Object.keys(preferences).some((key) => key !== "activeListId")) throw new Error("reader bookmark list patch contains unsupported fields.")
  if (preferences.activeListId === undefined) throw new Error("reader bookmark list patch must change activeListId.")
  const activeListId = normalizedBookmarkListId(preferences.activeListId, "reader bookmark list patch.activeListId")
  return {
    patch: { bookmarkList: { activeListId } },
    tomlPatch: { bookmark_list: { active_list_id: activeListId } },
  }
}

export function parseNeoviewPageListPatch(value: unknown): {
  patch: NeoviewPageListPatch
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader page list patch")
  if (Object.keys(record).some((key) => key !== "pageList")) throw new Error("reader page list patch contains unsupported fields.")
  const preferences = requireRecord(record.pageList, "reader page list patch.pageList")
  const allowed = new Set(["viewMode", "followProgress"])
  const unknown = Object.keys(preferences).filter((key) => !allowed.has(key))
  if (unknown.length) throw new Error(`reader page list patch contains unsupported fields: ${unknown.join(", ")}.`)
  const patch: NeoviewPageListPatch = { pageList: {} }
  const tomlPatch: Record<string, unknown> = {}
  if (preferences.viewMode !== undefined) {
    patch.pageList.viewMode = optionalEnum(preferences.viewMode, "reader page list patch.viewMode", ["list", "details", "thumbnails"] as const)
    tomlPatch.view_mode = patch.pageList.viewMode
  }
  if (preferences.followProgress !== undefined) {
    patch.pageList.followProgress = requiredBoolean(preferences.followProgress, "reader page list patch.followProgress")
    tomlPatch.follow_progress = patch.pageList.followProgress
  }
  if (!Object.keys(patch.pageList).length) throw new Error("reader page list patch must change at least one field.")
  return { patch, tomlPatch: { page_list: tomlPatch } }
}

export function parseNeoviewViewDefaultsPatch(value: unknown): {
  patch: NeoviewViewDefaultsPatch
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader view defaults patch")
  if (Object.keys(record).some((key) => key !== "viewDefaults")) throw new Error("reader view defaults patch contains unsupported fields.")
  const defaults = requireRecord(record.viewDefaults, "reader view defaults patch.viewDefaults")
  const allowed = new Set(["fitMode", "pageMode"])
  const unknown = Object.keys(defaults).filter((key) => !allowed.has(key))
  if (unknown.length) throw new Error(`reader view defaults patch contains unsupported fields: ${unknown.join(", ")}.`)
  const patch: NeoviewViewDefaultsPatch = { viewDefaults: {} }
  const readerPatch: Record<string, unknown> = {}
  if (defaults.fitMode !== undefined) {
    patch.viewDefaults.fitMode = readerFitMode(defaults.fitMode, "reader view defaults patch.fitMode")
    readerPatch.default_zoom_mode = persistedReaderFitMode(patch.viewDefaults.fitMode)
  }
  if (defaults.pageMode !== undefined) {
    patch.viewDefaults.pageMode = optionalEnum(defaults.pageMode, "reader view defaults patch.pageMode", ["single", "double"] as const)
    readerPatch.double_page_view = patch.viewDefaults.pageMode === "double"
  }
  if (!Object.keys(patch.viewDefaults).length) throw new Error("reader view defaults patch must change at least one field.")
  return { patch, tomlPatch: { reader: readerPatch } }
}

export function parseNeoviewShellControlPatch(value: unknown): {
  patch: NeoviewShellControlPatch
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader shell control patch")
  const unknownRoot = Object.keys(record).filter((key) => key !== "expectedRevision" && key !== "shellControl")
  if (unknownRoot.length) throw new Error(`reader shell control patch contains unsupported fields: ${unknownRoot.join(", ")}.`)
  const expectedRevision = boundedInteger(record.expectedRevision, 0, Number.MAX_SAFE_INTEGER, "reader shell control patch.expectedRevision")
  const control = requireRecord(record.shellControl, "reader shell control patch.shellControl")
  const unknownControl = Object.keys(control).filter((key) => key !== "floating" && key !== "edges" && key !== "reset")
  if (unknownControl.length) throw new Error(`reader shell control patch contains unsupported fields: ${unknownControl.join(", ")}.`)
  const reset = control.reset === undefined
    ? undefined
    : optionalEnum(control.reset, "reader shell control patch.reset", ["known-defaults"] as const)
  if (reset && (control.floating !== undefined || control.edges !== undefined)) {
    throw new Error("reader shell control patch.reset cannot be combined with floating or edges.")
  }
  if (reset) {
    return {
      patch: { expectedRevision, shellControl: { reset } },
      tomlPatch: shellControlTomlPatch(
        DEFAULT_NEOVIEW_SHELL_CONFIG.floatingControl,
        DEFAULT_NEOVIEW_SHELL_CONFIG.edges,
      ),
    }
  }

  const patch: NeoviewShellControlPatch = { expectedRevision, shellControl: {} }
  let floatingPatch: NeoviewShellControlPatch["shellControl"]["floating"]
  if (control.floating !== undefined) {
    const floating = requireRecord(control.floating, "reader shell control patch.floating")
    const unknown = Object.keys(floating).filter((key) => key !== "enabled" && key !== "position")
    if (unknown.length) throw new Error(`reader shell control patch.floating contains unsupported fields: ${unknown.join(", ")}.`)
    floatingPatch = {}
    if (floating.enabled !== undefined) floatingPatch.enabled = requiredBoolean(floating.enabled, "reader shell control patch.floating.enabled")
    if (floating.position !== undefined) {
      const position = requireRecord(floating.position, "reader shell control patch.floating.position")
      const positionKeys = Object.keys(position)
      if (positionKeys.some((key) => key !== "x" && key !== "y")) throw new Error("reader shell control patch.floating.position contains unsupported fields.")
      if (position.x === undefined || position.y === undefined) throw new Error("reader shell control patch.floating.position requires x and y.")
      floatingPatch.position = {
        x: boundedInteger(position.x, 0, 32_767, "reader shell control patch.floating.position.x"),
        y: boundedInteger(position.y, 0, 32_767, "reader shell control patch.floating.position.y"),
      }
    }
    if (!Object.keys(floatingPatch).length) throw new Error("reader shell control patch.floating must change at least one field.")
    patch.shellControl.floating = floatingPatch
  }

  let edgePatches: NeoviewShellControlPatch["shellControl"]["edges"]
  if (control.edges !== undefined) {
    const edges = requireRecord(control.edges, "reader shell control patch.edges")
    const unknownEdges = Object.keys(edges).filter((edge) => !NEOVIEW_SHELL_EDGES.includes(edge as NeoviewShellEdge))
    if (unknownEdges.length) throw new Error(`reader shell control patch.edges contains unsupported edges: ${unknownEdges.join(", ")}.`)
    edgePatches = {}
    for (const edge of NEOVIEW_SHELL_EDGES) {
      if (edges[edge] === undefined) continue
      const source = requireRecord(edges[edge], `reader shell control patch.edges.${edge}`)
      const unknown = Object.keys(source).filter((key) => !["enabled", "initialVisible", "pinned", "triggerSize", "lockMode"].includes(key))
      if (unknown.length) throw new Error(`reader shell control patch.edges.${edge} contains unsupported fields: ${unknown.join(", ")}.`)
      const target: Partial<NeoviewShellEdgeConfig> = {}
      if (source.enabled !== undefined) target.enabled = requiredBoolean(source.enabled, `${edge}.enabled`)
      if (source.initialVisible !== undefined) target.initialVisible = requiredBoolean(source.initialVisible, `${edge}.initialVisible`)
      if (source.pinned !== undefined) target.pinned = requiredBoolean(source.pinned, `${edge}.pinned`)
      if (source.triggerSize !== undefined) target.triggerSize = boundedNumber(source.triggerSize, 1, 128, 32, `${edge}.triggerSize`)
      if (source.lockMode !== undefined) target.lockMode = shellEdgeLockMode(source.lockMode, `${edge}.lockMode`)
      if (!Object.keys(target).length) throw new Error(`reader shell control patch.edges.${edge} must change at least one field.`)
      edgePatches[edge] = target
    }
    if (!Object.keys(edgePatches).length) throw new Error("reader shell control patch.edges must change at least one edge.")
    patch.shellControl.edges = edgePatches
  }
  if (!patch.shellControl.floating && !patch.shellControl.edges) throw new Error("reader shell control patch must change at least one field.")
  return {
    patch,
    tomlPatch: shellControlTomlPatch(floatingPatch, edgePatches),
  }
}

const NEOVIEW_SHELL_EDGES = ["top", "right", "bottom", "left"] as const
type NeoviewShellEdge = typeof NEOVIEW_SHELL_EDGES[number]

function shellControlTomlPatch(
  floating: Partial<NeoviewShellFloatingControlConfig> | undefined,
  edges: Partial<Record<NeoviewShellEdge, Partial<NeoviewShellEdgeConfig>>> | undefined,
): Record<string, unknown> {
  const panels: Record<string, unknown> = {}
  if (floating) {
    const value: Record<string, unknown> = {}
    if (floating.enabled !== undefined) value.enabled = floating.enabled
    if (floating.position !== undefined) value.position = { x: floating.position.x, y: floating.position.y }
    panels.sidebar_control = value
  }
  if (edges) {
    panels.edges = Object.fromEntries(Object.entries(edges).map(([edge, source]) => {
      const value: Record<string, unknown> = {}
      if (source.enabled !== undefined) value.enabled = source.enabled
      if (source.initialVisible !== undefined) value.initial_visible = source.initialVisible
      if (source.pinned !== undefined) value.pinned = source.pinned
      if (source.triggerSize !== undefined) value.trigger_size = source.triggerSize
      if (source.lockMode !== undefined) value.lock_mode = source.lockMode
      return [edge, value]
    }))
  }
  return { panels }
}

export function parseNeoviewSidebarLayoutPatch(value: unknown): {
  patch: NeoviewSidebarLayoutPatch
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader shell patch")
  const allowed = new Set(["side", "pinned", "width", "height", "customHeight", "verticalAlign", "horizontalPosition"])
  const unknown = Object.keys(record).filter((key) => !allowed.has(key))
  if (unknown.length) throw new Error(`reader shell patch contains unsupported fields: ${unknown.join(", ")}.`)
  const side = optionalEnum(record.side, "reader shell patch.side", ["left", "right"] as const)
  if (!side) throw new Error("reader shell patch.side is required.")
  const patch: NeoviewSidebarLayoutPatch = { side }
  if (record.pinned !== undefined) patch.pinned = optionalBoolean(record.pinned, "reader shell patch.pinned")
  if (record.width !== undefined) patch.width = boundedNumber(record.width, 200, 600, 320, "reader shell patch.width")
  if (record.height !== undefined) patch.height = sidebarHeight(record.height, "reader shell patch.height")
  if (record.customHeight !== undefined) patch.customHeight = boundedNumber(record.customHeight, 10, 100, 100, "reader shell patch.customHeight")
  if (record.verticalAlign !== undefined) patch.verticalAlign = boundedNumber(record.verticalAlign, 0, 100, 0, "reader shell patch.verticalAlign")
  if (record.horizontalPosition !== undefined) patch.horizontalPosition = boundedNumber(record.horizontalPosition, 0, 100, 0, "reader shell patch.horizontalPosition")
  if (Object.keys(patch).length === 1) throw new Error("reader shell patch must change at least one layout field.")
  const sidePatch: Record<string, unknown> = {}
  if (patch.pinned !== undefined) sidePatch.pinned = patch.pinned
  if (patch.width !== undefined) sidePatch.width = patch.width
  if (patch.height !== undefined) sidePatch.height = patch.height === "two-thirds" ? "2/3" : patch.height === "one-third" ? "1/3" : patch.height
  if (patch.customHeight !== undefined) sidePatch.custom_height = patch.customHeight
  if (patch.verticalAlign !== undefined) sidePatch.vertical_align = patch.verticalAlign
  if (patch.horizontalPosition !== undefined) sidePatch.horizontal_position = patch.horizontalPosition
  const panelsPatch: Record<string, unknown> = { sidebars: { [side]: sidePatch } }
  if (patch.pinned !== undefined) panelsPatch.edges = { [side]: { pinned: patch.pinned } }
  return { patch, tomlPatch: { panels: panelsPatch } }
}

export function parseNeoviewCardLayoutPatch(value: unknown): {
  patch: NeoviewCardLayoutPatch
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader card patch")
  const allowed = new Set(["cardId", "panelId", "visible", "expanded", "order", "height"])
  const unknown = Object.keys(record).filter((key) => !allowed.has(key))
  if (unknown.length) throw new Error(`reader card patch contains unsupported fields: ${unknown.join(", ")}.`)
  if (typeof record.cardId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(record.cardId)) {
    throw new Error("reader card patch.cardId is invalid.")
  }
  const patch: NeoviewCardLayoutPatch = { cardId: record.cardId }
  if (record.panelId !== undefined) {
    if (typeof record.panelId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(record.panelId)) throw new Error("reader card patch.panelId is invalid.")
    patch.panelId = record.panelId
  }
  if (record.visible !== undefined) patch.visible = optionalBoolean(record.visible, "reader card patch.visible")
  if (record.expanded !== undefined) patch.expanded = optionalBoolean(record.expanded, "reader card patch.expanded")
  if (record.order !== undefined) patch.order = boundedNumber(record.order, 0, 10_000, 0, "reader card patch.order")
  if (record.height === null) patch.height = null
  else if (record.height !== undefined) patch.height = boundedNumber(record.height, 50, 4_096, 50, "reader card patch.height")
  if (Object.keys(patch).length === 1) throw new Error("reader card patch must change at least one field.")
  const manifest = READER_CARD_MANIFEST_BY_ID.get(patch.cardId)
  if (manifest && patch.visible === false && !manifest.canHide) throw new Error(`reader card patch cannot hide card ${patch.cardId}.`)
  if (patch.panelId && !readerCardCanMoveTo(patch.cardId, patch.panelId)) {
    throw new Error(`reader card patch cannot place card ${patch.cardId} in panel ${patch.panelId}.`)
  }
  const state: Record<string, unknown> = {}
  if (patch.panelId !== undefined) state.panel_id = patch.panelId
  if (patch.visible !== undefined) state.visible = patch.visible
  if (patch.expanded !== undefined) state.expanded = patch.expanded
  if (patch.order !== undefined) state.order = patch.order
  if (patch.height !== undefined) state.height = patch.height === null ? "auto" : patch.height
  return { patch, tomlPatch: { panels: { card_state: { [patch.cardId]: state } } } }
}

export function parseNeoviewBoardLayoutPatch(value: unknown): {
  patch: NeoviewBoardLayoutPatch
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader board patch")
  if (Object.keys(record).some((key) => key !== "board" && key !== "expectedRevision")) throw new Error("reader board patch contains unsupported fields.")
  const expectedRevision = boundedInteger(record.expectedRevision, 0, Number.MAX_SAFE_INTEGER, "reader board patch.expectedRevision")
  const board = requireRecord(record.board, "reader board patch.board")
  if (Object.keys(board).some((key) => key !== "panels" && key !== "cards")) throw new Error("reader board patch.board contains unsupported fields.")
  if (!Array.isArray(board.panels) || !Array.isArray(board.cards)) throw new Error("reader board patch requires panels and cards arrays.")
  if (board.panels.length > 128 || board.cards.length > 512) throw new Error("reader board patch exceeds the layout item limit.")
  const panelIds = new Set<string>()
  const panels = board.panels.map((value, index) => {
    const item = requireRecord(value, `reader board patch.panels[${index}]`)
    const id = requireLayoutId(item.id, `reader board patch.panels[${index}].id`)
    if (panelIds.has(id)) throw new Error(`reader board patch contains duplicate panel ${id}.`)
    panelIds.add(id)
    return {
      id,
      visible: requiredBoolean(item.visible, `${id}.visible`),
      order: boundedNumber(item.order, 0, 10_000, 0, `${id}.order`),
      position: optionalEnum(item.position, `${id}.position`, ["left", "right", "bottom", "floating"] as const) ?? "left",
    }
  })
  const cardIds = new Set<string>()
  const cards = board.cards.map((value, index) => {
    const item = requireRecord(value, `reader board patch.cards[${index}]`)
    const cardId = requireLayoutId(item.cardId, `reader board patch.cards[${index}].cardId`)
    if (cardIds.has(cardId)) throw new Error(`reader board patch contains duplicate card ${cardId}.`)
    cardIds.add(cardId)
    return {
      cardId,
      panelId: requireLayoutId(item.panelId, `${cardId}.panelId`),
      visible: requiredBoolean(item.visible, `${cardId}.visible`),
      order: boundedNumber(item.order, 0, 10_000, 0, `${cardId}.order`),
    }
  })
  const panelById = new Map(panels.map((panel) => [panel.id, panel]))
  for (const card of cards) {
    const manifest = READER_CARD_MANIFEST_BY_ID.get(card.cardId)
    if (!manifest) continue
    if (!card.visible && !manifest.canHide) throw new Error(`reader board patch cannot hide card ${card.cardId}.`)
    if (!card.visible) continue
    const panel = panelById.get(card.panelId)
    if (!panel) throw new Error(`reader board patch card ${card.cardId} references missing panel ${card.panelId}.`)
    if (panel.position !== "left" && panel.position !== "right") {
      throw new Error(`reader board patch card ${card.cardId} cannot be placed in a ${panel.position} panel.`)
    }
  }
  const panelState = Object.fromEntries(panels.map(({ id, ...state }) => [id, state]))
  const cardState = Object.fromEntries(cards.map(({ cardId, panelId, ...state }) => [cardId, { ...state, panel_id: panelId }]))
  return {
    patch: { expectedRevision, board: { panels, cards } },
    tomlPatch: { panels: { panel_state: panelState, card_state: cardState } },
  }
}

function parseShellOptions(
  panels: Record<string, unknown> | undefined,
  reader: Record<string, unknown> | undefined,
): NeoviewShellConfig {
  if (!panels && !reader) return DEFAULT_NEOVIEW_SHELL_CONFIG
  panels ??= {}
  const hover = optionalRecord(panels.hover_areas, "[nodes.neoview.panels.hover_areas]")
  const timing = optionalRecord(panels.auto_hide_timing, "[nodes.neoview.panels.auto_hide_timing]")
  const sidebars = optionalRecord(panels.sidebars, "[nodes.neoview.panels.sidebars]")
  const left = optionalRecord(sidebars?.left, "[nodes.neoview.panels.sidebars.left]")
  const right = optionalRecord(sidebars?.right, "[nodes.neoview.panels.sidebars.right]")
  const autoHideToolbar = optionalBoolean(panels.auto_hide_toolbar, "[nodes.neoview.panels].auto_hide_toolbar")
  const canonicalControl = optionalRecord(panels.sidebar_control, "[nodes.neoview.panels.sidebar_control]")
  const canonicalPosition = optionalRecord(canonicalControl?.position, "[nodes.neoview.panels.sidebar_control.position]")
  const legacyView = optionalRecord(reader?.view, "[nodes.neoview.reader.view]")
  const legacyControl = optionalRecord(
    legacyView?.sidebar_control ?? legacyView?.sidebarControl,
    "[nodes.neoview.reader.view.sidebar_control]",
  )
  const legacyPosition = optionalRecord(legacyControl?.position, "[nodes.neoview.reader.view.sidebar_control.position]")
  const canonicalEdges = optionalRecord(panels.edges, "[nodes.neoview.panels.edges]")
  const legacyEdges = {
    top: { enabled: true, initialVisible: autoHideToolbar === false, pinned: autoHideToolbar === false, trigger: hover?.top_trigger_height },
    right: { enabled: optionalBoolean(panels.right_sidebar_visible, "right_sidebar_visible") ?? true, initialVisible: false, pinned: optionalBoolean(right?.pinned, "right.pinned") ?? false, trigger: hover?.right_trigger_width },
    bottom: { enabled: optionalBoolean(panels.bottom_panel_visible, "bottom_panel_visible") ?? true, initialVisible: optionalBoolean(panels.bottom_panel_visible, "bottom_panel_visible") ?? false, pinned: false, trigger: hover?.bottom_trigger_height },
    left: { enabled: optionalBoolean(panels.left_sidebar_visible, "left_sidebar_visible") ?? true, initialVisible: optionalBoolean(left?.open, "left.open") ?? true, pinned: optionalBoolean(left?.pinned, "left.pinned") ?? true, trigger: hover?.left_trigger_width },
  } satisfies Record<NeoviewShellEdge, { enabled: boolean; initialVisible: boolean; pinned: boolean; trigger: unknown }>
  return {
    showDelayMs: secondsToMilliseconds(timing?.show_delay_sec, "[nodes.neoview.panels.auto_hide_timing].show_delay_sec"),
    hideDelayMs: secondsToMilliseconds(timing?.hide_delay_sec, "[nodes.neoview.panels.auto_hide_timing].hide_delay_sec"),
    opacity: {
      top: boundedNumber(panels.top_toolbar_opacity, 0, 100, DEFAULT_NEOVIEW_SHELL_CONFIG.opacity.top, "top_toolbar_opacity"),
      bottom: boundedNumber(panels.bottom_bar_opacity, 0, 100, DEFAULT_NEOVIEW_SHELL_CONFIG.opacity.bottom, "bottom_bar_opacity"),
      sidebar: boundedNumber(panels.sidebar_opacity, 0, 100, DEFAULT_NEOVIEW_SHELL_CONFIG.opacity.sidebar, "sidebar_opacity"),
    },
    blur: {
      top: boundedNumber(panels.top_toolbar_blur, 0, 20, DEFAULT_NEOVIEW_SHELL_CONFIG.blur.top, "top_toolbar_blur"),
      bottom: boundedNumber(panels.bottom_bar_blur, 0, 20, DEFAULT_NEOVIEW_SHELL_CONFIG.blur.bottom, "bottom_bar_blur"),
      sidebar: boundedNumber(panels.sidebar_blur, 0, 20, DEFAULT_NEOVIEW_SHELL_CONFIG.blur.sidebar, "sidebar_blur"),
    },
    floatingControl: {
      enabled: optionalBoolean(canonicalControl?.enabled, "sidebar_control.enabled")
        ?? optionalBoolean(legacyControl?.enabled, "reader.view.sidebar_control.enabled")
        ?? DEFAULT_NEOVIEW_SHELL_CONFIG.floatingControl.enabled,
      position: {
        x: boundedIntegerWithFallback(canonicalPosition?.x ?? legacyPosition?.x, 0, 32_767, DEFAULT_NEOVIEW_SHELL_CONFIG.floatingControl.position.x, "sidebar_control.position.x"),
        y: boundedIntegerWithFallback(canonicalPosition?.y ?? legacyPosition?.y, 0, 32_767, DEFAULT_NEOVIEW_SHELL_CONFIG.floatingControl.position.y, "sidebar_control.position.y"),
      },
    },
    edges: Object.fromEntries(NEOVIEW_SHELL_EDGES.map((edge) => [
      edge,
      edgeConfig(edge, optionalRecord(canonicalEdges?.[edge], `[nodes.neoview.panels.edges.${edge}]`), legacyEdges[edge]),
    ])) as NeoviewShellConfig["edges"],
    sidebars: { left: sidebarConfig("left", left), right: sidebarConfig("right", right) },
    panelLayout: parsePanelLayout(panels),
    cardLayout: parseCardLayout(panels),
  }
}

function parseCardLayout(panels: Record<string, unknown>): Record<string, NeoviewCardLayout> {
  const result: Record<string, NeoviewCardLayout> = { ...DEFAULT_NEOVIEW_SHELL_CONFIG.cardLayout }
  const legacy = optionalRecord(panels.card_configs, "[nodes.neoview.panels.card_configs]")
  const legacyData = optionalRecord(legacy?.data, "[nodes.neoview.panels.card_configs.data]")
  for (const [panelId, cards] of Object.entries(legacyData ?? {})) {
    if (!Array.isArray(cards)) continue
    for (const value of cards) {
      if (!isRecord(value) || typeof value.id !== "string") continue
      result[value.id] = parseCardValue(value.id, panelId, value, result[value.id])
    }
  }
  const canonical = optionalRecord(panels.card_state, "[nodes.neoview.panels.card_state]")
  for (const [cardId, value] of Object.entries(canonical ?? {})) {
    if (!isRecord(value)) throw new Error(`[nodes.neoview.panels.card_state.${cardId}] must be a table.`)
    result[cardId] = parseCardValue(cardId, undefined, value, result[cardId])
  }
  return result
}

function parseCardValue(
  cardId: string,
  legacyPanelId: string | undefined,
  value: Record<string, unknown>,
  fallback: NeoviewCardLayout | undefined,
): NeoviewCardLayout {
  const panelId = value.panel_id ?? value.panelId ?? legacyPanelId ?? fallback?.panelId
  if (typeof panelId !== "string" || !panelId) throw new Error(`${cardId}.panelId must be a non-empty string.`)
  return {
    panelId,
    visible: optionalBoolean(value.visible, `${cardId}.visible`) ?? fallback?.visible ?? true,
    expanded: optionalBoolean(value.expanded, `${cardId}.expanded`) ?? fallback?.expanded ?? true,
    order: boundedNumber(value.order, 0, 10_000, fallback?.order ?? 0, `${cardId}.order`),
    height: value.height === "auto"
      ? undefined
      : value.height === undefined
        ? fallback?.height
        : boundedNumber(value.height, 50, 4_096, 50, `${cardId}.height`),
  }
}

function parsePanelLayout(panels: Record<string, unknown>): Record<string, NeoviewPanelLayout> {
  const layout = optionalRecord(panels.layout, "[nodes.neoview.panels.layout]")
  const source = optionalRecord(layout?.sidebarConfig, "[nodes.neoview.panels.layout.sidebarConfig]")
    ?? layout
  const values = source?.panels
  const result: Record<string, NeoviewPanelLayout> = { ...DEFAULT_NEOVIEW_SHELL_CONFIG.panelLayout }
  if (Array.isArray(values)) {
    for (const value of values) {
      if (!isRecord(value) || typeof value.id !== "string") continue
      const id = value.id
      result[id] = {
        visible: optionalBoolean(value.visible, `${id}.visible`) ?? result[id]?.visible ?? true,
        order: boundedNumber(value.order, 0, 10_000, result[id]?.order ?? 0, `${id}.order`),
        position: optionalEnum(value.position, `${id}.position`, ["left", "right", "bottom", "floating"] as const) ?? result[id]?.position ?? "left",
      }
    }
  }
  const canonical = optionalRecord(panels.panel_state, "[nodes.neoview.panels.panel_state]")
  for (const [id, value] of Object.entries(canonical ?? {})) {
    if (!isRecord(value)) throw new Error(`[nodes.neoview.panels.panel_state.${id}] must be a table.`)
    result[id] = {
      visible: optionalBoolean(value.visible, `${id}.visible`) ?? result[id]?.visible ?? true,
      order: boundedNumber(value.order, 0, 10_000, result[id]?.order ?? 0, `${id}.order`),
      position: optionalEnum(value.position, `${id}.position`, ["left", "right", "bottom", "floating"] as const) ?? result[id]?.position ?? "left",
    }
  }
  return result
}

function edgeConfig(
  edge: NeoviewShellEdge,
  canonical: Record<string, unknown> | undefined,
  legacy: { enabled: boolean; initialVisible: boolean; pinned: boolean; trigger: unknown },
): NeoviewShellEdgeConfig {
  return {
    enabled: optionalBoolean(canonical?.enabled, `${edge}.enabled`) ?? legacy.enabled,
    initialVisible: optionalBoolean(canonical?.initial_visible, `${edge}.initial_visible`) ?? legacy.initialVisible,
    pinned: optionalBoolean(canonical?.pinned, `${edge}.pinned`) ?? legacy.pinned,
    triggerSize: boundedNumber(canonical?.trigger_size ?? legacy.trigger, 1, 128, 32, `${edge} trigger`),
    lockMode: shellEdgeLockMode(canonical?.lock_mode, `${edge}.lock_mode`),
  }
}

function shellEdgeLockMode(value: unknown, path: string): NeoviewShellEdgeLockMode {
  return optionalEnum(value, path, ["auto", "locked-open", "locked-hidden"] as const) ?? "auto"
}

function sidebarConfig(side: "left" | "right", value: Record<string, unknown> | undefined): NeoviewShellSidebarConfig {
  return {
    width: boundedNumber(value?.width, 200, 600, side === "left" ? 320 : 280, `${side}.width`),
    height: sidebarHeight(value?.height, `${side}.height`),
    customHeight: boundedNumber(value?.custom_height, 10, 100, 100, `${side}.custom_height`),
    verticalAlign: boundedNumber(value?.vertical_align, 0, 100, 0, `${side}.vertical_align`),
    horizontalPosition: boundedNumber(value?.horizontal_position, 0, 100, 0, `${side}.horizontal_position`),
  }
}

function sidebarHeight(value: unknown, path: string): NeoviewShellSidebarConfig["height"] {
  if (value === undefined) return "full"
  if (value === "2/3") return "two-thirds"
  if (value === "1/3") return "one-third"
  return optionalEnum(value, path, ["full", "two-thirds", "half", "one-third", "custom"] as const) ?? "full"
}

function secondsToMilliseconds(value: unknown, path: string): number {
  return Math.round(boundedNumber(value, 0, 5, 0, path) * 1000)
}

function parseSlideshowConfig(
  canonical: Record<string, unknown> | undefined,
  legacy: Record<string, unknown> | undefined,
  legacyBook: Record<string, unknown> | undefined,
): NeoviewSlideshowConfig {
  const interval = canonical?.interval_seconds
    ?? canonical?.default_interval
    ?? canonical?.defaultInterval
    ?? legacy?.interval_seconds
    ?? legacy?.default_interval
    ?? legacy?.defaultInterval
    ?? legacyBook?.auto_page_turn_interval
    ?? legacyBook?.autoPageTurnInterval
  return {
    intervalSeconds: normalizedSlideshowInterval(interval, "NeoView slideshow interval"),
    loop: optionalBoolean(canonical?.loop ?? legacy?.loop, "NeoView slideshow loop") ?? DEFAULT_NEOVIEW_SLIDESHOW_CONFIG.loop,
    random: optionalBoolean(canonical?.random ?? legacy?.random, "NeoView slideshow random") ?? DEFAULT_NEOVIEW_SLIDESHOW_CONFIG.random,
    fadeTransition: optionalBoolean(
      canonical?.fade_transition ?? canonical?.fadeTransition ?? legacy?.fade_transition ?? legacy?.fadeTransition,
      "NeoView slideshow fade transition",
    ) ?? DEFAULT_NEOVIEW_SLIDESHOW_CONFIG.fadeTransition,
  }
}

function normalizedSlideshowInterval(value: unknown, path: string): number {
  if (value === undefined) return DEFAULT_NEOVIEW_SLIDESHOW_CONFIG.intervalSeconds
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number.`)
  return Math.min(60, Math.max(1, Math.round(value)))
}

function boundedNumber(value: unknown, min: number, max: number, fallback: number, path: string): number {
  if (value === undefined) return fallback
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${path} must be a finite number between ${min} and ${max}.`)
  }
  return value
}

function boundedInteger(value: unknown, min: number, max: number, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${path} must be an integer between ${min} and ${max}.`)
  }
  return value
}

function boundedIntegerWithFallback(value: unknown, min: number, max: number, fallback: number, path: string): number {
  return value === undefined ? fallback : boundedInteger(value, min, max, path)
}

function mebibytes(value: unknown, min: number, max: number, fallbackBytes: number, path: string): number {
  if (value === undefined) return fallbackBytes
  return boundedInteger(value, min, max, path) * 1024 * 1024
}

function parseTailOverflow(value: unknown): TailOverflowBehavior | undefined {
  if (value === undefined) return undefined
  const aliases: Readonly<Record<string, TailOverflowBehavior>> = {
    "do-nothing": "do-nothing",
    doNothing: "do-nothing",
    "stay-on-last-page": "stay-on-last-page",
    stayOnLastPage: "stay-on-last-page",
    "next-book": "next-book",
    nextBook: "next-book",
    loop: "loop",
    loopTopBottom: "loop",
    "seamless-loop": "seamless-loop",
    seamlessLoop: "seamless-loop",
  }
  if (typeof value !== "string" || !aliases[value]) {
    throw new Error("[nodes.neoview.reader].tail_overflow_behavior is invalid.")
  }
  return aliases[value]
}

function readerFitMode(value: unknown, path: string): ReaderFitMode {
  if (value === undefined) return DEFAULT_READER_PRESENTATION.fitMode
  if (value === "fit" || value === "fitLeftAlign" || value === "fitRightAlign") return "fit"
  if (value === "fill" || value === "original") return value
  if (value === "fitWidth" || value === "fit-width") return "fit-width"
  if (value === "fitHeight" || value === "fit-height") return "fit-height"
  throw new Error(`${path} must be fit, fill, fitWidth, fitHeight or original.`)
}

function persistedReaderFitMode(value: ReaderFitMode): string {
  if (value === "fit-width") return "fitWidth"
  if (value === "fit-height") return "fitHeight"
  return value
}

function nestedValue(record: Record<string, unknown> | undefined, section: string, key: string): unknown {
  if (!record) return undefined
  const nested = record[section]
  return isRecord(nested) ? nested[key] : undefined
}

function optionalStringArray(value: unknown, fallback: readonly string[], path: string): readonly string[] {
  return value === undefined ? fallback : requiredStringArray(value, path)
}

function optionalConfigPath(value: unknown, path: string): string | undefined {
  if (value === undefined || value === "") return undefined
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
    throw new Error(`${path} must be an empty string or a non-empty path without NUL.`)
  }
  return value.trim()
}

function requiredManifestIdentifier(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(value)) {
    throw new Error(`${path} must be a valid identifier.`)
  }
  return value
}

function requiredManifestText(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 256 || value.includes("\0")) {
    throw new Error(`${path} must be a non-empty string of at most 256 characters without NUL.`)
  }
  return value.trim()
}

function requiredManifestPath(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 512 || value.includes("\0")) {
    throw new Error(`${path} must be a non-empty relative path without NUL.`)
  }
  const normalized = value.trim().replace(/\\/gu, "/")
  if (normalized.startsWith("/") || /^[a-zA-Z]:\//u.test(normalized) || normalized.split("/").includes("..")) {
    throw new Error(`${path} must be a safe relative path.`)
  }
  return normalized
}

function requiredManifestPaths(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 64) throw new Error(`${path} must contain between 1 and 64 paths.`)
  const paths = value.map((entry, index) => requiredManifestPath(entry, `${path}[${index}]`))
  if (new Set(paths).size !== paths.length) throw new Error(`${path} must not contain duplicates.`)
  return paths
}

function requiredManifestScales(value: unknown, path: string): number[] {
  if (!Array.isArray(value) || !value.length || value.length > 8) throw new Error(`${path} must contain between 1 and 8 scales.`)
  const scales = value.map((scale) => boundedInteger(scale, 1, 8, path))
  return [...new Set(scales)].sort((left, right) => left - right)
}

function requiredManifestNoise(value: unknown, path: string): number[] {
  if (!Array.isArray(value) || value.length > 5) throw new Error(`${path} must contain at most 5 noise levels.`)
  const noise = value.map((level) => boundedInteger(level, -1, 3, path))
  return [...new Set(noise)].sort((left, right) => left - right)
}

function requiredManifestScaleFiles(
  value: unknown,
  scales: readonly number[],
  path: string,
): Readonly<Record<number, string>> {
  const record = requireRecord(value, path)
  const result: Record<number, string> = {}
  for (const [scale, alias] of Object.entries(record)) {
    const numericScale = Number(scale)
    if (!Number.isInteger(numericScale) || !scales.includes(numericScale)) throw new Error(`${path}.${scale} is not a declared scale.`)
    result[numericScale] = requiredManifestIdentifier(alias, `${path}.${scale}`)
  }
  return result
}

function requiredManifestEngine(value: unknown, path: string): "upscayl" | "waifu2x" | "realcugan" {
  const engine = optionalEnum(value, path, ["upscayl", "waifu2x", "realcugan"] as const)
  if (!engine) throw new Error(`${path} is required.`)
  return engine
}

function optionalHttpsUrl(value: unknown, path: string): string | undefined {
  if (value === undefined || value === "") return undefined
  if (typeof value !== "string") throw new Error(`${path} must be an HTTPS URL.`)
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${path} must be an HTTPS URL.`)
  }
  if (url.protocol !== "https:") throw new Error(`${path} must be an HTTPS URL.`)
  return url.href.endsWith("/") ? url.href : `${url.href}/`
}

function requiredStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length > 128 || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${path} must be an array containing at most 128 strings.`)
  }
  return value
}

function optionalStringRecord(
  value: unknown,
  fallback: Readonly<Record<string, string>>,
  path: string,
): Readonly<Record<string, string>> {
  return value === undefined ? fallback : requiredStringRecord(value, path)
}

function requiredStringRecord(value: unknown, path: string): Record<string, string> {
  const record = requireRecord(value, path)
  if (Object.keys(record).length > 128 || Object.values(record).some((entry) => typeof entry !== "string")) {
    throw new Error(`${path} must contain at most 128 string values.`)
  }
  return record as Record<string, string>
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean.`)
  return value
}

function requiredBoolean(value: unknown, path: string): boolean {
  const parsed = optionalBoolean(value, path)
  if (parsed === undefined) throw new Error(`${path} is required.`)
  return parsed
}

function requireLayoutId(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)) throw new Error(`${path} is invalid.`)
  return value
}

function optionalEnum<const Values extends readonly string[]>(
  value: unknown,
  path: string,
  values: Values,
): Values[number] | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string" || !values.includes(value)) {
    throw new Error(`${path} must be one of: ${values.join(", ")}.`)
  }
  return value as Values[number]
}

function optionalRecord(value: unknown, path: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  return requireRecord(value, path)
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${path} must be a table.`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
