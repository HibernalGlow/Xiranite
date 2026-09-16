import { describe, expect, it } from "vitest"
import { parseNeoviewBoardLayoutPatch, parseNeoviewBookPatch, parseNeoviewBookmarkListPatch, parseNeoviewCardLayoutPatch, parseNeoviewEmmPatch, parseNeoviewFolderViewPatch, parseNeoviewHistoryListPatch, parseNeoviewPageListPatch, parseNeoviewPageTransitionPatch, parseNeoviewRuntimeConfig, parseNeoviewShellControlPatch, parseNeoviewSidebarLayoutPatch, parseNeoviewSlideshowPatch, parseNeoviewStartupPatch, parseNeoviewSystemMonitorPatch, parseNeoviewViewDefaultsPatch } from "./ReaderRuntimeConfig.js"

describe("parseNeoviewRuntimeConfig", () => {
  it("[neoview.settings.runtime] maps schema v1 reader defaults", () => {
      expect(parseNeoviewRuntimeConfig({
        schema_version: 1,
        reader: {
          reading_direction: "right-to-left",
          double_page_view: true,
          default_zoom_mode: "fitWidth",
          tail_overflow_behavior: "seamless-loop",
        },
      }).sessionOptions).toEqual({
        direction: "right-to-left",
        layout: {
          pageMode: "double",
          panorama: false,
          singleFirstPage: true,
          singleLastPage: true,
          treatWidePageAsSingle: true,
          splitWidePages: false,
        },
        tailOverflow: "seamless-loop",
      })
      expect(parseNeoviewRuntimeConfig({ reader: { double_page_view: true, default_zoom_mode: "fitWidth" } }).viewDefaults).toMatchObject({
        fitMode: "fit-width",
        pageMode: "double",
        doublePageGap: 0,
        splitWidePages: false,
        hoverScrollEnabled: true,
        hoverScrollSpeed: 2,
        magnifierZoom: 2,
        magnifierSize: 200,
        orientation: "horizontal",
        autoRotation: "none",
        widePageStretch: "uniform-height",
        background: {
          color: "#000000",
          mode: "solid",
          ambient: { style: "vibrant", speed: 8, blur: 80, opacity: 0.8 },
          aurora: { showRadialGradient: true },
          spotlight: { color: "white" },
        },
      })
    })

  it("accepts the nested v1 compatibility shape and legacy tail aliases", () => {
      expect(parseNeoviewRuntimeConfig({
        reader: {
          book: {
            reading_direction: "left-to-right",
            double_page_view: false,
            tail_overflow_behavior: "nextBook",
          },
        },
      }).sessionOptions).toMatchObject({
        direction: "left-to-right",
        layout: { pageMode: "single" },
        tailOverflow: "next-book",
      })
    })

  it("rejects unsupported schema versions and invalid executable settings", () => {
      expect(() => parseNeoviewRuntimeConfig({ schema_version: 2 })).toThrow("schema_version must be 1")
      expect(() => parseNeoviewRuntimeConfig({ reader: { reading_direction: "top-to-bottom" } })).toThrow("reading_direction")
      expect(() => parseNeoviewRuntimeConfig({ reader: { double_page_view: "yes" } })).toThrow("double_page_view")
      expect(() => parseNeoviewRuntimeConfig({ reader: { tail_overflow_behavior: "delete-book" } })).toThrow("tail_overflow_behavior")
      expect(() => parseNeoviewRuntimeConfig({ reader: { default_zoom_mode: "stretch" } })).toThrow("default_zoom_mode")
    })

  it("returns empty defaults when no NeoView section exists", () => {
      expect(parseNeoviewRuntimeConfig(undefined)).toMatchObject({
        schemaVersion: 1,
        sessionOptions: {},
        viewDefaults: { fitMode: "fit", pageMode: "single" },
        slideshow: { intervalSeconds: 5, loop: false, random: false, fadeTransition: true },
        shellOptions: {
          showDelayMs: 0,
          edges: { left: { pinned: true, triggerSize: 32 }, right: { initialVisible: true } },
          sidebars: { left: { width: 320 }, right: { width: 280 } },
        },
      })
    })

  it("[neoview.settings.presentation-cache] parses the bounded L3 cache policy from node TOML", () => {
      expect(parseNeoviewRuntimeConfig({ performance: { presentation_disk_cache: {
        enabled: true,
        directory: "D:/cache/neoview",
        max_size_mb: 4096,
        max_entry_size_mb: 48,
        max_age_days: 45,
        trim_ratio: 0.75,
        min_free_space_mb: 1024,
      } } }).presentationDiskCache).toEqual({
        enabled: true,
        directory: "D:/cache/neoview",
        maxBytes: 4096 * 1024 * 1024,
        maxEntryBytes: 48 * 1024 * 1024,
        maxAgeMs: 45 * 24 * 60 * 60 * 1000,
        trimRatio: 0.75,
        minFreeBytes: 1024 * 1024 * 1024,
      })
      expect(() => parseNeoviewRuntimeConfig({ performance: { presentation_disk_cache: {
        max_size_mb: 64, max_entry_size_mb: 128,
      } } })).toThrow("max_entry_size_mb must not exceed")
      expect(() => parseNeoviewRuntimeConfig({ performance: { presentation_disk_cache: {
        directory: " ",
      } } })).toThrow("directory")
    })

  it("[neoview.preload.config-runtime] consolidates canonical and legacy candidate budgets with a safety cap", () => {
      expect(parseNeoviewRuntimeConfig({ performance: { preload_pages: 7, preload_items: 3 } }).preload).toEqual({ maxCandidatePages: 7, browserPredecodeEnabled: true, browserPredecodePages: 3 })
      expect(parseNeoviewRuntimeConfig({ performance: { preLoadSize: 5 } }).preload).toEqual({ maxCandidatePages: 5, browserPredecodeEnabled: true, browserPredecodePages: 3 })
      expect(parseNeoviewRuntimeConfig({ image: { preloadCount: 6 } }).preload).toEqual({ maxCandidatePages: 6, browserPredecodeEnabled: true, browserPredecodePages: 3 })
      expect(parseNeoviewRuntimeConfig({ reader: { book: { preloadPages: 8 } } }).preload).toEqual({ maxCandidatePages: 8, browserPredecodeEnabled: true, browserPredecodePages: 3 })
      expect(parseNeoviewRuntimeConfig({ performance: { preload_pages: 999 } }).preload).toEqual({ maxCandidatePages: 32, browserPredecodeEnabled: true, browserPredecodePages: 3 })
      expect(parseNeoviewRuntimeConfig({ performance: { browser_predecode_enabled: false } }).preload).toEqual({ maxCandidatePages: 4, browserPredecodeEnabled: false, browserPredecodePages: 3 })
      expect(parseNeoviewRuntimeConfig({ performance: { browserPredecodeEnabled: false } }).preload).toEqual({ maxCandidatePages: 4, browserPredecodeEnabled: false, browserPredecodePages: 3 })
      expect(parseNeoviewRuntimeConfig({ performance: { browser_predecode_pages: 3 } }).preload).toEqual({ maxCandidatePages: 4, browserPredecodeEnabled: true, browserPredecodePages: 3 })
      expect(() => parseNeoviewRuntimeConfig({ performance: { preload_pages: -1 } })).toThrow("preload_pages")
    })

  it("[neoview.slideshow.config] normalizes legacy settings and writes one canonical TOML shape", () => {
      expect(parseNeoviewRuntimeConfig({
        slideshow: { interval_seconds: 12, loop: true, fade_transition: false },
        reader: {
          slideshow: { default_interval: 7, loop: false, random: true, fade_transition: true },
          book: { auto_page_turn_interval: 3 },
        },
      }).slideshow).toEqual({ intervalSeconds: 12, loop: true, random: true, fadeTransition: false })
      expect(parseNeoviewRuntimeConfig({ reader: { slideshow: { defaultInterval: 99 } } }).slideshow.intervalSeconds).toBe(60)
      expect(parseNeoviewRuntimeConfig({ reader: { book: { autoPageTurnInterval: 0 } } }).slideshow.intervalSeconds).toBe(1)
      expect(parseNeoviewSlideshowPatch({ slideshow: { intervalSeconds: 9, loop: true, random: false, fadeTransition: false } })).toEqual({
        patch: { slideshow: { intervalSeconds: 9, loop: true, random: false, fadeTransition: false } },
        tomlPatch: { slideshow: { interval_seconds: 9, loop: true, random: false, fade_transition: false } },
      })
      expect(() => parseNeoviewSlideshowPatch({ slideshow: {} })).toThrow("at least one")
      expect(() => parseNeoviewSlideshowPatch({ slideshow: { intervalSeconds: 61 } })).toThrow("between 1 and 60")
      expect(() => parseNeoviewSlideshowPatch({ slideshow: { autoplay: true } })).toThrow("unsupported fields")
    })

  it("[neoview.history.view-settings-config] inherits File presentation with sparse bounded overrides", () => {
      expect(parseNeoviewRuntimeConfig({ history_list: { view_mode: "thumbnail" } }).historyList).toEqual({
        viewMode: "thumbnail",
        viewOverrides: { viewMode: "cover-grid" },
        autoCleanup: { enabled: false, trigger: "on-show", intervalMinutes: 60 },
      })
      expect(parseNeoviewRuntimeConfig({ history_list: {
        view_mode: "content",
        view_overrides: { view_mode: "mosaic-list", thumbnail_width_percent: 42 },
      } }).historyList).toEqual({
        viewMode: "content",
        viewOverrides: { viewMode: "mosaic-list", thumbnailWidthPercent: 42 },
        autoCleanup: { enabled: false, trigger: "on-show", intervalMinutes: 60 },
      })
      expect(parseNeoviewRuntimeConfig({ history_list: {
        auto_cleanup: { enabled: true, trigger: "interval", interval_minutes: 360 },
      } }).historyList.autoCleanup).toEqual({ enabled: true, trigger: "interval", intervalMinutes: 360 })
      expect(parseNeoviewRuntimeConfig(undefined).historyList).toEqual({
        viewMode: "compact",
        viewOverrides: {},
        autoCleanup: { enabled: false, trigger: "on-show", intervalMinutes: 60 },
      })
      expect(parseNeoviewHistoryListPatch({ historyList: { viewMode: "banner" } })).toEqual({
        patch: { historyList: { viewMode: "banner", viewOverrides: { viewMode: "mosaic-list" } } },
        tomlPatch: { history_list: { view_mode: null, view_overrides: { view_mode: "mosaic-list" } } },
      })
      expect(parseNeoviewHistoryListPatch({ historyList: { viewOverrides: { thumbnailWidthPercent: 36 } } })).toEqual({
        patch: { historyList: { viewOverrides: { thumbnailWidthPercent: 36 } } },
        tomlPatch: { history_list: { view_overrides: { thumbnail_width_percent: 36 } } },
      })
      expect(parseNeoviewHistoryListPatch({ historyList: { viewOverrides: { viewMode: null } } })).toEqual({
        patch: { historyList: { viewOverrides: { viewMode: null } } },
        tomlPatch: { history_list: { view_mode: null, view_overrides: { view_mode: null } } },
      })
      expect(parseNeoviewHistoryListPatch({ historyList: { autoCleanup: { enabled: true, trigger: "interval", intervalMinutes: 360 } } })).toEqual({
        patch: { historyList: { autoCleanup: { enabled: true, trigger: "interval", intervalMinutes: 360 } } },
        tomlPatch: { history_list: { auto_cleanup: { enabled: true, trigger: "interval", interval_minutes: 360 } } },
      })
      expect(() => parseNeoviewHistoryListPatch({ historyList: {} })).toThrow("viewMode, viewOverrides or autoCleanup")
      expect(() => parseNeoviewHistoryListPatch({ historyList: { viewMode: "grid" } })).toThrow("viewMode")
      expect(() => parseNeoviewHistoryListPatch({ historyList: { viewOverrides: { thumbnailWidthPercent: 9 } } })).toThrow("between 10 and 90")
      expect(() => parseNeoviewHistoryListPatch({ historyList: { autoCleanup: { intervalMinutes: 1 } } })).toThrow("between 5 and 10080")
      expect(() => parseNeoviewHistoryListPatch({ historyList: { viewMode: "compact", future: true } })).toThrow("unsupported")
    })

  it("[neoview.bookmark.active-list-config] persists a bounded active Bookmark List identity", () => {
      expect(parseNeoviewRuntimeConfig({ bookmark_list: { active_list_id: "reading" } }).bookmarkList).toEqual({ activeListId: "reading", viewOverrides: {} })
      expect(parseNeoviewRuntimeConfig(undefined).bookmarkList).toEqual({ activeListId: "all", viewOverrides: {} })
      expect(parseNeoviewBookmarkListPatch({ bookmarkList: { activeListId: " reading " } })).toEqual({
        patch: { bookmarkList: { activeListId: "reading" } },
        tomlPatch: { bookmark_list: { active_list_id: "reading" } },
      })
      expect(parseNeoviewBookmarkListPatch({ bookmarkList: { viewOverrides: { bannerWidthPercent: 70 } } })).toEqual({
        patch: { bookmarkList: { viewOverrides: { bannerWidthPercent: 70 } } },
        tomlPatch: { bookmark_list: { view_overrides: { banner_width_percent: 70 } } },
      })
      expect(() => parseNeoviewBookmarkListPatch({ bookmarkList: {} })).toThrow("activeListId or viewOverrides")
      expect(() => parseNeoviewBookmarkListPatch({ bookmarkList: { activeListId: "" } })).toThrow("1 to 256")
      expect(() => parseNeoviewBookmarkListPatch({ bookmarkList: { activeListId: "x".repeat(257) } })).toThrow("1 to 256")
      expect(() => parseNeoviewBookmarkListPatch({ bookmarkList: { activeListId: "all", future: true } })).toThrow("unsupported")
    })

  it("[neoview.page-list.settings-config] persists bounded page-list preferences in one canonical TOML shape", () => {
      expect(parseNeoviewRuntimeConfig({ page_list: { view_mode: "thumbnails", follow_progress: false } }).pageList).toEqual({
        viewMode: "thumbnails",
        followProgress: false,
      })
      expect(parseNeoviewRuntimeConfig(undefined).pageList).toEqual({ viewMode: "list", followProgress: true })
      expect(parseNeoviewPageListPatch({ pageList: { viewMode: "details", followProgress: false } })).toEqual({
        patch: { pageList: { viewMode: "details", followProgress: false } },
        tomlPatch: { page_list: { view_mode: "details", follow_progress: false } },
      })
      expect(() => parseNeoviewPageListPatch({ pageList: {} })).toThrow("at least one")
      expect(() => parseNeoviewPageListPatch({ pageList: { viewMode: "tiles" } })).toThrow("viewMode")
    })

  it("[neoview.toolbar.sort-locks] reads legacy locks and writes bounded canonical book defaults", () => {
      expect(parseNeoviewRuntimeConfig(undefined).sessionOptions.direction).toBe("left-to-right")
      expect(parseNeoviewRuntimeConfig({ book: { locked_sort_mode: "timeStampDescending", locked_media_priority: "videoFirst", locked_reading_direction: "right-to-left" } }).book).toEqual({
        lockedSortMode: "timeStampDescending",
        lockedMediaPriority: "videoFirst",
        lockedReadingDirection: "right-to-left",
      })
      expect(parseNeoviewRuntimeConfig({ reader: { book: { lockedSortMode: "entry", lockedMediaPriority: "imageFirst" } } }).book).toEqual({
        lockedSortMode: "entry",
        lockedMediaPriority: "imageFirst",
        lockedReadingDirection: null,
      })
      expect(parseNeoviewBookPatch({ book: { lockedSortMode: null, lockedMediaPriority: "imageFirst", lockedReadingDirection: "left-to-right" } })).toEqual({
        patch: { book: { lockedSortMode: null, lockedMediaPriority: "imageFirst", lockedReadingDirection: "left-to-right" } },
        tomlPatch: { book: { locked_sort_mode: "none", locked_media_priority: "imageFirst", locked_reading_direction: "left-to-right" }, reader: { reading_direction: "left-to-right" } },
      })
      expect(parseNeoviewRuntimeConfig({ book: { locked_reading_direction: "right-to-left" }, reader: { reading_direction: "left-to-right" } }).sessionOptions.direction).toBe("right-to-left")
      expect(() => parseNeoviewBookPatch({ book: { lockedSortMode: "randomDescending" } })).toThrow("lockedSortMode")
      expect(() => parseNeoviewBookPatch({ book: { lockedMediaPriority: "audioFirst" } })).toThrow("lockedMediaPriority")
    })

  it("[neoview.settings.view-defaults] normalizes legacy zoom aliases and writes canonical TOML", () => {
      expect(parseNeoviewRuntimeConfig({ reader: { default_zoom_mode: "fitRightAlign" } }).viewDefaults.fitMode).toBe("fit-right")
      expect(parseNeoviewRuntimeConfig({ reader: { view: {
        orientation: "vertical",
        autoRotateMode: "horizontalRight",
        widePageStretch: "uniformHeight",
        doublePageGap: -12,
      } } }).viewDefaults).toMatchObject({
        orientation: "vertical",
        autoRotation: "horizontal-right",
        widePageStretch: "uniform-height",
        doublePageGap: -12,
      })
      expect(parseNeoviewRuntimeConfig({ reader: { view: { page_layout: { split_horizontal_pages: true } } } })).toMatchObject({
        sessionOptions: { layout: { pageMode: "single", splitWidePages: true } },
        viewDefaults: { splitWidePages: true },
      })
      expect(parseNeoviewRuntimeConfig({ image: { hover_scroll_enabled: false, hover_scroll_speed: 4.5 } }).viewDefaults).toMatchObject({
        hoverScrollEnabled: false,
        hoverScrollSpeed: 4.5,
      })
      expect(parseNeoviewRuntimeConfig({ reader: { view: { magnifier: { zoom: 3.2, size: 320 } } } }).viewDefaults).toMatchObject({
        magnifierZoom: 3.2,
        magnifierSize: 320,
      })
      expect(parseNeoviewViewDefaultsPatch({ viewDefaults: {
        fitMode: "fit-height",
        pageMode: "double",
        doublePageGap: -16,
        splitWidePages: true,
        hoverScrollEnabled: false,
        hoverScrollSpeed: 3.5,
        magnifierZoom: 2.5,
        magnifierSize: 280,
        orientation: "vertical",
        autoRotation: "forced-left",
        widePageStretch: "uniform-width",
      } })).toEqual({
        patch: { viewDefaults: {
          fitMode: "fit-height",
          pageMode: "double",
          doublePageGap: -16,
          splitWidePages: true,
          hoverScrollEnabled: false,
          hoverScrollSpeed: 3.5,
          magnifierZoom: 2.5,
          magnifierSize: 280,
          orientation: "vertical",
          autoRotation: "forced-left",
          widePageStretch: "uniform-width",
        } },
        tomlPatch: { reader: {
          default_zoom_mode: "fitHeight",
          double_page_view: true,
          double_page_gap: -16,
          split_wide_pages: true,
          hover_scroll_enabled: false,
          hover_scroll_speed: 3.5,
          orientation: "vertical",
          auto_rotation: "forcedLeft",
          wide_page_stretch: "uniformWidth",
        }, view: { magnifier: { zoom: 2.5, size: 280 } } },
      })
      expect(() => parseNeoviewViewDefaultsPatch({ viewDefaults: {} })).toThrow("at least one")
      expect(() => parseNeoviewViewDefaultsPatch({ viewDefaults: { fitMode: "stretch" } })).toThrow("fitMode")
      expect(() => parseNeoviewViewDefaultsPatch({ viewDefaults: { orientation: "landscape" } })).toThrow("orientation")
      expect(() => parseNeoviewViewDefaultsPatch({ viewDefaults: { autoRotation: "clockwise" } })).toThrow("auto rotation")
      expect(() => parseNeoviewViewDefaultsPatch({ viewDefaults: { widePageStretch: "cover" } })).toThrow("wide page stretch")
      expect(() => parseNeoviewViewDefaultsPatch({ viewDefaults: { hoverScrollSpeed: 12 } })).toThrow("between 0.5 and 10")
      expect(() => parseNeoviewViewDefaultsPatch({ viewDefaults: { magnifierZoom: 0.5 } })).toThrow("between 1 and 5")
      expect(() => parseNeoviewViewDefaultsPatch({ viewDefaults: { magnifierSize: 510 } })).toThrow("between 100 and 500")
      expect(() => parseNeoviewViewDefaultsPatch({ viewDefaults: { doublePageGap: -501 } })).toThrow("between -500 and 500")
    })
})


describe("ReaderRuntimeConfig system monitor", () => {
  it("[neoview.system-monitor.persistence] parses canonical settings and defaults", () => {
    expect(parseNeoviewRuntimeConfig(undefined).systemMonitor).toEqual({ enabled: true, refreshIntervalMs: 1_000, maxSamples: 60 })
    expect(parseNeoviewRuntimeConfig({ performance: { monitor: {
      enabled: false,
      refresh_interval_ms: 2_000,
      max_samples: 120,
    } } }).systemMonitor).toEqual({ enabled: false, refreshIntervalMs: 2_000, maxSamples: 120 })
    expect(() => parseNeoviewRuntimeConfig({ performance: { monitor: { refresh_interval_ms: 750 } } })).toThrow("must be one of")
  })

  it("[neoview.system-monitor.persistence-patch] projects a bounded canonical TOML patch", () => {
    expect(parseNeoviewSystemMonitorPatch({ systemMonitor: {
      enabled: false,
      refreshIntervalMs: 5_000,
      maxSamples: 30,
    } })).toEqual({
      patch: { systemMonitor: { enabled: false, refreshIntervalMs: 5_000, maxSamples: 30 } },
      tomlPatch: { performance: { monitor: { enabled: false, refresh_interval_ms: 5_000, max_samples: 30 } } },
    })
    expect(() => parseNeoviewSystemMonitorPatch({ systemMonitor: { refreshIntervalMs: 750 } })).toThrow("must be one of")
    expect(() => parseNeoviewSystemMonitorPatch({ systemMonitor: { maxSamples: 1_000 } })).toThrow("between 10 and 600")
  })
})

describe("ReaderRuntimeConfig startup restore", () => {
  it("[neoview.startup-restore.config] defaults on and projects the canonical TOML patch", () => {
    expect(parseNeoviewRuntimeConfig(undefined).startup).toEqual({ restoreLastBook: true })
    expect(parseNeoviewRuntimeConfig({ startup: { restore_last_book: false } }).startup).toEqual({ restoreLastBook: false })
    expect(parseNeoviewStartupPatch({ startup: { restoreLastBook: false } })).toEqual({
      patch: { startup: { restoreLastBook: false } },
      tomlPatch: { startup: { restore_last_book: false } },
    })
    expect(() => parseNeoviewStartupPatch({ startup: {} })).toThrow("must change at least one field")
  })
})

describe("ReaderRuntimeConfig preload", () => {
  it("[neoview.preload.persistence-patch] projects bounded candidate and browser decode settings into canonical TOML", async () => {
    const { parseNeoviewPreloadPatch } = await import("./ReaderRuntimeConfigParser.js")
    expect(parseNeoviewPreloadPatch({ preload: { maxCandidatePages: 12 } })).toEqual({
      patch: { preload: { maxCandidatePages: 12 } },
      tomlPatch: { performance: { preload_pages: 12 } },
    })
    expect(parseNeoviewPreloadPatch({ preload: { browserPredecodeEnabled: false } })).toEqual({
      patch: { preload: { browserPredecodeEnabled: false } },
      tomlPatch: { performance: { browser_predecode_enabled: false } },
    })
    expect(parseNeoviewPreloadPatch({ preload: { browserPredecodePages: 3 } })).toEqual({
      patch: { preload: { browserPredecodePages: 3 } },
      tomlPatch: { performance: { browser_predecode_pages: 3 } },
    })
    expect(() => parseNeoviewPreloadPatch({ preload: { maxCandidatePages: 33 } })).toThrow("between 0 and 32")
    expect(() => parseNeoviewPreloadPatch({ preload: {} })).toThrow("must change")
  })
})
