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
import { parseReaderRadialMenuConfig, type ReaderRadialMenuConfig } from "./ReaderRadialMenuConfig.js"; import { parseReaderMouseCursorPatch, parseReaderMouseCursorSettings } from "./ReaderMouseCursorConfig.js"
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
import { parseInlineBranchConfigPatch, readInlineBranchConfig } from "./ReaderInlineBranchConfigParser.js"
import { boundedNumber, boundedInteger, boundedIntegerWithFallback, mebibytes, parseTailOverflow, readerFitMode, persistedReaderFitMode, nestedValue, optionalStringArray, optionalConfigPath, readerAutoRotation, persistedReaderAutoRotation, readerWidePageStretch, persistedReaderWidePageStretch, requiredManifestIdentifier, requiredManifestText, requiredManifestPath, requiredManifestPaths, requiredManifestScales, requiredManifestNoise, requiredManifestScaleFiles, requiredManifestEngine, optionalHttpsUrl, requiredStringArray, optionalStringRecord, requiredStringRecord, optionalBoolean, requiredBoolean, requireLayoutId, requireLaneTitle, optionalEnum, optionalRecord, requireRecord, isRecord } from "./ReaderRuntimeConfigParserPrimitives.js"
import { parseSuperResolutionConfig } from "./ReaderRuntimeConfigSuperResolutionParser.js"
import { parseMediaConfig } from "./ReaderRuntimeConfigMediaParser.js"
import { parseNeoviewBackgroundConfig, parseEmmConfig, parseSystemMonitorConfig, parseAiTranslationConfig, parsePreloadConfig, parseColorFilterConfig, parsePageTransitionConfig, parseSwitchToastConfig } from "./ReaderRuntimeConfigSectionsParser.js"
import { parseFileTreeConfig, parseFolderViewConfig, normalizedBookmarkListId } from "./ReaderRuntimeConfigFolderParser.js"
import { NEOVIEW_SHELL_EDGES, NEOVIEW_SHELL_SURFACES, normalizedSwimlaneOrder, swimlaneWidth, readerWidthRatio, revealZone, readerFocusHoverDelay, edgeRevealDelay, shellEdgeLockMode, sidebarHeight } from "./ReaderRuntimeConfigShellPatchParser.js"
import type { NeoviewShellEdge } from "./ReaderRuntimeConfigShellPatchParser.js"
import { parseShellOptions } from "./ReaderRuntimeConfigShellParser.js"
import { parsePresentationDiskCache, parseFilePresentationOverrides, parseBookConfig, parseSlideshowConfig } from "./ReaderRuntimeConfigReaderDefaultsParser.js"
export { parseNeoviewSlideshowPatch, parseNeoviewHistoryListPatch, parseNeoviewBookmarkListPatch, parseNeoviewPageListPatch, parseNeoviewBookPatch, parseNeoviewViewDefaultsPatch } from "./ReaderRuntimeConfigReaderDefaultsParser.js"
export { parseNeoviewShellControlPatch, parseNeoviewSidebarLayoutPatch, parseNeoviewCardLayoutPatch, parseNeoviewBoardLayoutPatch } from "./ReaderRuntimeConfigShellPatchParser.js"
export { parseNeoviewFolderViewPatch } from "./ReaderRuntimeConfigFolderParser.js"
export { parseNeoviewEmmPatch, parseNeoviewSystemMonitorPatch, parseNeoviewAiTranslationPatch, parseNeoviewPreloadPatch, parseNeoviewColorFilterPatch, parseNeoviewPageTransitionPatch, parseNeoviewSwitchToastPatch, parseNeoviewInfoOverlayPatch, parseNeoviewImageTrimPatch } from "./ReaderRuntimeConfigSectionsParser.js"
export { parseNeoviewMediaPatch } from "./ReaderRuntimeConfigMediaParser.js"
export { parseNeoviewSuperResolutionPreferencesPatch } from "./ReaderRuntimeConfigSuperResolutionParser.js"

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
  if (schemaVersion !== 1) throw new Error(`[nodes.neoview].schema_version must be 1, received{String(schemaVersion)}.`)
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
  const magnifier = optionalRecord(view?.magnifier ?? nestedValue(reader, "view", "magnifier"), "[nodes.neoview.view.magnifier]"); const mouseCursor = parseReaderMouseCursorSettings(view?.mouse_cursor ?? view?.mouseCursor ?? nestedValue(reader, "view", "mouse_cursor") ?? nestedValue(reader, "view", "mouseCursor"))
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
      magnifierSize, mouseCursor,
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
      viewOverrides: parseFilePresentationOverrides(bookmarkList, undefined, "[nodes.neoview.bookmark_list]"),
    },
    historyList: {
      viewMode:
        optionalEnum(historyList?.view_mode, "[nodes.neoview.history_list].view_mode", ["compact", "content", "banner", "thumbnail"] as const) ??
        Models.DEFAULT_NEOVIEW_HISTORY_LIST_CONFIG.viewMode,
      viewOverrides: parseFilePresentationOverrides(
        historyList,
        optionalEnum(historyList?.view_mode, "[nodes.neoview.history_list].view_mode", ["compact", "content", "banner", "thumbnail"] as const),
        "[nodes.neoview.history_list]",
      ),
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
