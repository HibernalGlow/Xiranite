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
import { DEFAULT_READER_VOICE_CONTROL_CONFIG, parseReaderVoiceControlConfig } from "./ReaderVoiceControlConfig.js"
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
import * as Models from "./ReaderRuntimeConfigModels.js"

const READER_CARD_MANIFEST_BY_ID = new Map(READER_CARD_MANIFEST.map((card) => [card.id as string, card]))
export function parseNeoviewRuntimeConfig(value: unknown): Models.NeoviewRuntimeConfig {
  if (value === undefined)
    return {
      schemaVersion: 1,
      sessionOptions: { direction: "left-to-right" },
      shellOptions: Models.DEFAULT_NEOVIEW_SHELL_CONFIG,
      viewDefaults: Models.DEFAULT_NEOVIEW_VIEW_DEFAULTS,
      book: Models.DEFAULT_NEOVIEW_BOOK_CONFIG,
      pageList: Models.DEFAULT_NEOVIEW_PAGE_LIST_CONFIG,
      bookmarkList: Models.DEFAULT_NEOVIEW_BOOKMARK_LIST_CONFIG,
      historyList: Models.DEFAULT_NEOVIEW_HISTORY_LIST_CONFIG,
      folderView: Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG,
      fileTree: Models.DEFAULT_NEOVIEW_FILE_TREE_CONFIG,
      slideshow: Models.DEFAULT_NEOVIEW_SLIDESHOW_CONFIG,
      media: Models.DEFAULT_NEOVIEW_MEDIA_CONFIG,
      imageProcessing: DEFAULT_NEOVIEW_IMAGE_PROCESSING_CONFIG,
      colorFilter: DEFAULT_READER_COLOR_FILTER,
      pageTransition: DEFAULT_READER_PAGE_TRANSITION,
      switchToast: DEFAULT_READER_SWITCH_TOAST,
      infoOverlay: DEFAULT_READER_INFO_OVERLAY,
      imageTrim: DEFAULT_READER_IMAGE_TRIM,
      superResolution: Models.DEFAULT_NEOVIEW_SUPER_RESOLUTION_CONFIG,
      presentationDiskCache: Models.DEFAULT_NEOVIEW_PRESENTATION_DISK_CACHE_CONFIG,
      inputBindings: parseNeoviewInputBindingsConfig(undefined),
      radialMenu: parseReaderRadialMenuConfig(undefined),
      voiceControl: DEFAULT_READER_VOICE_CONTROL_CONFIG,
      preload: Models.DEFAULT_NEOVIEW_PRELOAD_CONFIG,
      systemMonitor: Models.DEFAULT_NEOVIEW_SYSTEM_MONITOR_CONFIG,
      emm: Models.DEFAULT_NEOVIEW_EMM_CONFIG,
      aiTranslation: Models.DEFAULT_NEOVIEW_AI_TRANSLATION_CONFIG,
    }
  const config = unwrapNeoviewConfigEnvelope(value)
  const schemaVersion = config.schema_version ?? 1
  if (schemaVersion !== 1) throw new Error(`[nodes.neoview].schema_version must be 1, received ${String(schemaVersion)}.`)
  const reader = optionalRecord(config.reader, "[nodes.neoview.reader]")
  const book = optionalRecord(config.book, "[nodes.neoview.book]")
  const panels = optionalRecord(config.panels, "[nodes.neoview.panels]")
  const slideshow = optionalRecord(config.slideshow, "[nodes.neoview.slideshow]")
  const pageList = optionalRecord(config.page_list, "[nodes.neoview.page_list]")
  const bookmarkList = optionalRecord(config.bookmark_list, "[nodes.neoview.bookmark_list]")
  const historyList = optionalRecord(config.history_list, "[nodes.neoview.history_list]")
  const folder = optionalRecord(config.folder, "[nodes.neoview.folder]")
  const image = optionalRecord(config.image, "[nodes.neoview.image]")
  const imageProcessing = optionalRecord(image?.processing, "[nodes.neoview.image.processing]")
  const view = optionalRecord(config.view, "[nodes.neoview.view]")
  const background = parseNeoviewBackgroundConfig(view)
  const colorFilter = optionalRecord(image?.color_filter, "[nodes.neoview.image.color_filter]")
  const pageTransition = optionalRecord(image?.page_transition, "[nodes.neoview.image.page_transition]")
  const switchToast = optionalRecord(
    view?.switch_toast ?? view?.switchToast ?? nestedValue(reader, "view", "switch_toast") ?? nestedValue(reader, "view", "switchToast"),
    "[nodes.neoview.view.switch_toast]",
  )
  const infoOverlay = optionalRecord(
    view?.info_overlay ?? view?.infoOverlay ?? nestedValue(reader, "view", "info_overlay") ?? nestedValue(reader, "view", "infoOverlay"),
    "[nodes.neoview.view.info_overlay]",
  )
  const imageTrim = optionalRecord(
    view?.image_trim ?? view?.imageTrim ?? nestedValue(reader, "view", "image_trim") ?? nestedValue(reader, "view", "imageTrim"),
    "[nodes.neoview.view.image_trim]",
  )
  const magnifier = optionalRecord(view?.magnifier ?? nestedValue(reader, "view", "magnifier"), "[nodes.neoview.view.magnifier]")
  const subtitle = optionalRecord(reader?.subtitle, "[nodes.neoview.reader.subtitle]")
  const legacySlideshow = optionalRecord(reader?.slideshow, "[nodes.neoview.reader.slideshow]")
  const legacyBook = optionalRecord(reader?.book, "[nodes.neoview.reader.book]")
  const performance = optionalRecord(config.performance, "[nodes.neoview.performance]")
  const systemMonitor = optionalRecord(performance?.monitor, "[nodes.neoview.performance.monitor]")
  const emm = optionalRecord(config.emm, "[nodes.neoview.emm]")
  const aiTranslation = optionalRecord(config.ai_translation ?? config.aiTranslation, "[nodes.neoview.ai_translation]")
  const superResolution = optionalRecord(config.super_resolution, "[nodes.neoview.super_resolution]")
  const bindings = optionalRecord(config.bindings, "[nodes.neoview.bindings]")
  const voiceControl = optionalRecord(config.voice_control ?? config.voiceControl, "[nodes.neoview.voice_control]")
  const presentationDiskCache = optionalRecord(performance?.presentation_disk_cache, "[nodes.neoview.performance.presentation_disk_cache]")

  const bookConfig = parseBookConfig(book, legacyBook)
  const configuredDirection = optionalEnum(
    reader?.reading_direction ?? nestedValue(reader, "book", "reading_direction"),
    "[nodes.neoview.reader].reading_direction",
    ["left-to-right", "right-to-left"] as const,
  )
  const direction = bookConfig.lockedReadingDirection ?? configuredDirection ?? "left-to-right"
  const doublePage = optionalBoolean(reader?.double_page_view ?? nestedValue(reader, "book", "double_page_view"), "[nodes.neoview.reader].double_page_view")
  const legacyPageLayout = optionalRecord(
    nestedValue(reader, "view", "page_layout") ?? nestedValue(reader, "view", "pageLayout"),
    "[nodes.neoview.reader.view.page_layout]",
  )
  const splitWidePages = optionalBoolean(
    reader?.split_wide_pages ?? reader?.splitWidePages ?? legacyPageLayout?.split_horizontal_pages ?? legacyPageLayout?.splitHorizontalPages,
    "[nodes.neoview.reader].split_wide_pages",
  )
  const hoverScrollEnabled =
    optionalBoolean(
      reader?.hover_scroll_enabled ?? reader?.hoverScrollEnabled ?? image?.hover_scroll_enabled ?? image?.hoverScrollEnabled,
      "[nodes.neoview.reader].hover_scroll_enabled",
    ) ?? Models.DEFAULT_NEOVIEW_VIEW_DEFAULTS.hoverScrollEnabled
  const hoverScrollSpeed = boundedNumber(
    reader?.hover_scroll_speed ?? reader?.hoverScrollSpeed ?? image?.hover_scroll_speed ?? image?.hoverScrollSpeed,
    0.5,
    10,
    Models.DEFAULT_NEOVIEW_VIEW_DEFAULTS.hoverScrollSpeed,
    "[nodes.neoview.reader].hover_scroll_speed",
  )
  const magnifierZoom = boundedNumber(magnifier?.zoom, 1, 5, Models.DEFAULT_NEOVIEW_VIEW_DEFAULTS.magnifierZoom, "[nodes.neoview.view.magnifier].zoom")
  const magnifierSize = boundedNumber(magnifier?.size, 100, 500, Models.DEFAULT_NEOVIEW_VIEW_DEFAULTS.magnifierSize, "[nodes.neoview.view.magnifier].size")
  const tailOverflow = parseTailOverflow(reader?.tail_overflow_behavior ?? nestedValue(reader, "book", "tail_overflow_behavior"))
  const fitMode = readerFitMode(
    reader?.default_zoom_mode ?? nestedValue(reader, "view", "default_zoom_mode") ?? nestedValue(reader, "view", "defaultZoomMode"),
    "[nodes.neoview.reader].default_zoom_mode",
  )
  const pageMode = doublePage === undefined ? DEFAULT_READER_LAYOUT.pageMode : doublePage ? "double" : "single"
  const doublePageGap = boundedNumber(
    reader?.double_page_gap ?? nestedValue(reader, "view", "double_page_gap") ?? nestedValue(reader, "view", "doublePageGap"),
    -500,
    500,
    Models.DEFAULT_NEOVIEW_VIEW_DEFAULTS.doublePageGap,
    "[nodes.neoview.reader].double_page_gap",
  )
  const orientation =
    optionalEnum(reader?.orientation ?? nestedValue(reader, "view", "orientation"), "[nodes.neoview.reader].orientation", [
      "horizontal",
      "vertical",
    ] as const) ?? DEFAULT_READER_PRESENTATION.orientation
  const autoRotation = readerAutoRotation(
    reader?.auto_rotation ?? nestedValue(reader, "view", "auto_rotation") ?? nestedValue(reader, "view", "autoRotateMode"),
  )
  const widePageStretch = readerWidePageStretch(
    reader?.wide_page_stretch ?? nestedValue(reader, "view", "wide_page_stretch") ?? nestedValue(reader, "view", "widePageStretch"),
  )

  return {
    schemaVersion: 1,
    sessionOptions: {
      direction,
      layout:
        doublePage === undefined && splitWidePages === undefined
          ? undefined
          : {
              ...DEFAULT_READER_LAYOUT,
              ...(doublePage === undefined ? {} : { pageMode: doublePage ? "double" : "single" }),
              splitWidePages: splitWidePages ?? DEFAULT_READER_LAYOUT.splitWidePages,
            },
      tailOverflow,
    },
    shellOptions: parseShellOptions(panels, reader),
    viewDefaults: {
      fitMode,
      pageMode,
      doublePageGap,
      splitWidePages: splitWidePages ?? false,
      hoverScrollEnabled,
      hoverScrollSpeed,
      magnifierZoom,
      magnifierSize,
      orientation,
      autoRotation,
      widePageStretch,
      background,
    },
    book: bookConfig,
    pageList: {
      viewMode:
        optionalEnum(pageList?.view_mode, "[nodes.neoview.page_list].view_mode", ["list", "details", "thumbnails"] as const) ??
        Models.DEFAULT_NEOVIEW_PAGE_LIST_CONFIG.viewMode,
      followProgress:
        optionalBoolean(pageList?.follow_progress, "[nodes.neoview.page_list].follow_progress") ?? Models.DEFAULT_NEOVIEW_PAGE_LIST_CONFIG.followProgress,
    },
    bookmarkList: {
      activeListId:
        bookmarkList?.active_list_id === undefined
          ? Models.DEFAULT_NEOVIEW_BOOKMARK_LIST_CONFIG.activeListId
          : normalizedBookmarkListId(bookmarkList.active_list_id, "[nodes.neoview.bookmark_list].active_list_id"),
    },
    historyList: {
      viewMode:
        optionalEnum(historyList?.view_mode, "[nodes.neoview.history_list].view_mode", ["compact", "content", "banner", "thumbnail"] as const) ??
        Models.DEFAULT_NEOVIEW_HISTORY_LIST_CONFIG.viewMode,
    },
    folderView: parseFolderViewConfig(folder),
    fileTree: parseFileTreeConfig(optionalRecord(folder?.tree, "[nodes.neoview.folder.tree]")),
    slideshow: parseSlideshowConfig(slideshow, legacySlideshow, legacyBook),
    media: parseMediaConfig(image, subtitle),
    imageProcessing: parseNeoviewImageProcessingConfig(imageProcessing),
    colorFilter: parseColorFilterConfig(colorFilter),
    pageTransition: parsePageTransitionConfig(pageTransition),
    switchToast: parseSwitchToastConfig(switchToast, {
      showBookSwitchToast:
        view?.show_book_switch_toast ??
        view?.showBookSwitchToast ??
        nestedValue(reader, "view", "show_book_switch_toast") ??
        nestedValue(reader, "view", "showBookSwitchToast"),
    }),
    infoOverlay: normalizeReaderInfoOverlay({
      enabled: infoOverlay?.enabled,
      opacity: infoOverlay?.opacity,
      showBorder: infoOverlay?.show_border ?? infoOverlay?.showBorder,
      width: infoOverlay?.width,
      height: infoOverlay?.height,
    }),
    imageTrim: normalizeReaderImageTrim({
      enabled: imageTrim?.enabled,
      top: imageTrim?.top,
      bottom: imageTrim?.bottom,
      left: imageTrim?.left,
      right: imageTrim?.right,
      linkVertical: imageTrim?.link_vertical ?? imageTrim?.linkVertical,
      linkHorizontal: imageTrim?.link_horizontal ?? imageTrim?.linkHorizontal,
      autoTrimThreshold: imageTrim?.auto_trim_threshold ?? imageTrim?.autoTrimThreshold,
      autoTrimTarget: imageTrim?.auto_trim_target ?? imageTrim?.autoTrimTarget,
    }),
    superResolution: parseSuperResolutionConfig(superResolution),
    presentationDiskCache: parsePresentationDiskCache(presentationDiskCache),
    inputBindings: parseNeoviewInputBindingsConfig(bindings),
    radialMenu: parseReaderRadialMenuConfig(bindings?.radial_menus),
    voiceControl: parseReaderVoiceControlConfig(voiceControl),
    preload: parsePreloadConfig(performance, image, legacyBook),
    systemMonitor: parseSystemMonitorConfig(systemMonitor),
    emm: parseEmmConfig(emm),
    aiTranslation: parseAiTranslationConfig(aiTranslation),
  }
}

function parseNeoviewBackgroundConfig(view: Record<string, unknown> | undefined): Models.NeoviewBackgroundConfig {
  const defaults = Models.DEFAULT_NEOVIEW_VIEW_DEFAULTS.background
  const ambient = optionalRecord(view?.ambient, "[nodes.neoview.view.ambient]")
  const aurora = optionalRecord(view?.aurora, "[nodes.neoview.view.aurora]")
  const spotlight = optionalRecord(view?.spotlight, "[nodes.neoview.view.spotlight]")
  const colorValue = view?.background_color ?? view?.backgroundColor
  const spotlightColor = spotlight?.color
  return {
    color: typeof colorValue === "string" && colorValue.trim() ? colorValue.trim() : defaults.color,
    mode: optionalEnum(view?.background_mode ?? view?.backgroundMode, "[nodes.neoview.view].background_mode", ["solid", "auto", "edge", "ambient", "aurora", "spotlight"] as const) ?? defaults.mode,
    ambient: {
      style: optionalEnum(ambient?.style, "[nodes.neoview.view.ambient].style", ["gentle", "vibrant", "dynamic"] as const) ?? defaults.ambient.style,
      speed: boundedNumber(ambient?.speed, 2, 20, defaults.ambient.speed, "[nodes.neoview.view.ambient].speed"),
      blur: boundedNumber(ambient?.blur, 20, 150, defaults.ambient.blur, "[nodes.neoview.view.ambient].blur"),
      opacity: boundedNumber(ambient?.opacity, 0.3, 1, defaults.ambient.opacity, "[nodes.neoview.view.ambient].opacity"),
    },
    aurora: {
      showRadialGradient: optionalBoolean(aurora?.show_radial_gradient ?? aurora?.showRadialGradient, "[nodes.neoview.view.aurora].show_radial_gradient") ?? defaults.aurora.showRadialGradient,
    },
    spotlight: {
      color: typeof spotlightColor === "string" && spotlightColor.trim() ? spotlightColor.trim() : defaults.spotlight.color,
    },
  }
}

function parseEmmConfig(value: Record<string, unknown> | undefined): Models.NeoviewEmmConfig {
  if (!value) return Models.DEFAULT_NEOVIEW_EMM_CONFIG
  return {
    enabled: optionalBoolean(value.enabled, "[nodes.neoview.emm].enabled") ?? Models.DEFAULT_NEOVIEW_EMM_CONFIG.enabled,
    databasePaths: normalizedEmmPaths(
      value.database_paths ?? value.databasePaths ?? Models.DEFAULT_NEOVIEW_EMM_CONFIG.databasePaths,
      "[nodes.neoview.emm].database_paths",
    ),
    settingPath: optionalConfigPath(value.setting_path ?? value.settingPath, "[nodes.neoview.emm].setting_path"),
    translationDatabasePath: optionalConfigPath(
      value.translation_database_path ?? value.translationDatabasePath,
      "[nodes.neoview.emm].translation_database_path",
    ),
    translationPath: optionalConfigPath(value.translation_path ?? value.translationPath, "[nodes.neoview.emm].translation_path"),
    defaultRating:
      value.default_rating === undefined && value.defaultRating === undefined
        ? Models.DEFAULT_NEOVIEW_EMM_CONFIG.defaultRating
        : boundedNumber(
            value.default_rating ?? value.defaultRating,
            0,
            5,
            Models.DEFAULT_NEOVIEW_EMM_CONFIG.defaultRating,
            "[nodes.neoview.emm].default_rating",
          ),
  }
}

export function parseNeoviewEmmPatch(value: unknown): {
  patch: Models.NeoviewEmmPatch
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader EMM patch")
  if (Object.keys(record).some((key) => key !== "emm")) throw new Error("reader EMM patch contains unsupported fields.")
  const source = requireRecord(record.emm, "reader EMM patch.emm")
  const allowed = ["enabled", "databasePaths", "settingPath", "translationDatabasePath", "translationPath", "defaultRating"]
  const unknown = Object.keys(source).filter((key) => !allowed.includes(key))
  if (unknown.length) throw new Error(`reader EMM patch contains unsupported fields: ${unknown.join(", ")}.`)
  if (!Object.keys(source).length) throw new Error("reader EMM patch must change at least one field.")
  const patch: Partial<Models.NeoviewEmmConfig> = {}
  const toml: Record<string, unknown> = {}
  if (source.enabled !== undefined) {
    patch.enabled = requiredBoolean(source.enabled, "reader EMM patch.enabled")
    toml.enabled = patch.enabled
  }
  if (source.databasePaths !== undefined) {
    patch.databasePaths = normalizedEmmPaths(source.databasePaths, "reader EMM patch.databasePaths")
    toml.database_paths = patch.databasePaths
  }
  if (source.settingPath !== undefined) {
    patch.settingPath = optionalConfigPath(source.settingPath, "reader EMM patch.settingPath")
    toml.setting_path = patch.settingPath ?? ""
  }
  if (source.translationDatabasePath !== undefined) {
    patch.translationDatabasePath = optionalConfigPath(source.translationDatabasePath, "reader EMM patch.translationDatabasePath")
    toml.translation_database_path = patch.translationDatabasePath ?? ""
  }
  if (source.translationPath !== undefined) {
    patch.translationPath = optionalConfigPath(source.translationPath, "reader EMM patch.translationPath")
    toml.translation_path = patch.translationPath ?? ""
  }
  if (source.defaultRating !== undefined) {
    patch.defaultRating = boundedNumber(source.defaultRating, 0, 5, Models.DEFAULT_NEOVIEW_EMM_CONFIG.defaultRating, "reader EMM patch.defaultRating")
    toml.default_rating = patch.defaultRating
  }
  return { patch: { emm: patch }, tomlPatch: { emm: toml } }
}

function parseSystemMonitorConfig(value: Record<string, unknown> | undefined): Models.NeoviewSystemMonitorConfig {
  if (!value) return Models.DEFAULT_NEOVIEW_SYSTEM_MONITOR_CONFIG
  return {
    enabled: optionalBoolean(value.enabled, "[nodes.neoview.performance.monitor].enabled") ?? Models.DEFAULT_NEOVIEW_SYSTEM_MONITOR_CONFIG.enabled,
    refreshIntervalMs: parseSystemMonitorInterval(
      value.refresh_interval_ms ?? value.refreshIntervalMs,
      "[nodes.neoview.performance.monitor].refresh_interval_ms",
      Models.DEFAULT_NEOVIEW_SYSTEM_MONITOR_CONFIG.refreshIntervalMs,
    ),
    maxSamples: boundedIntegerWithFallback(
      value.max_samples ?? value.maxSamples,
      10,
      600,
      Models.DEFAULT_NEOVIEW_SYSTEM_MONITOR_CONFIG.maxSamples,
      "[nodes.neoview.performance.monitor].max_samples",
    ),
  }
}

function parseAiTranslationConfig(value: Record<string, unknown> | undefined): Models.NeoviewAiTranslationConfig {
  if (!value) return Models.DEFAULT_NEOVIEW_AI_TRANSLATION_CONFIG
  const service = parseAiTranslationService(
    value.service ?? value.type,
    "[nodes.neoview.ai_translation].service",
    Models.DEFAULT_NEOVIEW_AI_TRANSLATION_CONFIG.service,
  )
  return {
    enabled: optionalBoolean(value.enabled, "[nodes.neoview.ai_translation].enabled") ?? Models.DEFAULT_NEOVIEW_AI_TRANSLATION_CONFIG.enabled,
    autoTranslate:
      optionalBoolean(value.auto_translate ?? value.autoTranslate, "[nodes.neoview.ai_translation].auto_translate") ??
      Models.DEFAULT_NEOVIEW_AI_TRANSLATION_CONFIG.autoTranslate,
    service,
    ollamaUrl:
      optionalTrimmedString(value.ollama_url ?? value.ollamaUrl, 512, "[nodes.neoview.ai_translation].ollama_url") ??
      Models.DEFAULT_NEOVIEW_AI_TRANSLATION_CONFIG.ollamaUrl,
    ollamaModel:
      optionalTrimmedString(value.ollama_model ?? value.ollamaModel, 256, "[nodes.neoview.ai_translation].ollama_model") ??
      Models.DEFAULT_NEOVIEW_AI_TRANSLATION_CONFIG.ollamaModel,
    sourceLanguage:
      optionalTrimmedString(value.source_language ?? value.sourceLanguage, 32, "[nodes.neoview.ai_translation].source_language") ??
      Models.DEFAULT_NEOVIEW_AI_TRANSLATION_CONFIG.sourceLanguage,
    targetLanguage:
      optionalTrimmedString(value.target_language ?? value.targetLanguage, 32, "[nodes.neoview.ai_translation].target_language") ??
      Models.DEFAULT_NEOVIEW_AI_TRANSLATION_CONFIG.targetLanguage,
    promptTemplate:
      optionalTrimmedString(value.prompt_template ?? value.promptTemplate, 8_192, "[nodes.neoview.ai_translation].prompt_template") ??
      Models.DEFAULT_NEOVIEW_AI_TRANSLATION_CONFIG.promptTemplate,
    memoryCacheEntries: boundedIntegerWithFallback(
      value.memory_cache_entries ?? value.memoryCacheEntries,
      0,
      10_000,
      Models.DEFAULT_NEOVIEW_AI_TRANSLATION_CONFIG.memoryCacheEntries,
      "[nodes.neoview.ai_translation].memory_cache_entries",
    ),
  }
}

function parseAiTranslationService(value: unknown, path: string, fallback: Models.NeoviewAiTranslationService): Models.NeoviewAiTranslationService {
  if (value === undefined) return fallback
  if (typeof value !== "string" || !Models.NEOVIEW_AI_TRANSLATION_SERVICES.includes(value as Models.NeoviewAiTranslationService)) {
    throw new Error(`${path} must be one of ${Models.NEOVIEW_AI_TRANSLATION_SERVICES.join(", ")}.`)
  }
  return value as Models.NeoviewAiTranslationService
}

function optionalTrimmedString(value: unknown, max: number, path: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error(`${path} must be a string.`)
  const trimmed = value.trim()
  if (trimmed.length > max) throw new Error(`${path} must contain at most ${max} characters.`)
  return trimmed
}

export function parseNeoviewAiTranslationPatch(value: unknown): {
  patch: Models.NeoviewAiTranslationPatch
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader AI translation patch")
  if (Object.keys(record).some((key) => key !== "aiTranslation")) {
    throw new Error("reader AI translation patch contains unsupported fields.")
  }
  const source = requireRecord(record.aiTranslation, "reader AI translation patch.aiTranslation")
  const allowed = [
    "enabled",
    "autoTranslate",
    "service",
    "ollamaUrl",
    "ollamaModel",
    "sourceLanguage",
    "targetLanguage",
    "promptTemplate",
    "memoryCacheEntries",
  ]
  const unknown = Object.keys(source).filter((key) => !allowed.includes(key))
  if (unknown.length) throw new Error(`reader AI translation patch contains unsupported fields: ${unknown.join(", ")}.`)
  if (!Object.keys(source).length) throw new Error("reader AI translation patch must change at least one field.")
  const patch: Partial<Models.NeoviewAiTranslationConfig> = {}
  const toml: Record<string, unknown> = {}
  if (source.enabled !== undefined) {
    patch.enabled = requiredBoolean(source.enabled, "reader AI translation patch.enabled")
    toml.enabled = patch.enabled
  }
  if (source.autoTranslate !== undefined) {
    patch.autoTranslate = requiredBoolean(source.autoTranslate, "reader AI translation patch.autoTranslate")
    toml.auto_translate = patch.autoTranslate
  }
  if (source.service !== undefined) {
    patch.service = parseAiTranslationService(source.service, "reader AI translation patch.service", Models.DEFAULT_NEOVIEW_AI_TRANSLATION_CONFIG.service)
    toml.service = patch.service
  }
  if (source.ollamaUrl !== undefined) {
    const url = optionalTrimmedString(source.ollamaUrl, 512, "reader AI translation patch.ollamaUrl")
    if (url === undefined) throw new Error("reader AI translation patch.ollamaUrl must be a string.")
    const parsed = new URL(url)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("reader AI translation patch.ollamaUrl must use HTTP or HTTPS.")
    if (parsed.username || parsed.password) throw new Error("reader AI translation patch.ollamaUrl must not contain credentials.")
    patch.ollamaUrl = url
    toml.ollama_url = url
  }
  if (source.ollamaModel !== undefined) {
    patch.ollamaModel = optionalTrimmedString(source.ollamaModel, 256, "reader AI translation patch.ollamaModel") ?? ""
    toml.ollama_model = patch.ollamaModel
  }
  if (source.sourceLanguage !== undefined) {
    patch.sourceLanguage = optionalTrimmedString(source.sourceLanguage, 32, "reader AI translation patch.sourceLanguage") ?? ""
    if (!patch.sourceLanguage) throw new Error("reader AI translation patch.sourceLanguage must not be empty.")
    toml.source_language = patch.sourceLanguage
  }
  if (source.targetLanguage !== undefined) {
    patch.targetLanguage = optionalTrimmedString(source.targetLanguage, 32, "reader AI translation patch.targetLanguage") ?? ""
    if (!patch.targetLanguage) throw new Error("reader AI translation patch.targetLanguage must not be empty.")
    toml.target_language = patch.targetLanguage
  }
  if (source.promptTemplate !== undefined) {
    patch.promptTemplate = optionalTrimmedString(source.promptTemplate, 8_192, "reader AI translation patch.promptTemplate") ?? ""
    if (!patch.promptTemplate) throw new Error("reader AI translation patch.promptTemplate must not be empty.")
    toml.prompt_template = patch.promptTemplate
  }
  if (source.memoryCacheEntries !== undefined) {
    patch.memoryCacheEntries = boundedInteger(source.memoryCacheEntries, 0, 10_000, "reader AI translation patch.memoryCacheEntries")
    toml.memory_cache_entries = patch.memoryCacheEntries
  }
  return {
    patch: { aiTranslation: patch },
    tomlPatch: { ai_translation: toml },
  }
}

export function parseNeoviewSystemMonitorPatch(value: unknown): {
  patch: Models.NeoviewSystemMonitorPatch
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader system monitor patch")
  if (Object.keys(record).some((key) => key !== "systemMonitor")) {
    throw new Error("reader system monitor patch contains unsupported fields.")
  }
  const source = requireRecord(record.systemMonitor, "reader system monitor patch.systemMonitor")
  const unknown = Object.keys(source).filter((key) => !["enabled", "refreshIntervalMs", "maxSamples"].includes(key))
  if (unknown.length) throw new Error(`reader system monitor patch contains unsupported fields: ${unknown.join(", ")}.`)
  if (!Object.keys(source).length) throw new Error("reader system monitor patch must change at least one field.")
  const patch: Partial<Models.NeoviewSystemMonitorConfig> = {}
  const toml: Record<string, unknown> = {}
  if (source.enabled !== undefined) {
    patch.enabled = requiredBoolean(source.enabled, "reader system monitor patch.enabled")
    toml.enabled = patch.enabled
  }
  if (source.refreshIntervalMs !== undefined) {
    patch.refreshIntervalMs = parseSystemMonitorInterval(source.refreshIntervalMs, "reader system monitor patch.refreshIntervalMs")
    toml.refresh_interval_ms = patch.refreshIntervalMs
  }
  if (source.maxSamples !== undefined) {
    patch.maxSamples = boundedInteger(source.maxSamples, 10, 600, "reader system monitor patch.maxSamples")
    toml.max_samples = patch.maxSamples
  }
  return {
    patch: { systemMonitor: patch },
    tomlPatch: { performance: { monitor: toml } },
  }
}

function parseSystemMonitorInterval(value: unknown, path: string, fallback?: Models.NeoviewSystemMonitorInterval): Models.NeoviewSystemMonitorInterval {
  if (value === undefined && fallback !== undefined) return fallback
  const interval = boundedInteger(value, 500, 5_000, path)
  if (!Models.NEOVIEW_SYSTEM_MONITOR_INTERVALS.includes(interval as Models.NeoviewSystemMonitorInterval)) {
    throw new Error(`${path} must be one of: ${Models.NEOVIEW_SYSTEM_MONITOR_INTERVALS.join(", ")}.`)
  }
  return interval as Models.NeoviewSystemMonitorInterval
}

function parsePreloadConfig(
  performance: Record<string, unknown> | undefined,
  image: Record<string, unknown> | undefined,
  legacyBook: Record<string, unknown> | undefined,
): Models.NeoviewPreloadConfig {
  const requested = boundedIntegerWithFallback(
    performance?.preload_pages ??
      performance?.preloadPages ??
      performance?.preload_items ??
      performance?.preLoadSize ??
      image?.preload_count ??
      image?.preloadCount ??
      legacyBook?.preload_pages ??
      legacyBook?.preloadPages,
    0,
    1_000,
    Models.DEFAULT_NEOVIEW_PRELOAD_CONFIG.maxCandidatePages,
    "[nodes.neoview.performance].preload_pages",
  )
  return {
    maxCandidatePages: Math.min(requested, 32),
    browserPredecodeEnabled:
      optionalBoolean(
        performance?.browser_predecode_enabled ?? performance?.browserPredecodeEnabled,
        "[nodes.neoview.performance].browser_predecode_enabled",
      ) ?? Models.DEFAULT_NEOVIEW_PRELOAD_CONFIG.browserPredecodeEnabled,
    browserPredecodePages: boundedIntegerWithFallback(
      performance?.browser_predecode_pages ?? performance?.browserPredecodePages,
      1,
      4,
      Models.DEFAULT_NEOVIEW_PRELOAD_CONFIG.browserPredecodePages,
      "[nodes.neoview.performance].browser_predecode_pages",
    ),
  }
}

export function parseNeoviewPreloadPatch(value: unknown): {
  patch: Models.NeoviewPreloadPatch
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader preload patch")
  if (Object.keys(record).some((key) => key !== "preload")) {
    throw new Error("reader preload patch contains unsupported fields.")
  }
  const source = requireRecord(record.preload, "reader preload patch.preload")
  if (Object.keys(source).some((key) => key !== "maxCandidatePages" && key !== "browserPredecodeEnabled" && key !== "browserPredecodePages")) {
    throw new Error("reader preload patch contains unsupported fields.")
  }
  const preload: Partial<Models.NeoviewPreloadConfig> = {}
  const performance: Record<string, unknown> = {}
  if (source.maxCandidatePages !== undefined) {
    const maxCandidatePages = boundedInteger(source.maxCandidatePages, 0, 32, "reader preload patch.maxCandidatePages")
    preload.maxCandidatePages = maxCandidatePages
    performance.preload_pages = maxCandidatePages
  }
  if (source.browserPredecodeEnabled !== undefined) {
    preload.browserPredecodeEnabled = optionalBoolean(
      source.browserPredecodeEnabled,
      "reader preload patch.browserPredecodeEnabled",
    )
    performance.browser_predecode_enabled = preload.browserPredecodeEnabled
  }
  if (source.browserPredecodePages !== undefined) {
    const browserPredecodePages = boundedInteger(source.browserPredecodePages, 1, 4, "reader preload patch.browserPredecodePages")
    preload.browserPredecodePages = browserPredecodePages
    performance.browser_predecode_pages = browserPredecodePages
  }
  if (Object.keys(preload).length === 0) throw new Error("reader preload patch must change at least one field.")
  return {
    patch: { preload },
    tomlPatch: { performance },
  }
}

function parseSuperResolutionConfig(value: Record<string, unknown> | undefined): Models.NeoviewSuperResolutionConfig {
  if (!value) return Models.DEFAULT_NEOVIEW_SUPER_RESOLUTION_CONFIG
  const artifactCache = optionalRecord(value.artifact_cache, "[nodes.neoview.super_resolution.artifact_cache]")
  return {
    provider:
      optionalEnum(value.provider, "[nodes.neoview.super_resolution].provider", ["opencomic-system", "disabled"] as const) ??
      Models.DEFAULT_NEOVIEW_SUPER_RESOLUTION_CONFIG.provider,
    upscaylPath: optionalConfigPath(value.upscayl_path, "[nodes.neoview.super_resolution].upscayl_path"),
    waifu2xPath: optionalConfigPath(value.waifu2x_path, "[nodes.neoview.super_resolution].waifu2x_path"),
    realcuganPath: optionalConfigPath(value.realcugan_path, "[nodes.neoview.super_resolution].realcugan_path"),
    modelsDirectory: optionalConfigPath(value.models_directory, "[nodes.neoview.super_resolution].models_directory"),
    modelSources: parseSuperResolutionModelSources(value.model_sources, "[nodes.neoview.super_resolution].model_sources"),
    maxDaemonsPerGpu: boundedIntegerWithFallback(
      value.max_daemons_per_gpu,
      0,
      8,
      Models.DEFAULT_NEOVIEW_SUPER_RESOLUTION_CONFIG.maxDaemonsPerGpu,
      "[nodes.neoview.super_resolution].max_daemons_per_gpu",
    ),
    daemonIdleTimeoutMs: boundedIntegerWithFallback(
      value.daemon_idle_timeout_ms,
      1_000,
      3_600_000,
      Models.DEFAULT_NEOVIEW_SUPER_RESOLUTION_CONFIG.daemonIdleTimeoutMs,
      "[nodes.neoview.super_resolution].daemon_idle_timeout_ms",
    ),
    taskTimeoutMs: boundedIntegerWithFallback(
      value.task_timeout_ms,
      1_000,
      24 * 60 * 60_000,
      Models.DEFAULT_NEOVIEW_SUPER_RESOLUTION_CONFIG.taskTimeoutMs,
      "[nodes.neoview.super_resolution].task_timeout_ms",
    ),
    artifactCache: {
      directory: optionalConfigPath(artifactCache?.directory, "[nodes.neoview.super_resolution.artifact_cache].directory"),
      retentionDays: boundedIntegerWithFallback(
        artifactCache?.retention_days,
        1,
        3_650,
        Models.DEFAULT_NEOVIEW_SUPER_RESOLUTION_CONFIG.artifactCache.retentionDays,
        "[nodes.neoview.super_resolution.artifact_cache].retention_days",
      ),
      cleanupIntervalMinutes: boundedIntegerWithFallback(
        artifactCache?.cleanup_interval_minutes,
        1,
        10_080,
        Models.DEFAULT_NEOVIEW_SUPER_RESOLUTION_CONFIG.artifactCache.cleanupIntervalMinutes,
        "[nodes.neoview.super_resolution.artifact_cache].cleanup_interval_minutes",
      ),
    },
    customModels: parseSuperResolutionCustomModels(value.custom_models),
    preferences: parseSuperResolutionPreferences(value.preferences),
  }
}

function parseColorFilterConfig(value: Record<string, unknown> | undefined): ReaderColorFilterSettings {
  if (!value) return DEFAULT_READER_COLOR_FILTER
  return normalizeReaderColorFilter({
    colorizeEnabled: value.colorize_enabled,
    colorizePreset: value.colorize_preset,
    customColors: value.custom_colors,
    onlyBlackAndWhite: value.only_black_and_white,
    brightness: value.brightness,
    contrast: value.contrast,
    saturation: value.saturation,
    sepia: value.sepia,
    hueRotate: value.hue_rotate,
    invert: value.invert,
    negative: value.negative,
  })
}

function parsePageTransitionConfig(value: Record<string, unknown> | undefined): ReaderPageTransitionSettings {
  if (!value) return DEFAULT_READER_PAGE_TRANSITION
  return normalizeReaderPageTransition({
    enabled: value.enabled,
    type: value.type,
    duration: value.duration,
    easing: value.easing,
  })
}

function parseSwitchToastConfig(value: Record<string, unknown> | undefined, legacy: { showBookSwitchToast?: unknown }): ReaderSwitchToastSettings {
  if (!value) return normalizeReaderSwitchToast(undefined, legacy)
  return normalizeReaderSwitchToast(
    {
      enableBook: value.enable_book ?? value.enableBook,
      enablePage: value.enable_page ?? value.enablePage,
      enableAction: value.enable_action ?? value.enableAction,
      enableBoundaryToast: value.enable_boundary_toast ?? value.enableBoundaryToast,
      showBookPath: value.show_book_path ?? value.showBookPath,
      showBookPageProgress: value.show_book_page_progress ?? value.showBookPageProgress,
      showBookType: value.show_book_type ?? value.showBookType,
      showPageIndex: value.show_page_index ?? value.showPageIndex,
      showPageSize: value.show_page_size ?? value.showPageSize,
      showPageDimensions: value.show_page_dimensions ?? value.showPageDimensions,
      bookTitleTemplate: value.book_title_template ?? value.bookTitleTemplate,
      bookDescriptionTemplate: value.book_description_template ?? value.bookDescriptionTemplate,
      pageTitleTemplate: value.page_title_template ?? value.pageTitleTemplate,
      pageDescriptionTemplate: value.page_description_template ?? value.pageDescriptionTemplate,
      positionX: value.position_x ?? value.positionX,
      positionY: value.position_y ?? value.positionY,
      opacity: value.opacity,
      liquidGlass: value.liquid_glass ?? value.liquidGlass,
    },
    legacy,
  )
}

function parseSuperResolutionModelSources(value: unknown, path: string): readonly string[] {
  if (value === undefined) return Models.DEFAULT_NEOVIEW_SUPER_RESOLUTION_CONFIG.modelSources
  if (!Array.isArray(value) || value.length > 32) throw new Error(`${path} must be an array of at most 32 paths.`)
  const sources = value.map((entry, index) => {
    const source = optionalConfigPath(entry, `${path}[${index}]`)
    if (!source) throw new Error(`${path}[${index}] must not be empty.`)
    return source
  })
  return Object.freeze([...new Set(sources)])
}

function parseSuperResolutionCustomModels(value: unknown): readonly SuperResolutionCustomModelManifest[] {
  if (value === undefined) return Models.DEFAULT_NEOVIEW_SUPER_RESOLUTION_CONFIG.customModels
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
    const scaleFiles = model.scale_files === undefined ? undefined : requiredManifestScaleFiles(model.scale_files, scales, `${path}.scale_files`)
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

function parseMediaConfig(image: Record<string, unknown> | undefined, subtitle: Record<string, unknown> | undefined): Models.NeoviewMediaConfig {
  const formats = new ReaderMediaFormatRegistry({
    supportedImageFormats: optionalStringArray(
      image?.supported_formats,
      Models.DEFAULT_NEOVIEW_MEDIA_CONFIG.supportedImageFormats,
      "[nodes.neoview.image].supported_formats",
    ),
    videoFormats: optionalStringArray(image?.video_formats, Models.DEFAULT_NEOVIEW_MEDIA_CONFIG.videoFormats, "[nodes.neoview.image].video_formats"),
    mediaMimeTypes: optionalStringRecord(image?.media_mime_types, Models.DEFAULT_NEOVIEW_MEDIA_CONFIG.mediaMimeTypes, "[nodes.neoview.image].media_mime_types"),
  })
  const videoMinPlaybackRate = boundedNumber(
    image?.video_min_playback_rate,
    0.05,
    64,
    Models.DEFAULT_NEOVIEW_MEDIA_CONFIG.videoMinPlaybackRate,
    "[nodes.neoview.image].video_min_playback_rate",
  )
  const videoMaxPlaybackRate = boundedNumber(
    image?.video_max_playback_rate,
    0.05,
    64,
    Models.DEFAULT_NEOVIEW_MEDIA_CONFIG.videoMaxPlaybackRate,
    "[nodes.neoview.image].video_max_playback_rate",
  )
  if (videoMaxPlaybackRate < videoMinPlaybackRate) {
    throw new Error("[nodes.neoview.image].video_max_playback_rate must not be less than video_min_playback_rate.")
  }
  return {
    supportedImageFormats: formats.supportedImageFormats,
    videoFormats: formats.videoFormats,
    mediaMimeTypes: formats.mediaMimeTypes,
    autoPlayAnimatedImages:
      optionalBoolean(image?.auto_play_animated_images, "[nodes.neoview.image].auto_play_animated_images") ??
      Models.DEFAULT_NEOVIEW_MEDIA_CONFIG.autoPlayAnimatedImages,
    animatedVideoEnabled:
      optionalBoolean(image?.animated_video_enabled, "[nodes.neoview.image].animated_video_enabled") ??
      Models.DEFAULT_NEOVIEW_MEDIA_CONFIG.animatedVideoEnabled,
    animatedVideoKeywords: normalizeReaderAnimatedVideoKeywords(image?.animated_video_keywords),
    videoMinPlaybackRate,
    videoMaxPlaybackRate,
    videoPlaybackRateStep: boundedNumber(
      image?.video_playback_rate_step,
      0.01,
      4,
      Models.DEFAULT_NEOVIEW_MEDIA_CONFIG.videoPlaybackRateStep,
      "[nodes.neoview.image].video_playback_rate_step",
    ),
    subtitle: {
      fontSize: boundedNumber(subtitle?.font_size, 0.5, 3, Models.DEFAULT_NEOVIEW_MEDIA_CONFIG.subtitle.fontSize, "[nodes.neoview.reader.subtitle].font_size"),
      color: normalizedSubtitleColor(subtitle?.color, "[nodes.neoview.reader.subtitle].color", Models.DEFAULT_NEOVIEW_MEDIA_CONFIG.subtitle.color),
      backgroundOpacity: boundedNumber(
        subtitle?.bg_opacity,
        0,
        1,
        Models.DEFAULT_NEOVIEW_MEDIA_CONFIG.subtitle.backgroundOpacity,
        "[nodes.neoview.reader.subtitle].bg_opacity",
      ),
      bottomPercent: boundedNumber(
        subtitle?.bottom,
        0,
        30,
        Models.DEFAULT_NEOVIEW_MEDIA_CONFIG.subtitle.bottomPercent,
        "[nodes.neoview.reader.subtitle].bottom",
      ),
    },
  }
}

export function parseNeoviewMediaPatch(
  value: unknown,
  current: Models.NeoviewMediaConfig = Models.DEFAULT_NEOVIEW_MEDIA_CONFIG,
): { patch: Models.NeoviewMediaPatch; tomlPatch: Record<string, unknown> } {
  const record = requireRecord(value, "reader media patch")
  if (Object.keys(record).some((key) => key !== "media")) throw new Error("reader media patch contains unsupported fields.")
  const media = requireRecord(record.media, "reader media patch.media")
  const allowed = new Set([
    "supportedImageFormats",
    "videoFormats",
    "mediaMimeTypes",
    "autoPlayAnimatedImages",
    "animatedVideoEnabled",
    "animatedVideoKeywords",
    "videoMinPlaybackRate",
    "videoMaxPlaybackRate",
    "videoPlaybackRateStep",
    "subtitle",
  ])
  const unknown = Object.keys(media).filter((key) => !allowed.has(key))
  if (unknown.length) throw new Error(`reader media patch contains unsupported fields: ${unknown.join(", ")}.`)
  const patch: Models.NeoviewMediaPatch = { media: {} }
  const imageToml: Record<string, unknown> = {}
  const readerToml: Record<string, unknown> = {}
  if (media.supportedImageFormats !== undefined || media.videoFormats !== undefined || media.mediaMimeTypes !== undefined) {
    const formats = new ReaderMediaFormatRegistry({
      supportedImageFormats:
        media.supportedImageFormats === undefined
          ? current.supportedImageFormats
          : requiredStringArray(media.supportedImageFormats, "reader media patch.supportedImageFormats"),
      videoFormats: media.videoFormats === undefined ? current.videoFormats : requiredStringArray(media.videoFormats, "reader media patch.videoFormats"),
      mediaMimeTypes:
        media.mediaMimeTypes === undefined ? current.mediaMimeTypes : requiredStringRecord(media.mediaMimeTypes, "reader media patch.mediaMimeTypes"),
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
  if (media.animatedVideoEnabled !== undefined) {
    patch.media.animatedVideoEnabled = requiredBoolean(media.animatedVideoEnabled, "reader media patch.animatedVideoEnabled")
    imageToml.animated_video_enabled = patch.media.animatedVideoEnabled
  }
  if (media.animatedVideoKeywords !== undefined) {
    patch.media.animatedVideoKeywords = normalizeReaderAnimatedVideoKeywords(media.animatedVideoKeywords)
    imageToml.animated_video_keywords = patch.media.animatedVideoKeywords
  }
  if (media.videoMinPlaybackRate !== undefined) {
    patch.media.videoMinPlaybackRate = boundedNumber(
      media.videoMinPlaybackRate,
      0.05,
      64,
      current.videoMinPlaybackRate,
      "reader media patch.videoMinPlaybackRate",
    )
    imageToml.video_min_playback_rate = patch.media.videoMinPlaybackRate
  }
  if (media.videoMaxPlaybackRate !== undefined) {
    patch.media.videoMaxPlaybackRate = boundedNumber(
      media.videoMaxPlaybackRate,
      0.05,
      64,
      current.videoMaxPlaybackRate,
      "reader media patch.videoMaxPlaybackRate",
    )
    imageToml.video_max_playback_rate = patch.media.videoMaxPlaybackRate
  }
  if (media.videoPlaybackRateStep !== undefined) {
    patch.media.videoPlaybackRateStep = boundedNumber(
      media.videoPlaybackRateStep,
      0.01,
      4,
      current.videoPlaybackRateStep,
      "reader media patch.videoPlaybackRateStep",
    )
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
    const subtitlePatch: Partial<Models.NeoviewSubtitleConfig> = {}
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
      subtitlePatch.backgroundOpacity = boundedNumber(
        subtitle.backgroundOpacity,
        0,
        1,
        current.subtitle.backgroundOpacity,
        "reader media patch.subtitle.backgroundOpacity",
      )
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

export function parseNeoviewColorFilterPatch(value: unknown): {
  patch: Models.NeoviewColorFilterPatch
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader color filter patch")
  if (Object.keys(record).some((key) => key !== "colorFilter")) {
    throw new Error("reader color filter patch contains unsupported fields.")
  }
  const colorFilter = requireRecord(record.colorFilter, "reader color filter patch.colorFilter")
  if (colorFilter.reset !== undefined) {
    if (colorFilter.reset !== "defaults") {
      throw new Error('reader color filter patch.reset must be "defaults".')
    }
    if (Object.keys(colorFilter).length !== 1) {
      throw new Error("reader color filter patch.reset cannot be combined with other fields.")
    }
    return {
      patch: { colorFilter: { reset: "defaults" } },
      tomlPatch: {
        image: { color_filter: colorFilterToml(DEFAULT_READER_COLOR_FILTER) },
      },
    }
  }
  const settings = parseReaderColorFilterPatch(colorFilter)
  if (!Object.keys(settings).length) throw new Error("reader color filter patch must change at least one field.")
  return {
    patch: { colorFilter: settings },
    tomlPatch: { image: { color_filter: colorFilterToml(settings) } },
  }
}

export function parseNeoviewSuperResolutionPreferencesPatch(value: unknown): {
  patch: { superResolution: Models.NeoviewSuperResolutionPatch }
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader super-resolution patch")
  if (Object.keys(record).some((key) => key !== "superResolution")) {
    throw new Error("reader super-resolution patch contains unsupported fields.")
  }
  const root = requireRecord(record.superResolution, "reader super-resolution patch.superResolution")
  if (Object.keys(root).some((key) => key !== "preferences" && key !== "modelsDirectory" && key !== "modelSources" && key !== "artifactCache")) {
    throw new Error("reader super-resolution patch.superResolution contains unsupported fields.")
  }
  const rootPatch: Models.NeoviewSuperResolutionPatch = {}
  const rootToml: Record<string, unknown> = {}
  if (root.modelsDirectory !== undefined) {
    const modelsDirectory = optionalConfigPath(root.modelsDirectory, "reader super-resolution patch.superResolution.modelsDirectory")
    if (!modelsDirectory) throw new Error("reader super-resolution patch.superResolution.modelsDirectory must not be empty.")
    rootPatch.modelsDirectory = modelsDirectory
    rootToml.models_directory = modelsDirectory
  }
  if (root.modelSources !== undefined) {
    const modelSources = parseSuperResolutionModelSources(root.modelSources, "reader super-resolution patch.superResolution.modelSources")
    rootPatch.modelSources = modelSources
    rootToml.model_sources = modelSources
  }
  if (root.artifactCache !== undefined) {
    const cache = requireRecord(root.artifactCache, "reader super-resolution patch.superResolution.artifactCache")
    const unknown = Object.keys(cache).filter((key) => key !== "directory" && key !== "retentionDays" && key !== "cleanupIntervalMinutes")
    if (unknown.length) throw new Error(`reader super-resolution artifact cache patch contains unsupported fields: ${unknown.join(", ")}.`)
    const cachePatch: Partial<Models.NeoviewSuperResolutionArtifactCacheConfig> = {}
    const cacheToml: Record<string, unknown> = {}
    if (cache.directory !== undefined) {
      const directory = optionalConfigPath(cache.directory, "reader super-resolution patch.superResolution.artifactCache.directory")
      cachePatch.directory = directory
      cacheToml.directory = directory ?? null
    }
    if (cache.retentionDays !== undefined) {
      cachePatch.retentionDays = boundedInteger(cache.retentionDays, 1, 3_650, "reader super-resolution patch.superResolution.artifactCache.retentionDays")
      cacheToml.retention_days = cachePatch.retentionDays
    }
    if (cache.cleanupIntervalMinutes !== undefined) {
      cachePatch.cleanupIntervalMinutes = boundedInteger(
        cache.cleanupIntervalMinutes,
        1,
        10_080,
        "reader super-resolution patch.superResolution.artifactCache.cleanupIntervalMinutes",
      )
      cacheToml.cleanup_interval_minutes = cachePatch.cleanupIntervalMinutes
    }
    if (!Object.keys(cacheToml).length) throw new Error("reader super-resolution artifact cache patch must change at least one field.")
    rootPatch.artifactCache = cachePatch
    rootToml.artifact_cache = cacheToml
  }
  if (root.preferences === undefined) {
    if (!Object.keys(rootPatch).length) throw new Error("reader super-resolution patch must change at least one field.")
    return {
      patch: { superResolution: rootPatch },
      tomlPatch: { super_resolution: rootToml },
    }
  }
  const preferences = requireRecord(root.preferences, "reader super-resolution patch.superResolution.preferences")
  const allowed = new Set([
    "autoUpscaleEnabled",
    "preUpscaleEnabled",
    "globalUpscaleEnabled",
    "currentImageUpscaleEnabled",
    "preloadPages",
    "backgroundConcurrency",
    "showPanelPreview",
    "defaultModelId",
    "defaultScale",
    "defaultTileSize",
    "defaultTileEnabled",
    "defaultNoise",
    "defaultGpuId",
    "defaultTta",
    "progressiveEnabled",
    "progressiveDwellTimeMs",
    "progressiveMaxPages",
    "conditionalEnabled",
    "conditionalMinWidth",
    "conditionalMinHeight",
    "conditions",
  ])
  if (Object.keys(preferences).some((key) => !allowed.has(key))) {
    throw new Error("reader super-resolution preferences patch contains unsupported fields.")
  }
  const patch: Models.NeoviewSuperResolutionPreferencesPatch = {}
  const toml: Record<string, unknown> = { schema_version: 1 }
  const booleanFields = [
    ["autoUpscaleEnabled", "auto_upscale_enabled"],
    ["preUpscaleEnabled", "pre_upscale_enabled"],
    ["globalUpscaleEnabled", "global_upscale_enabled"],
    ["currentImageUpscaleEnabled", "current_image_upscale_enabled"],
    ["showPanelPreview", "show_panel_preview"],
    ["defaultTileEnabled", "default_tile_enabled"],
    ["defaultTta", "default_tta"],
    ["progressiveEnabled", "progressive_enabled"],
    ["conditionalEnabled", "conditional_enabled"],
  ] as const
  for (const [field, tomlField] of booleanFields) {
    if (preferences[field] !== undefined) {
      const parsed = optionalBoolean(preferences[field], `reader super-resolution preferences.${field}`)
      if (parsed === undefined) throw new Error(`reader super-resolution preferences.${field} must be a boolean.`)
      patch[field] = parsed
      toml[tomlField] = parsed
    }
  }
  const integerFields = [
    ["preloadPages", "preload_pages", 0, 1_000],
    ["backgroundConcurrency", "background_concurrency", 1, 32],
    ["defaultScale", "default_scale", 1, 32],
    ["defaultTileSize", "default_tile_size", 1, 65_536],
    ["defaultNoise", "default_noise", -1, 3],
    ["progressiveDwellTimeMs", "progressive_dwell_time_ms", 0, 3_600_000],
    ["progressiveMaxPages", "progressive_max_pages", 0, 10_000],
  ] as const
  for (const [field, tomlField, min, max] of integerFields) {
    if (preferences[field] !== undefined) {
      const parsed = boundedInteger(preferences[field], min, max, `reader super-resolution preferences.${field}`)
      patch[field] = parsed
      toml[tomlField] = parsed
    }
  }
  const directFields = [
    ["defaultModelId", "default_model_id"],
    ["defaultGpuId", "default_gpu_id"],
    ["conditionalMinWidth", "conditional_min_width"],
    ["conditionalMinHeight", "conditional_min_height"],
  ] as const
  for (const [field, tomlField] of directFields) {
    if (preferences[field] !== undefined) toml[tomlField] = preferences[field]
  }
  if (preferences.conditions !== undefined) {
    toml.conditions = superResolutionConditionsToml(preferences.conditions)
  }
  let parsed: SuperResolutionPreferences
  try {
    parsed = parseSuperResolutionPreferences(toml)
  } catch (error) {
    throw new Error(`reader super-resolution preferences patch is invalid: ${error instanceof Error ? error.message : String(error)}`)
  }
  for (const [field] of directFields) {
    if (preferences[field] !== undefined) Object.assign(patch, { [field]: parsed[field] })
  }
  if (preferences.conditions !== undefined) patch.conditions = parsed.conditions
  if (!Object.keys(patch).length) throw new Error("reader super-resolution preferences patch must change at least one field.")
  rootPatch.preferences = patch
  rootToml.preferences = toml
  return {
    patch: { superResolution: rootPatch },
    tomlPatch: { super_resolution: rootToml },
  }
}

function superResolutionConditionsToml(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("reader super-resolution preferences.conditions must be an array.")
  return value.map((condition, index) => {
    const path = `reader super-resolution preferences.conditions[${index}]`
    const root = remapSuperResolutionFields(condition, path, {
      id: "id",
      name: "name",
      enabled: "enabled",
      priority: "priority",
      match: "match",
      action: "action",
    })
    root.match = remapSuperResolutionFields(root.match, `${path}.match`, {
      minWidth: "min_width",
      minHeight: "min_height",
      maxWidth: "max_width",
      maxHeight: "max_height",
      minMegapixels: "min_megapixels",
      maxMegapixels: "max_megapixels",
      dimensionMode: "dimension_mode",
      createdBetween: "created_between",
      modifiedBetween: "modified_between",
      bookPathRegex: "book_path_regex",
      imagePathRegex: "image_path_regex",
      matchInnerPath: "match_inner_path",
      excludeFromPreload: "exclude_from_preload",
      metadata: "metadata",
    })
    root.action = remapSuperResolutionFields(root.action, `${path}.action`, {
      skip: "skip",
      modelId: "model_id",
      scale: "scale",
      tileSize: "tile_size",
      tileEnabled: "tile_enabled",
      noise: "noise",
      gpuId: "gpu_id",
      useCache: "use_cache",
      tta: "tta",
    })
    return root
  })
}

function remapSuperResolutionFields(value: unknown, path: string, fields: Readonly<Record<string, string>>): Record<string, unknown> {
  const record = requireRecord(value, path)
  const unsupported = Object.keys(record).find((key) => fields[key] === undefined)
  if (unsupported) throw new Error(`${path} contains unsupported field: ${unsupported}`)
  return Object.fromEntries(Object.entries(record).map(([key, fieldValue]) => [fields[key]!, fieldValue]))
}

export function parseNeoviewPageTransitionPatch(value: unknown): {
  patch: Models.NeoviewPageTransitionPatch
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader page transition patch")
  if (Object.keys(record).some((key) => key !== "pageTransition")) {
    throw new Error("reader page transition patch contains unsupported fields.")
  }
  const pageTransition = requireRecord(record.pageTransition, "reader page transition patch.pageTransition")
  if (pageTransition.reset !== undefined) {
    if (pageTransition.reset !== "defaults") {
      throw new Error('reader page transition patch.reset must be "defaults".')
    }
    if (Object.keys(pageTransition).length !== 1) {
      throw new Error("reader page transition patch.reset cannot be combined with other fields.")
    }
    return {
      patch: { pageTransition: { reset: "defaults" } },
      tomlPatch: {
        image: {
          page_transition: pageTransitionToml(DEFAULT_READER_PAGE_TRANSITION),
        },
      },
    }
  }
  const settings = parseReaderPageTransitionPatch(pageTransition)
  if (!Object.keys(settings).length) throw new Error("reader page transition patch must change at least one field.")
  return {
    patch: { pageTransition: settings },
    tomlPatch: { image: { page_transition: pageTransitionToml(settings) } },
  }
}

export function parseNeoviewSwitchToastPatch(value: unknown): {
  patch: Models.NeoviewSwitchToastPatch
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader switch toast patch")
  if (Object.keys(record).some((key) => key !== "switchToast")) {
    throw new Error("reader switch toast patch contains unsupported fields.")
  }
  const switchToast = requireRecord(record.switchToast, "reader switch toast patch.switchToast")
  if (switchToast.reset !== undefined) {
    if (switchToast.reset !== "defaults") {
      throw new Error('reader switch toast patch.reset must be "defaults".')
    }
    if (Object.keys(switchToast).length !== 1) {
      throw new Error("reader switch toast patch.reset cannot be combined with other fields.")
    }
    return {
      patch: { switchToast: { reset: "defaults" } },
      tomlPatch: {
        view: { switch_toast: switchToastToml(DEFAULT_READER_SWITCH_TOAST) },
      },
    }
  }
  const settings = parseReaderSwitchToastPatch(switchToast)
  if (!Object.keys(settings).length) throw new Error("reader switch toast patch must change at least one field.")
  return {
    patch: { switchToast: settings },
    tomlPatch: { view: { switch_toast: switchToastToml(settings) } },
  }
}

export function parseNeoviewInfoOverlayPatch(value: unknown): {
  patch: Models.NeoviewInfoOverlayPatch
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader info overlay patch")
  if (Object.keys(record).some((key) => key !== "infoOverlay")) {
    throw new Error("reader info overlay patch contains unsupported fields.")
  }
  const infoOverlay = requireRecord(record.infoOverlay, "reader info overlay patch.infoOverlay")
  const mutation = parseReaderInfoOverlayPatch(infoOverlay)
  const toml = infoOverlayToml(mutation)
  if ("reset" in mutation) {
    return {
      patch: { infoOverlay: { reset: "defaults" } },
      tomlPatch: { view: { info_overlay: toml } },
    }
  }
  return {
    patch: { infoOverlay: mutation },
    tomlPatch: { view: { info_overlay: toml } },
  }
}

export function parseNeoviewImageTrimPatch(
  value: unknown,
  current?: ReaderImageTrimSettings,
): {
  patch: Models.NeoviewImageTrimPatch
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader image trim patch")
  if (Object.keys(record).some((key) => key !== "imageTrim")) {
    throw new Error("reader image trim patch contains unsupported fields.")
  }
  const imageTrim = requireRecord(record.imageTrim, "reader image trim patch.imageTrim")
  const mutation = parseReaderImageTrimPatch(imageTrim)
  const toml: Record<string, unknown> = {}
  if ("reset" in mutation) {
    Object.assign(toml, imageTrimToml(DEFAULT_READER_IMAGE_TRIM))
    return {
      patch: { imageTrim: { reset: "defaults" } },
      tomlPatch: { view: { image_trim: toml } },
    }
  }
  const projected = current ? projectReaderImageTrimPatch(current, mutation) : mutation
  Object.assign(toml, imageTrimToml(projected))
  return {
    patch: { imageTrim: projected },
    tomlPatch: { view: { image_trim: toml } },
  }
}

function imageTrimToml(value: ReaderImageTrimPatch | ReaderImageTrimSettings): Record<string, unknown> {
  const toml: Record<string, unknown> = {}
  if (value.enabled !== undefined) toml.enabled = value.enabled
  if (value.top !== undefined) toml.top = value.top
  if (value.bottom !== undefined) toml.bottom = value.bottom
  if (value.left !== undefined) toml.left = value.left
  if (value.right !== undefined) toml.right = value.right
  if (value.linkVertical !== undefined) toml.link_vertical = value.linkVertical
  if (value.linkHorizontal !== undefined) toml.link_horizontal = value.linkHorizontal
  if (value.autoTrimThreshold !== undefined) toml.auto_trim_threshold = value.autoTrimThreshold
  if (value.autoTrimTarget !== undefined) toml.auto_trim_target = value.autoTrimTarget
  return toml
}

function infoOverlayToml(value: ReaderInfoOverlayPatch | { reset: "defaults" }): Record<string, unknown> {
  if ("reset" in value) {
    return infoOverlayToml(DEFAULT_READER_INFO_OVERLAY)
  }
  const toml: Record<string, unknown> = {}
  if (value.enabled !== undefined) toml.enabled = value.enabled
  if (value.opacity !== undefined) toml.opacity = value.opacity
  if (value.showBorder !== undefined) toml.show_border = value.showBorder
  if (value.width !== undefined) toml.width = value.width === null ? "auto" : value.width
  if (value.height !== undefined) toml.height = value.height === null ? "auto" : value.height
  return toml
}

function switchToastToml(value: ReaderSwitchToastPatch): Record<string, unknown> {
  const toml: Record<string, unknown> = {}
  if (value.enableBook !== undefined) toml.enable_book = value.enableBook
  if (value.enablePage !== undefined) toml.enable_page = value.enablePage
  if (value.enableAction !== undefined) toml.enable_action = value.enableAction
  if (value.enableBoundaryToast !== undefined) toml.enable_boundary_toast = value.enableBoundaryToast
  if (value.showBookPath !== undefined) toml.show_book_path = value.showBookPath
  if (value.showBookPageProgress !== undefined) toml.show_book_page_progress = value.showBookPageProgress
  if (value.showBookType !== undefined) toml.show_book_type = value.showBookType
  if (value.showPageIndex !== undefined) toml.show_page_index = value.showPageIndex
  if (value.showPageSize !== undefined) toml.show_page_size = value.showPageSize
  if (value.showPageDimensions !== undefined) toml.show_page_dimensions = value.showPageDimensions
  if (value.bookTitleTemplate !== undefined) toml.book_title_template = value.bookTitleTemplate
  if (value.bookDescriptionTemplate !== undefined) toml.book_description_template = value.bookDescriptionTemplate
  if (value.pageTitleTemplate !== undefined) toml.page_title_template = value.pageTitleTemplate
  if (value.pageDescriptionTemplate !== undefined) toml.page_description_template = value.pageDescriptionTemplate
  if (value.positionX !== undefined) toml.position_x = value.positionX
  if (value.positionY !== undefined) toml.position_y = value.positionY
  if (value.opacity !== undefined) toml.opacity = value.opacity
  if (value.liquidGlass !== undefined) toml.liquid_glass = value.liquidGlass
  return toml
}

function pageTransitionToml(value: ReaderPageTransitionPatch): Record<string, unknown> {
  const toml: Record<string, unknown> = {}
  if (value.enabled !== undefined) toml.enabled = value.enabled
  if (value.type !== undefined) toml.type = value.type
  if (value.duration !== undefined) toml.duration = value.duration
  if (value.easing !== undefined) toml.easing = value.easing
  return toml
}

function colorFilterToml(value: ReaderColorFilterPatch): Record<string, unknown> {
  const toml: Record<string, unknown> = {}
  if (value.colorizeEnabled !== undefined) toml.colorize_enabled = value.colorizeEnabled
  if (value.colorizePreset !== undefined) toml.colorize_preset = value.colorizePreset
  if (value.customColors !== undefined) toml.custom_colors = value.customColors.map((point) => ({ ...point }))
  if (value.onlyBlackAndWhite !== undefined) toml.only_black_and_white = value.onlyBlackAndWhite
  if (value.brightness !== undefined) toml.brightness = value.brightness
  if (value.contrast !== undefined) toml.contrast = value.contrast
  if (value.saturation !== undefined) toml.saturation = value.saturation
  if (value.sepia !== undefined) toml.sepia = value.sepia
  if (value.hueRotate !== undefined) toml.hue_rotate = value.hueRotate
  if (value.invert !== undefined) toml.invert = value.invert
  if (value.negative !== undefined) toml.negative = value.negative
  return toml
}

function parseFileTreeConfig(value: Record<string, unknown> | undefined): Models.NeoviewFileTreeConfig {
  if (!value) return Models.DEFAULT_NEOVIEW_FILE_TREE_CONFIG
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
  patch: Models.NeoviewFolderViewPatch
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader folder view patch")
  if (Object.keys(record).some((key) => key !== "folderView")) throw new Error("reader folder view patch contains unsupported fields.")
  const folder = requireRecord(record.folderView, "reader folder view patch.folderView")
  const allowed = new Set([
    "homePath",
    "viewMode",
    "previewGridEnabled",
    "previewCount",
    "contentWidthPercent",
    "thumbnailWidthPercent",
    "bannerWidthPercent",
    "hoverPreviewEnabled",
    "hoverPreviewDelayMs",
    "typeFilter",
    "showHiddenFolders",
    "confirmDelete",
    "tagDisplay",
    "penetration",
    "emptyArea",
    "details",
    "search",
    "tree",
    "tabs",
  ])
  const unknown = Object.keys(folder).filter((key) => !allowed.has(key))
  if (unknown.length) throw new Error(`reader folder view patch contains unsupported fields: ${unknown.join(", ")}.`)
  const patch: Models.NeoviewFolderViewPatch = { folderView: {} }
  const toml: Record<string, unknown> = {}
  if (folder.homePath !== undefined) {
    patch.folderView.homePath = normalizedFolderHomePath(folder.homePath, "reader folder view patch.homePath")
    toml.home_path = patch.folderView.homePath
  }
  if (folder.viewMode !== undefined) {
    patch.folderView.viewMode = optionalEnum(folder.viewMode, "reader folder view patch.viewMode", Models.NEOVIEW_FOLDER_VIEW_MODES)
    toml.view_mode = patch.folderView.viewMode
  }
  if (folder.previewGridEnabled !== undefined) {
    patch.folderView.previewGridEnabled = optionalBoolean(folder.previewGridEnabled, "reader folder view patch.previewGridEnabled")
    toml.preview_grid_enabled = patch.folderView.previewGridEnabled
  }
  if (folder.previewCount !== undefined) {
    const count = boundedInteger(folder.previewCount, 4, 16, "reader folder view patch.previewCount")
    if (count !== 4 && count !== 9 && count !== 16) throw new Error("reader folder view patch.previewCount must be 4, 9 or 16.")
    patch.folderView.previewCount = count
    toml.preview_count = count
  }
  if (folder.contentWidthPercent !== undefined) {
    patch.folderView.contentWidthPercent = boundedInteger(folder.contentWidthPercent, 20, 70, "reader folder view patch.contentWidthPercent")
    toml.content_width_percent = patch.folderView.contentWidthPercent
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
  if (folder.hoverPreviewEnabled !== undefined) {
    patch.folderView.hoverPreviewEnabled = optionalBoolean(folder.hoverPreviewEnabled, "reader folder view patch.hoverPreviewEnabled")
    toml.hover_preview_enabled = patch.folderView.hoverPreviewEnabled
  }
  if (folder.hoverPreviewDelayMs !== undefined) {
    patch.folderView.hoverPreviewDelayMs = parseFolderHoverPreviewDelay(folder.hoverPreviewDelayMs, "reader folder view patch.hoverPreviewDelayMs")
    toml.hover_preview_delay_ms = patch.folderView.hoverPreviewDelayMs
  }
  if (folder.typeFilter !== undefined) {
    patch.folderView.typeFilter = optionalEnum(folder.typeFilter, "reader folder view patch.typeFilter", Models.NEOVIEW_FOLDER_TYPE_FILTERS)
    toml.type_filter = patch.folderView.typeFilter
  }
  if (folder.showHiddenFolders !== undefined) {
    patch.folderView.showHiddenFolders = optionalBoolean(folder.showHiddenFolders, "reader folder view patch.showHiddenFolders")
    toml.show_hidden_folders = patch.folderView.showHiddenFolders
  }
  if (folder.confirmDelete !== undefined) {
    patch.folderView.confirmDelete = optionalBoolean(folder.confirmDelete, "reader folder view patch.confirmDelete")
    toml.confirm_delete = patch.folderView.confirmDelete
  }
  if (folder.tagDisplay !== undefined) {
    const display = requireRecord(folder.tagDisplay, "reader folder view patch.tagDisplay")
    const allowedDisplay = new Set(["tagMode", "showRating", "showCollectTagCount", "showTags", "maxTags", "showTooltips"])
    const unknownDisplay = Object.keys(display).filter((key) => !allowedDisplay.has(key))
    if (unknownDisplay.length) throw new Error(`reader folder view patch.tagDisplay contains unsupported fields: ${unknownDisplay.join(", ")}.`)
    const displayPatch: Partial<Models.NeoviewFolderTagDisplayConfig> = {}
    const displayToml: Record<string, unknown> = {}
    if (display.tagMode !== undefined) {
      displayPatch.tagMode = optionalEnum(display.tagMode, "reader folder view patch.tagDisplay.tagMode", ["all", "collect", "none"])!
      displayToml.tag_mode = displayPatch.tagMode
    }
    for (const [key, tomlKey] of [
      ["showRating", "show_rating"],
      ["showCollectTagCount", "show_collect_tag_count"],
      ["showTags", "show_tags"],
      ["showTooltips", "show_tooltips"],
    ] as const) {
      if (display[key] === undefined) continue
      displayPatch[key] = requiredBoolean(display[key], `reader folder view patch.tagDisplay.${key}`)
      displayToml[tomlKey] = displayPatch[key]
    }
    if (display.maxTags !== undefined) {
      displayPatch.maxTags = boundedInteger(display.maxTags, 1, 12, "reader folder view patch.tagDisplay.maxTags")
      displayToml.max_tags = displayPatch.maxTags
    }
    if (!Object.keys(displayPatch).length) throw new Error("reader folder view patch.tagDisplay must change at least one field.")
    patch.folderView.tagDisplay = displayPatch
    toml.tag_display = displayToml
  }
  if (folder.penetration !== undefined) {
    const penetration = requireRecord(folder.penetration, "reader folder view patch.penetration")
    const allowedPenetration = new Set(["enabled", "showInternalFiles", "internalItemsMode", "maxDepth", "terminalTargets"])
    const unknownPenetration = Object.keys(penetration).filter((key) => !allowedPenetration.has(key))
    if (unknownPenetration.length) throw new Error(`reader folder view patch.penetration contains unsupported fields: ${unknownPenetration.join(", ")}.`)
    const penetrationPatch: Partial<Models.NeoviewFolderPenetrationConfig> = {}
    const penetrationToml: Record<string, unknown> = {}
    if (penetration.enabled !== undefined) {
      penetrationPatch.enabled = optionalBoolean(penetration.enabled, "reader folder view patch.penetration.enabled")
      penetrationToml.enabled = penetrationPatch.enabled
    }
    if (penetration.showInternalFiles !== undefined) {
      penetrationPatch.showInternalFiles = optionalBoolean(penetration.showInternalFiles, "reader folder view patch.penetration.showInternalFiles")
      penetrationToml.show_internal_files = penetrationPatch.showInternalFiles
    }
    if (penetration.internalItemsMode !== undefined) {
      penetrationPatch.internalItemsMode = optionalEnum(penetration.internalItemsMode, "reader folder view patch.penetration.internalItemsMode", ["single", "all"])
      penetrationToml.internal_items_mode = penetrationPatch.internalItemsMode
    }
    if (penetration.maxDepth !== undefined) {
      penetrationPatch.maxDepth = boundedInteger(penetration.maxDepth, 1, 32, "reader folder view patch.penetration.maxDepth")
      penetrationToml.max_depth = penetrationPatch.maxDepth
    }
    if (penetration.terminalTargets !== undefined) {
      penetrationPatch.terminalTargets = normalizedFolderPenetrationTargets(penetration.terminalTargets, "reader folder view patch.penetration.terminalTargets")
      penetrationToml.terminal_targets = penetrationPatch.terminalTargets
    }
    if (!Object.keys(penetrationPatch).length) throw new Error("reader folder view patch.penetration must change at least one field.")
    patch.folderView.penetration = penetrationPatch
    toml.penetration = penetrationToml
  }
  if (folder.emptyArea !== undefined) {
    const emptyArea = requireRecord(folder.emptyArea, "reader folder view patch.emptyArea")
    const allowedEmptyArea = new Set(["singleClickAction", "doubleClickAction", "showBackButton"])
    const unknownEmptyArea = Object.keys(emptyArea).filter((key) => !allowedEmptyArea.has(key))
    if (unknownEmptyArea.length) throw new Error(`reader folder view patch.emptyArea contains unsupported fields: ${unknownEmptyArea.join(", ")}.`)
    const emptyAreaPatch: Partial<Models.NeoviewFolderEmptyAreaConfig> = {}
    const emptyAreaToml: Record<string, unknown> = {}
    if (emptyArea.singleClickAction !== undefined) {
      emptyAreaPatch.singleClickAction = optionalEnum(
        emptyArea.singleClickAction,
        "reader folder view patch.emptyArea.singleClickAction",
        Models.NEOVIEW_FOLDER_EMPTY_AREA_ACTIONS,
      )
      emptyAreaToml.single_click_action = emptyAreaPatch.singleClickAction
    }
    if (emptyArea.doubleClickAction !== undefined) {
      emptyAreaPatch.doubleClickAction = optionalEnum(
        emptyArea.doubleClickAction,
        "reader folder view patch.emptyArea.doubleClickAction",
        Models.NEOVIEW_FOLDER_EMPTY_AREA_ACTIONS,
      )
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
    const detailPatch: Models.NeoviewFolderDetailsPatch = {}
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
    const searchPatch: Partial<Models.NeoviewFolderSearchConfig> = {}
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
    const treePatch: Partial<Models.NeoviewFolderTreeViewConfig> = {}
    const treeToml: Record<string, unknown> = {}
    if (tree.visible !== undefined) {
      treePatch.visible = optionalBoolean(tree.visible, "reader folder view patch.tree.visible")
      treeToml.visible = treePatch.visible
    }
    if (tree.layout !== undefined) {
      treePatch.layout = optionalEnum(tree.layout, "reader folder view patch.tree.layout", Models.NEOVIEW_FOLDER_TREE_LAYOUTS)
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
    const tabPatch: Partial<Models.NeoviewFolderTabsConfig> = {}
    const tabToml: Record<string, unknown> = {}
    if (tabs.pinned !== undefined) {
      tabPatch.pinned = normalizedPinnedTabs(tabs.pinned, "reader folder view patch.tabs.pinned")
      tabToml.pinned = tabPatch.pinned
    }
    if (tabs.layout !== undefined) {
      tabPatch.layout = optionalEnum(tabs.layout, "reader folder view patch.tabs.layout", Models.NEOVIEW_FOLDER_REGION_POSITIONS)
      tabToml.layout = tabPatch.layout
    }
    if (tabs.width !== undefined) {
      tabPatch.width = boundedInteger(tabs.width, 100, 400, "reader folder view patch.tabs.width")
      tabToml.width = tabPatch.width
    }
    if (tabs.breadcrumbPosition !== undefined) {
      tabPatch.breadcrumbPosition = optionalEnum(
        tabs.breadcrumbPosition,
        "reader folder view patch.tabs.breadcrumbPosition",
        Models.NEOVIEW_FOLDER_REGION_POSITIONS,
      )
      tabToml.breadcrumb_position = tabPatch.breadcrumbPosition
    }
    if (tabs.toolbarPosition !== undefined) {
      tabPatch.toolbarPosition = optionalEnum(tabs.toolbarPosition, "reader folder view patch.tabs.toolbarPosition", Models.NEOVIEW_FOLDER_REGION_POSITIONS)
      tabToml.toolbar_position = tabPatch.toolbarPosition
    }
    if (!Object.keys(tabPatch).length) throw new Error("reader folder view patch.tabs must change at least one field.")
    patch.folderView.tabs = tabPatch
    toml.tabs = tabToml
  }
  if (!Object.keys(patch.folderView).length) throw new Error("reader folder view patch must change at least one field.")
  return { patch, tomlPatch: { folder: toml } }
}

function parseFolderViewConfig(value: Record<string, unknown> | undefined): Models.NeoviewFolderViewConfig {
  if (!value) return Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG
  const details = optionalRecord(value.details, "[nodes.neoview.folder.details]")
  const search = optionalRecord(value.search, "[nodes.neoview.folder.search]")
  const emptyArea = optionalRecord(value.empty_area, "[nodes.neoview.folder.empty_area]")
  const tree = optionalRecord(value.tree_view, "[nodes.neoview.folder.tree_view]")
  const tabs = optionalRecord(value.tabs, "[nodes.neoview.folder.tabs]")
  const penetration = optionalRecord(value.penetration, "[nodes.neoview.folder.penetration]")
  const tagDisplay = optionalRecord(value.tag_display, "[nodes.neoview.folder.tag_display]")
  const hiddenColumns = normalizedDetailColumns(details?.hidden_columns ?? [], "[nodes.neoview.folder.details].hidden_columns", false, false).filter(
    (id) => id !== "name",
  )
  const pinnedLeft = normalizedDetailColumns(details?.pinned_left ?? ["name"], "[nodes.neoview.folder.details].pinned_left", false, false)
  const pinnedRight = normalizedDetailColumns(details?.pinned_right ?? [], "[nodes.neoview.folder.details].pinned_right", false, false).filter(
    (id) => !pinnedLeft.includes(id),
  )
  const previewCount =
    value.preview_count === undefined
      ? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.previewCount
      : boundedInteger(value.preview_count, 4, 16, "[nodes.neoview.folder].preview_count")
  if (previewCount !== 4 && previewCount !== 9 && previewCount !== 16) throw new Error("[nodes.neoview.folder].preview_count must be 4, 9 or 16.")
  const contentWidthPercent =
    value.content_width_percent === undefined
      ? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.contentWidthPercent
      : boundedInteger(value.content_width_percent, 20, 70, "[nodes.neoview.folder].content_width_percent")
  return {
    homePath:
      value.home_path === undefined
        ? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.homePath
        : normalizedFolderHomePath(value.home_path, "[nodes.neoview.folder].home_path"),
    viewMode:
      optionalEnum(value.view_mode, "[nodes.neoview.folder].view_mode", Models.NEOVIEW_FOLDER_VIEW_MODES) ?? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.viewMode,
    previewGridEnabled:
      optionalBoolean(value.preview_grid_enabled, "[nodes.neoview.folder].preview_grid_enabled") ??
      Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.previewGridEnabled,
    previewCount,
    contentWidthPercent,
    thumbnailWidthPercent:
      value.thumbnail_width_percent === undefined
        ? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.thumbnailWidthPercent
        : boundedInteger(value.thumbnail_width_percent, 10, 90, "[nodes.neoview.folder].thumbnail_width_percent"),
    bannerWidthPercent:
      value.banner_width_percent === undefined
        ? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.bannerWidthPercent
        : boundedInteger(value.banner_width_percent, 20, 100, "[nodes.neoview.folder].banner_width_percent"),
    hoverPreviewEnabled:
      optionalBoolean(value.hover_preview_enabled, "[nodes.neoview.folder].hover_preview_enabled") ??
      Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.hoverPreviewEnabled,
    hoverPreviewDelayMs:
      value.hover_preview_delay_ms === undefined
        ? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.hoverPreviewDelayMs
        : parseFolderHoverPreviewDelay(value.hover_preview_delay_ms, "[nodes.neoview.folder].hover_preview_delay_ms"),
    typeFilter:
      optionalEnum(value.type_filter, "[nodes.neoview.folder].type_filter", Models.NEOVIEW_FOLDER_TYPE_FILTERS) ??
      Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.typeFilter,
    showHiddenFolders:
      optionalBoolean(value.show_hidden_folders, "[nodes.neoview.folder].show_hidden_folders") ?? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.showHiddenFolders,
    confirmDelete: optionalBoolean(value.confirm_delete, "[nodes.neoview.folder].confirm_delete") ?? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.confirmDelete,
    tagDisplay: {
      tagMode:
        optionalEnum(tagDisplay?.tag_mode ?? tagDisplay?.tagMode, "[nodes.neoview.folder.tag_display].tag_mode", ["all", "collect", "none"]) ??
        Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.tagDisplay.tagMode,
      showRating:
        optionalBoolean(tagDisplay?.show_rating, "[nodes.neoview.folder.tag_display].show_rating") ??
        Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.tagDisplay.showRating,
      showCollectTagCount:
        optionalBoolean(tagDisplay?.show_collect_tag_count, "[nodes.neoview.folder.tag_display].show_collect_tag_count") ??
        Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.tagDisplay.showCollectTagCount,
      showTags:
        optionalBoolean(tagDisplay?.show_tags, "[nodes.neoview.folder.tag_display].show_tags") ?? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.tagDisplay.showTags,
      maxTags:
        tagDisplay?.max_tags === undefined
          ? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.tagDisplay.maxTags
          : boundedInteger(tagDisplay.max_tags, 1, 12, "[nodes.neoview.folder.tag_display].max_tags"),
      showTooltips:
        optionalBoolean(tagDisplay?.show_tooltips, "[nodes.neoview.folder.tag_display].show_tooltips") ??
        Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.tagDisplay.showTooltips,
    },
    penetration: {
      enabled:
        optionalBoolean(penetration?.enabled, "[nodes.neoview.folder.penetration].enabled") ?? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.penetration.enabled,
      showInternalFiles:
        optionalBoolean(penetration?.show_internal_files ?? penetration?.showInternalFiles, "[nodes.neoview.folder.penetration].show_internal_files") ?? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.penetration.showInternalFiles,
      internalItemsMode:
        optionalEnum(penetration?.internal_items_mode ?? penetration?.internalItemsMode, "[nodes.neoview.folder.penetration].internal_items_mode", ["single", "all"]) ?? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.penetration.internalItemsMode,
      maxDepth:
        penetration?.max_depth === undefined
          ? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.penetration.maxDepth
          : boundedInteger(penetration.max_depth, 1, 32, "[nodes.neoview.folder.penetration].max_depth"),
      terminalTargets:
        penetration?.terminal_targets === undefined
          ? [...Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.penetration.terminalTargets]
          : normalizedFolderPenetrationTargets(penetration.terminal_targets, "[nodes.neoview.folder.penetration].terminal_targets"),
    },
    emptyArea: {
      singleClickAction:
        optionalEnum(emptyArea?.single_click_action, "[nodes.neoview.folder.empty_area].single_click_action", Models.NEOVIEW_FOLDER_EMPTY_AREA_ACTIONS) ??
        Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.emptyArea.singleClickAction,
      doubleClickAction:
        optionalEnum(emptyArea?.double_click_action, "[nodes.neoview.folder.empty_area].double_click_action", Models.NEOVIEW_FOLDER_EMPTY_AREA_ACTIONS) ??
        Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.emptyArea.doubleClickAction,
      showBackButton:
        optionalBoolean(emptyArea?.show_back_button, "[nodes.neoview.folder.empty_area].show_back_button") ??
        Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.emptyArea.showBackButton,
    },
    details: {
      columnOrder: normalizedDetailColumns(
        details?.column_order ?? Models.NEOVIEW_FOLDER_DETAIL_COLUMNS,
        "[nodes.neoview.folder.details].column_order",
        true,
        false,
      ),
      hiddenColumns,
      pinnedLeft,
      pinnedRight,
      columnWidths: {
        ...Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.details.columnWidths,
        ...normalizedDetailWidths(details?.column_widths ?? {}, "[nodes.neoview.folder.details].column_widths", false),
      },
    },
    search: {
      includeSubfolders:
        optionalBoolean(search?.include_subfolders, "[nodes.neoview.folder.search].include_subfolders") ??
        Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.search.includeSubfolders,
      showHistoryOnFocus:
        optionalBoolean(search?.show_history_on_focus, "[nodes.neoview.folder.search].show_history_on_focus") ??
        Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.search.showHistoryOnFocus,
      searchInPath:
        optionalBoolean(search?.search_in_path, "[nodes.neoview.folder.search].search_in_path") ??
        Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.search.searchInPath,
    },
    tree: {
      visible: optionalBoolean(tree?.visible, "[nodes.neoview.folder.tree_view].visible") ?? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.tree.visible,
      layout:
        optionalEnum(tree?.layout, "[nodes.neoview.folder.tree_view].layout", Models.NEOVIEW_FOLDER_TREE_LAYOUTS) ??
        Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.tree.layout,
      size:
        tree?.size === undefined
          ? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.tree.size
          : boundedInteger(tree.size, 100, 500, "[nodes.neoview.folder.tree_view].size"),
      pinnedPaths: normalizedTreePinnedPaths(tree?.pinned_paths ?? [], "[nodes.neoview.folder.tree_view].pinned_paths"),
    },
    tabs: {
      pinned: normalizedPinnedTabs(tabs?.pinned ?? [], "[nodes.neoview.folder.tabs].pinned"),
      layout:
        optionalEnum(tabs?.layout, "[nodes.neoview.folder.tabs].layout", Models.NEOVIEW_FOLDER_REGION_POSITIONS) ??
        Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.tabs.layout,
      width:
        tabs?.width === undefined
          ? Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.tabs.width
          : boundedInteger(tabs.width, 100, 400, "[nodes.neoview.folder.tabs].width"),
      breadcrumbPosition:
        optionalEnum(tabs?.breadcrumb_position, "[nodes.neoview.folder.tabs].breadcrumb_position", Models.NEOVIEW_FOLDER_REGION_POSITIONS) ??
        Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.tabs.breadcrumbPosition,
      toolbarPosition:
        optionalEnum(tabs?.toolbar_position, "[nodes.neoview.folder.tabs].toolbar_position", Models.NEOVIEW_FOLDER_REGION_POSITIONS) ??
        Models.DEFAULT_NEOVIEW_FOLDER_VIEW_CONFIG.tabs.toolbarPosition,
    },
  }
}

function normalizedPinnedTabs(value: unknown, path: string): Models.NeoviewFolderPinnedTab[] {
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

function normalizedFolderPenetrationTargets(value: unknown, path: string): Models.NeoviewFolderPenetrationTarget[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > Models.NEOVIEW_FOLDER_PENETRATION_TARGETS.length) {
    throw new Error(`${path} must contain 1-${Models.NEOVIEW_FOLDER_PENETRATION_TARGETS.length} targets.`)
  }
  const targets: Models.NeoviewFolderPenetrationTarget[] = []
  for (const target of value) {
    if (typeof target !== "string" || !Models.NEOVIEW_FOLDER_PENETRATION_TARGETS.includes(target as Models.NeoviewFolderPenetrationTarget)) {
      throw new Error(`${path} contains an unsupported target.`)
    }
    if (targets.includes(target as Models.NeoviewFolderPenetrationTarget)) throw new Error(`${path} cannot contain duplicate targets.`)
    targets.push(target as Models.NeoviewFolderPenetrationTarget)
  }
  return targets
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

function normalizedDetailColumns(value: unknown, path: string, appendMissing: boolean, strict = true): Models.NeoviewFolderDetailColumn[] {
  if (!Array.isArray(value) || value.length > (strict ? Models.NEOVIEW_FOLDER_DETAIL_COLUMNS.length : 64))
    throw new Error(`${path} must be a bounded array of known column IDs.`)
  const known = new Set<string>(Models.NEOVIEW_FOLDER_DETAIL_COLUMNS)
  const result: Models.NeoviewFolderDetailColumn[] = []
  for (const item of value) {
    if (typeof item !== "string" || !known.has(item)) {
      if (strict) throw new Error(`${path} contains an unknown column ID.`)
      continue
    }
    const column = item as Models.NeoviewFolderDetailColumn
    if (!result.includes(column)) result.push(column)
  }
  if (appendMissing) for (const column of Models.NEOVIEW_FOLDER_DETAIL_COLUMNS) if (!result.includes(column)) result.push(column)
  return result
}

function normalizedDetailWidths(value: unknown, path: string, strict: boolean): Partial<Record<Models.NeoviewFolderDetailColumn, number>> {
  const record = requireRecord(value, path)
  const known = new Set<string>(Models.NEOVIEW_FOLDER_DETAIL_COLUMNS)
  const result: Partial<Record<Models.NeoviewFolderDetailColumn, number>> = {}
  for (const [id, width] of Object.entries(record)) {
    if (!known.has(id)) {
      if (strict) throw new Error(`${path} contains unknown column ${id}.`)
      continue
    }
    result[id as Models.NeoviewFolderDetailColumn] = boundedInteger(width, 48, 800, `${path}.${id}`)
  }
  if (strict && !Object.keys(result).length) throw new Error(`${path} must change at least one known column.`)
  return result
}

function parsePresentationDiskCache(value: Record<string, unknown> | undefined): Models.NeoviewPresentationDiskCacheConfig {
  if (!value) return Models.DEFAULT_NEOVIEW_PRESENTATION_DISK_CACHE_CONFIG
  const maxBytes = mebibytes(
    value.max_size_mb,
    64,
    65_536,
    Models.DEFAULT_NEOVIEW_PRESENTATION_DISK_CACHE_CONFIG.maxBytes,
    "[nodes.neoview.performance.presentation_disk_cache].max_size_mb",
  )
  const maxEntryBytes = mebibytes(
    value.max_entry_size_mb,
    1,
    256,
    Models.DEFAULT_NEOVIEW_PRESENTATION_DISK_CACHE_CONFIG.maxEntryBytes,
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
    maxAgeMs: boundedInteger(value.max_age_days ?? 30, 1, 3_650, "[nodes.neoview.performance.presentation_disk_cache].max_age_days") * 24 * 60 * 60 * 1000,
    trimRatio: boundedNumber(
      value.trim_ratio,
      0.5,
      0.95,
      Models.DEFAULT_NEOVIEW_PRESENTATION_DISK_CACHE_CONFIG.trimRatio,
      "[nodes.neoview.performance.presentation_disk_cache].trim_ratio",
    ),
    minFreeBytes: mebibytes(
      value.min_free_space_mb,
      0,
      65_536,
      Models.DEFAULT_NEOVIEW_PRESENTATION_DISK_CACHE_CONFIG.minFreeBytes,
      "[nodes.neoview.performance.presentation_disk_cache].min_free_space_mb",
    ),
  }
}

export function parseNeoviewSlideshowPatch(value: unknown): {
  patch: Models.NeoviewSlideshowPatch
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader slideshow patch")
  if (Object.keys(record).some((key) => key !== "slideshow")) throw new Error("reader slideshow patch contains unsupported fields.")
  const slideshow = requireRecord(record.slideshow, "reader slideshow patch.slideshow")
  const allowed = new Set(["intervalSeconds", "loop", "random", "fadeTransition"])
  const unknown = Object.keys(slideshow).filter((key) => !allowed.has(key))
  if (unknown.length) throw new Error(`reader slideshow patch contains unsupported fields: ${unknown.join(", ")}.`)
  const patch: Models.NeoviewSlideshowPatch = { slideshow: {} }
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
  patch: Models.NeoviewHistoryListPatch
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
  patch: Models.NeoviewBookmarkListPatch
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
  patch: Models.NeoviewPageListPatch
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader page list patch")
  if (Object.keys(record).some((key) => key !== "pageList")) throw new Error("reader page list patch contains unsupported fields.")
  const preferences = requireRecord(record.pageList, "reader page list patch.pageList")
  const allowed = new Set(["viewMode", "followProgress"])
  const unknown = Object.keys(preferences).filter((key) => !allowed.has(key))
  if (unknown.length) throw new Error(`reader page list patch contains unsupported fields: ${unknown.join(", ")}.`)
  const patch: Models.NeoviewPageListPatch = { pageList: {} }
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

export function parseNeoviewBookPatch(value: unknown): {
  patch: Models.NeoviewBookPatch
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader book patch")
  if (Object.keys(record).some((key) => key !== "book")) throw new Error("reader book patch contains unsupported fields.")
  const source = requireRecord(record.book, "reader book patch.book")
  const allowed = new Set(["lockedSortMode", "lockedMediaPriority", "lockedReadingDirection"])
  const unknown = Object.keys(source).filter((key) => !allowed.has(key))
  if (unknown.length) throw new Error(`reader book patch contains unsupported fields: ${unknown.join(", ")}.`)
  const patch: Models.NeoviewBookPatch = { book: {} }
  const toml: Record<string, unknown> = {}
  if (source.lockedSortMode !== undefined) {
    patch.book.lockedSortMode =
      source.lockedSortMode === null ? null : optionalEnum(source.lockedSortMode, "reader book patch.lockedSortMode", READER_PAGE_SORT_MODES)!
    toml.locked_sort_mode = patch.book.lockedSortMode ?? "none"
  }
  if (source.lockedMediaPriority !== undefined) {
    patch.book.lockedMediaPriority =
      source.lockedMediaPriority === null
        ? null
        : optionalEnum(source.lockedMediaPriority, "reader book patch.lockedMediaPriority", ["videoFirst", "imageFirst"] as const)!
    toml.locked_media_priority = patch.book.lockedMediaPriority ?? "none"
  }
  if (source.lockedReadingDirection !== undefined) {
    patch.book.lockedReadingDirection =
      source.lockedReadingDirection === null
        ? null
        : optionalEnum(source.lockedReadingDirection, "reader book patch.lockedReadingDirection", ["left-to-right", "right-to-left"] as const)!
    toml.locked_reading_direction = patch.book.lockedReadingDirection ?? "none"
  }
  if (!Object.keys(patch.book).length) throw new Error("reader book patch must change at least one field.")
  return {
    patch,
    tomlPatch: {
      book: toml,
      ...(patch.book.lockedReadingDirection === undefined || patch.book.lockedReadingDirection === null
        ? {}
        : {
            reader: {
              reading_direction: patch.book.lockedReadingDirection ?? undefined,
            },
          }),
    },
  }
}

function parseBookConfig(canonical: Record<string, unknown> | undefined, legacy: Record<string, unknown> | undefined): Models.NeoviewBookConfig {
  const sort = canonical?.locked_sort_mode ?? canonical?.lockedSortMode ?? legacy?.locked_sort_mode ?? legacy?.lockedSortMode
  const media = canonical?.locked_media_priority ?? canonical?.lockedMediaPriority ?? legacy?.locked_media_priority ?? legacy?.lockedMediaPriority
  const direction =
    canonical?.locked_reading_direction ?? canonical?.lockedReadingDirection ?? legacy?.locked_reading_direction ?? legacy?.lockedReadingDirection
  const lockedSortMode =
    sort === undefined || sort === null || sort === "none" ? null : optionalEnum(sort, "[nodes.neoview.book].locked_sort_mode", READER_PAGE_SORT_MODES)!
  const parsedMedia =
    media === undefined || media === null ? "none" : optionalEnum(media, "[nodes.neoview.book].locked_media_priority", READER_MEDIA_PRIORITY_MODES)!
  const lockedReadingDirection =
    direction === undefined || direction === null || direction === "none"
      ? null
      : optionalEnum(direction, "[nodes.neoview.book].locked_reading_direction", ["left-to-right", "right-to-left"] as const)!
  return {
    lockedSortMode,
    lockedMediaPriority: parsedMedia === "none" ? null : parsedMedia,
    lockedReadingDirection,
  }
}

export function parseNeoviewViewDefaultsPatch(value: unknown): {
  patch: Models.NeoviewViewDefaultsPatch
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader view defaults patch")
  if (Object.keys(record).some((key) => key !== "viewDefaults")) throw new Error("reader view defaults patch contains unsupported fields.")
  const defaults = requireRecord(record.viewDefaults, "reader view defaults patch.viewDefaults")
  const allowed = new Set([
    "fitMode",
    "pageMode",
    "doublePageGap",
    "splitWidePages",
    "hoverScrollEnabled",
    "hoverScrollSpeed",
    "magnifierZoom",
    "magnifierSize",
    "orientation",
    "autoRotation",
    "widePageStretch",
    "background",
  ])
  const unknown = Object.keys(defaults).filter((key) => !allowed.has(key))
  if (unknown.length) throw new Error(`reader view defaults patch contains unsupported fields: ${unknown.join(", ")}.`)
  const patch: Models.NeoviewViewDefaultsPatch = { viewDefaults: {} }
  const readerPatch: Record<string, unknown> = {}
  const magnifierPatch: Record<string, unknown> = {}
  const backgroundPatch: Record<string, unknown> = {}
  if (defaults.fitMode !== undefined) {
    patch.viewDefaults.fitMode = readerFitMode(defaults.fitMode, "reader view defaults patch.fitMode")
    readerPatch.default_zoom_mode = persistedReaderFitMode(patch.viewDefaults.fitMode)
  }
  if (defaults.pageMode !== undefined) {
    patch.viewDefaults.pageMode = optionalEnum(defaults.pageMode, "reader view defaults patch.pageMode", ["single", "double"] as const)
    readerPatch.double_page_view = patch.viewDefaults.pageMode === "double"
  }
  if (defaults.doublePageGap !== undefined) {
    patch.viewDefaults.doublePageGap = boundedNumber(
      defaults.doublePageGap,
      -500,
      500,
      Models.DEFAULT_NEOVIEW_VIEW_DEFAULTS.doublePageGap,
      "reader view defaults patch.doublePageGap",
    )
    readerPatch.double_page_gap = patch.viewDefaults.doublePageGap
  }
  if (defaults.splitWidePages !== undefined) {
    patch.viewDefaults.splitWidePages = requiredBoolean(defaults.splitWidePages, "reader view defaults patch.splitWidePages")
    readerPatch.split_wide_pages = patch.viewDefaults.splitWidePages
  }
  if (defaults.hoverScrollEnabled !== undefined) {
    patch.viewDefaults.hoverScrollEnabled = requiredBoolean(defaults.hoverScrollEnabled, "reader view defaults patch.hoverScrollEnabled")
    readerPatch.hover_scroll_enabled = patch.viewDefaults.hoverScrollEnabled
  }
  if (defaults.hoverScrollSpeed !== undefined) {
    patch.viewDefaults.hoverScrollSpeed = boundedNumber(
      defaults.hoverScrollSpeed,
      0.5,
      10,
      Models.DEFAULT_NEOVIEW_VIEW_DEFAULTS.hoverScrollSpeed,
      "reader view defaults patch.hoverScrollSpeed",
    )
    readerPatch.hover_scroll_speed = patch.viewDefaults.hoverScrollSpeed
  }
  if (defaults.magnifierZoom !== undefined) {
    patch.viewDefaults.magnifierZoom = boundedNumber(
      defaults.magnifierZoom,
      1,
      5,
      Models.DEFAULT_NEOVIEW_VIEW_DEFAULTS.magnifierZoom,
      "reader view defaults patch.magnifierZoom",
    )
    magnifierPatch.zoom = patch.viewDefaults.magnifierZoom
  }
  if (defaults.magnifierSize !== undefined) {
    patch.viewDefaults.magnifierSize = boundedNumber(
      defaults.magnifierSize,
      100,
      500,
      Models.DEFAULT_NEOVIEW_VIEW_DEFAULTS.magnifierSize,
      "reader view defaults patch.magnifierSize",
    )
    magnifierPatch.size = patch.viewDefaults.magnifierSize
  }
  if (defaults.orientation !== undefined) {
    patch.viewDefaults.orientation = optionalEnum(defaults.orientation, "reader view defaults patch.orientation", ["horizontal", "vertical"] as const)
    readerPatch.orientation = patch.viewDefaults.orientation
  }
  if (defaults.autoRotation !== undefined) {
    patch.viewDefaults.autoRotation = readerAutoRotation(defaults.autoRotation)
    readerPatch.auto_rotation = persistedReaderAutoRotation(patch.viewDefaults.autoRotation)
  }
  if (defaults.widePageStretch !== undefined) {
    patch.viewDefaults.widePageStretch = readerWidePageStretch(defaults.widePageStretch)
    readerPatch.wide_page_stretch = persistedReaderWidePageStretch(patch.viewDefaults.widePageStretch)
  }
  if (defaults.background !== undefined) {
    const background = requireRecord(defaults.background, "reader view defaults patch.background")
    const allowedBackground = new Set(["color", "mode", "ambient", "aurora", "spotlight"])
    const unknownBackground = Object.keys(background).filter((key) => !allowedBackground.has(key))
    if (unknownBackground.length) throw new Error(`reader view defaults patch.background contains unsupported fields: ${unknownBackground.join(", ")}.`)
    const backgroundConfig = Models.DEFAULT_NEOVIEW_VIEW_DEFAULTS.background
    const next: Models.NeoviewBackgroundPatch = {}
    if (background.color !== undefined) {
      if (typeof background.color !== "string" || !background.color.trim() || background.color.length > 128) throw new Error("reader view defaults patch.background.color must be a non-empty string.")
      next.color = background.color.trim()
      backgroundPatch.background_color = next.color
    }
    if (background.mode !== undefined) {
      next.mode = optionalEnum(background.mode, "reader view defaults patch.background.mode", ["solid", "auto", "edge", "ambient", "aurora", "spotlight"] as const)
      backgroundPatch.background_mode = next.mode
    }
    if (background.ambient !== undefined) {
      const ambient = requireRecord(background.ambient, "reader view defaults patch.background.ambient")
      const ambientPatch: Partial<Models.NeoviewBackgroundConfig["ambient"]> = {}
      if (ambient.style !== undefined) ambientPatch.style = optionalEnum(ambient.style, "reader view defaults patch.background.ambient.style", ["gentle", "vibrant", "dynamic"] as const)
      if (ambient.speed !== undefined) ambientPatch.speed = boundedNumber(ambient.speed, 2, 20, backgroundConfig.ambient.speed, "reader view defaults patch.background.ambient.speed")
      if (ambient.blur !== undefined) ambientPatch.blur = boundedNumber(ambient.blur, 20, 150, backgroundConfig.ambient.blur, "reader view defaults patch.background.ambient.blur")
      if (ambient.opacity !== undefined) ambientPatch.opacity = boundedNumber(ambient.opacity, 0.3, 1, backgroundConfig.ambient.opacity, "reader view defaults patch.background.ambient.opacity")
      next.ambient = ambientPatch
      backgroundPatch.ambient = ambientPatch
    }
    if (background.aurora !== undefined) {
      const aurora = requireRecord(background.aurora, "reader view defaults patch.background.aurora")
      const showRadialGradient = requiredBoolean(aurora.showRadialGradient, "reader view defaults patch.background.aurora.showRadialGradient")
      next.aurora = { showRadialGradient }
      backgroundPatch.aurora = { show_radial_gradient: showRadialGradient }
    }
    if (background.spotlight !== undefined) {
      const spotlight = requireRecord(background.spotlight, "reader view defaults patch.background.spotlight")
      if (typeof spotlight.color !== "string" || !spotlight.color.trim() || spotlight.color.length > 128) throw new Error("reader view defaults patch.background.spotlight.color must be a non-empty string.")
      next.spotlight = { color: spotlight.color.trim() }
      backgroundPatch.spotlight = next.spotlight
    }
    if (!Object.keys(next).length) throw new Error("reader view defaults patch.background must change at least one field.")
    patch.viewDefaults.background = next
  }
  if (!Object.keys(patch.viewDefaults).length) throw new Error("reader view defaults patch must change at least one field.")
  const viewPatch = {
    ...(Object.keys(magnifierPatch).length ? { magnifier: magnifierPatch } : {}),
    ...backgroundPatch,
  }
  return {
    patch,
    tomlPatch: {
      ...(Object.keys(readerPatch).length ? { reader: readerPatch } : {}),
      ...(Object.keys(viewPatch).length ? { view: viewPatch } : {}),
    },
  }
}

export function parseNeoviewShellControlPatch(value: unknown): {
  patch: Models.NeoviewShellControlPatch
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader shell control patch")
  const unknownRoot = Object.keys(record).filter((key) => key !== "expectedRevision" && key !== "shellControl")
  if (unknownRoot.length) throw new Error(`reader shell control patch contains unsupported fields: ${unknownRoot.join(", ")}.`)
  const expectedRevision = boundedInteger(record.expectedRevision, 0, Number.MAX_SAFE_INTEGER, "reader shell control patch.expectedRevision")
  const control = requireRecord(record.shellControl, "reader shell control patch.shellControl")
  const unknownControl = Object.keys(control).filter(
    (key) => key !== "floating" && key !== "edges" && key !== "sidebarInteraction" && key !== "workspace" && key !== "material" && key !== "reset",
  )
  if (unknownControl.length) throw new Error(`reader shell control patch contains unsupported fields: ${unknownControl.join(", ")}.`)
  const reset = control.reset === undefined ? undefined : optionalEnum(control.reset, "reader shell control patch.reset", ["known-defaults"] as const)
  if (reset && (control.floating !== undefined || control.edges !== undefined || control.sidebarInteraction !== undefined || control.workspace !== undefined || control.material !== undefined)) {
    throw new Error("reader shell control patch.reset cannot be combined with floating, edges, sidebarInteraction, workspace or material.")
  }
  if (reset) {
    return {
      patch: { expectedRevision, shellControl: { reset } },
      tomlPatch: shellControlTomlPatch(
        Models.DEFAULT_NEOVIEW_SHELL_CONFIG.floatingControl,
        Models.DEFAULT_NEOVIEW_SHELL_CONFIG.edges,
        Models.DEFAULT_NEOVIEW_SHELL_CONFIG.sidebarInteraction,
        {
          mode: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.mode,
          laneOrder: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.laneOrder,
          activeLane: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.activeLane,
          readerSolo: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.readerSolo,
          readerSoloOnFocus: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.readerSoloOnFocus,
          readerWidthRatio: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.readerWidthRatio,
          edgeRevealDelayMs: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.edgeRevealDelayMs,
          edgeRevealZones: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.edgeRevealZones,
          readerFocusOnHover: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.readerFocusOnHover,
          readerFocusHoverDelayMs: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.readerFocusHoverDelayMs,
          manualScrollEnabled: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.manualScrollEnabled,
          showLaneNavigatorInReaderSolo: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.showLaneNavigatorInReaderSolo,
          windowControlsPlacement: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.windowControlsPlacement,
          windowControlsOwnerLaneId: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.windowControlsOwnerLaneId,
          windowControlsExpanded: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.windowControlsExpanded,
          lanes: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.lanes,
        },
        {
          preset: Models.DEFAULT_NEOVIEW_SHELL_MATERIAL_CONFIG.preset,
          opacity: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.opacity,
          blur: Models.DEFAULT_NEOVIEW_SHELL_CONFIG.blur,
          saturation: Models.DEFAULT_NEOVIEW_SHELL_MATERIAL_CONFIG.saturation,
          highlight: Models.DEFAULT_NEOVIEW_SHELL_MATERIAL_CONFIG.highlight,
          shadow: Models.DEFAULT_NEOVIEW_SHELL_MATERIAL_CONFIG.shadow,
        },
      ),
    }
  }

  const patch: Models.NeoviewShellControlPatch = {
    expectedRevision,
    shellControl: {},
  }
  let floatingPatch: Models.NeoviewShellControlPatch["shellControl"]["floating"]
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

  let edgePatches: Models.NeoviewShellControlPatch["shellControl"]["edges"]
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
      const target: Partial<Models.NeoviewShellEdgeConfig> = {}
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
  let sidebarInteractionPatch: Models.NeoviewShellControlPatch["shellControl"]["sidebarInteraction"]
  if (control.sidebarInteraction !== undefined) {
    const interaction = requireRecord(control.sidebarInteraction, "reader shell control patch.sidebarInteraction")
    const unknown = Object.keys(interaction).filter((key) => !["showDragHandle", "enableBlankAreaCollapse", "blankAreaCollapseMode"].includes(key))
    if (unknown.length) throw new Error(`reader shell control patch.sidebarInteraction contains unsupported fields: ${unknown.join(", ")}.`)
    sidebarInteractionPatch = {}
    if (interaction.showDragHandle !== undefined)
      sidebarInteractionPatch.showDragHandle = requiredBoolean(interaction.showDragHandle, "sidebarInteraction.showDragHandle")
    if (interaction.enableBlankAreaCollapse !== undefined)
      sidebarInteractionPatch.enableBlankAreaCollapse = requiredBoolean(interaction.enableBlankAreaCollapse, "sidebarInteraction.enableBlankAreaCollapse")
    if (interaction.blankAreaCollapseMode !== undefined) {
      sidebarInteractionPatch.blankAreaCollapseMode = optionalEnum(interaction.blankAreaCollapseMode, "sidebarInteraction.blankAreaCollapseMode", [
        "single",
        "double",
      ] as const)
    }
    if (!Object.keys(sidebarInteractionPatch).length) throw new Error("reader shell control patch.sidebarInteraction must change at least one field.")
    patch.shellControl.sidebarInteraction = sidebarInteractionPatch
  }
  let workspacePatch: Models.NeoviewShellControlPatch["shellControl"]["workspace"]
  if (control.workspace !== undefined) {
    const workspace = requireRecord(control.workspace, "reader shell control patch.workspace")
    const unknown = Object.keys(workspace).filter((key) => ![
      "mode",
      "laneOrder",
      "activeLane",
      "readerSolo",
      "readerSoloOnFocus",
      "soloLaneId",
      "readerWidthRatio",
      "edgeRevealDelayMs",
      "edgeRevealZones",
      "readerFocusOnHover",
      "readerFocusHoverDelayMs",
      "manualScrollEnabled",
      "showLaneNavigatorInReaderSolo",
      "autoFitToViewport",
      "barHandleStyle",
      "barHandlePosition",
      "laneNavigatorPositionX",
      "laneNavigatorPositionY",
      "laneNavigatorDock",
      "windowControlsPlacement",
      "windowControlsOwnerLaneId",
      "windowControlsExpanded",
      "lanes",
    ].includes(key))
    if (unknown.length) throw new Error(`reader shell control patch.workspace contains unsupported fields: ${unknown.join(", ")}.`)
    workspacePatch = {}
    if (workspace.mode !== undefined) {
      workspacePatch.mode = optionalEnum(workspace.mode, "workspace.mode", Models.NEOVIEW_WORKSPACE_MODES)
    }
    if (workspace.laneOrder !== undefined) {
      workspacePatch.laneOrder = normalizedSwimlaneOrder(workspace.laneOrder, Models.NEOVIEW_SWIMLANE_IDS, "workspace.laneOrder", true)
    }
    if (workspace.activeLane !== undefined) {
      workspacePatch.activeLane = requireLayoutId(workspace.activeLane, "workspace.activeLane")
    }
    if (workspace.readerSolo !== undefined) {
      workspacePatch.readerSolo = requiredBoolean(workspace.readerSolo, "workspace.readerSolo")
    }
    if (workspace.readerSoloOnFocus !== undefined) {
      workspacePatch.readerSoloOnFocus = requiredBoolean(workspace.readerSoloOnFocus, "workspace.readerSoloOnFocus")
    }
    if (workspace.soloLaneId !== undefined) {
      workspacePatch.soloLaneId = workspace.soloLaneId === null ? null : requireLayoutId(workspace.soloLaneId, "workspace.soloLaneId")
    }
    if (workspace.readerWidthRatio !== undefined) {
      workspacePatch.readerWidthRatio = readerWidthRatio(workspace.readerWidthRatio, "workspace.readerWidthRatio")
    }
    if (workspace.edgeRevealDelayMs !== undefined) {
      workspacePatch.edgeRevealDelayMs = edgeRevealDelay(workspace.edgeRevealDelayMs, "workspace.edgeRevealDelayMs")
    }
    if (workspace.edgeRevealZones !== undefined) {
      const zones = requireRecord(workspace.edgeRevealZones, "workspace.edgeRevealZones")
      const unknownZones = Object.keys(zones).filter((edge) => !Models.NEOVIEW_SWIMLANE_REVEAL_EDGES.includes(edge as Models.NeoviewSwimlaneRevealEdge))
      if (unknownZones.length) throw new Error(`workspace.edgeRevealZones contains unsupported edges: ${unknownZones.join(", ")}.`)
      workspacePatch.edgeRevealZones = {
        left: revealZone(zones.left, "workspace.edgeRevealZones.left", Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.edgeRevealZones.left),
        right: revealZone(zones.right, "workspace.edgeRevealZones.right", Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.edgeRevealZones.right),
        top: revealZone(zones.top, "workspace.edgeRevealZones.top", Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.edgeRevealZones.top),
        bottom: revealZone(zones.bottom, "workspace.edgeRevealZones.bottom", Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane.edgeRevealZones.bottom),
      }
    }
    if (workspace.readerFocusOnHover !== undefined) {
      workspacePatch.readerFocusOnHover = requiredBoolean(workspace.readerFocusOnHover, "workspace.readerFocusOnHover")
    }
    if (workspace.readerFocusHoverDelayMs !== undefined) {
      workspacePatch.readerFocusHoverDelayMs = readerFocusHoverDelay(workspace.readerFocusHoverDelayMs, "workspace.readerFocusHoverDelayMs")
    }
    if (workspace.manualScrollEnabled !== undefined) {
      workspacePatch.manualScrollEnabled = requiredBoolean(workspace.manualScrollEnabled, "workspace.manualScrollEnabled")
    }
    if (workspace.showLaneNavigatorInReaderSolo !== undefined) {
      workspacePatch.showLaneNavigatorInReaderSolo = requiredBoolean(workspace.showLaneNavigatorInReaderSolo, "workspace.showLaneNavigatorInReaderSolo")
    }
    if (workspace.autoFitToViewport !== undefined) {
      workspacePatch.autoFitToViewport = requiredBoolean(workspace.autoFitToViewport, "workspace.autoFitToViewport")
    }
    if (workspace.barHandleStyle !== undefined) {
      workspacePatch.barHandleStyle = optionalEnum(workspace.barHandleStyle, "workspace.barHandleStyle", Models.NEOVIEW_BAR_HANDLE_STYLES)
    }
    if (workspace.barHandlePosition !== undefined) {
      workspacePatch.barHandlePosition = optionalEnum(workspace.barHandlePosition, "workspace.barHandlePosition", Models.NEOVIEW_BAR_HANDLE_POSITIONS)
    }
    if (workspace.laneNavigatorPositionX !== undefined) workspacePatch.laneNavigatorPositionX = boundedNumber(workspace.laneNavigatorPositionX, 0, 100, 92, "workspace.laneNavigatorPositionX")
    if (workspace.laneNavigatorPositionY !== undefined) workspacePatch.laneNavigatorPositionY = boundedNumber(workspace.laneNavigatorPositionY, 0, 100, 96, "workspace.laneNavigatorPositionY")
    if (workspace.laneNavigatorDock !== undefined) workspacePatch.laneNavigatorDock = optionalEnum(workspace.laneNavigatorDock, "workspace.laneNavigatorDock", Models.NEOVIEW_LANE_NAVIGATOR_DOCKS)
    if (workspace.windowControlsPlacement !== undefined) workspacePatch.windowControlsPlacement = optionalEnum(workspace.windowControlsPlacement, "workspace.windowControlsPlacement", Models.NEOVIEW_WINDOW_CONTROLS_PLACEMENTS)
    if (workspace.windowControlsOwnerLaneId !== undefined) workspacePatch.windowControlsOwnerLaneId = requireLayoutId(workspace.windowControlsOwnerLaneId, "workspace.windowControlsOwnerLaneId")
    if (workspace.windowControlsExpanded !== undefined) workspacePatch.windowControlsExpanded = requiredBoolean(workspace.windowControlsExpanded, "workspace.windowControlsExpanded")
    if (workspace.lanes !== undefined) {
      const lanes = requireRecord(workspace.lanes, "reader shell control patch.workspace.lanes")
      const lanePatches: NonNullable<Models.NeoviewShellControlPatch["shellControl"]["workspace"]>["lanes"] = {}
      for (const laneId of Object.keys(lanes)) {
        requireLayoutId(laneId, `reader shell control patch.workspace.lanes.${laneId}`)
        const source = requireRecord(lanes[laneId], `reader shell control patch.workspace.lanes.${laneId}`)
        const unknownLaneFields = Object.keys(source).filter((key) => ![
          "width",
          "collapsed",
          "title",
          "activePanelId",
          "panelBarMode",
          "panelBarDock",
          "panelBarPositionX",
          "panelBarPositionY",
          "panelBarConstrained",
        ].includes(key))
        if (unknownLaneFields.length) throw new Error(`reader shell control patch.workspace.lanes.${laneId} contains unsupported fields: ${unknownLaneFields.join(", ")}.`)
        const lane: Partial<Models.NeoviewSwimlaneLaneConfig> = {}
        if (source.width !== undefined) lane.width = swimlaneWidth(source.width, laneId, `workspace.lanes.${laneId}.width`)
        if (source.collapsed !== undefined) lane.collapsed = requiredBoolean(source.collapsed, `workspace.lanes.${laneId}.collapsed`)
        if (source.title !== undefined) lane.title = requireLaneTitle(source.title, `workspace.lanes.${laneId}.title`)
        if (source.activePanelId !== undefined) lane.activePanelId = requireLayoutId(source.activePanelId, `workspace.lanes.${laneId}.activePanelId`)
        if (source.panelBarMode !== undefined) lane.panelBarMode = optionalEnum(source.panelBarMode, `workspace.lanes.${laneId}.panelBarMode`, Models.NEOVIEW_PANEL_BAR_MODES)
        if (source.panelBarDock !== undefined) lane.panelBarDock = optionalEnum(source.panelBarDock, `workspace.lanes.${laneId}.panelBarDock`, Models.NEOVIEW_PANEL_BAR_DOCKS)
        if (source.panelBarPositionX !== undefined) lane.panelBarPositionX = boundedNumber(source.panelBarPositionX, 0, 100, 50, `workspace.lanes.${laneId}.panelBarPositionX`)
        if (source.panelBarPositionY !== undefined) lane.panelBarPositionY = boundedNumber(source.panelBarPositionY, 0, 100, 50, `workspace.lanes.${laneId}.panelBarPositionY`)
        if (source.panelBarConstrained !== undefined) lane.panelBarConstrained = requiredBoolean(source.panelBarConstrained, `workspace.lanes.${laneId}.panelBarConstrained`)
        if (!Object.keys(lane).length) throw new Error(`reader shell control patch.workspace.lanes.${laneId} must change at least one field.`)
        lanePatches[laneId] = lane
      }
      if (!Object.keys(lanePatches).length) throw new Error("reader shell control patch.workspace.lanes must change at least one lane.")
      workspacePatch.lanes = lanePatches
    }
    if (!Object.keys(workspacePatch).length) throw new Error("reader shell control patch.workspace must change at least one field.")
    patch.shellControl.workspace = workspacePatch
  }
  let materialPatch: Models.NeoviewShellControlPatch["shellControl"]["material"]
  if (control.material !== undefined) {
    const material = requireRecord(control.material, "reader shell control patch.material")
    const unknown = Object.keys(material).filter((key) => !["preset", "opacity", "blur", "saturation", "highlight", "shadow"].includes(key))
    if (unknown.length) throw new Error(`reader shell control patch.material contains unsupported fields: ${unknown.join(", ")}.`)
    materialPatch = {}
    if (material.preset !== undefined) {
      materialPatch.preset = optionalEnum(material.preset, "material.preset", ["solid", "soft", "frosted", "custom"] as const)
    }
    if (material.opacity !== undefined) materialPatch.opacity = shellSurfaceNumberPatch(material.opacity, "material.opacity", 0, 100)
    if (material.blur !== undefined) materialPatch.blur = shellSurfaceNumberPatch(material.blur, "material.blur", 0, 20)
    if (material.saturation !== undefined) materialPatch.saturation = shellSurfaceNumberPatch(material.saturation, "material.saturation", 50, 180)
    if (material.highlight !== undefined) materialPatch.highlight = shellSurfaceNumberPatch(material.highlight, "material.highlight", 0, 100)
    if (material.shadow !== undefined) materialPatch.shadow = shellSurfaceNumberPatch(material.shadow, "material.shadow", 0, 100)
    if (!Object.keys(materialPatch).length) throw new Error("reader shell control patch.material must change at least one field.")
    patch.shellControl.material = materialPatch
  }
  if (!patch.shellControl.floating && !patch.shellControl.edges && !patch.shellControl.sidebarInteraction && !patch.shellControl.workspace && !patch.shellControl.material)
    throw new Error("reader shell control patch must change at least one field.")
  return {
    patch,
    tomlPatch: shellControlTomlPatch(floatingPatch, edgePatches, sidebarInteractionPatch, workspacePatch, materialPatch),
  }
}

const NEOVIEW_SHELL_EDGES = ["top", "right", "bottom", "left"] as const
type NeoviewShellEdge = (typeof NEOVIEW_SHELL_EDGES)[number]
const NEOVIEW_SHELL_SURFACES = ["top", "bottom", "sidebar"] as const

function normalizedSwimlaneOrder(
  value: unknown,
  fallback: readonly Models.NeoviewSwimlaneId[],
  path: string,
  _strict = false,
): Models.NeoviewSwimlaneId[] {
  if (value === undefined) return [...fallback]
  const source = requiredStringArray(value, path)
  const order = source
    .map((laneId) => requireLayoutId(laneId, path))
    .filter((laneId, index, lanes) => lanes.indexOf(laneId) === index)
  if (order.length > 32) throw new Error(`${path} cannot contain more than 32 lanes.`)
  for (const laneId of Models.NEOVIEW_SWIMLANE_IDS) if (!order.includes(laneId)) order.push(laneId)
  return order
}

function swimlaneWidth(value: unknown, laneId: Models.NeoviewSwimlaneId, path: string, fallback = laneId === "reader" ? 960 : laneId === "right" ? 280 : 320): number {
  return boundedNumber(value, laneId === "reader" ? 120 : 240, 8_192, fallback, path)
}

function readerWidthRatio(value: unknown, path: string, fallback = 0.5): number {
  return boundedNumber(value, 0.25, 1, fallback, path)
}

function revealZone(value: unknown, path: string, fallback: Models.NeoviewSwimlaneRevealZone): Models.NeoviewSwimlaneRevealZone {
  const source = requireRecord(value, path)
  const unknown = Object.keys(source).filter((key) => !["x", "y", "width", "height"].includes(key))
  if (unknown.length) throw new Error(`${path} contains unsupported fields: ${unknown.join(", ")}.`)
  const x = boundedNumber(source.x, 0, 99, fallback.x, `${path}.x`)
  const y = boundedNumber(source.y, 0, 99, fallback.y, `${path}.y`)
  return {
    x,
    y,
    width: boundedNumber(source.width, 1, 100 - x, Math.min(fallback.width, 100 - x), `${path}.width`),
    height: boundedNumber(source.height, 1, 100 - y, Math.min(fallback.height, 100 - y), `${path}.height`),
  }
}

function readerFocusHoverDelay(value: unknown, path: string, fallback = 650): number {
  if (value === undefined) return fallback
  return boundedInteger(value, 200, 5_000, path)
}

function edgeRevealDelay(value: unknown, path: string, fallback = 180): number {
  if (value === undefined) return fallback
  return boundedInteger(value, 100, 5_000, path)
}

function shellSurfaceNumberPatch(value: unknown, label: string, minimum: number, maximum: number): Partial<Models.NeoviewShellSurfaceValues> {
  const source = requireRecord(value, label)
  const unknown = Object.keys(source).filter((key) => !NEOVIEW_SHELL_SURFACES.includes(key as Models.NeoviewShellSurface))
  if (unknown.length) throw new Error(`${label} contains unsupported surfaces: ${unknown.join(", ")}.`)
  const result: Partial<Models.NeoviewShellSurfaceValues> = {}
  for (const surface of NEOVIEW_SHELL_SURFACES) {
    if (source[surface] !== undefined) result[surface] = boundedNumber(source[surface], minimum, maximum, minimum, `${label}.${surface}`)
  }
  if (!Object.keys(result).length) throw new Error(`${label} must change at least one surface.`)
  return result
}

function shellControlTomlPatch(
  floating: Partial<Models.NeoviewShellFloatingControlConfig> | undefined,
  edges: Partial<Record<NeoviewShellEdge, Partial<Models.NeoviewShellEdgeConfig>>> | undefined,
  sidebarInteraction: Partial<Models.NeoviewShellSidebarInteractionConfig> | undefined,
  workspace: Models.NeoviewShellControlPatch["shellControl"]["workspace"] | undefined,
  material: Models.NeoviewShellMaterialPatch | undefined,
): Record<string, unknown> {
  const panels: Record<string, unknown> = {}
  if (floating) {
    const value: Record<string, unknown> = {}
    if (floating.enabled !== undefined) value.enabled = floating.enabled
    if (floating.position !== undefined) value.position = { x: floating.position.x, y: floating.position.y }
    panels.sidebar_control = value
  }
  if (edges) {
    panels.edges = Object.fromEntries(
      Object.entries(edges).map(([edge, source]) => {
        const value: Record<string, unknown> = {}
        if (source.enabled !== undefined) value.enabled = source.enabled
        if (source.initialVisible !== undefined) value.initial_visible = source.initialVisible
        if (source.pinned !== undefined) value.pinned = source.pinned
        if (source.triggerSize !== undefined) value.trigger_size = source.triggerSize
        if (source.lockMode !== undefined) value.lock_mode = source.lockMode
        return [edge, value]
      }),
    )
  }
  if (sidebarInteraction) {
    const value: Record<string, unknown> = {}
    if (sidebarInteraction.showDragHandle !== undefined) value.show_drag_handle = sidebarInteraction.showDragHandle
    if (sidebarInteraction.enableBlankAreaCollapse !== undefined) value.enable_blank_area_collapse = sidebarInteraction.enableBlankAreaCollapse
    if (sidebarInteraction.blankAreaCollapseMode !== undefined) value.blank_area_collapse_mode = sidebarInteraction.blankAreaCollapseMode
    panels.sidebar_interaction = value
  }
  if (workspace) {
    if (workspace.mode !== undefined) panels.layout_mode = workspace.mode
    const value: Record<string, unknown> = {}
    if (workspace.laneOrder !== undefined) value.lane_order = workspace.laneOrder
    // activeLane, readerSolo and soloLaneId are accepted for old clients but
    // belong to the per-instance frontend session and must not re-enter TOML.
    if (workspace.readerSoloOnFocus !== undefined) value.reader_solo_on_focus = workspace.readerSoloOnFocus
    if (workspace.readerWidthRatio !== undefined) value.reader_width_ratio = workspace.readerWidthRatio
    if (workspace.edgeRevealDelayMs !== undefined) value.edge_reveal_delay_ms = workspace.edgeRevealDelayMs
    if (workspace.edgeRevealZones !== undefined) {
      value.left_reveal_zone = workspace.edgeRevealZones.left
      value.right_reveal_zone = workspace.edgeRevealZones.right
      value.top_reveal_zone = workspace.edgeRevealZones.top
      value.bottom_reveal_zone = workspace.edgeRevealZones.bottom
    }
    if (workspace.readerFocusOnHover !== undefined) value.reader_focus_on_hover = workspace.readerFocusOnHover
    if (workspace.readerFocusHoverDelayMs !== undefined) value.reader_focus_hover_delay_ms = workspace.readerFocusHoverDelayMs
    if (workspace.manualScrollEnabled !== undefined) value.manual_scroll_enabled = workspace.manualScrollEnabled
    if (workspace.showLaneNavigatorInReaderSolo !== undefined) value.show_lane_navigator_in_reader_solo = workspace.showLaneNavigatorInReaderSolo
    if (workspace.autoFitToViewport !== undefined) value.auto_fit_to_viewport = workspace.autoFitToViewport
    if (workspace.barHandleStyle !== undefined) value.bar_handle_style = workspace.barHandleStyle
    if (workspace.barHandlePosition !== undefined) value.bar_handle_position = workspace.barHandlePosition
    if (workspace.laneNavigatorPositionX !== undefined) value.lane_navigator_position_x = workspace.laneNavigatorPositionX
    if (workspace.laneNavigatorPositionY !== undefined) value.lane_navigator_position_y = workspace.laneNavigatorPositionY
    if (workspace.laneNavigatorDock !== undefined) value.lane_navigator_dock = workspace.laneNavigatorDock
    if (workspace.windowControlsPlacement !== undefined) value.window_controls_placement = workspace.windowControlsPlacement
    if (workspace.windowControlsOwnerLaneId !== undefined) value.window_controls_owner_lane_id = workspace.windowControlsOwnerLaneId
    if (workspace.windowControlsExpanded !== undefined) value.window_controls_expanded = workspace.windowControlsExpanded
    if (workspace.lanes !== undefined) {
      for (const [laneId, source] of Object.entries(workspace.lanes)) {
        if (!source) continue
        const lane: Record<string, unknown> = {}
        if (source.width !== undefined) lane.width = source.width
        if (source.collapsed !== undefined) lane.collapsed = source.collapsed
        if (source.title !== undefined) lane.title = source.title
        if (source.activePanelId !== undefined) lane.active_panel_id = source.activePanelId
        if (source.panelBarMode !== undefined) lane.panel_bar_mode = source.panelBarMode
        if (source.panelBarDock !== undefined) lane.panel_bar_dock = source.panelBarDock
        if (source.panelBarPositionX !== undefined) lane.panel_bar_position_x = source.panelBarPositionX
        if (source.panelBarPositionY !== undefined) lane.panel_bar_position_y = source.panelBarPositionY
        if (source.panelBarConstrained !== undefined) lane.panel_bar_constrained = source.panelBarConstrained
        value[laneId] = lane
      }
    }
    if (Object.keys(value).length) panels.swimlane = value
  }
  if (material) {
    if (material.opacity) {
      if (material.opacity.top !== undefined) panels.top_toolbar_opacity = material.opacity.top
      if (material.opacity.bottom !== undefined) panels.bottom_bar_opacity = material.opacity.bottom
      if (material.opacity.sidebar !== undefined) panels.sidebar_opacity = material.opacity.sidebar
    }
    if (material.blur) {
      if (material.blur.top !== undefined) panels.top_toolbar_blur = material.blur.top
      if (material.blur.bottom !== undefined) panels.bottom_bar_blur = material.blur.bottom
      if (material.blur.sidebar !== undefined) panels.sidebar_blur = material.blur.sidebar
    }
    const value: Record<string, unknown> = {}
    if (material.preset !== undefined) value.preset = material.preset
    for (const key of ["saturation", "highlight", "shadow"] as const) {
      const values = material[key]
      if (!values) continue
      for (const surface of NEOVIEW_SHELL_SURFACES) {
        if (values[surface] !== undefined) value[`${surface}_${key}`] = values[surface]
      }
    }
    if (Object.keys(value).length) panels.material = value
  }
  return Object.keys(panels).length ? { panels } : {}
}

export function parseNeoviewSidebarLayoutPatch(value: unknown): {
  patch: Models.NeoviewSidebarLayoutPatch
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader shell patch")
  const allowed = new Set(["side", "pinned", "width", "height", "customHeight", "verticalAlign", "horizontalPosition"])
  const unknown = Object.keys(record).filter((key) => !allowed.has(key))
  if (unknown.length) throw new Error(`reader shell patch contains unsupported fields: ${unknown.join(", ")}.`)
  const side = optionalEnum(record.side, "reader shell patch.side", ["left", "right"] as const)
  if (!side) throw new Error("reader shell patch.side is required.")
  const patch: Models.NeoviewSidebarLayoutPatch = { side }
  if (record.pinned !== undefined) patch.pinned = optionalBoolean(record.pinned, "reader shell patch.pinned")
  if (record.width !== undefined) patch.width = boundedNumber(record.width, 200, 600, 320, "reader shell patch.width")
  if (record.height !== undefined) patch.height = sidebarHeight(record.height, "reader shell patch.height")
  if (record.customHeight !== undefined) patch.customHeight = boundedNumber(record.customHeight, 10, 100, 100, "reader shell patch.customHeight")
  if (record.verticalAlign !== undefined) patch.verticalAlign = boundedNumber(record.verticalAlign, 0, 100, 0, "reader shell patch.verticalAlign")
  if (record.horizontalPosition !== undefined)
    patch.horizontalPosition = boundedNumber(record.horizontalPosition, 0, 100, 0, "reader shell patch.horizontalPosition")
  if (Object.keys(patch).length === 1) throw new Error("reader shell patch must change at least one layout field.")
  const sidePatch: Record<string, unknown> = {}
  if (patch.pinned !== undefined) sidePatch.pinned = patch.pinned
  if (patch.width !== undefined) sidePatch.width = patch.width
  if (patch.height !== undefined) sidePatch.height = patch.height === "two-thirds" ? "2/3" : patch.height === "one-third" ? "1/3" : patch.height
  if (patch.customHeight !== undefined) sidePatch.custom_height = patch.customHeight
  if (patch.verticalAlign !== undefined) sidePatch.vertical_align = patch.verticalAlign
  if (patch.horizontalPosition !== undefined) sidePatch.horizontal_position = patch.horizontalPosition
  const panelsPatch: Record<string, unknown> = {
    sidebars: { [side]: sidePatch },
  }
  if (patch.pinned !== undefined) panelsPatch.edges = { [side]: { pinned: patch.pinned } }
  return { patch, tomlPatch: { panels: panelsPatch } }
}

export function parseNeoviewCardLayoutPatch(value: unknown): {
  patch: Models.NeoviewCardLayoutPatch
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader card patch")
  const allowed = new Set(["cardId", "panelId", "visible", "expanded", "order", "height"])
  const unknown = Object.keys(record).filter((key) => !allowed.has(key))
  if (unknown.length) throw new Error(`reader card patch contains unsupported fields: ${unknown.join(", ")}.`)
  if (typeof record.cardId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(record.cardId)) {
    throw new Error("reader card patch.cardId is invalid.")
  }
  const patch: Models.NeoviewCardLayoutPatch = { cardId: record.cardId }
  if (record.panelId !== undefined) {
    if (typeof record.panelId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(record.panelId))
      throw new Error("reader card patch.panelId is invalid.")
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
  return {
    patch,
    tomlPatch: { panels: { card_state: { [patch.cardId]: state } } },
  }
}

export function parseNeoviewBoardLayoutPatch(value: unknown): {
  patch: Models.NeoviewBoardLayoutPatch
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
  const visibleCardsByPanel = new Map<string, Array<(typeof cards)[number]>>()
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
    const panelCards = visibleCardsByPanel.get(card.panelId) ?? []
    panelCards.push(card)
    visibleCardsByPanel.set(card.panelId, panelCards)
  }
  for (const [panelId, panelCards] of visibleCardsByPanel) {
    if (panelCards.length < 2) continue
    const exclusiveCard = panelCards.find((card) => READER_CARD_MANIFEST_BY_ID.get(card.cardId)?.exclusivePanel)
    if (exclusiveCard) {
      throw new Error(`reader board patch card ${exclusiveCard.cardId} requires exclusive panel ${panelId}.`)
    }
  }
  const panelState = Object.fromEntries(panels.map(({ id, ...state }) => [id, state]))
  const cardState = Object.fromEntries(cards.map(({ cardId, panelId, ...state }) => [cardId, { ...state, panel_id: panelId }]))
  return {
    patch: { expectedRevision, board: { panels, cards } },
    tomlPatch: { panels: { panel_state: panelState, card_state: cardState } },
  }
}

function parseShellOptions(panels: Record<string, unknown> | undefined, reader: Record<string, unknown> | undefined): Models.NeoviewShellConfig {
  if (!panels && !reader) return Models.DEFAULT_NEOVIEW_SHELL_CONFIG
  panels ??= {}
  const hover = optionalRecord(panels.hover_areas, "[nodes.neoview.panels.hover_areas]")
  const timing = optionalRecord(panels.auto_hide_timing, "[nodes.neoview.panels.auto_hide_timing]")
  const sidebars = optionalRecord(panels.sidebars, "[nodes.neoview.panels.sidebars]")
  const left = optionalRecord(sidebars?.left, "[nodes.neoview.panels.sidebars.left]")
  const right = optionalRecord(sidebars?.right, "[nodes.neoview.panels.sidebars.right]")
  const autoHideToolbar = optionalBoolean(panels.auto_hide_toolbar, "[nodes.neoview.panels].auto_hide_toolbar")
  const canonicalControl = optionalRecord(panels.sidebar_control, "[nodes.neoview.panels.sidebar_control]")
  const canonicalInteraction = optionalRecord(panels.sidebar_interaction, "[nodes.neoview.panels.sidebar_interaction]")
  const canonicalMaterial = optionalRecord(panels.material, "[nodes.neoview.panels.material]")
  const canonicalPosition = optionalRecord(canonicalControl?.position, "[nodes.neoview.panels.sidebar_control.position]")
  const legacyView = optionalRecord(reader?.view, "[nodes.neoview.reader.view]")
  const legacyControl = optionalRecord(legacyView?.sidebar_control ?? legacyView?.sidebarControl, "[nodes.neoview.reader.view.sidebar_control]")
  const legacyPosition = optionalRecord(legacyControl?.position, "[nodes.neoview.reader.view.sidebar_control.position]")
  const canonicalEdges = optionalRecord(panels.edges, "[nodes.neoview.panels.edges]")
  const legacyEdges = {
    top: {
      enabled: true,
      initialVisible: autoHideToolbar === false,
      pinned: autoHideToolbar === false,
      trigger: hover?.top_trigger_height,
    },
    right: {
      enabled: optionalBoolean(panels.right_sidebar_visible, "right_sidebar_visible") ?? true,
      initialVisible: optionalBoolean(right?.open, "right.open") ?? true,
      pinned: optionalBoolean(right?.pinned, "right.pinned") ?? false,
      trigger: hover?.right_trigger_width,
    },
    bottom: {
      enabled: optionalBoolean(panels.bottom_panel_visible, "bottom_panel_visible") ?? true,
      initialVisible: optionalBoolean(panels.bottom_panel_visible, "bottom_panel_visible") ?? false,
      pinned: false,
      trigger: hover?.bottom_trigger_height,
    },
    left: {
      enabled: optionalBoolean(panels.left_sidebar_visible, "left_sidebar_visible") ?? true,
      initialVisible: optionalBoolean(left?.open, "left.open") ?? true,
      pinned: optionalBoolean(left?.pinned, "left.pinned") ?? true,
      trigger: hover?.left_trigger_width,
    },
  } satisfies Record<
    NeoviewShellEdge,
    {
      enabled: boolean
      initialVisible: boolean
      pinned: boolean
      trigger: unknown
    }
  >
  const parsedSidebars = {
    left: sidebarConfig("left", left),
    right: sidebarConfig("right", right),
  }
  return {
    showDelayMs: secondsToMilliseconds(timing?.show_delay_sec, "[nodes.neoview.panels.auto_hide_timing].show_delay_sec"),
    hideDelayMs: secondsToMilliseconds(timing?.hide_delay_sec, "[nodes.neoview.panels.auto_hide_timing].hide_delay_sec"),
    opacity: {
      top: boundedNumber(panels.top_toolbar_opacity, 0, 100, Models.DEFAULT_NEOVIEW_SHELL_CONFIG.opacity.top, "top_toolbar_opacity"),
      bottom: boundedNumber(panels.bottom_bar_opacity, 0, 100, Models.DEFAULT_NEOVIEW_SHELL_CONFIG.opacity.bottom, "bottom_bar_opacity"),
      sidebar: boundedNumber(panels.sidebar_opacity, 0, 100, Models.DEFAULT_NEOVIEW_SHELL_CONFIG.opacity.sidebar, "sidebar_opacity"),
    },
    blur: {
      top: boundedNumber(panels.top_toolbar_blur, 0, 20, Models.DEFAULT_NEOVIEW_SHELL_CONFIG.blur.top, "top_toolbar_blur"),
      bottom: boundedNumber(panels.bottom_bar_blur, 0, 20, Models.DEFAULT_NEOVIEW_SHELL_CONFIG.blur.bottom, "bottom_bar_blur"),
      sidebar: boundedNumber(panels.sidebar_blur, 0, 20, Models.DEFAULT_NEOVIEW_SHELL_CONFIG.blur.sidebar, "sidebar_blur"),
    },
    material: {
      preset:
        optionalEnum(canonicalMaterial?.preset, "material.preset", ["solid", "soft", "frosted", "custom"] as const) ??
        Models.DEFAULT_NEOVIEW_SHELL_MATERIAL_CONFIG.preset,
      saturation: shellMaterialValues(canonicalMaterial, "saturation", 50, 180, Models.DEFAULT_NEOVIEW_SHELL_MATERIAL_CONFIG.saturation),
      highlight: shellMaterialValues(canonicalMaterial, "highlight", 0, 100, Models.DEFAULT_NEOVIEW_SHELL_MATERIAL_CONFIG.highlight),
      shadow: shellMaterialValues(canonicalMaterial, "shadow", 0, 100, Models.DEFAULT_NEOVIEW_SHELL_MATERIAL_CONFIG.shadow),
    },
    floatingControl: {
      enabled:
        optionalBoolean(canonicalControl?.enabled, "sidebar_control.enabled") ??
        optionalBoolean(legacyControl?.enabled, "reader.view.sidebar_control.enabled") ??
        Models.DEFAULT_NEOVIEW_SHELL_CONFIG.floatingControl.enabled,
      position: {
        x: boundedIntegerWithFallback(
          canonicalPosition?.x ?? legacyPosition?.x,
          0,
          32_767,
          Models.DEFAULT_NEOVIEW_SHELL_CONFIG.floatingControl.position.x,
          "sidebar_control.position.x",
        ),
        y: boundedIntegerWithFallback(
          canonicalPosition?.y ?? legacyPosition?.y,
          0,
          32_767,
          Models.DEFAULT_NEOVIEW_SHELL_CONFIG.floatingControl.position.y,
          "sidebar_control.position.y",
        ),
      },
    },
    edges: Object.fromEntries(
      NEOVIEW_SHELL_EDGES.map((edge) => [
        edge,
        edgeConfig(edge, optionalRecord(canonicalEdges?.[edge], `[nodes.neoview.panels.edges.${edge}]`), legacyEdges[edge]),
      ]),
    ) as Models.NeoviewShellConfig["edges"],
    sidebars: parsedSidebars,
    sidebarInteraction: {
      showDragHandle:
        optionalBoolean(canonicalInteraction?.show_drag_handle, "sidebar_interaction.show_drag_handle") ??
        Models.DEFAULT_NEOVIEW_SHELL_CONFIG.sidebarInteraction.showDragHandle,
      enableBlankAreaCollapse:
        optionalBoolean(canonicalInteraction?.enable_blank_area_collapse, "sidebar_interaction.enable_blank_area_collapse") ??
        Models.DEFAULT_NEOVIEW_SHELL_CONFIG.sidebarInteraction.enableBlankAreaCollapse,
      blankAreaCollapseMode:
        optionalEnum(canonicalInteraction?.blank_area_collapse_mode, "sidebar_interaction.blank_area_collapse_mode", ["single", "double"] as const) ??
        Models.DEFAULT_NEOVIEW_SHELL_CONFIG.sidebarInteraction.blankAreaCollapseMode,
    },
    workspace: parseWorkspaceConfig(panels, parsedSidebars),
    panelLayout: parsePanelLayout(panels),
    cardLayout: parseCardLayout(panels),
  }
}

function parseWorkspaceConfig(
  panels: Record<string, unknown>,
  sidebars: Models.NeoviewShellConfig["sidebars"],
): Models.NeoviewWorkspaceConfig {
  const source = optionalRecord(panels.swimlane, "[nodes.neoview.panels.swimlane]")
  const defaults = Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.swimlane
  const laneOrder = normalizedSwimlaneOrder(source?.lane_order ?? source?.laneOrder, defaults.laneOrder, "[nodes.neoview.panels.swimlane].lane_order")
  const laneIds = [...laneOrder]
  const reservedSwimlaneKeys = new Set([
    "lane_order", "laneOrder", "active_lane", "activeLane", "reader_solo", "readerSolo",
    "reader_solo_on_focus", "readerSoloOnFocus", "solo_lane", "soloLaneId",
    "reader_width_ratio", "readerWidthRatio", "edge_reveal_delay_ms", "edgeRevealDelayMs",
    "left_reveal_zone", "leftRevealZone", "right_reveal_zone", "rightRevealZone",
    "top_reveal_zone", "topRevealZone", "bottom_reveal_zone", "bottomRevealZone",
    "reader_focus_on_hover", "readerFocusOnHover", "reader_focus_hover_delay_ms", "readerFocusHoverDelayMs",
    "manual_scroll_enabled", "manualScrollEnabled",
    "show_lane_navigator_in_reader_solo", "showLaneNavigatorInReaderSolo",
    "auto_fit_to_viewport", "autoFitToViewport",
    "bar_handle_style", "barHandleStyle", "bar_handle_position", "barHandlePosition", "lane_navigator_position_x", "laneNavigatorPositionX",
    "lane_navigator_position_y", "laneNavigatorPositionY",
    "lane_navigator_dock", "laneNavigatorDock",
    "window_controls_placement", "windowControlsPlacement",
    "window_controls_owner_lane_id", "windowControlsOwnerLaneId",
    "window_controls_expanded", "windowControlsExpanded",
  ])
  for (const [key, value] of Object.entries(source ?? {})) {
    if (!reservedSwimlaneKeys.has(key) && value && typeof value === "object" && !Array.isArray(value) && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(key) && !laneIds.includes(key)) laneIds.push(key)
  }
  const lanes = Object.fromEntries(laneIds.map((laneId) => {
    const lane = optionalRecord(source?.[laneId], `[nodes.neoview.panels.swimlane].${laneId}`)
    const laneDefaults = defaults.lanes[laneId] ?? { width: 320, collapsed: false }
    const fallbackWidth = laneId === "left" ? sidebars.left.width : laneId === "right" ? sidebars.right.width : laneDefaults.width
    const activePanelValue = lane?.active_panel_id ?? lane?.activePanelId
    const panelBarMode = optionalEnum(lane?.panel_bar_mode ?? lane?.panelBarMode, `[nodes.neoview.panels.swimlane].${laneId}.panel_bar_mode`, Models.NEOVIEW_PANEL_BAR_MODES) ?? laneDefaults.panelBarMode
    const panelBarDock = optionalEnum(lane?.panel_bar_dock ?? lane?.panelBarDock, `[nodes.neoview.panels.swimlane].${laneId}.panel_bar_dock`, Models.NEOVIEW_PANEL_BAR_DOCKS) ?? laneDefaults.panelBarDock
    const panelBarPositionX = lane?.panel_bar_position_x ?? lane?.panelBarPositionX
    const panelBarPositionY = lane?.panel_bar_position_y ?? lane?.panelBarPositionY
    const panelBarConstrained = optionalBoolean(lane?.panel_bar_constrained ?? lane?.panelBarConstrained, `[nodes.neoview.panels.swimlane].${laneId}.panel_bar_constrained`) ?? laneDefaults.panelBarConstrained
    return [laneId, {
      width: swimlaneWidth(lane?.width, laneId, `[nodes.neoview.panels.swimlane].${laneId}.width`, fallbackWidth),
      collapsed: optionalBoolean(lane?.collapsed, `[nodes.neoview.panels.swimlane].${laneId}.collapsed`) ?? laneDefaults.collapsed,
      ...((lane?.title ?? laneDefaults.title) === undefined ? {} : {
        title: requireLaneTitle(lane?.title ?? laneDefaults.title, `[nodes.neoview.panels.swimlane].${laneId}.title`),
      }),
      ...(activePanelValue === undefined
        ? (laneDefaults.activePanelId ? { activePanelId: laneDefaults.activePanelId } : {})
        : { activePanelId: requireLayoutId(activePanelValue, `[nodes.neoview.panels.swimlane].${laneId}.active_panel_id`) }),
      ...(panelBarMode ? { panelBarMode } : {}),
      ...(panelBarDock ? { panelBarDock } : {}),
      ...(panelBarPositionX === undefined && laneDefaults.panelBarPositionX === undefined ? {} : {
        panelBarPositionX: boundedNumber(panelBarPositionX, 0, 100, laneDefaults.panelBarPositionX ?? 50, `[nodes.neoview.panels.swimlane].${laneId}.panel_bar_position_x`),
      }),
      ...(panelBarPositionY === undefined && laneDefaults.panelBarPositionY === undefined ? {} : {
        panelBarPositionY: boundedNumber(panelBarPositionY, 0, 100, laneDefaults.panelBarPositionY ?? 50, `[nodes.neoview.panels.swimlane].${laneId}.panel_bar_position_y`),
      }),
      ...(panelBarConstrained === undefined ? {} : { panelBarConstrained }),
    }]
  })) as Models.NeoviewSwimlaneConfig["lanes"]
  if (!source?.left) lanes.left.width = sidebars.left.width
  if (!source?.right) lanes.right.width = sidebars.right.width
  const activeLaneValue = source?.active_lane ?? source?.activeLane
  const activeLane = activeLaneValue === undefined
    ? defaults.activeLane
    : requireLayoutId(activeLaneValue, "[nodes.neoview.panels.swimlane].active_lane")
  const soloLaneValue = source?.solo_lane ?? source?.soloLaneId
  const soloLaneId = typeof soloLaneValue === "string" && soloLaneValue.trim()
    ? requireLayoutId(soloLaneValue, "[nodes.neoview.panels.swimlane].solo_lane")
    : undefined
  return {
    mode:
      optionalEnum(panels.layout_mode ?? panels.layoutMode, "[nodes.neoview.panels].layout_mode", Models.NEOVIEW_WORKSPACE_MODES) ??
      Models.DEFAULT_NEOVIEW_SHELL_CONFIG.workspace.mode,
    swimlane: {
      laneOrder,
      activeLane: laneOrder.includes(activeLane) ? activeLane : defaults.activeLane,
      readerSolo:
        optionalBoolean(source?.reader_solo ?? source?.readerSolo, "[nodes.neoview.panels.swimlane].reader_solo") ?? defaults.readerSolo,
      readerSoloOnFocus:
        optionalBoolean(source?.reader_solo_on_focus ?? source?.readerSoloOnFocus, "[nodes.neoview.panels.swimlane].reader_solo_on_focus") ?? defaults.readerSoloOnFocus,
      ...(soloLaneId && laneOrder.includes(soloLaneId) ? { soloLaneId } : {}),
      readerWidthRatio: readerWidthRatio(
        source?.reader_width_ratio ?? source?.readerWidthRatio,
        "[nodes.neoview.panels.swimlane].reader_width_ratio",
        Math.min(1, Math.max(0.25, lanes.reader.width / 1_920)),
      ),
      edgeRevealDelayMs: edgeRevealDelay(
        source?.edge_reveal_delay_ms ?? source?.edgeRevealDelayMs,
        "[nodes.neoview.panels.swimlane].edge_reveal_delay_ms",
        defaults.edgeRevealDelayMs,
      ),
      edgeRevealZones: {
        left: revealZone(source?.left_reveal_zone ?? source?.leftRevealZone ?? defaults.edgeRevealZones.left, "[nodes.neoview.panels.swimlane].left_reveal_zone", defaults.edgeRevealZones.left),
        right: revealZone(source?.right_reveal_zone ?? source?.rightRevealZone ?? defaults.edgeRevealZones.right, "[nodes.neoview.panels.swimlane].right_reveal_zone", defaults.edgeRevealZones.right),
        top: revealZone(source?.top_reveal_zone ?? source?.topRevealZone ?? defaults.edgeRevealZones.top, "[nodes.neoview.panels.swimlane].top_reveal_zone", defaults.edgeRevealZones.top),
        bottom: revealZone(source?.bottom_reveal_zone ?? source?.bottomRevealZone ?? defaults.edgeRevealZones.bottom, "[nodes.neoview.panels.swimlane].bottom_reveal_zone", defaults.edgeRevealZones.bottom),
      },
      readerFocusOnHover:
        optionalBoolean(source?.reader_focus_on_hover ?? source?.readerFocusOnHover, "[nodes.neoview.panels.swimlane].reader_focus_on_hover") ??
        defaults.readerFocusOnHover,
      readerFocusHoverDelayMs: readerFocusHoverDelay(
        source?.reader_focus_hover_delay_ms ?? source?.readerFocusHoverDelayMs,
        "[nodes.neoview.panels.swimlane].reader_focus_hover_delay_ms",
        defaults.readerFocusHoverDelayMs,
      ),
      manualScrollEnabled:
        optionalBoolean(source?.manual_scroll_enabled ?? source?.manualScrollEnabled, "[nodes.neoview.panels.swimlane].manual_scroll_enabled") ??
        defaults.manualScrollEnabled,
      showLaneNavigatorInReaderSolo:
        optionalBoolean(
          source?.show_lane_navigator_in_reader_solo ?? source?.showLaneNavigatorInReaderSolo,
          "[nodes.neoview.panels.swimlane].show_lane_navigator_in_reader_solo",
        ) ?? defaults.showLaneNavigatorInReaderSolo,
      autoFitToViewport:
        optionalBoolean(source?.auto_fit_to_viewport ?? source?.autoFitToViewport, "[nodes.neoview.panels.swimlane].auto_fit_to_viewport") ?? defaults.autoFitToViewport,
      barHandleStyle:
        optionalEnum(source?.bar_handle_style ?? source?.barHandleStyle, "[nodes.neoview.panels.swimlane].bar_handle_style", Models.NEOVIEW_BAR_HANDLE_STYLES) ?? defaults.barHandleStyle,
      barHandlePosition:
        optionalEnum(source?.bar_handle_position ?? source?.barHandlePosition, "[nodes.neoview.panels.swimlane].bar_handle_position", Models.NEOVIEW_BAR_HANDLE_POSITIONS) ?? defaults.barHandlePosition,
      laneNavigatorPositionX: boundedNumber(source?.lane_navigator_position_x ?? source?.laneNavigatorPositionX, 0, 100, defaults.laneNavigatorPositionX, "[nodes.neoview.panels.swimlane].lane_navigator_position_x"),
      laneNavigatorPositionY: boundedNumber(source?.lane_navigator_position_y ?? source?.laneNavigatorPositionY, 0, 100, defaults.laneNavigatorPositionY, "[nodes.neoview.panels.swimlane].lane_navigator_position_y"),
      laneNavigatorDock:
        optionalEnum(source?.lane_navigator_dock ?? source?.laneNavigatorDock, "[nodes.neoview.panels.swimlane].lane_navigator_dock", Models.NEOVIEW_LANE_NAVIGATOR_DOCKS) ?? defaults.laneNavigatorDock,
      windowControlsPlacement:
        optionalEnum(source?.window_controls_placement ?? source?.windowControlsPlacement, "[nodes.neoview.panels.swimlane].window_controls_placement", Models.NEOVIEW_WINDOW_CONTROLS_PLACEMENTS) ?? defaults.windowControlsPlacement,
      windowControlsOwnerLaneId: (() => {
        const owner = requireLayoutId(
          source?.window_controls_owner_lane_id ?? source?.windowControlsOwnerLaneId ?? defaults.windowControlsOwnerLaneId,
          "[nodes.neoview.panels.swimlane].window_controls_owner_lane_id",
        )
        return laneOrder.includes(owner) ? owner : laneOrder.at(-1) ?? defaults.windowControlsOwnerLaneId
      })(),
      windowControlsExpanded:
        optionalBoolean(source?.window_controls_expanded ?? source?.windowControlsExpanded, "[nodes.neoview.panels.swimlane].window_controls_expanded") ?? defaults.windowControlsExpanded,
      lanes,
    },
  }
}

function parseCardLayout(panels: Record<string, unknown>): Record<string, Models.NeoviewCardLayout> {
  const result: Record<string, Models.NeoviewCardLayout> = {
    ...Models.DEFAULT_NEOVIEW_SHELL_CONFIG.cardLayout,
  }
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
  const legacyAmbientBackground = canonical?.["ambient-background-settings"]
  if (canonical?.["ambient-background"] === undefined && legacyAmbientBackground !== undefined) {
    if (!isRecord(legacyAmbientBackground)) throw new Error("[nodes.neoview.panels.card_state.ambient-background-settings] must be a table.")
    result["ambient-background"] = parseCardValue(
      "ambient-background",
      undefined,
      legacyAmbientBackground,
      result["ambient-background"],
    )
  }
  for (const [cardId, value] of Object.entries(canonical ?? {})) {
    if (cardId === "ambient-background-settings") continue
    if (!isRecord(value)) throw new Error(`[nodes.neoview.panels.card_state.${cardId}] must be a table.`)
    result[cardId] = parseCardValue(cardId, undefined, value, result[cardId])
  }
  return result
}

function parseCardValue(
  cardId: string,
  legacyPanelId: string | undefined,
  value: Record<string, unknown>,
  fallback: Models.NeoviewCardLayout | undefined,
): Models.NeoviewCardLayout {
  const panelId = value.panel_id ?? value.panelId ?? legacyPanelId ?? fallback?.panelId
  if (typeof panelId !== "string" || !panelId) throw new Error(`${cardId}.panelId must be a non-empty string.`)
  return {
    panelId,
    visible: optionalBoolean(value.visible, `${cardId}.visible`) ?? fallback?.visible ?? true,
    expanded: optionalBoolean(value.expanded, `${cardId}.expanded`) ?? fallback?.expanded ?? true,
    order: boundedNumber(value.order, 0, 10_000, fallback?.order ?? 0, `${cardId}.order`),
    height:
      value.height === "auto" ? undefined : value.height === undefined ? fallback?.height : boundedNumber(value.height, 50, 4_096, 50, `${cardId}.height`),
  }
}

function parsePanelLayout(panels: Record<string, unknown>): Record<string, Models.NeoviewPanelLayout> {
  const layout = optionalRecord(panels.layout, "[nodes.neoview.panels.layout]")
  const source = optionalRecord(layout?.sidebarConfig, "[nodes.neoview.panels.layout.sidebarConfig]") ?? layout
  const values = source?.panels
  const result: Record<string, Models.NeoviewPanelLayout> = {
    ...Models.DEFAULT_NEOVIEW_SHELL_CONFIG.panelLayout,
  }
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
  legacy: {
    enabled: boolean
    initialVisible: boolean
    pinned: boolean
    trigger: unknown
  },
): Models.NeoviewShellEdgeConfig {
  return {
    enabled: optionalBoolean(canonical?.enabled, `${edge}.enabled`) ?? legacy.enabled,
    initialVisible: optionalBoolean(canonical?.initial_visible, `${edge}.initial_visible`) ?? legacy.initialVisible,
    pinned: optionalBoolean(canonical?.pinned, `${edge}.pinned`) ?? legacy.pinned,
    triggerSize: boundedNumber(canonical?.trigger_size ?? legacy.trigger, 1, 128, 32, `${edge} trigger`),
    lockMode: shellEdgeLockMode(canonical?.lock_mode, `${edge}.lock_mode`),
  }
}

function shellEdgeLockMode(value: unknown, path: string): Models.NeoviewShellEdgeLockMode {
  return optionalEnum(value, path, ["auto", "locked-open", "locked-hidden"] as const) ?? "auto"
}

function sidebarConfig(side: "left" | "right", value: Record<string, unknown> | undefined): Models.NeoviewShellSidebarConfig {
  return {
    width: boundedNumber(value?.width, 200, 600, side === "left" ? 320 : 280, `${side}.width`),
    height: sidebarHeight(value?.height, `${side}.height`),
    customHeight: boundedNumber(value?.custom_height, 10, 100, 100, `${side}.custom_height`),
    verticalAlign: boundedNumber(value?.vertical_align, 0, 100, 0, `${side}.vertical_align`),
    horizontalPosition: boundedNumber(value?.horizontal_position, 0, 100, 0, `${side}.horizontal_position`),
  }
}

function sidebarHeight(value: unknown, path: string): Models.NeoviewShellSidebarConfig["height"] {
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
): Models.NeoviewSlideshowConfig {
  const interval =
    canonical?.interval_seconds ??
    canonical?.default_interval ??
    canonical?.defaultInterval ??
    legacy?.interval_seconds ??
    legacy?.default_interval ??
    legacy?.defaultInterval ??
    legacyBook?.auto_page_turn_interval ??
    legacyBook?.autoPageTurnInterval
  return {
    intervalSeconds: normalizedSlideshowInterval(interval, "NeoView slideshow interval"),
    loop: optionalBoolean(canonical?.loop ?? legacy?.loop, "NeoView slideshow loop") ?? Models.DEFAULT_NEOVIEW_SLIDESHOW_CONFIG.loop,
    random: optionalBoolean(canonical?.random ?? legacy?.random, "NeoView slideshow random") ?? Models.DEFAULT_NEOVIEW_SLIDESHOW_CONFIG.random,
    fadeTransition:
      optionalBoolean(
        canonical?.fade_transition ?? canonical?.fadeTransition ?? legacy?.fade_transition ?? legacy?.fadeTransition,
        "NeoView slideshow fade transition",
      ) ?? Models.DEFAULT_NEOVIEW_SLIDESHOW_CONFIG.fadeTransition,
  }
}

function normalizedSlideshowInterval(value: unknown, path: string): number {
  if (value === undefined) return Models.DEFAULT_NEOVIEW_SLIDESHOW_CONFIG.intervalSeconds
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
  if (value === "fit") return "fit"
  if (value === "fitLeftAlign" || value === "fit-left") return "fit-left"
  if (value === "fitRightAlign" || value === "fit-right") return "fit-right"
  if (value === "fill" || value === "original") return value
  if (value === "fitWidth" || value === "fit-width") return "fit-width"
  if (value === "fitHeight" || value === "fit-height") return "fit-height"
  throw new Error(`${path} must be fit, fill, fitWidth, fitHeight, original, fitLeftAlign or fitRightAlign.`)
}

function persistedReaderFitMode(value: ReaderFitMode): string {
  if (value === "fit-width") return "fitWidth"
  if (value === "fit-height") return "fitHeight"
  if (value === "fit-left") return "fitLeftAlign"
  if (value === "fit-right") return "fitRightAlign"
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

function normalizedEmmPaths(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value) || value.length > 8) throw new Error(`${path} must be an array containing at most 8 paths.`)
  const paths: string[] = []
  const seen = new Set<string>()
  for (const [index, entry] of value.entries()) {
    const normalized = optionalConfigPath(entry, `${path}[${index}]`)
    if (!normalized) throw new Error(`${path}[${index}] must not be empty.`)
    if (normalized.length > 4096) throw new Error(`${path}[${index}] must contain at most 4096 characters.`)
    const identity = normalized.replaceAll("\\", "/").toLocaleLowerCase()
    if (seen.has(identity)) continue
    seen.add(identity)
    paths.push(normalized)
  }
  return paths
}

function readerAutoRotation(value: unknown): ReaderAutoRotation {
  if (value === undefined) return DEFAULT_READER_PRESENTATION.autoRotation
  const aliases: Record<string, ReaderAutoRotation> = {
    none: "none",
    left: "left",
    right: "right",
    horizontalLeft: "horizontal-left",
    "horizontal-left": "horizontal-left",
    horizontalRight: "horizontal-right",
    "horizontal-right": "horizontal-right",
    forcedLeft: "forced-left",
    "forced-left": "forced-left",
    forcedRight: "forced-right",
    "forced-right": "forced-right",
  }
  if (typeof value !== "string" || !aliases[value]) throw new Error("reader auto rotation is invalid.")
  return aliases[value]
}

function persistedReaderAutoRotation(value: ReaderAutoRotation): string {
  return value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

function readerWidePageStretch(value: unknown): ReaderWidePageStretch {
  if (value === undefined) return DEFAULT_READER_PRESENTATION.widePageStretch
  const aliases: Record<string, ReaderWidePageStretch> = {
    none: "none",
    uniformHeight: "uniform-height",
    "uniform-height": "uniform-height",
    uniformWidth: "uniform-width",
    "uniform-width": "uniform-width",
  }
  if (typeof value !== "string" || !aliases[value]) throw new Error("reader wide page stretch is invalid.")
  return aliases[value]
}

function persistedReaderWidePageStretch(value: ReaderWidePageStretch): string {
  return value === "uniform-height" ? "uniformHeight" : value === "uniform-width" ? "uniformWidth" : value
}

function shellMaterialValues(
  source: Record<string, unknown> | undefined,
  key: "saturation" | "highlight" | "shadow",
  minimum: number,
  maximum: number,
  defaults: Models.NeoviewShellSurfaceValues,
): Models.NeoviewShellSurfaceValues {
  return Object.fromEntries(
    NEOVIEW_SHELL_SURFACES.map((surface) => [
      surface,
      boundedNumber(source?.[`${surface}_${key}`], minimum, maximum, defaults[surface], `material.${surface}_${key}`),
    ]),
  ) as Models.NeoviewShellSurfaceValues
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

function requiredManifestScaleFiles(value: unknown, scales: readonly number[], path: string): Readonly<Record<number, string>> {
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

function optionalStringRecord(value: unknown, fallback: Readonly<Record<string, string>>, path: string): Readonly<Record<string, string>> {
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

function requireLaneTitle(value: unknown, path: string): string {
  if (typeof value !== "string") throw new Error(`${path} must be a string.`)
  const title = value.trim()
  if (!title || title.length > 80) throw new Error(`${path} must contain 1 to 80 characters.`)
  return title
}

function optionalEnum<const Values extends readonly string[]>(value: unknown, path: string, values: Values): Values[number] | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string" || !values.includes(value)) {
    throw new Error(`${path} must be one of: ${values.join(", ")}.`)
  }
  return value as Values[number]
}

function parseFolderHoverPreviewDelay(value: unknown, path: string): Models.NeoviewFolderHoverPreviewDelay {
  const delay = boundedInteger(value, 0, 2_000, path)
  if (!Models.NEOVIEW_FOLDER_HOVER_PREVIEW_DELAYS.includes(delay as Models.NeoviewFolderHoverPreviewDelay)) {
    throw new Error(`${path} must be one of: ${Models.NEOVIEW_FOLDER_HOVER_PREVIEW_DELAYS.join(", ")}.`)
  }
  return delay as Models.NeoviewFolderHoverPreviewDelay
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
