import {
  LegacySuperResolutionSettingsCodec,
  type DecodedLegacySuperResolutionSettings,
} from "./LegacySuperResolutionSettingsCodec.js"
import { convertLegacyReaderInputBindings } from "../application/config/ReaderLegacyInputBindings.js"
import { LegacyRadialMenuCodec } from "./LegacyRadialMenuCodec.js"

export const NEOVIEW_CONFIG_SCHEMA_VERSION = 1 as const
export const LEGACY_NEOVIEW_SETTINGS_SOURCE_HASH = "sha256:78e22b555978be0712e053efe890a6621a965de6284e5c5df4901df0f704fcea"

export type LegacySettingsSourceKind =
  | "direct-settings"
  | "neoview-1.0"
  | "app-settings"
  | "full-export"
  | "backup"

export type LegacySettingsDisposition =
  | "migrated"
  | "converted"
  | "skipped"
  | "host-replaced"
  | "pending-data"
  | "rejected-sensitive"
  | "invalid"
  | "unknown"

export interface LegacySettingsReportEntry {
  sourcePath: string
  targetPath?: string
  disposition: LegacySettingsDisposition
  message?: string
}

export interface LegacySettingsMigrationReport {
  codecVersion: 1
  sourceKind: LegacySettingsSourceKind
  sourceVersion?: string
  entries: LegacySettingsReportEntry[]
  summary: Record<LegacySettingsDisposition, number>
  fullyRecognized: boolean
}

export interface DecodedLegacySettings {
  configPatch: Record<string, unknown>
  pendingData: Record<string, unknown>
  report: LegacySettingsMigrationReport
}

export const LEGACY_SETTINGS_MODULES = [
  "native-settings",
  "keybindings",
  "emm",
  "file-browser",
  "ui",
  "panels",
  "bookmarks",
  "history",
  "book-settings",
  "search-history",
  "upscale",
  "performance",
  "folder-ratings",
  "voice-control",
] as const

export type LegacySettingsModule = (typeof LEGACY_SETTINGS_MODULES)[number]

export interface LegacySettingsDecodeOptions {
  modules?: readonly LegacySettingsModule[]
}

type SchemaNode = true | { readonly [key: string]: SchemaNode }

// This is the compatibility contract for the last frozen NeoViewSettings type.
// Optional fields are included so old exports are recognized even when absent from defaults.
const NATIVE_SCHEMA = {
  system: {
    language: true,
    hardwareAcceleration: true,
    temporaryDirectory: true,
    thumbnailDirectory: true,
    excludedPaths: true,
  },
  startup: { openLastFile: true, minimizeToTray: true, openLastFolder: true },
  archive: { allowFileOperations: true, confirmBeforeDelete: true },
  performance: {
    cacheMemorySize: true,
    preLoadSize: true,
    multiThreadedRendering: true,
    maxThreads: true,
    adaptivePreload: true,
    preDecodeCacheSize: true,
    progressiveLoad: { enabled: true, dwellTime: true, batchSize: true, maxPages: true },
    archiveTempfileThresholdMB: true,
    directUrlThresholdMB: true,
    protocolDirectEnabled: true,
  },
  image: {
    supportedFormats: true,
    preloadCount: true,
    enableSuperResolution: true,
    superResolutionModel: true,
    currentImageUpscaleEnabled: true,
    autoPlayAnimatedImages: true,
    longImageScrollMode: true,
    hoverScrollEnabled: true,
    hoverScrollSpeed: true,
    videoMinPlaybackRate: true,
    videoMaxPlaybackRate: true,
    videoPlaybackRateStep: true,
    videoFormats: true,
    nativeJxl: true,
  },
  view: {
    defaultZoomMode: true,
    showGrid: true,
    showInfoBar: true,
    showBookSwitchToast: true,
    backgroundColor: true,
    backgroundMode: true,
    lastDynamicBackgroundMode: true,
    ambient: { speed: true, blur: true, opacity: true, style: true },
    aurora: { showRadialGradient: true },
    spotlight: { color: true },
    mouseCursor: {
      autoHide: true,
      hideDelay: true,
      showMovementThreshold: true,
      showOnButtonClick: true,
    },
    pageLayout: {
      splitHorizontalPages: true,
      treatHorizontalAsDoublePage: true,
      singleFirstPageMode: true,
      singleLastPageMode: true,
      widePageStretch: true,
    },
    autoRotate: { mode: true },
    infoOverlay: { enabled: true, opacity: true, showBorder: true, width: true, height: true },
    notification: {
      messageStyle: true,
      durationMs: true,
      maxVisible: true,
      placeholders: {
        fileOperations: true,
        taskProgress: true,
        performanceTips: true,
        systemMessages: true,
      },
    },
    magnifier: { zoom: true, size: true },
    switchToast: {
      enableBook: true,
      enablePage: true,
      enableBoundaryToast: true,
      showBookPath: true,
      showBookPageProgress: true,
      showBookType: true,
      showPageIndex: true,
      showPageSize: true,
      showPageDimensions: true,
      bookTitleTemplate: true,
      bookDescriptionTemplate: true,
      pageTitleTemplate: true,
      pageDescriptionTemplate: true,
      positionX: true,
      positionY: true,
      opacity: true,
      liquidGlass: true,
    },
    renderer: { mode: true, useViewerJS: true },
    sidebarControl: { enabled: true, position: { x: true, y: true } },
  },
  book: {
    autoPageTurnInterval: true,
    preloadPages: true,
    rememberProgress: true,
    doublePageView: true,
    readingDirection: true,
    tailOverflowBehavior: true,
    lockedSortMode: true,
    lockedMediaPriority: true,
  },
  panels: {
    leftSidebarVisible: true,
    rightSidebarVisible: true,
    bottomPanelVisible: true,
    autoHideToolbar: true,
    sidebarOpacity: true,
    topToolbarOpacity: true,
    bottomBarOpacity: true,
    sidebarBlur: true,
    topToolbarBlur: true,
    bottomBarBlur: true,
    settingsOpacity: true,
    settingsBlur: true,
    hoverAreas: {
      topTriggerHeight: true,
      bottomTriggerHeight: true,
      leftTriggerWidth: true,
      rightTriggerWidth: true,
    },
    autoHideTiming: { showDelaySec: true, hideDelaySec: true },
    pageListFollowProgress: true,
    progressBarGlow: true,
  },
  bindings: {
    mouse: { leftClick: true, rightClick: true, wheelUp: true, wheelDown: true },
    keyboard: { space: true, arrowLeft: true, arrowRight: true, escape: true },
  },
  history: { enabled: true, maxHistorySize: true, rememberLastFile: true, autoCleanupDays: true },
  slideshow: { defaultInterval: true, loop: true, random: true, fadeTransition: true },
  subtitle: { fontSize: true, color: true, bgOpacity: true, bottom: true },
  subtitleFontSize: true,
  subtitleColor: true,
  subtitleBgOpacity: true,
  subtitleBottom: true,
  theme: {
    theme: true,
    fontSize: true,
    uiScale: true,
    customFont: { enabled: true, fontFamilies: true, uiFontFamilies: true, monoFontFamilies: true },
  },
} as const satisfies Record<string, SchemaNode>

const NATIVE_TARGETS: Readonly<Record<string, readonly string[]>> = {
  system: ["system"],
  startup: ["startup"],
  archive: ["archive"],
  performance: ["performance"],
  image: ["image"],
  view: ["reader", "view"],
  book: ["reader", "book"],
  panels: ["panels"],
  bindings: ["bindings"],
  history: ["history"],
  slideshow: ["reader", "slideshow"],
  subtitle: ["reader", "subtitle"],
}

const LEGACY_SUBTITLE_ALIASES: Readonly<Record<string, string>> = {
  subtitleFontSize: "font_size",
  subtitleColor: "color",
  subtitleBgOpacity: "bg_opacity",
  subtitleBottom: "bottom",
}

const DEPRECATED_RENDER_KEYS = new Set(["renderMode", "loadMode", "dataSource", "pageTransferMode"])
const SENSITIVE_KEY = /(?:password|passwd|token|secret|credential|api[_-]?key|authorization)/i
const SENSITIVE_STORAGE_KEY = /(?:gist-sync|ai-api|api-config|auth|credential|secret|token|password)/i
const THEME_STORAGE_KEYS = new Set(["theme-mode", "theme-name", "runtime-theme", "custom-themes"])
const PENDING_EXTENDED_KEYS = new Set(["bookmarks", "history", "searchHistory", "folderRatings"])
const legacySuperResolution = new LegacySuperResolutionSettingsCodec()
const legacyRadialMenu = new LegacyRadialMenuCodec()
const LEGACY_NATIVE_SUPER_RESOLUTION_KEYS = new Set([
  "enableSuperResolution",
  "superResolutionModel",
  "currentImageUpscaleEnabled",
])

export class LegacySettingsCodec {
  readonly version = 1 as const

  decode(input: string | unknown, options: LegacySettingsDecodeOptions = {}): DecodedLegacySettings {
    const parsed = typeof input === "string" ? parseJson(input) : input
    if (!isRecord(parsed)) throw new Error("Legacy NeoView settings must be a JSON object.")

    const source = identifySource(parsed)
    const entries: LegacySettingsReportEntry[] = []
    const configPatch: Record<string, unknown> = { schema_version: NEOVIEW_CONFIG_SCHEMA_VERSION }
    const pendingData: Record<string, unknown> = {}
    const modules = new Set(options.modules ?? LEGACY_SETTINGS_MODULES)

    mapEnvelope(parsed, source.kind, entries)

    if (source.nativeSettings) {
      if (modules.has("native-settings")) mapNativeSettings(source.nativeSettings, configPatch, entries, source.nativePath)
      else entries.push({ sourcePath: source.nativePath || "(root)", disposition: "skipped", message: "Module native-settings was not selected." })
    }
    if (source.appSettings) {
      mapAppSettings(source.appSettings, configPatch, entries, source.appPath, modules)
    }
    if (source.extended) {
      mapExtendedSettings(source.extended, configPatch, pendingData, entries, source.extendedPath, modules)
    }
    if (source.rawLocalStorage) {
      mapRawLocalStorage(source.rawLocalStorage, configPatch, pendingData, entries, source.rawPath, modules)
    }

    const summary = emptySummary()
    for (const entry of entries) summary[entry.disposition] += 1
    return {
      configPatch,
      pendingData,
      report: {
        codecVersion: this.version,
        sourceKind: source.kind,
        sourceVersion: source.version,
        entries,
        summary,
        fullyRecognized: summary.unknown === 0 && summary.invalid === 0 && summary["rejected-sensitive"] === 0,
      },
    }
  }
}

const ENVELOPE_KEYS: Readonly<Record<LegacySettingsSourceKind, ReadonlySet<string>>> = {
  "direct-settings": new Set(Object.keys(NATIVE_SCHEMA)),
  "neoview-1.0": new Set(["format", "exportTime", "config"]),
  "app-settings": new Set(["version", "timestamp", "keybindings", "radialMenus", "emmMetadata", "fileBrowser", "theme"]),
  "full-export": new Set(["version", "timestamp", "includeNativeSettings", "includeExtendedData", "nativeSettings", "appSettings", "extended", "extendedData"]),
  backup: new Set(["version", "timestamp", "backupType", "nativeSettings", "appSettings", "extended", "extendedData", "rawLocalStorage"]),
}

const ENVELOPE_DATA_KEYS = new Set(["config", "nativeSettings", "appSettings", "extended", "extendedData", "rawLocalStorage"])

function mapEnvelope(
  envelope: Record<string, unknown>,
  kind: LegacySettingsSourceKind,
  entries: LegacySettingsReportEntry[],
): void {
  if (kind === "direct-settings" || kind === "app-settings") return
  const known = ENVELOPE_KEYS[kind]
  for (const key of Object.keys(envelope)) {
    if (!known.has(key)) {
      dispositionForUnknownKey(key, key, entries)
    } else if (!ENVELOPE_DATA_KEYS.has(key)) {
      entries.push({ sourcePath: key, disposition: "converted", message: "Envelope metadata is used for format detection only." })
    }
  }
}

interface IdentifiedSource {
  kind: LegacySettingsSourceKind
  version?: string
  nativeSettings?: Record<string, unknown>
  nativePath: string
  appSettings?: Record<string, unknown>
  appPath: string
  extended?: Record<string, unknown>
  extendedPath: string
  rawLocalStorage?: Record<string, unknown>
  rawPath: string
}

function identifySource(value: Record<string, unknown>): IdentifiedSource {
  if (value.format === "NeoView/1.0") {
    if (!isRecord(value.config)) throw new Error("NeoView/1.0 export is missing an object config.")
    return baseSource("neoview-1.0", stringValue(value.format), { nativeSettings: value.config, nativePath: "config" })
  }
  if ("backupType" in value || "rawLocalStorage" in value || "extendedData" in value) {
    return baseSource("backup", stringValue(value.version), {
      nativeSettings: recordValue(value.nativeSettings),
      nativePath: "nativeSettings",
      appSettings: recordValue(value.appSettings),
      appPath: "appSettings",
      extended: recordValue(value.extendedData ?? value.extended),
      extendedPath: "extendedData",
      rawLocalStorage: recordValue(value.rawLocalStorage),
      rawPath: "rawLocalStorage",
    })
  }
  if ("includeNativeSettings" in value || "includeExtendedData" in value || "nativeSettings" in value || "extended" in value) {
    return baseSource("full-export", stringValue(value.version), {
      nativeSettings: recordValue(value.nativeSettings),
      nativePath: "nativeSettings",
      appSettings: recordValue(value.appSettings),
      appPath: "appSettings",
      extended: recordValue(value.extended ?? value.extendedData),
      extendedPath: "extended",
    })
  }
  if (isRecord(value.emmMetadata) || isRecord(value.fileBrowser) || "keybindings" in value) {
    return baseSource("app-settings", stringValue(value.version), { appSettings: value, appPath: "" })
  }
  if (isRecord(value.system) || isRecord(value.view)) {
    return baseSource("direct-settings", undefined, { nativeSettings: value, nativePath: "" })
  }
  throw new Error("Unrecognized NeoView settings envelope.")
}

function baseSource(
  kind: LegacySettingsSourceKind,
  version: string | undefined,
  values: Partial<IdentifiedSource>,
): IdentifiedSource {
  return {
    kind,
    version,
    nativePath: "nativeSettings",
    appPath: "appSettings",
    extendedPath: "extended",
    rawPath: "rawLocalStorage",
    ...values,
  }
}

function mapNativeSettings(
  settings: Record<string, unknown>,
  config: Record<string, unknown>,
  entries: LegacySettingsReportEntry[],
  prefix: string,
): void {
  for (const [key, value] of Object.entries(settings)) {
    const sourcePath = joinPath(prefix, key)
    if (key === "theme") {
      entries.push({ sourcePath, disposition: "host-replaced", message: "Xiranite owns application theme, fonts, and UI scale." })
      continue
    }
    if (key in LEGACY_SUBTITLE_ALIASES) {
      mapLeaf(value, config, ["reader", "subtitle", LEGACY_SUBTITLE_ALIASES[key]!], sourcePath, entries, "converted")
      continue
    }
    const schema = (NATIVE_SCHEMA as Readonly<Record<string, SchemaNode>>)[key]
    const target = NATIVE_TARGETS[key]
    if (!schema || !target) {
      dispositionForUnknownKey(key, sourcePath, entries)
      continue
    }
    if (!isRecord(value) || schema === true) {
      entries.push({ sourcePath, disposition: "invalid", message: "Expected an object section." })
      continue
    }
    if (key === "image") {
      applyLegacySuperResolution(legacySuperResolution.decodeNativeImage(value, sourcePath), config, entries)
      mapSchemaObject(
        Object.fromEntries(Object.entries(value).filter(([childKey]) => !LEGACY_NATIVE_SUPER_RESOLUTION_KEYS.has(childKey))),
        schema,
        config,
        target,
        sourcePath,
        entries,
      )
    } else {
      mapSchemaObject(value, schema, config, target, sourcePath, entries)
    }
  }
}

function mapSchemaObject(
  source: Record<string, unknown>,
  schema: Exclude<SchemaNode, true>,
  config: Record<string, unknown>,
  targetPrefix: readonly string[],
  sourcePrefix: string,
  entries: LegacySettingsReportEntry[],
): void {
  for (const [key, value] of Object.entries(source)) {
    const sourcePath = joinPath(sourcePrefix, key)
    const childSchema = schema[key]
    if (!childSchema) {
      dispositionForUnknownKey(key, sourcePath, entries)
      continue
    }
    const targetPath = resolveNativeTarget(targetPrefix, key)
    if (childSchema === true) {
      mapLeaf(value, config, targetPath, sourcePath, entries)
    } else if (isRecord(value)) {
      mapSchemaObject(value, childSchema, config, targetPath, sourcePath, entries)
    } else {
      entries.push({ sourcePath, targetPath: targetPath.join("."), disposition: "invalid", message: "Expected an object." })
    }
  }
}

function resolveNativeTarget(targetPrefix: readonly string[], key: string): string[] {
  const section = targetPrefix.join(".")
  if (section === "system" && key === "temporaryDirectory") return ["paths", "temporary_directory"]
  if (section === "system" && key === "thumbnailDirectory") return ["paths", "thumbnail_directory"]
  if (section === "performance" && key === "cacheMemorySize") return ["performance", "cache_memory_size_mb"]
  if (section === "performance" && key === "preLoadSize") return ["performance", "preload_items"]
  if (section === "reader.view" && key === "defaultZoomMode") return ["reader", "default_zoom_mode"]
  if (section === "reader.view" && key === "sidebarControl") return ["panels", "sidebar_control"]
  if (section === "reader.book" && key === "readingDirection") return ["reader", "reading_direction"]
  if (section === "reader.book" && key === "doublePageView") return ["reader", "double_page_view"]
  if (section === "reader.book" && key === "tailOverflowBehavior") return ["reader", "tail_overflow_behavior"]
  if (section === "reader.book" && key === "preloadPages") return ["performance", "preload_pages"]
  return [...targetPrefix, snakeCase(key)]
}

function mapAppSettings(
  app: Record<string, unknown>,
  config: Record<string, unknown>,
  entries: LegacySettingsReportEntry[],
  prefix: string,
  modules: ReadonlySet<LegacySettingsModule>,
): void {
  const known: Readonly<Record<string, readonly string[] | "metadata" | "theme">> = {
    version: "metadata",
    timestamp: "metadata",
    keybindings: ["bindings", "keybindings"],
    radialMenus: ["bindings", "radial_menus"],
    emmMetadata: ["integrations", "emm"],
    fileBrowser: ["file_browser"],
    theme: "theme",
  }
  const appModules: Readonly<Record<string, LegacySettingsModule>> = {
    keybindings: "keybindings",
    radialMenus: "keybindings",
    emmMetadata: "emm",
    fileBrowser: "file-browser",
  }
  for (const [key, value] of Object.entries(app)) {
    const sourcePath = joinPath(prefix, key)
    const target = known[key]
    const module = appModules[key]
    if (module && !modules.has(module)) {
      entries.push({ sourcePath, disposition: "skipped", message: `Module ${module} was not selected.` })
    } else if (!target) {
      dispositionForUnknownKey(key, sourcePath, entries)
    } else if (target === "metadata") {
      entries.push({ sourcePath, disposition: "converted", message: "Envelope metadata is not runtime configuration." })
    } else if (target === "theme") {
      entries.push({ sourcePath, disposition: "host-replaced", message: "Xiranite owns the application theme." })
    } else if (key === "keybindings") {
      mapLegacyInputBindings(value, config, sourcePath, entries)
    } else if (key === "radialMenus") {
      mapLegacyRadialMenu(value, config, sourcePath, entries)
    } else {
      mapOpaqueSetting(value, config, target, sourcePath, entries)
    }
  }
}

function mapExtendedSettings(
  extended: Record<string, unknown>,
  config: Record<string, unknown>,
  pending: Record<string, unknown>,
  entries: LegacySettingsReportEntry[],
  prefix: string,
  modules: ReadonlySet<LegacySettingsModule>,
): void {
  const targets: Readonly<Record<string, readonly string[] | "theme">> = {
    uiState: ["ui", "state"],
    panelsLayout: ["panels", "layout"],
    historySettings: ["history", "selection_sync"],
    insightsCardsSettings: ["panels", "insights_cards_settings"],
    insightsCards: ["panels", "insights_cards"],
    cardConfigs: ["panels", "card_configs"],
    folderPanelSettings: ["file_browser", "folder_panel"],
    themeStorage: "theme",
    performanceSettings: ["performance", "native"],
    excludedPaths: ["system", "excluded_paths"],
    voiceControl: ["input", "voice_control"],
    virtualPanelSettings: ["panels", "virtual"],
    panelViewModes: ["panels", "view_modes"],
  }
  const extendedModules: Readonly<Record<string, LegacySettingsModule>> = {
    uiState: "ui",
    panelsLayout: "panels",
    bookmarks: "bookmarks",
    history: "history",
    historySettings: "history",
    searchHistory: "search-history",
    upscalePanelSettings: "upscale",
    insightsCardsSettings: "panels",
    insightsCards: "panels",
    cardConfigs: "panels",
    folderPanelSettings: "file-browser",
    performanceSettings: "performance",
    folderRatings: "folder-ratings",
    excludedPaths: "native-settings",
    voiceControl: "voice-control",
    virtualPanelSettings: "panels",
    panelViewModes: "panels",
  }
  for (const [key, value] of Object.entries(extended)) {
    const sourcePath = joinPath(prefix, key)
    const module = extendedModules[key]
    if (module && !modules.has(module)) {
      entries.push({ sourcePath, disposition: "skipped", message: `Module ${module} was not selected.` })
      continue
    }
    if (PENDING_EXTENDED_KEYS.has(key)) {
      pending[key] = cloneJson(value)
      entries.push({ sourcePath, disposition: "pending-data", message: "Runtime data requires its dedicated database importer and is not written to TOML." })
      continue
    }
    if (key === "upscalePanelSettings") {
      applyLegacySuperResolution(legacySuperResolution.decodePanel(value, sourcePath), config, entries)
      continue
    }
    const target = targets[key]
    if (!target) {
      dispositionForUnknownKey(key, sourcePath, entries)
    } else if (target === "theme") {
      entries.push({ sourcePath, disposition: "host-replaced", message: "Xiranite owns custom themes." })
    } else {
      mapOpaqueSetting(value, config, target, sourcePath, entries)
    }
  }
}

function mapRawLocalStorage(
  storage: Record<string, unknown>,
  config: Record<string, unknown>,
  pending: Record<string, unknown>,
  entries: LegacySettingsReportEntry[],
  prefix: string,
  modules: ReadonlySet<LegacySettingsModule>,
): void {
  for (const [key, raw] of Object.entries(storage)) {
    const sourcePath = joinPath(prefix, key)
    if (THEME_STORAGE_KEYS.has(key)) {
      entries.push({ sourcePath, disposition: "host-replaced", message: "Xiranite owns theme storage." })
      continue
    }
    if (SENSITIVE_KEY.test(key) || SENSITIVE_STORAGE_KEY.test(key)) {
      entries.push({ sourcePath, disposition: "rejected-sensitive", message: "Sensitive legacy storage is never persisted to TOML or migration reports." })
      continue
    }
    if (key === "neoview-settings") {
      if (!modules.has("native-settings")) {
        entries.push({ sourcePath, disposition: "skipped", message: "Module native-settings was not selected." })
        continue
      }
      const parsed = parseStorageJson(raw, sourcePath, entries)
      if (isRecord(parsed)) mapNativeSettings(parsed, config, entries, sourcePath)
      continue
    }
    if (key === "pyo3_upscale_settings") {
      if (!modules.has("upscale")) {
        entries.push({ sourcePath, disposition: "skipped", message: "Module upscale was not selected." })
        continue
      }
      const parsed = parseStorageJson(raw, sourcePath, entries)
      if (parsed !== undefined) applyLegacySuperResolution(legacySuperResolution.decodePanel(parsed, sourcePath), config, entries)
      continue
    }
    if (key === "neoview-keybindings" || key === "neoview-radial-menus") {
      if (!modules.has("keybindings")) {
        entries.push({ sourcePath, disposition: "skipped", message: "Module keybindings was not selected." })
        continue
      }
      const parsed = parseStorageJson(raw, sourcePath, entries)
      if (parsed !== undefined) {
        if (key === "neoview-keybindings") mapLegacyInputBindings(parsed, config, sourcePath, entries)
        else mapLegacyRadialMenu(parsed, config, sourcePath, entries)
      }
      continue
    }
    if (isKnownPendingStorageKey(key)) {
      const module = pendingStorageModule(key)
      if (!modules.has(module)) {
        entries.push({ sourcePath, disposition: "skipped", message: `Module ${module} was not selected.` })
        continue
      }
      pending[key] = cloneJson(raw)
      entries.push({ sourcePath, disposition: "pending-data", message: "Legacy runtime data is deferred to a dedicated importer." })
      continue
    }
    entries.push({ sourcePath, disposition: "unknown", message: "Unmapped localStorage key." })
  }
}

function mapLegacyInputBindings(
  value: unknown,
  config: Record<string, unknown>,
  sourcePath: string,
  entries: LegacySettingsReportEntry[],
): void {
  const decoded = convertLegacyReaderInputBindings(value)
  if (decoded.bindings.length) setPath(config, ["bindings", "items"], decoded.bindings)
  for (const entry of decoded.report) {
    const bindingIndex = entry.bindingId ? decoded.bindings.findIndex((binding) => binding.id === entry.bindingId) : -1
    entries.push({
      sourcePath: rebaseSourcePath(entry.sourcePath, "keybindings", sourcePath),
      targetPath: bindingIndex >= 0 ? `bindings.items.${bindingIndex}` : undefined,
      disposition: entry.status === "converted" ? "converted" : entry.status,
      message: entry.message,
    })
  }
}

function mapLegacyRadialMenu(
  value: unknown,
  config: Record<string, unknown>,
  sourcePath: string,
  entries: LegacySettingsReportEntry[],
): void {
  const decoded = legacyRadialMenu.decode(value, sourcePath)
  if (decoded.config) setPath(config, ["bindings", "radial_menus"], decoded.config)
  for (const entry of decoded.report) {
    entries.push({
      sourcePath: entry.sourcePath,
      targetPath: decoded.config ? "bindings.radial_menus" : undefined,
      disposition: entry.status === "converted" ? "converted" : entry.status,
      message: entry.message,
    })
  }
}

function rebaseSourcePath(path: string, originalRoot: string, sourceRoot: string): string {
  return path === originalRoot ? sourceRoot : path.startsWith(`${originalRoot}[`) || path.startsWith(`${originalRoot}.`)
    ? `${sourceRoot}${path.slice(originalRoot.length)}`
    : sourceRoot
}

function applyLegacySuperResolution(
  decoded: DecodedLegacySuperResolutionSettings,
  config: Record<string, unknown>,
  entries: LegacySettingsReportEntry[],
): void {
  const superResolution = isRecord(config.super_resolution) ? config.super_resolution : {}
  const existing = isRecord(superResolution.preferences) ? superResolution.preferences : {}
  setPath(config, ["super_resolution", "preferences"], { ...existing, ...decoded.preferencesPatch })
  entries.push(...decoded.entries)
}

function mapOpaqueSetting(
  value: unknown,
  config: Record<string, unknown>,
  target: readonly string[],
  sourcePath: string,
  entries: LegacySettingsReportEntry[],
): void {
  const sanitized = sanitizeToml(value, sourcePath, entries)
  if (sanitized !== undefined) {
    setPath(config, target, sanitized)
    entries.push({ sourcePath, targetPath: target.join("."), disposition: "migrated" })
  }
}

function mapLeaf(
  value: unknown,
  config: Record<string, unknown>,
  target: readonly string[],
  sourcePath: string,
  entries: LegacySettingsReportEntry[],
  disposition: "migrated" | "converted" = "migrated",
): void {
  if (SENSITIVE_KEY.test(sourcePath)) {
    entries.push({ sourcePath, disposition: "rejected-sensitive" })
    return
  }
  const validationError = validateKnownLeaf(sourcePath, value)
  if (validationError) {
    entries.push({ sourcePath, targetPath: target.join("."), disposition: "invalid", message: validationError })
    return
  }
  const transformed = transformKnownLeaf(sourcePath, value)
  const sanitized = sanitizeToml(transformed, sourcePath, entries)
  if (sanitized === undefined) return
  setPath(config, target, sanitized)
  entries.push({
    sourcePath,
    targetPath: target.join("."),
    disposition: transformed === value ? disposition : "converted",
  })
}

function transformKnownLeaf(sourcePath: string, value: unknown): unknown {
  if (!sourcePath.endsWith(".tailOverflowBehavior") || typeof value !== "string") return value
  const aliases: Readonly<Record<string, string>> = {
    doNothing: "do-nothing",
    stayOnLastPage: "stay-on-last-page",
    nextBook: "next-book",
    loopTopBottom: "loop",
    seamlessLoop: "seamless-loop",
  }
  return aliases[value] ?? value
}

const ENUM_RULES: readonly { pattern: RegExp; values: ReadonlySet<string> }[] = [
  { pattern: /\.defaultZoomMode$/, values: new Set(["fit", "fill", "fitWidth", "fitHeight", "original", "fitLeftAlign", "fitRightAlign"]) },
  { pattern: /\.readingDirection$/, values: new Set(["left-to-right", "right-to-left"]) },
  { pattern: /\.tailOverflowBehavior$/, values: new Set(["doNothing", "stayOnLastPage", "nextBook", "loopTopBottom", "seamlessLoop"]) },
  { pattern: /\.longImageScrollMode$/, values: new Set(["page", "continuous"]) },
  { pattern: /\.backgroundMode$/, values: new Set(["solid", "auto", "ambient", "aurora", "spotlight"]) },
  { pattern: /\.lastDynamicBackgroundMode$/, values: new Set(["auto", "ambient", "aurora", "spotlight"]) },
  { pattern: /\.ambient\.style$/, values: new Set(["gentle", "vibrant", "dynamic"]) },
  { pattern: /\.single(?:First|Last)PageMode$/, values: new Set(["default", "continue", "restoreOrDefault", "restoreOrContinue"]) },
  { pattern: /\.widePageStretch$/, values: new Set(["none", "uniformHeight", "uniformWidth"]) },
  { pattern: /\.autoRotate\.mode$/, values: new Set(["none", "left", "right", "horizontalLeft", "horizontalRight", "forcedLeft", "forcedRight"]) },
  { pattern: /\.notification\.messageStyle$/, values: new Set(["none", "normal", "normalIconOnly", "tiny", "tinyIconOnly"]) },
  { pattern: /\.renderer\.mode$/, values: new Set(["standard"]) },
]

const NUMERIC_RULES: readonly { pattern: RegExp; minimum: number; maximum: number; integer?: boolean }[] = [
  { pattern: /\.(?:cacheMemorySize|archiveTempfileThresholdMB|directUrlThresholdMB)$/, minimum: 0, maximum: 1024 * 1024 },
  { pattern: /\.(?:preLoadSize|preloadCount|preloadPages|preDecodeCacheSize|maxPages|batchSize)$/, minimum: 0, maximum: 100_000, integer: true },
  { pattern: /\.maxThreads$/, minimum: 1, maximum: 1024, integer: true },
  { pattern: /\.(?:opacity|bgOpacity)$/, minimum: 0, maximum: 1 },
  { pattern: /\.(?:sidebarOpacity|topToolbarOpacity|bottomBarOpacity|settingsOpacity)$/, minimum: 0, maximum: 100 },
  { pattern: /\.(?:sidebarBlur|topToolbarBlur|bottomBarBlur|settingsBlur|blur)$/, minimum: 0, maximum: 10_000 },
  { pattern: /\.(?:hoverScrollSpeed|videoMinPlaybackRate|videoMaxPlaybackRate|videoPlaybackRateStep|zoom)$/, minimum: 0, maximum: 10_000 },
  { pattern: /\.(?:hideDelay|showDelaySec|hideDelaySec|dwellTime|autoPageTurnInterval|defaultInterval)$/, minimum: 0, maximum: 86_400 },
  { pattern: /\.(?:durationMs)$/, minimum: 0, maximum: 86_400_000 },
  { pattern: /\.(?:maxVisible|maxHistorySize|autoCleanupDays|size|width|height)$/, minimum: 0, maximum: 10_000_000, integer: true },
]

function validateKnownLeaf(sourcePath: string, value: unknown): string | undefined {
  const enumRule = ENUM_RULES.find((rule) => rule.pattern.test(sourcePath))
  if (enumRule) {
    if (typeof value !== "string" || !enumRule.values.has(value)) {
      return `Expected one of: ${[...enumRule.values].join(", ")}.`
    }
    return undefined
  }
  const numericRule = NUMERIC_RULES.find((rule) => rule.pattern.test(sourcePath))
  if (numericRule) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "Expected a finite number."
    if (value < numericRule.minimum || value > numericRule.maximum) {
      return `Expected a number from ${numericRule.minimum} to ${numericRule.maximum}.`
    }
    if (numericRule.integer && !Number.isInteger(value)) return "Expected an integer."
    return undefined
  }
  if (/(?:Directory|Path)$/.test(sourcePath) && typeof value !== "string") return "Expected a path string."
  if (/(?:supportedFormats|videoFormats|excludedPaths)$/.test(sourcePath)) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return "Expected an array of strings."
  }
  return undefined
}

function sanitizeToml(
  value: unknown,
  sourcePath: string,
  entries: LegacySettingsReportEntry[],
): unknown | undefined {
  if (value === null || value === undefined) {
    entries.push({ sourcePath, disposition: "converted", message: "Null/undefined means unset and is omitted from TOML." })
    return undefined
  }
  if (typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value
    entries.push({ sourcePath, disposition: "invalid", message: "TOML cannot represent a non-finite number." })
    return undefined
  }
  if (Array.isArray(value)) {
    const result: unknown[] = []
    for (let index = 0; index < value.length; index += 1) {
      const item = sanitizeToml(value[index], `${sourcePath}[${index}]`, entries)
      if (item !== undefined) result.push(item)
    }
    return result
  }
  if (isRecord(value)) {
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      const childPath = joinPath(sourcePath, key)
      if (SENSITIVE_KEY.test(key)) {
        entries.push({ sourcePath: childPath, disposition: "rejected-sensitive" })
        continue
      }
      const mapped = sanitizeToml(child, childPath, entries)
      if (mapped !== undefined) result[snakeCase(key)] = mapped
    }
    return result
  }
  entries.push({ sourcePath, disposition: "invalid", message: `Unsupported JSON value type: ${typeof value}.` })
  return undefined
}

function dispositionForUnknownKey(key: string, sourcePath: string, entries: LegacySettingsReportEntry[]): void {
  if (SENSITIVE_KEY.test(key)) {
    entries.push({ sourcePath, disposition: "rejected-sensitive" })
  } else if (DEPRECATED_RENDER_KEYS.has(key)) {
    entries.push({
      sourcePath,
      disposition: "host-replaced",
      message: "The DOM image and loopback asset pipeline replaces this legacy renderer/data-source option.",
    })
  } else {
    entries.push({ sourcePath, disposition: "unknown" })
  }
}

function isKnownPendingStorageKey(key: string): boolean {
  return key === "neoview-book-settings" || /(?:bookmark|history|rating|recent|progress|search-history|translation-cache)/i.test(key)
}

function pendingStorageModule(key: string): LegacySettingsModule {
  if (key === "neoview-book-settings") return "book-settings"
  if (/bookmark/i.test(key)) return "bookmarks"
  if (/search-history/i.test(key)) return "search-history"
  if (/rating/i.test(key)) return "folder-ratings"
  return "history"
}

function parseStorageJson(raw: unknown, sourcePath: string, entries: LegacySettingsReportEntry[]): unknown {
  if (typeof raw !== "string") return raw
  try {
    return JSON.parse(raw) as unknown
  } catch {
    entries.push({ sourcePath, disposition: "invalid", message: "Expected JSON-encoded localStorage value." })
    return undefined
  }
}

function parseJson(input: string): unknown {
  try {
    return JSON.parse(input) as unknown
  } catch (error) {
    throw new Error(`Invalid NeoView settings JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function emptySummary(): Record<LegacySettingsDisposition, number> {
  return {
    migrated: 0,
    converted: 0,
    skipped: 0,
    "host-replaced": 0,
    "pending-data": 0,
    "rejected-sensitive": 0,
    invalid: 0,
    unknown: 0,
  }
}

function snakeCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[-\s]+/g, "_").toLowerCase()
}

function joinPath(prefix: string, key: string): string {
  return prefix ? `${prefix}.${key}` : key
}

function setPath(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let cursor = target
  for (const segment of path.slice(0, -1)) {
    const existing = cursor[segment]
    if (!isRecord(existing)) cursor[segment] = {}
    cursor = cursor[segment] as Record<string, unknown>
  }
  cursor[path[path.length - 1]!] = value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function cloneJson<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T
}
