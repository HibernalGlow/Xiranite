import { DEFAULT_READER_LAYOUT, type PageMode } from "../../domain/frame/frame.js"
import type { TailOverflowBehavior } from "../../domain/navigation/navigation.js"
import { DEFAULT_READER_PRESENTATION, type ReaderFitMode } from "../../domain/presentation/presentation.js"
import type { ReaderSessionOptions } from "../reader/contracts.js"
import { READER_CARD_MANIFEST, READER_PANEL_MANIFEST, readerCardCanMoveTo } from "./ReaderLayoutManifest.js"

const READER_CARD_MANIFEST_BY_ID = new Map(READER_CARD_MANIFEST.map((card) => [card.id as string, card]))

export interface NeoviewRuntimeConfig {
  schemaVersion: 1
  sessionOptions: Partial<ReaderSessionOptions>
  shellOptions: NeoviewShellConfig
  viewDefaults: NeoviewViewDefaults
  folderView: NeoviewFolderViewConfig
  fileTree: NeoviewFileTreeConfig
  slideshow: NeoviewSlideshowConfig
  presentationDiskCache: NeoviewPresentationDiskCacheConfig
}

export interface NeoviewFileTreeConfig {
  excludedPaths: string[]
}

export const NEOVIEW_FOLDER_VIEW_MODES = ["compact", "cover-list", "mosaic-list", "details", "cover-grid", "mosaic-grid"] as const
export const NEOVIEW_FOLDER_DETAIL_COLUMNS = ["name", "path", "type", "extension", "size", "modifiedAt", "dimensions", "pageCount", "rating", "tags"] as const
export type NeoviewFolderViewMode = typeof NEOVIEW_FOLDER_VIEW_MODES[number]
export type NeoviewFolderDetailColumn = typeof NEOVIEW_FOLDER_DETAIL_COLUMNS[number]

export interface NeoviewFolderDetailsConfig {
  columnOrder: NeoviewFolderDetailColumn[]
  hiddenColumns: NeoviewFolderDetailColumn[]
  pinnedLeft: NeoviewFolderDetailColumn[]
  pinnedRight: NeoviewFolderDetailColumn[]
  columnWidths: Record<NeoviewFolderDetailColumn, number>
}

export interface NeoviewFolderViewConfig {
  viewMode: NeoviewFolderViewMode
  previewCount: 4 | 9 | 16
  details: NeoviewFolderDetailsConfig
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
    viewMode?: NeoviewFolderViewMode
    previewCount?: 4 | 9 | 16
    details?: NeoviewFolderDetailsPatch
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

export interface NeoviewShellEdgeConfig {
  enabled: boolean
  initialVisible: boolean
  pinned: boolean
  triggerSize: number
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

export type NeoviewShellConfigPatch = NeoviewSidebarLayoutPatch | NeoviewCardLayoutPatch | NeoviewBoardLayoutPatch

export const DEFAULT_NEOVIEW_VIEW_DEFAULTS: NeoviewViewDefaults = {
  fitMode: DEFAULT_READER_PRESENTATION.fitMode,
  pageMode: DEFAULT_READER_LAYOUT.pageMode,
}

export const DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG: NeoviewFolderViewConfig = {
  viewMode: "compact",
  previewCount: 4,
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

export const DEFAULT_NEOVIEW_PRESENTATION_DISK_CACHE_CONFIG: NeoviewPresentationDiskCacheConfig = {
  enabled: true,
  maxBytes: 2 * 1024 * 1024 * 1024,
  maxEntryBytes: 24 * 1024 * 1024,
  maxAgeMs: 30 * 24 * 60 * 60 * 1000,
  trimRatio: 0.8,
  minFreeBytes: 512 * 1024 * 1024,
}

export const DEFAULT_NEOVIEW_SHELL_CONFIG: NeoviewShellConfig = {
  showDelayMs: 0,
  hideDelayMs: 0,
  opacity: { top: 85, bottom: 85, sidebar: 85 },
  blur: { top: 12, bottom: 12, sidebar: 12 },
  edges: {
    top: { enabled: true, initialVisible: true, pinned: false, triggerSize: 32 },
    right: { enabled: true, initialVisible: false, pinned: false, triggerSize: 32 },
    bottom: { enabled: true, initialVisible: false, pinned: false, triggerSize: 32 },
    left: { enabled: true, initialVisible: true, pinned: true, triggerSize: 32 },
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
    folderView: DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG,
    fileTree: DEFAULT_NEOVIEW_FILE_TREE_CONFIG,
    slideshow: DEFAULT_NEOVIEW_SLIDESHOW_CONFIG,
    presentationDiskCache: DEFAULT_NEOVIEW_PRESENTATION_DISK_CACHE_CONFIG,
  }
  const config = requireRecord(value, "[nodes.neoview]")
  const schemaVersion = config.schema_version ?? 1
  if (schemaVersion !== 1) throw new Error(`[nodes.neoview].schema_version must be 1, received ${String(schemaVersion)}.`)
  const reader = optionalRecord(config.reader, "[nodes.neoview.reader]")
  const panels = optionalRecord(config.panels, "[nodes.neoview.panels]")
  const slideshow = optionalRecord(config.slideshow, "[nodes.neoview.slideshow]")
  const folder = optionalRecord(config.folder, "[nodes.neoview.folder]")
  const legacySlideshow = optionalRecord(reader?.slideshow, "[nodes.neoview.reader.slideshow]")
  const legacyBook = optionalRecord(reader?.book, "[nodes.neoview.reader.book]")
  const performance = optionalRecord(config.performance, "[nodes.neoview.performance]")
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
    shellOptions: parseShellOptions(panels),
    viewDefaults: { fitMode, pageMode },
    folderView: parseFolderViewConfig(folder),
    fileTree: parseFileTreeConfig(optionalRecord(folder?.tree, "[nodes.neoview.folder.tree]")),
    slideshow: parseSlideshowConfig(slideshow, legacySlideshow, legacyBook),
    presentationDiskCache: parsePresentationDiskCache(presentationDiskCache),
  }
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
  const allowed = new Set(["viewMode", "previewCount", "details"])
  const unknown = Object.keys(folder).filter((key) => !allowed.has(key))
  if (unknown.length) throw new Error(`reader folder view patch contains unsupported fields: ${unknown.join(", ")}.`)
  const patch: NeoviewFolderViewPatch = { folderView: {} }
  const toml: Record<string, unknown> = {}
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
  if (!Object.keys(patch.folderView).length) throw new Error("reader folder view patch must change at least one field.")
  return { patch, tomlPatch: { folder: toml } }
}

function parseFolderViewConfig(value: Record<string, unknown> | undefined): NeoviewFolderViewConfig {
  if (!value) return DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG
  const details = optionalRecord(value.details, "[nodes.neoview.folder.details]")
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
    viewMode: optionalEnum(value.view_mode, "[nodes.neoview.folder].view_mode", NEOVIEW_FOLDER_VIEW_MODES) ?? DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.viewMode,
    previewCount,
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
  }
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
  return { patch, tomlPatch: { panels: { sidebars: { [side]: sidePatch } } } }
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

function parseShellOptions(panels: Record<string, unknown> | undefined): NeoviewShellConfig {
  if (!panels) return DEFAULT_NEOVIEW_SHELL_CONFIG
  const hover = optionalRecord(panels.hover_areas, "[nodes.neoview.panels.hover_areas]")
  const timing = optionalRecord(panels.auto_hide_timing, "[nodes.neoview.panels.auto_hide_timing]")
  const sidebars = optionalRecord(panels.sidebars, "[nodes.neoview.panels.sidebars]")
  const left = optionalRecord(sidebars?.left, "[nodes.neoview.panels.sidebars.left]")
  const right = optionalRecord(sidebars?.right, "[nodes.neoview.panels.sidebars.right]")
  const autoHideToolbar = optionalBoolean(panels.auto_hide_toolbar, "[nodes.neoview.panels].auto_hide_toolbar")
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
    edges: {
      top: edgeConfig("top", true, autoHideToolbar === false, autoHideToolbar === false, hover?.top_trigger_height),
      right: edgeConfig("right", optionalBoolean(panels.right_sidebar_visible, "right_sidebar_visible") ?? true, false, optionalBoolean(right?.pinned, "right.pinned") ?? false, hover?.right_trigger_width),
      bottom: edgeConfig("bottom", optionalBoolean(panels.bottom_panel_visible, "bottom_panel_visible") ?? true, optionalBoolean(panels.bottom_panel_visible, "bottom_panel_visible") ?? false, false, hover?.bottom_trigger_height),
      left: edgeConfig("left", optionalBoolean(panels.left_sidebar_visible, "left_sidebar_visible") ?? true, optionalBoolean(left?.open, "left.open") ?? true, optionalBoolean(left?.pinned, "left.pinned") ?? true, hover?.left_trigger_width),
    },
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

function edgeConfig(edge: string, enabled: boolean, initialVisible: boolean, pinned: boolean, trigger: unknown): NeoviewShellEdgeConfig {
  return { enabled, initialVisible, pinned, triggerSize: boundedNumber(trigger, 1, 128, 32, `${edge} trigger`) }
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
