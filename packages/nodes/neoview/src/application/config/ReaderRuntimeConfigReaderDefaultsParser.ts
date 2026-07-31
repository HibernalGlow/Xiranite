import { parseReaderMouseCursorPatch } from "./ReaderMouseCursorConfig.js"
import { READER_MEDIA_PRIORITY_MODES, READER_PAGE_SORT_MODES } from "../reader/ReaderPageOrder.js"
import * as Models from "./ReaderRuntimeConfigModels.js"
import { boundedNumber, boundedInteger, mebibytes, readerFitMode, persistedReaderFitMode, readerAutoRotation, persistedReaderAutoRotation, readerWidePageStretch, persistedReaderWidePageStretch, optionalBoolean, requiredBoolean, optionalEnum, optionalRecord, requireRecord } from "./ReaderRuntimeConfigParserPrimitives.js"
import { normalizedBookmarkListId } from "./ReaderRuntimeConfigFolderParser.js"

export function parsePresentationDiskCache(value: Record<string, unknown> | undefined): Models.NeoviewPresentationDiskCacheConfig {
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
  const allowed = new Set(["viewMode", "viewOverrides", "autoCleanup"])
  const unknown = Object.keys(preferences).filter((key) => !allowed.has(key))
  if (unknown.length) throw new Error(`reader history list patch contains unsupported fields: ${unknown.join(", ")}.`)
  const patch: Models.NeoviewHistoryListPatch = { historyList: {} }
  const toml: Record<string, unknown> = {}
  let overrideParsed = false
  if (preferences.viewOverrides !== undefined) {
    const parsed = parseFilePresentationOverridePatch(preferences.viewOverrides, "reader history list patch.viewOverrides")
    patch.historyList.viewOverrides = parsed.patch
    toml.view_overrides = parsed.tomlPatch
    overrideParsed = true
    if (Object.hasOwn(parsed.patch, "viewMode")) toml.view_mode = null
  }
  if (preferences.viewMode !== undefined) {
    const legacyViewMode = optionalEnum(preferences.viewMode, "reader history list patch.viewMode", ["compact", "content", "banner", "thumbnail"] as const)!
    patch.historyList.viewMode = legacyViewMode
    if (!Object.hasOwn(patch.historyList.viewOverrides ?? {}, "viewMode")) {
      const canonical = legacyHistoryViewMode(legacyViewMode)
      patch.historyList.viewOverrides = { ...patch.historyList.viewOverrides, viewMode: canonical }
      toml.view_overrides = { ...(toml.view_overrides as Record<string, unknown> | undefined), view_mode: canonical }
      toml.view_mode = null
    }
  }
  if (preferences.autoCleanup !== undefined) {
    const cleanup = requireRecord(preferences.autoCleanup, "reader history list patch.autoCleanup")
    const cleanupAllowed = new Set(["enabled", "trigger", "intervalMinutes"])
    const cleanupUnknown = Object.keys(cleanup).filter((key) => !cleanupAllowed.has(key))
    if (cleanupUnknown.length) throw new Error(`reader history auto cleanup patch contains unsupported fields: ${cleanupUnknown.join(", ")}.`)
    const cleanupPatch: Partial<Models.NeoviewHistoryAutoCleanupConfig> = {}
    const cleanupToml: Record<string, unknown> = {}
    if (cleanup.enabled !== undefined) {
      cleanupPatch.enabled = requiredBoolean(cleanup.enabled, "reader history list patch.autoCleanup.enabled")
      cleanupToml.enabled = cleanupPatch.enabled
    }
    if (cleanup.trigger !== undefined) {
      cleanupPatch.trigger = optionalEnum(cleanup.trigger, "reader history list patch.autoCleanup.trigger", Models.NEOVIEW_HISTORY_AUTO_CLEANUP_TRIGGERS)!
      cleanupToml.trigger = cleanupPatch.trigger
    }
    if (cleanup.intervalMinutes !== undefined) {
      cleanupPatch.intervalMinutes = boundedInteger(cleanup.intervalMinutes, 5, 10_080, "reader history list patch.autoCleanup.intervalMinutes")
      cleanupToml.interval_minutes = cleanupPatch.intervalMinutes
    }
    if (!Object.keys(cleanupPatch).length) throw new Error("reader history auto cleanup patch must change at least one field.")
    patch.historyList.autoCleanup = cleanupPatch
    toml.auto_cleanup = cleanupToml
  }
  if (preferences.viewMode === undefined && !overrideParsed && preferences.autoCleanup === undefined) {
    throw new Error("reader history list patch must change viewMode, viewOverrides or autoCleanup.")
  }
  return {
    patch,
    tomlPatch: { history_list: toml },
  }
}
export function parseNeoviewBookmarkListPatch(value: unknown): {
  patch: Models.NeoviewBookmarkListPatch
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader bookmark list patch")
  if (Object.keys(record).some((key) => key !== "bookmarkList")) throw new Error("reader bookmark list patch contains unsupported fields.")
  const preferences = requireRecord(record.bookmarkList, "reader bookmark list patch.bookmarkList")
  const allowed = new Set(["activeListId", "viewOverrides"])
  const unknown = Object.keys(preferences).filter((key) => !allowed.has(key))
  if (unknown.length) throw new Error(`reader bookmark list patch contains unsupported fields: ${unknown.join(", ")}.`)
  const patch: Models.NeoviewBookmarkListPatch = { bookmarkList: {} }
  const toml: Record<string, unknown> = {}
  if (preferences.activeListId !== undefined) {
    patch.bookmarkList.activeListId = normalizedBookmarkListId(preferences.activeListId, "reader bookmark list patch.activeListId")
    toml.active_list_id = patch.bookmarkList.activeListId
  }
  if (preferences.viewOverrides !== undefined) {
    const parsed = parseFilePresentationOverridePatch(preferences.viewOverrides, "reader bookmark list patch.viewOverrides")
    patch.bookmarkList.viewOverrides = parsed.patch
    toml.view_overrides = parsed.tomlPatch
  }
  if (!Object.keys(patch.bookmarkList).length) throw new Error("reader bookmark list patch must change activeListId or viewOverrides.")
  return {
    patch,
    tomlPatch: { bookmark_list: toml },
  }
}
export function parseFilePresentationOverrides(
  section: Record<string, unknown> | undefined,
  legacyViewMode: Models.NeoviewHistoryListConfig["viewMode"] | undefined,
  label: string,
): Models.NeoviewFilePresentationOverrides {
  const record = optionalRecord(section?.view_overrides ?? section?.viewOverrides, `${label}.view_overrides`)
  const overrides: Models.NeoviewFilePresentationOverrides = {}
  const configuredViewMode = record?.view_mode ?? record?.viewMode
  if (configuredViewMode !== undefined) {
    overrides.viewMode = optionalEnum(
      configuredViewMode,
      `${label}.view_overrides.view_mode`,
      Models.NEOVIEW_FILE_PRESENTATION_VIEW_MODES,
    )
  } else if (legacyViewMode !== undefined) {
    overrides.viewMode = legacyHistoryViewMode(legacyViewMode)
  }
  const contentWidth = record?.content_width_percent ?? record?.contentWidthPercent
  if (contentWidth !== undefined) overrides.contentWidthPercent = boundedInteger(contentWidth, 20, 70, `${label}.view_overrides.content_width_percent`)
  const thumbnailWidth = record?.thumbnail_width_percent ?? record?.thumbnailWidthPercent
  if (thumbnailWidth !== undefined) overrides.thumbnailWidthPercent = boundedInteger(thumbnailWidth, 10, 90, `${label}.view_overrides.thumbnail_width_percent`)
  const bannerWidth = record?.banner_width_percent ?? record?.bannerWidthPercent
  if (bannerWidth !== undefined) overrides.bannerWidthPercent = boundedInteger(bannerWidth, 20, 100, `${label}.view_overrides.banner_width_percent`)
  return overrides
}
export function parseFilePresentationOverridePatch(value: unknown, label: string): {
  patch: Models.NeoviewFilePresentationOverridePatch
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, label)
  const allowed = new Set(["viewMode", "contentWidthPercent", "thumbnailWidthPercent", "bannerWidthPercent"])
  const unknown = Object.keys(record).filter((key) => !allowed.has(key))
  if (unknown.length) throw new Error(`${label} contains unsupported fields: ${unknown.join(", ")}.`)
  if (!Object.keys(record).length) throw new Error(`${label} must change at least one field.`)
  const patch: Models.NeoviewFilePresentationOverridePatch = {}
  const tomlPatch: Record<string, unknown> = {}
  if (Object.hasOwn(record, "viewMode")) {
    patch.viewMode = record.viewMode === null
      ? null
      : optionalEnum(record.viewMode, `${label}.viewMode`, Models.NEOVIEW_FILE_PRESENTATION_VIEW_MODES)
    tomlPatch.view_mode = patch.viewMode
  }
  if (Object.hasOwn(record, "contentWidthPercent")) {
    patch.contentWidthPercent = record.contentWidthPercent === null
      ? null
      : boundedInteger(record.contentWidthPercent, 20, 70, `${label}.contentWidthPercent`)
    tomlPatch.content_width_percent = patch.contentWidthPercent
  }
  if (Object.hasOwn(record, "thumbnailWidthPercent")) {
    patch.thumbnailWidthPercent = record.thumbnailWidthPercent === null
      ? null
      : boundedInteger(record.thumbnailWidthPercent, 10, 90, `${label}.thumbnailWidthPercent`)
    tomlPatch.thumbnail_width_percent = patch.thumbnailWidthPercent
  }
  if (Object.hasOwn(record, "bannerWidthPercent")) {
    patch.bannerWidthPercent = record.bannerWidthPercent === null
      ? null
      : boundedInteger(record.bannerWidthPercent, 20, 100, `${label}.bannerWidthPercent`)
    tomlPatch.banner_width_percent = patch.bannerWidthPercent
  }
  return { patch, tomlPatch }
}
export function legacyHistoryViewMode(value: Models.NeoviewHistoryListConfig["viewMode"]): Models.NeoviewFilePresentationViewMode {
  if (value === "content") return "cover-list"
  if (value === "banner") return "mosaic-list"
  if (value === "thumbnail") return "cover-grid"
  return "compact"
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
export function parseBookConfig(canonical: Record<string, unknown> | undefined, legacy: Record<string, unknown> | undefined): Models.NeoviewBookConfig {
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
    "magnifierSize", "mouseCursor",
    "orientation",
    "autoRotation",
    "widePageStretch",
    "background",
  ])
  const unknown = Object.keys(defaults).filter((key) => !allowed.has(key))
  if (unknown.length) throw new Error(`reader view defaults patch contains unsupported fields: ${unknown.join(", ")}.`)
  const patch: Models.NeoviewViewDefaultsPatch = { viewDefaults: {} }
  const readerPatch: Record<string, unknown> = {}
  const magnifierPatch: Record<string, unknown> = {}; const mouseCursorPatch: Record<string, unknown> = {}
  const backgroundPatch: Record<string, unknown> = {}; if (defaults.mouseCursor !== undefined) { const next = parseReaderMouseCursorPatch(defaults.mouseCursor); patch.viewDefaults.mouseCursor = next.patch; Object.assign(mouseCursorPatch, next.tomlPatch) }
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
    ...(Object.keys(magnifierPatch).length ? { magnifier: magnifierPatch } : {}), ...(Object.keys(mouseCursorPatch).length ? { mouse_cursor: mouseCursorPatch } : {}),
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
export function parseSlideshowConfig(
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
export function normalizedSlideshowInterval(value: unknown, path: string): number {
  if (value === undefined) return Models.DEFAULT_NEOVIEW_SLIDESHOW_CONFIG.intervalSeconds
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number.`)
  return Math.min(60, Math.max(1, Math.round(value)))
}
