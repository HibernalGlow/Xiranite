import { describe, expect, it } from "vitest"
import { parseNeoviewBoardLayoutPatch, parseNeoviewBookPatch, parseNeoviewBookmarkListPatch, parseNeoviewCardLayoutPatch, parseNeoviewFolderViewPatch, parseNeoviewHistoryListPatch, parseNeoviewPageListPatch, parseNeoviewPageTransitionPatch, parseNeoviewRuntimeConfig, parseNeoviewShellControlPatch, parseNeoviewSidebarLayoutPatch, parseNeoviewSlideshowPatch, parseNeoviewSystemMonitorPatch, parseNeoviewViewDefaultsPatch } from "./ReaderRuntimeConfig.js"

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
    expect(parseNeoviewRuntimeConfig({ reader: { double_page_view: true, default_zoom_mode: "fitWidth" } }).viewDefaults).toEqual({
      fitMode: "fit-width",
      pageMode: "double",
      splitWidePages: false,
      hoverScrollEnabled: true,
      hoverScrollSpeed: 2,
      magnifierZoom: 2,
      magnifierSize: 200,
      orientation: "horizontal",
      autoRotation: "none",
      widePageStretch: "uniform-height",
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
    expect(parseNeoviewRuntimeConfig({ performance: { preload_pages: 7, preload_items: 3 } }).preload).toEqual({ maxCandidatePages: 7 })
    expect(parseNeoviewRuntimeConfig({ performance: { preLoadSize: 5 } }).preload).toEqual({ maxCandidatePages: 5 })
    expect(parseNeoviewRuntimeConfig({ image: { preloadCount: 6 } }).preload).toEqual({ maxCandidatePages: 6 })
    expect(parseNeoviewRuntimeConfig({ reader: { book: { preloadPages: 8 } } }).preload).toEqual({ maxCandidatePages: 8 })
    expect(parseNeoviewRuntimeConfig({ performance: { preload_pages: 999 } }).preload).toEqual({ maxCandidatePages: 32 })
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

  it("[neoview.history.view-settings-config] persists a bounded History-specific view mode", () => {
    expect(parseNeoviewRuntimeConfig({ history_list: { view_mode: "thumbnail" } }).historyList).toEqual({ viewMode: "thumbnail" })
    expect(parseNeoviewRuntimeConfig(undefined).historyList).toEqual({ viewMode: "compact" })
    expect(parseNeoviewHistoryListPatch({ historyList: { viewMode: "banner" } })).toEqual({
      patch: { historyList: { viewMode: "banner" } },
      tomlPatch: { history_list: { view_mode: "banner" } },
    })
    expect(() => parseNeoviewHistoryListPatch({ historyList: {} })).toThrow("viewMode")
    expect(() => parseNeoviewHistoryListPatch({ historyList: { viewMode: "grid" } })).toThrow("viewMode")
    expect(() => parseNeoviewHistoryListPatch({ historyList: { viewMode: "compact", future: true } })).toThrow("unsupported")
  })

  it("[neoview.bookmark.active-list-config] persists a bounded active Bookmark List identity", () => {
    expect(parseNeoviewRuntimeConfig({ bookmark_list: { active_list_id: "reading" } }).bookmarkList).toEqual({ activeListId: "reading" })
    expect(parseNeoviewRuntimeConfig(undefined).bookmarkList).toEqual({ activeListId: "all" })
    expect(parseNeoviewBookmarkListPatch({ bookmarkList: { activeListId: " reading " } })).toEqual({
      patch: { bookmarkList: { activeListId: "reading" } },
      tomlPatch: { bookmark_list: { active_list_id: "reading" } },
    })
    expect(() => parseNeoviewBookmarkListPatch({ bookmarkList: {} })).toThrow("activeListId")
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
    expect(parseNeoviewRuntimeConfig({ book: { locked_sort_mode: "timeStampDescending", locked_media_priority: "videoFirst" } }).book).toEqual({
      lockedSortMode: "timeStampDescending",
      lockedMediaPriority: "videoFirst",
    })
    expect(parseNeoviewRuntimeConfig({ reader: { book: { lockedSortMode: "entry", lockedMediaPriority: "imageFirst" } } }).book).toEqual({
      lockedSortMode: "entry",
      lockedMediaPriority: "imageFirst",
    })
    expect(parseNeoviewBookPatch({ book: { lockedSortMode: null, lockedMediaPriority: "imageFirst" } })).toEqual({
      patch: { book: { lockedSortMode: null, lockedMediaPriority: "imageFirst" } },
      tomlPatch: { book: { locked_sort_mode: "none", locked_media_priority: "imageFirst" } },
    })
    expect(() => parseNeoviewBookPatch({ book: { lockedSortMode: "randomDescending" } })).toThrow("lockedSortMode")
    expect(() => parseNeoviewBookPatch({ book: { lockedMediaPriority: "audioFirst" } })).toThrow("lockedMediaPriority")
  })

  it("[neoview.settings.view-defaults] normalizes legacy zoom aliases and writes canonical TOML", () => {
    expect(parseNeoviewRuntimeConfig({ reader: { default_zoom_mode: "fitRightAlign" } }).viewDefaults.fitMode).toBe("fit-right")
    expect(parseNeoviewRuntimeConfig({ reader: { view: {
      orientation: "vertical",
      autoRotateMode: "horizontalRight",
      widePageStretch: "uniformHeight",
    } } }).viewDefaults).toMatchObject({
      orientation: "vertical",
      autoRotation: "horizontal-right",
      widePageStretch: "uniform-height",
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
  })

  it("[neoview.folder.settings] [neoview.folder.search-settings] [neoview.folder.tabs-pin-config] normalizes folder view and legacy search settings", () => {
    expect(parseNeoviewRuntimeConfig({ folder: {
      home_path: " D:/Books ",
      view_mode: "details",
      preview_count: 9,
      thumbnail_width_percent: 34,
      banner_width_percent: 70,
      tabs: {
        pinned: [{ path: "D:/Books", title: "Books" }, { path: "D:/Books", title: "Books copy" }],
        layout: "right",
        width: 240,
        breadcrumb_position: "left",
        toolbar_position: "bottom",
      },
      tree_view: { visible: true, layout: "right", size: 260, pinned_paths: ["D:\\Pinned", "d:/pinned"] },
      details: {
        column_order: ["name", "rating", "path"],
        hidden_columns: ["tags", "future-column"],
        pinned_left: ["name", "rating"],
        pinned_right: ["rating", "tags"],
        column_widths: { name: 260, path: 420, "future-column": 999 },
      },
    } }).folderView).toEqual({
      homePath: "D:/Books",
      viewMode: "details",
      previewGridEnabled: false,
      previewCount: 9,
      contentWidthPercent: 35,
      thumbnailWidthPercent: 34,
      bannerWidthPercent: 70,
      hoverPreviewEnabled: true,
      hoverPreviewDelayMs: 500,
      typeFilter: "library",
      emptyArea: { singleClickAction: "none", doubleClickAction: "goUp", showBackButton: false },
      details: {
        columnOrder: ["name", "rating", "path", "type", "extension", "size", "modifiedAt", "dimensions", "pageCount", "tags"],
        hiddenColumns: ["tags"],
        pinnedLeft: ["name", "rating"],
        pinnedRight: ["tags"],
        columnWidths: {
          name: 260, path: 420, type: 80, extension: 80, size: 96,
          modifiedAt: 152, dimensions: 96, pageCount: 72, rating: 72, tags: 180,
        },
      },
      search: { includeSubfolders: true, showHistoryOnFocus: true, searchInPath: false },
      tree: { visible: true, layout: "right", size: 260, pinnedPaths: ["D:\\Pinned"] },
      tabs: {
        pinned: [{ path: "D:/Books", title: "Books" }, { path: "D:/Books", title: "Books copy" }],
        layout: "right",
        width: 240,
        breadcrumbPosition: "left",
        toolbarPosition: "bottom",
      },
    })
    expect(parseNeoviewFolderViewPatch({ folderView: {
      homePath: " E:/Library ",
      viewMode: "cover-grid",
      previewGridEnabled: true,
      previewCount: 16,
      thumbnailWidthPercent: 42,
      bannerWidthPercent: 80,
      hoverPreviewEnabled: false,
      hoverPreviewDelayMs: 1200,
      tree: { visible: true, layout: "bottom", size: 320, pinnedPaths: ["E:/Books"] },
      tabs: { pinned: [{ path: "E:/Library", title: "Library" }] },
      details: { columnOrder: ["rating", "name"], hiddenColumns: ["tags"], pinnedLeft: ["name"], pinnedRight: ["rating"], columnWidths: { name: 300, rating: 84 } },
      search: { includeSubfolders: false, showHistoryOnFocus: false, searchInPath: true },
    } })).toEqual({
      patch: { folderView: {
        homePath: "E:/Library",
        viewMode: "cover-grid",
        previewGridEnabled: true,
        previewCount: 16,
        thumbnailWidthPercent: 42,
        bannerWidthPercent: 80,
        hoverPreviewEnabled: false,
        hoverPreviewDelayMs: 1200,
        details: {
          columnOrder: ["rating", "name", "path", "type", "extension", "size", "modifiedAt", "dimensions", "pageCount", "tags"],
          hiddenColumns: ["tags"],
          pinnedLeft: ["name"],
          pinnedRight: ["rating"],
          columnWidths: { name: 300, rating: 84 },
        },
        search: { includeSubfolders: false, showHistoryOnFocus: false, searchInPath: true },
        tree: { visible: true, layout: "bottom", size: 320, pinnedPaths: ["E:/Books"] },
        tabs: { pinned: [{ path: "E:/Library", title: "Library" }] },
      } },
      tomlPatch: { folder: {
        home_path: "E:/Library",
        view_mode: "cover-grid",
        preview_grid_enabled: true,
        preview_count: 16,
        thumbnail_width_percent: 42,
        banner_width_percent: 80,
        hover_preview_enabled: false,
        hover_preview_delay_ms: 1200,
        details: {
          column_order: ["rating", "name", "path", "type", "extension", "size", "modifiedAt", "dimensions", "pageCount", "tags"],
          hidden_columns: ["tags"],
          pinned_left: ["name"],
          pinned_right: ["rating"],
          column_widths: { name: 300, rating: 84 },
        },
        search: { include_subfolders: false, show_history_on_focus: false, search_in_path: true },
        tree_view: { visible: true, layout: "bottom", size: 320, pinned_paths: ["E:/Books"] },
        tabs: { pinned: [{ path: "E:/Library", title: "Library" }] },
      } },
    })
    expect(parseNeoviewRuntimeConfig({ folder: { search: {
      include_subfolders: false,
      show_history_on_focus: false,
      search_in_path: true,
    } } }).folderView.search).toEqual({ includeSubfolders: false, showHistoryOnFocus: false, searchInPath: true })
    expect(parseNeoviewRuntimeConfig(undefined).folderView.homePath).toBe("")
    expect(parseNeoviewFolderViewPatch({ folderView: { tabs: {
      layout: "left", width: 220, breadcrumbPosition: "bottom", toolbarPosition: "right",
    } } })).toEqual({
      patch: { folderView: { tabs: { layout: "left", width: 220, breadcrumbPosition: "bottom", toolbarPosition: "right" } } },
      tomlPatch: { folder: { tabs: { layout: "left", width: 220, breadcrumb_position: "bottom", toolbar_position: "right" } } },
    })
    expect(parseNeoviewFolderViewPatch({ folderView: { homePath: "" } })).toEqual({
      patch: { folderView: { homePath: "" } },
      tomlPatch: { folder: { home_path: "" } },
    })
    expect(() => parseNeoviewFolderViewPatch({ folderView: { homePath: "bad\0path" } })).toThrow("without NUL")
    expect(() => parseNeoviewFolderViewPatch({ folderView: { homePath: "x".repeat(4097) } })).toThrow("at most 4096")
    expect(() => parseNeoviewFolderViewPatch({ folderView: { homePath: 1 } })).toThrow("must be a string")
    expect(() => parseNeoviewFolderViewPatch({ folderView: { previewCount: 8 } })).toThrow("4, 9 or 16")
    expect(() => parseNeoviewFolderViewPatch({ folderView: { contentWidthPercent: 19 } })).toThrow("between 20 and 70")
    expect(() => parseNeoviewFolderViewPatch({ folderView: { thumbnailWidthPercent: 9 } })).toThrow("between 10 and 90")
    expect(() => parseNeoviewFolderViewPatch({ folderView: { bannerWidthPercent: 101 } })).toThrow("between 20 and 100")
    expect(() => parseNeoviewFolderViewPatch({ folderView: { hoverPreviewDelayMs: 300 } })).toThrow("one of: 200, 500, 800, 1200")
    expect(() => parseNeoviewRuntimeConfig({ folder: { hover_preview_delay_ms: 800 } })).not.toThrow()
    expect(() => parseNeoviewFolderViewPatch({ folderView: { details: { hiddenColumns: ["name"] } } })).toThrow("cannot hide name")
    expect(() => parseNeoviewFolderViewPatch({ folderView: { details: { columnOrder: ["unknown"] } } })).toThrow("unknown column")
    expect(() => parseNeoviewFolderViewPatch({ folderView: { details: { columnWidths: { name: 47 } } } })).toThrow("between 48 and 800")
    expect(() => parseNeoviewFolderViewPatch({ folderView: { details: { columnWidths: { future: 200 } } } })).toThrow("unknown column")
    expect(() => parseNeoviewFolderViewPatch({ folderView: { search: { searchInPath: "yes" } } })).toThrow("searchInPath")
    expect(() => parseNeoviewFolderViewPatch({ folderView: { search: { future: true } } })).toThrow("unsupported fields")
    expect(() => parseNeoviewFolderViewPatch({ folderView: { tree: { layout: "center" } } })).toThrow("layout")
    expect(() => parseNeoviewFolderViewPatch({ folderView: { tree: { size: 99 } } })).toThrow("between 100 and 500")
    expect(() => parseNeoviewFolderViewPatch({ folderView: { tree: { future: true } } })).toThrow("unsupported fields")
    expect(() => parseNeoviewFolderViewPatch({ folderView: { tree: { pinnedPaths: Array(65).fill("D:/Books") } } })).toThrow("at most 64")
    expect(() => parseNeoviewFolderViewPatch({ folderView: { tree: { pinnedPaths: [""] } } })).toThrow("invalid path")
    expect(parseNeoviewRuntimeConfig(undefined).folderView.tabs).toEqual({
      pinned: [], layout: "top", width: 160, breadcrumbPosition: "top", toolbarPosition: "top",
    })
    expect(() => parseNeoviewFolderViewPatch({ folderView: { tabs: { pinned: Array(8).fill({ path: "D:/Books", title: "Books" }) } } })).toThrow("at most 7")
    expect(() => parseNeoviewFolderViewPatch({ folderView: { tabs: { pinned: [{ path: "D:/Books", title: "" }] } } })).toThrow("1 to 256")
    expect(() => parseNeoviewFolderViewPatch({ folderView: { tabs: { layout: "center" } } })).toThrow("layout")
    expect(() => parseNeoviewFolderViewPatch({ folderView: { tabs: { width: 99 } } })).toThrow("between 100 and 400")
    expect(() => parseNeoviewFolderViewPatch({ folderView: { tabs: { future: true } } })).toThrow("unsupported fields")
  })

  it("[neoview.folder.tree-config] keeps persistent exclusions in the node TOML contract", () => {
    expect(parseNeoviewRuntimeConfig({
      folder: { tree: { excluded_paths: ["D:/Library/private", "D:/Library/archive"] } },
    }).fileTree).toEqual({ excludedPaths: ["D:/Library/private", "D:/Library/archive"] })
    expect(() => parseNeoviewRuntimeConfig({
      folder: { tree: { excluded_paths: Array(257).fill("D:/Library/private") } },
    })).toThrow("at most 256")
  })

  it("[neoview.settings.shell] normalizes legacy panel settings into bounded shell options", () => {
    const { shellOptions } = parseNeoviewRuntimeConfig({
      panels: {
        left_sidebar_visible: true,
        right_sidebar_visible: false,
        bottom_panel_visible: true,
        auto_hide_toolbar: false,
        sidebar_opacity: 73,
        sidebar_blur: 7,
        hover_areas: { top_trigger_height: 4, bottom_trigger_height: 5, left_trigger_width: 6, right_trigger_width: 7 },
        auto_hide_timing: { show_delay_sec: 0.125, hide_delay_sec: 0.75 },
        sidebars: {
          left: { width: 420, pinned: false, open: false, height: "custom", custom_height: 72, vertical_align: 40, horizontal_position: 15 },
          right: { width: 260, height: "2/3" },
        },
      },
    })
    expect(shellOptions).toMatchObject({
      showDelayMs: 125,
      hideDelayMs: 750,
      opacity: { sidebar: 73 },
      blur: { sidebar: 7 },
      edges: {
        top: { initialVisible: true, pinned: true, triggerSize: 4 },
        right: { enabled: false, triggerSize: 7 },
        bottom: { enabled: true, initialVisible: true, triggerSize: 5 },
        left: { enabled: true, initialVisible: false, pinned: false, triggerSize: 6 },
      },
      sidebars: {
        left: { width: 420, height: "custom", customHeight: 72, verticalAlign: 40, horizontalPosition: 15 },
        right: { width: 260, height: "two-thirds" },
      },
    })
  })

  it("[neoview.card.sidebar-control.data-contract] prefers canonical control tables and reads previously imported legacy values", () => {
    const canonical = parseNeoviewRuntimeConfig({
      reader: { view: { sidebar_control: { enabled: false, position: { x: 17, y: 19 } } } },
      panels: {
        auto_hide_toolbar: false,
        hover_areas: { top_trigger_height: 7 },
        sidebar_control: { enabled: true, position: { x: 120, y: 140 }, future: "preserved-on-disk" },
        edges: {
          top: { enabled: false, initial_visible: false, pinned: false, trigger_size: 11, lock_mode: "locked-hidden", future: 1 },
        },
      },
    }).shellOptions
    expect(canonical.floatingControl).toEqual({ enabled: true, position: { x: 120, y: 140 } })
    expect(canonical.edges.top).toEqual({
      enabled: false,
      initialVisible: false,
      pinned: false,
      triggerSize: 11,
      lockMode: "locked-hidden",
    })

    const legacy = parseNeoviewRuntimeConfig({
      reader: { view: { sidebar_control: { enabled: false, position: { x: 23, y: 29 } } } },
    }).shellOptions
    expect(legacy.floatingControl).toEqual({ enabled: false, position: { x: 23, y: 29 } })
  })

  it("[neoview.card.sidebar-control.persistence] validates one revisioned control patch and emits canonical leaf tables", () => {
    expect(parseNeoviewShellControlPatch({
      expectedRevision: 4,
      shellControl: {
        floating: { enabled: false, position: { x: 240, y: 180 } },
        edges: {
          top: { enabled: false, initialVisible: false, pinned: false, triggerSize: 12, lockMode: "locked-hidden" },
          left: { pinned: true, lockMode: "locked-open" },
        },
      },
    })).toEqual({
      patch: {
        expectedRevision: 4,
        shellControl: {
          floating: { enabled: false, position: { x: 240, y: 180 } },
          edges: {
            top: { enabled: false, initialVisible: false, pinned: false, triggerSize: 12, lockMode: "locked-hidden" },
            left: { pinned: true, lockMode: "locked-open" },
          },
        },
      },
      tomlPatch: { panels: {
        sidebar_control: { enabled: false, position: { x: 240, y: 180 } },
        edges: {
          top: { enabled: false, initial_visible: false, pinned: false, trigger_size: 12, lock_mode: "locked-hidden" },
          left: { pinned: true, lock_mode: "locked-open" },
        },
      } },
    })
    const reset = parseNeoviewShellControlPatch({ expectedRevision: 5, shellControl: { reset: "known-defaults" } })
    expect(reset.patch).toEqual({ expectedRevision: 5, shellControl: { reset: "known-defaults" } })
    expect(reset.tomlPatch).toMatchObject({ panels: {
      sidebar_control: { enabled: true, position: { x: 100, y: 100 } },
      edges: {
        top: { enabled: true, initial_visible: true, pinned: false, trigger_size: 32, lock_mode: "auto" },
        left: { enabled: true, initial_visible: true, pinned: true, trigger_size: 32, lock_mode: "auto" },
      },
    } })
    expect(() => parseNeoviewShellControlPatch({ expectedRevision: 0, shellControl: {} })).toThrow("at least one")
    expect(() => parseNeoviewShellControlPatch({ expectedRevision: 0, shellControl: { reset: "known-defaults", floating: { enabled: true } } })).toThrow("cannot be combined")
    expect(() => parseNeoviewShellControlPatch({ expectedRevision: 0, shellControl: { floating: { position: { x: 1 } } } })).toThrow("requires x and y")
    expect(() => parseNeoviewShellControlPatch({ expectedRevision: 0, shellControl: { edges: { center: { pinned: true } } } })).toThrow("unsupported edges")
    expect(() => parseNeoviewShellControlPatch({ expectedRevision: 0, shellControl: { edges: { top: { triggerSize: 129 } } } })).toThrow("triggerSize")
    expect(() => parseNeoviewShellControlPatch({ expectedRevision: 0, shellControl: { edges: { top: { lockMode: "forever" } } } })).toThrow("lockMode")
  })

  it("[neoview.material.persistence] reads and atomically writes the complete shell material", () => {
    const shell = parseNeoviewRuntimeConfig({
      panels: {
        top_toolbar_opacity: 76,
        bottom_bar_opacity: 82,
        sidebar_opacity: 68,
        top_toolbar_blur: 14,
        bottom_bar_blur: 10,
        sidebar_blur: 18,
        material: {
          preset: "custom",
          top_saturation: 132,
          bottom_saturation: 118,
          sidebar_saturation: 144,
          top_highlight: 28,
          bottom_highlight: 34,
          sidebar_highlight: 42,
          top_shadow: 51,
          bottom_shadow: 47,
          sidebar_shadow: 56,
        },
      },
    }).shellOptions
    expect(shell).toMatchObject({
      opacity: { top: 76, bottom: 82, sidebar: 68 },
      blur: { top: 14, bottom: 10, sidebar: 18 },
      material: {
        preset: "custom",
        saturation: { top: 132, bottom: 118, sidebar: 144 },
        highlight: { top: 28, bottom: 34, sidebar: 42 },
        shadow: { top: 51, bottom: 47, sidebar: 56 },
      },
    })

    expect(parseNeoviewShellControlPatch({
      expectedRevision: 9,
      shellControl: {
        material: {
          preset: "custom",
          opacity: { top: 76, bottom: 82, sidebar: 68 },
          blur: { top: 14, bottom: 10, sidebar: 18 },
          saturation: { top: 132, bottom: 118, sidebar: 144 },
          highlight: { top: 28, bottom: 34, sidebar: 42 },
          shadow: { top: 51, bottom: 47, sidebar: 56 },
        },
      },
    })).toEqual({
      patch: {
        expectedRevision: 9,
        shellControl: {
          material: {
            preset: "custom",
            opacity: { top: 76, bottom: 82, sidebar: 68 },
            blur: { top: 14, bottom: 10, sidebar: 18 },
            saturation: { top: 132, bottom: 118, sidebar: 144 },
            highlight: { top: 28, bottom: 34, sidebar: 42 },
            shadow: { top: 51, bottom: 47, sidebar: 56 },
          },
        },
      },
      tomlPatch: { panels: {
        top_toolbar_opacity: 76,
        bottom_bar_opacity: 82,
        sidebar_opacity: 68,
        top_toolbar_blur: 14,
        bottom_bar_blur: 10,
        sidebar_blur: 18,
        material: {
          preset: "custom",
          top_saturation: 132,
          bottom_saturation: 118,
          sidebar_saturation: 144,
          top_highlight: 28,
          bottom_highlight: 34,
          sidebar_highlight: 42,
          top_shadow: 51,
          bottom_shadow: 47,
          sidebar_shadow: 56,
        },
      } },
    })
    expect(() => parseNeoviewShellControlPatch({
      expectedRevision: 0,
      shellControl: { material: { saturation: { top: 181 } } },
    })).toThrow("material.saturation.top")
  })

  it("rejects shell values outside safe rendering and timer limits", () => {
    expect(() => parseNeoviewRuntimeConfig({ panels: { hover_areas: { top_trigger_height: 0 } } })).toThrow("top trigger")
    expect(() => parseNeoviewRuntimeConfig({ panels: { auto_hide_timing: { hide_delay_sec: 6 } } })).toThrow("hide_delay_sec")
    expect(() => parseNeoviewRuntimeConfig({ panels: { sidebars: { left: { width: 1000 } } } })).toThrow("left.width")
  })

  it("[neoview.settings.shell-patch] validates and converts sidebar patches to TOML shape", () => {
    expect(parseNeoviewSidebarLayoutPatch({
      side: "right",
      pinned: false,
      width: 412,
      height: "two-thirds",
      customHeight: 72,
      verticalAlign: 35,
      horizontalPosition: 18,
    })).toEqual({
      patch: { side: "right", pinned: false, width: 412, height: "two-thirds", customHeight: 72, verticalAlign: 35, horizontalPosition: 18 },
      tomlPatch: { panels: {
        sidebars: { right: { pinned: false, width: 412, height: "2/3", custom_height: 72, vertical_align: 35, horizontal_position: 18 } },
        edges: { right: { pinned: false } },
      } },
    })
    expect(() => parseNeoviewSidebarLayoutPatch({ side: "left" })).toThrow("at least one")
    expect(() => parseNeoviewSidebarLayoutPatch({ side: "left", width: 199 })).toThrow("width")
    expect(() => parseNeoviewSidebarLayoutPatch({ side: "left", width: 320, token: "no" })).toThrow("unsupported")
  })

  it("[neoview.settings.panel-layout] preserves unknown panels and normalizes legacy sidebarConfig arrays", () => {
    const parsed = parseNeoviewRuntimeConfig({
      panels: {
        layout: {
          sidebarConfig: {
            panels: [
              { id: "pageList", visible: false, order: 20, position: "left" },
              { id: "futurePanel", visible: true, order: 1, position: "floating" },
            ],
          },
        },
      },
    })
    expect(parsed.shellOptions.panelLayout).toMatchObject({
      pageList: { visible: false, order: 20, position: "left" },
      futurePanel: { visible: true, order: 1, position: "floating" },
      info: { visible: true, position: "right" },
    })
  })

  it("[neoview.settings.card-layout] imports v14 card arrays and lets canonical state override them", () => {
    expect(parseNeoviewRuntimeConfig({}).shellOptions.cardLayout["sidebar-control"]).toEqual({
      panelId: "control", visible: true, expanded: true, order: 1,
    })
    const parsed = parseNeoviewRuntimeConfig({
      panels: {
        card_configs: {
          key: "neoview_card_configs_v14",
          data: {
            pageList: [{ id: "page-navigation", visible: true, expanded: false, order: 4, height: 240 }],
            future: [{ id: "future-card", visible: false, expanded: true, order: 2 }],
          },
        },
        card_state: {
          "page-navigation": { expanded: true, order: 1 },
        },
      },
    })
    expect(parsed.shellOptions.cardLayout).toMatchObject({
      "page-navigation": { panelId: "pageList", visible: true, expanded: true, order: 1, height: 240 },
      "future-card": { panelId: "future", visible: false, expanded: true, order: 2 },
    })
  })

  it("[neoview.card.sidebar-height.config] normalizes and persists real sidebar interaction behavior", () => {
    expect(parseNeoviewRuntimeConfig({
      panels: {
        sidebar_interaction: {
          show_drag_handle: true,
          enable_blank_area_collapse: false,
          blank_area_collapse_mode: "double",
        },
      },
    }).shellOptions.sidebarInteraction).toEqual({
      showDragHandle: true,
      enableBlankAreaCollapse: false,
      blankAreaCollapseMode: "double",
    })

    expect(parseNeoviewShellControlPatch({
      expectedRevision: 7,
      shellControl: {
        sidebarInteraction: {
          showDragHandle: true,
          enableBlankAreaCollapse: true,
          blankAreaCollapseMode: "double",
        },
      },
    })).toEqual({
      patch: {
        expectedRevision: 7,
        shellControl: {
          sidebarInteraction: {
            showDragHandle: true,
            enableBlankAreaCollapse: true,
            blankAreaCollapseMode: "double",
          },
        },
      },
      tomlPatch: {
        panels: {
          sidebar_interaction: {
            show_drag_handle: true,
            enable_blank_area_collapse: true,
            blank_area_collapse_mode: "double",
          },
        },
      },
    })
    expect(() => parseNeoviewShellControlPatch({
      expectedRevision: 0,
      shellControl: { sidebarInteraction: { blankAreaCollapseMode: "triple" } },
    })).toThrow("blankAreaCollapseMode")
  })

  it("[neoview.page-transition.config] [neoview.page-transition.toml] parses canonical settings and emits strict leaf patches", () => {
    expect(parseNeoviewRuntimeConfig({ image: { page_transition: {
      enabled: true,
      type: "slideUp",
      duration: 750,
      easing: "easeOutCubic",
      future_field: "preserved-on-disk",
    } } }).pageTransition).toEqual({
      enabled: true,
      type: "slideUp",
      duration: 750,
      easing: "easeOutCubic",
    })
    expect(parseNeoviewPageTransitionPatch({ pageTransition: { enabled: true, type: "flip", duration: 320 } })).toEqual({
      patch: { pageTransition: { enabled: true, type: "flip", duration: 320 } },
      tomlPatch: { image: { page_transition: { enabled: true, type: "flip", duration: 320 } } },
    })
    expect(() => parseNeoviewPageTransitionPatch({ pageTransition: { duration: 501 } })).toThrow("duration")
    expect(() => parseNeoviewPageTransitionPatch({ pageTransition: { type: "fold" } })).toThrow("type")
    expect(() => parseNeoviewPageTransitionPatch({ pageTransition: {} })).toThrow("at least one")
    expect(() => parseNeoviewPageTransitionPatch({ pageTransition: { enabled: true }, other: true })).toThrow("unsupported")
  })

  it("[neoview.page-transition.reset] emits one exclusive full canonical reset", () => {
    expect(parseNeoviewPageTransitionPatch({ pageTransition: { reset: "defaults" } })).toEqual({
      patch: { pageTransition: { reset: "defaults" } },
      tomlPatch: { image: { page_transition: {
        enabled: false,
        type: "none",
        duration: 0,
        easing: "easeOutQuad",
      } } },
    })
    expect(() => parseNeoviewPageTransitionPatch({ pageTransition: { reset: "defaults", enabled: true } }))
      .toThrow("cannot be combined")
    expect(() => parseNeoviewPageTransitionPatch({ pageTransition: { reset: true } })).toThrow('must be "defaults"')
  })

  it("[neoview.thumbnail-maintenance.layout] keeps maintenance hidden until explicitly docked", () => {
    expect(parseNeoviewRuntimeConfig({}).shellOptions.cardLayout["thumbnail-maintenance"]).toEqual({
      panelId: "control", visible: false, expanded: true, order: 2,
    })
  })

  it("[neoview.thumbnail-architecture-metrics.registry] preserves the legacy properties placement without requiring a book", () => {
    expect(parseNeoviewRuntimeConfig({}).shellOptions.cardLayout["thumbnail-architecture-metrics"]).toEqual({
      panelId: "properties", visible: true, expanded: true, order: 2,
    })
  })

  it("[neoview.emm-tags.registry] preserves the non-hideable first properties Card without requiring a book", () => {
    expect(parseNeoviewRuntimeConfig({}).shellOptions.cardLayout["emm-tags"]).toEqual({
      panelId: "properties", visible: true, expanded: true, order: 0,
    })
  })

  it("[neoview.color-filter.layout] keeps the legacy filter visible in the control panel without a session", () => {
    expect(parseNeoviewRuntimeConfig({}).shellOptions.cardLayout["color-filter"]).toEqual({
      panelId: "control", visible: true, expanded: true, order: 2,
    })
  })

  it("[neoview.settings.card-patch] validates card state and writes canonical TOML", () => {
    expect(parseNeoviewCardLayoutPatch({ cardId: "page-navigation", expanded: false, height: 320 })).toEqual({
      patch: { cardId: "page-navigation", expanded: false, height: 320 },
      tomlPatch: { panels: { card_state: { "page-navigation": { expanded: false, height: 320 } } } },
    })
    expect(parseNeoviewCardLayoutPatch({ cardId: "page-navigation", height: null })).toEqual({
      patch: { cardId: "page-navigation", height: null },
      tomlPatch: { panels: { card_state: { "page-navigation": { height: "auto" } } } },
    })
    expect(parseNeoviewRuntimeConfig({ panels: {
      card_configs: { data: { pageList: [{ id: "page-navigation", height: 240 }] } },
      card_state: { "page-navigation": { height: "auto" } },
    } }).shellOptions.cardLayout["page-navigation"]?.height).toBeUndefined()
    expect(() => parseNeoviewCardLayoutPatch({ cardId: "../bad", expanded: false })).toThrow("cardId")
    expect(() => parseNeoviewCardLayoutPatch({ cardId: "page-navigation" })).toThrow("at least one")
    expect(() => parseNeoviewCardLayoutPatch({ cardId: "page-navigation", height: 20 })).toThrow("height")
    expect(() => parseNeoviewCardLayoutPatch({ cardId: "page-navigation", visible: false })).toThrow("cannot hide")
    expect(() => parseNeoviewCardLayoutPatch({ cardId: "book-information", panelId: "cardwindow" })).toThrow("cannot place")
  })

  it("[neoview.settings.board-patch] compacts a complete editor draft into one canonical patch", () => {
    expect(parseNeoviewBoardLayoutPatch({ expectedRevision: 7, board: {
      panels: [{ id: "pageList", visible: true, order: 0, position: "left" }],
      cards: [{ cardId: "book-information", panelId: "pageList", visible: true, order: 0 }],
    } })).toEqual({
      patch: { expectedRevision: 7, board: {
        panels: [{ id: "pageList", visible: true, order: 0, position: "left" }],
        cards: [{ cardId: "book-information", panelId: "pageList", visible: true, order: 0 }],
      } },
      tomlPatch: { panels: {
        panel_state: { pageList: { visible: true, order: 0, position: "left" } },
        card_state: { "book-information": { visible: true, order: 0, panel_id: "pageList" } },
      } },
    })
    expect(() => parseNeoviewBoardLayoutPatch({ expectedRevision: 0, board: { panels: [], cards: [
      { cardId: "same", panelId: "info", visible: true, order: 0 },
      { cardId: "same", panelId: "info", visible: true, order: 1 },
    ] } })).toThrow("duplicate card")
    expect(() => parseNeoviewBoardLayoutPatch({ expectedRevision: 0, board: {
      panels: [{ id: "pageList", visible: true, order: 0, position: "left" }],
      cards: [{ cardId: "page-navigation", panelId: "pageList", visible: false, order: 0 }],
    } })).toThrow("cannot hide card page-navigation")
    expect(() => parseNeoviewBoardLayoutPatch({ expectedRevision: 0, board: {
      panels: [{ id: "cardwindow", visible: true, order: 0, position: "floating" }],
      cards: [{ cardId: "book-information", panelId: "cardwindow", visible: true, order: 0 }],
    } })).toThrow("cannot be placed in a floating panel")
    expect(() => parseNeoviewBoardLayoutPatch({ expectedRevision: 0, board: {
      panels: [{ id: "history", visible: true, order: 0, position: "left" }],
      cards: [
        { cardId: "history-list", panelId: "history", visible: true, order: 0 },
        { cardId: "book-information", panelId: "history", visible: true, order: 1 },
      ],
    } })).toThrow("history-list requires exclusive panel history")
    expect(() => parseNeoviewBoardLayoutPatch({ expectedRevision: 0, board: {
      panels: [{ id: "history", visible: true, order: 0, position: "left" }],
      cards: [
        { cardId: "history-list", panelId: "history", visible: true, order: 0 },
        { cardId: "book-information", panelId: "history", visible: false, order: 1 },
      ],
    } })).toThrow("cannot hide card book-information")
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
