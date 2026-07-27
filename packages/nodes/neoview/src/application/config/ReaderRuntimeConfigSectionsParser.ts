import { DEFAULT_READER_COLOR_FILTER, normalizeReaderColorFilter, parseReaderColorFilterPatch, type ReaderColorFilterPatch, type ReaderColorFilterSettings } from "../../domain/color-filter/ReaderColorFilter.js"
import { DEFAULT_READER_PAGE_TRANSITION, normalizeReaderPageTransition, parseReaderPageTransitionPatch, type ReaderPageTransitionPatch, type ReaderPageTransitionSettings } from "../../domain/page-transition/ReaderPageTransition.js"
import { DEFAULT_READER_SWITCH_TOAST, normalizeReaderSwitchToast, parseReaderSwitchToastPatch, type ReaderSwitchToastPatch, type ReaderSwitchToastSettings } from "../switch-toast/ReaderSwitchToast.js"
import { DEFAULT_READER_INFO_OVERLAY, parseReaderInfoOverlayPatch, type ReaderInfoOverlayPatch } from "../info-overlay/ReaderInfoOverlay.js"
import { DEFAULT_READER_IMAGE_TRIM, parseReaderImageTrimPatch, projectReaderImageTrimPatch, type ReaderImageTrimPatch, type ReaderImageTrimSettings } from "../image-trim/ReaderImageTrim.js"
import * as Models from "./ReaderRuntimeConfigModels.js"
import { boundedNumber, boundedInteger, boundedIntegerWithFallback, optionalConfigPath, optionalBoolean, requiredBoolean, optionalEnum, optionalRecord, requireRecord } from "./ReaderRuntimeConfigParserPrimitives.js"

export function parseNeoviewBackgroundConfig(view: Record<string, unknown> | undefined): Models.NeoviewBackgroundConfig {
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
export function parseEmmConfig(value: Record<string, unknown> | undefined): Models.NeoviewEmmConfig {
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
export function parseSystemMonitorConfig(value: Record<string, unknown> | undefined): Models.NeoviewSystemMonitorConfig {
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
export function parseAiTranslationConfig(value: Record<string, unknown> | undefined): Models.NeoviewAiTranslationConfig {
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
export function parseAiTranslationService(value: unknown, path: string, fallback: Models.NeoviewAiTranslationService): Models.NeoviewAiTranslationService {
  if (value === undefined) return fallback
  if (typeof value !== "string" || !Models.NEOVIEW_AI_TRANSLATION_SERVICES.includes(value as Models.NeoviewAiTranslationService)) {
    throw new Error(`${path} must be one of ${Models.NEOVIEW_AI_TRANSLATION_SERVICES.join(", ")}.`)
  }
  return value as Models.NeoviewAiTranslationService
}
export function optionalTrimmedString(value: unknown, max: number, path: string): string | undefined {
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
export function parseSystemMonitorInterval(value: unknown, path: string, fallback?: Models.NeoviewSystemMonitorInterval): Models.NeoviewSystemMonitorInterval {
  if (value === undefined && fallback !== undefined) return fallback
  const interval = boundedInteger(value, 500, 5_000, path)
  if (!Models.NEOVIEW_SYSTEM_MONITOR_INTERVALS.includes(interval as Models.NeoviewSystemMonitorInterval)) {
    throw new Error(`${path} must be one of: ${Models.NEOVIEW_SYSTEM_MONITOR_INTERVALS.join(", ")}.`)
  }
  return interval as Models.NeoviewSystemMonitorInterval
}
export function parsePreloadConfig(
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
export function parseColorFilterConfig(value: Record<string, unknown> | undefined): ReaderColorFilterSettings {
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
export function parsePageTransitionConfig(value: Record<string, unknown> | undefined): ReaderPageTransitionSettings {
  if (!value) return DEFAULT_READER_PAGE_TRANSITION
  return normalizeReaderPageTransition({
    enabled: value.enabled,
    type: value.type,
    duration: value.duration,
    easing: value.easing, renderEveryRepeatedPage: value.render_every_repeated_page ?? value.renderEveryRepeatedPage,
  })
}
export function parseSwitchToastConfig(value: Record<string, unknown> | undefined, legacy: { showBookSwitchToast?: unknown }): ReaderSwitchToastSettings {
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
export function imageTrimToml(value: ReaderImageTrimPatch | ReaderImageTrimSettings): Record<string, unknown> {
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
export function infoOverlayToml(value: ReaderInfoOverlayPatch | { reset: "defaults" }): Record<string, unknown> {
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
export function switchToastToml(value: ReaderSwitchToastPatch): Record<string, unknown> {
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
export function pageTransitionToml(value: ReaderPageTransitionPatch): Record<string, unknown> {
  const toml: Record<string, unknown> = {}
  if (value.enabled !== undefined) toml.enabled = value.enabled
  if (value.type !== undefined) toml.type = value.type
  if (value.duration !== undefined) toml.duration = value.duration
  if (value.easing !== undefined) toml.easing = value.easing
  if (value.renderEveryRepeatedPage !== undefined) toml.render_every_repeated_page = value.renderEveryRepeatedPage
  return toml
}
export function colorFilterToml(value: ReaderColorFilterPatch): Record<string, unknown> {
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
export function normalizedEmmPaths(value: unknown, path: string): readonly string[] {
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
