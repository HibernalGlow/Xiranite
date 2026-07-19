import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { LEGACY_NEOVIEW_SETTINGS_SOURCE_HASH, LegacySettingsCodec } from "./LegacySettingsCodec.js"

describe("LegacySettingsCodec", () => {
  const codec = new LegacySettingsCodec()

  it("pins the explicit mapping table to the frozen NeoViewSettings source", async () => {
    const inventoryPath = resolve(import.meta.dirname, "../../../../../migration/neoview/frontend/module-inventory.json")
    const inventory = JSON.parse(await readFile(inventoryPath, "utf8")) as { modules: Array<{ file: string; hash: string }> }
    const source = inventory.modules.find((entry) => entry.file === "src/lib/settings/types.ts")
    expect(source?.hash).toBe(LEGACY_NEOVIEW_SETTINGS_SOURCE_HASH)
  })

  it("[neoview.settings.codec] maps direct NeoViewSettings into the versioned TOML shape", () => {
    const result = codec.decode({
      system: {
        language: "zh-CN",
        hardwareAcceleration: true,
        temporaryDirectory: "D:/cache/neoview",
        thumbnailDirectory: "D:/thumbs",
        excludedPaths: ["D:/private"],
      },
      performance: {
        cacheMemorySize: 1024,
        progressiveLoad: { enabled: true, dwellTime: 2, batchSize: 4, maxPages: 30 },
      },
      image: { hoverScrollEnabled: false, hoverScrollSpeed: 4.5 },
      view: {
        defaultZoomMode: "fitWidth",
        magnifier: { zoom: 3, size: 260 },
        pageLayout: { splitHorizontalPages: true, widePageStretch: "uniformHeight" },
        sidebarControl: { enabled: false, position: { x: 130, y: 170 } },
      },
      book: { readingDirection: "right-to-left", doublePageView: true, tailOverflowBehavior: "seamlessLoop", lockedSortMode: "fileSizeDescending", lockedMediaPriority: "videoFirst" },
      subtitleFontSize: 1.2,
      theme: { theme: "dark", uiScale: 1.25 },
    })

    expect(result.configPatch).toMatchObject({
      schema_version: 1,
      system: {
        language: "zh-CN",
        hardware_acceleration: true,
        excluded_paths: ["D:/private"],
      },
      paths: { temporary_directory: "D:/cache/neoview", thumbnail_directory: "D:/thumbs" },
      performance: {
        cache_memory_size_mb: 1024,
        progressive_load: { enabled: true, dwell_time: 2, batch_size: 4, max_pages: 30 },
      },
      reader: {
        default_zoom_mode: "fitWidth",
        split_wide_pages: true,
        reading_direction: "right-to-left",
        double_page_view: true,
        tail_overflow_behavior: "seamless-loop",
        hover_scroll_enabled: false,
        hover_scroll_speed: 4.5,
        view: { page_layout: { wide_page_stretch: "uniformHeight" } },
        subtitle: { font_size: 1.2 },
      },
      view: { magnifier: { zoom: 3, size: 260 } },
      book: { locked_sort_mode: "fileSizeDescending", locked_media_priority: "videoFirst" },
      panels: { sidebar_control: { enabled: false, position: { x: 130, y: 170 } } },
    })
    expect(result.configPatch).not.toHaveProperty("reader.view.sidebar_control")
    expect(result.configPatch).not.toHaveProperty("theme")
    expect(result.report.entries).toContainEqual(expect.objectContaining({ sourcePath: "theme", disposition: "host-replaced" }))
    expect(result.report.fullyRecognized).toBe(true)
  })

  it("recognizes NeoView/1.0 and deprecated renderer/data-source settings", () => {
    const result = codec.decode(JSON.stringify({
      format: "NeoView/1.0",
      config: {
        system: { language: "en" },
        view: { renderMode: "canvas", dataSource: "ipc", defaultZoomMode: "fit" },
      },
    }))

    expect(result.report.sourceKind).toBe("neoview-1.0")
    expect(result.report.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourcePath: "config.view.renderMode", disposition: "host-replaced" }),
      expect.objectContaining({ sourcePath: "config.view.dataSource", disposition: "host-replaced" }),
    ]))
    expect(JSON.stringify(result.configPatch)).not.toContain("canvas")
    expect(JSON.stringify(result.configPatch)).not.toContain("ipc")
  })

  it("[neoview.media.legacy-format-import] validates old image and video formats through the current registry", () => {
    const migrated = codec.decode({
      image: {
        supportedFormats: [".JPG", "webp", "jxl"],
        videoFormats: ["MP4", "webm", "nov"],
      },
    })
    expect(migrated.configPatch).toMatchObject({
      image: {
        supported_formats: ["jpg", "webp", "jxl"],
        video_formats: ["mp4", "webm", "nov"],
      },
    })
    expect(migrated.report.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourcePath: "image.supportedFormats", targetPath: "image.supported_formats", disposition: "converted" }),
      expect.objectContaining({ sourcePath: "image.videoFormats", targetPath: "image.video_formats", disposition: "converted" }),
    ]))

    const rejected = codec.decode({
      image: { supportedFormats: ["jpg", "legacy-raw"] },
    })
    expect(rejected.configPatch).not.toHaveProperty("image.supported_formats")
    expect(rejected.report.entries).toContainEqual(expect.objectContaining({
      sourcePath: "image.supportedFormats",
      disposition: "invalid",
      message: expect.stringContaining("requires an explicit image/* MIME override"),
    }))
  })

  it("maps full exports, defers database data, and replaces themes", () => {
    const result = codec.decode({
      version: "1.0.0",
      includeNativeSettings: true,
      includeExtendedData: true,
      nativeSettings: { system: { language: "ja" }, view: { defaultZoomMode: "fit" } },
      appSettings: {
        version: "1.0.0",
        timestamp: 123,
        keybindings: [{
          action: "nextPage",
          bindings: [{ type: "keyboard", key: "ArrowRight" }, { type: "mouse", gesture: "wheel-down" }],
        }],
        radialMenus: {
          id: "default",
          name: "旧轮盘",
          items: [{ id: "next", label: "下一页", action: "nextPage" }],
          radius: 120,
          innerRadius: 40,
          variant: "slice",
          startAngle: -90,
          sweepAngle: 360,
        },
        emmMetadata: { enableEMM: true, fileListTagDisplayMode: "collect" },
        fileBrowser: { sortField: "name", sortOrder: "asc" },
        theme: { mode: "dark" },
      },
      extended: {
        panelsLayout: { sidebars: ["pages"] },
        bookmarks: [{ name: "Book", path: "D:/book.cbz" }],
        history: [{ path: "D:/book.cbz", currentPage: 4 }],
        themeStorage: { customThemes: [{ name: "legacy" }] },
        excludedPaths: ["D:/skip"],
      },
    })

    expect(result.configPatch).toMatchObject({
      integrations: { emm: { enable_emm: true, file_list_tag_display_mode: "collect" } },
      file_browser: { sort_field: "name", sort_order: "asc" },
      panels: { layout: { sidebars: ["pages"] } },
      system: { excluded_paths: ["D:/skip"] },
    })
    expect(result.configPatch.bindings).toMatchObject({ radial_menus: { activeMenuId: "default" } })
    expect((result.configPatch.bindings as { items: unknown[] }).items).toEqual([
      expect.objectContaining({ action: "reader.next-page", input: expect.objectContaining({ device: "keyboard", code: "ArrowRight" }) }),
      expect.objectContaining({ action: "reader.next-page", input: expect.objectContaining({ device: "wheel", direction: "down" }) }),
    ])
    expect((result.configPatch.bindings as { radial_menus: { menus: Array<{ layers: unknown[][] }> } }).radial_menus.menus[0]?.layers[0]?.[0]).toMatchObject({ action: "reader.next-page" })
    expect(result.pendingData).toEqual({
      bookmarks: [{ name: "Book", path: "D:/book.cbz" }],
      history: [{ path: "D:/book.cbz", currentPage: 4 }],
    })
    expect(result.report.summary["pending-data"]).toBe(2)
    expect(result.report.summary["host-replaced"]).toBe(2)
    expect(result.report.fullyRecognized).toBe(false)
  })

  it("selects modules explicitly and reports skipped data", () => {
    const result = codec.decode({
      version: "1.0.0",
      nativeSettings: { system: { language: "en" }, view: { defaultZoomMode: "fit" } },
      appSettings: {
        keybindings: { next: ["ArrowRight"] },
        emmMetadata: { enableEMM: true },
        fileBrowser: { sortField: "name", sortOrder: "asc" },
      },
      extended: {
        bookmarks: [{ path: "D:/book.cbz" }],
        history: [{ path: "D:/book.cbz" }],
        panelsLayout: { sidebars: [] },
      },
    }, { modules: ["native-settings", "bookmarks"] })

    expect(result.configPatch).toMatchObject({ system: { language: "en" } })
    expect(result.configPatch).not.toHaveProperty("bindings")
    expect(result.configPatch).not.toHaveProperty("integrations")
    expect(result.pendingData).toEqual({ bookmarks: [{ path: "D:/book.cbz" }] })
    expect(result.report.fullyRecognized).toBe(false)
    expect(result.report.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourcePath: "appSettings.keybindings", disposition: "skipped" }),
      expect.objectContaining({ sourcePath: "extended.history", disposition: "skipped" }),
      expect.objectContaining({ sourcePath: "extended.panelsLayout", disposition: "skipped" }),
    ]))
  })

  it("recognizes backup raw storage without persisting credentials", () => {
    const result = codec.decode({
      version: "2.0.0",
      backupType: "manual",
      rawLocalStorage: {
        "neoview-settings": JSON.stringify({
          system: { language: "zh-CN" },
          view: { defaultZoomMode: "fill" },
        }),
        "theme-mode": "dark",
        "neoview-gist-sync": JSON.stringify({ token: "github-secret", gistId: "abc" }),
        "neoview-history": "[]",
      },
    })

    expect(result.report.sourceKind).toBe("backup")
    expect(result.configPatch).toMatchObject({ system: { language: "zh-CN" }, reader: { default_zoom_mode: "fill" } })
    expect(JSON.stringify(result)).not.toContain("github-secret")
    expect(result.report.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourcePath: "rawLocalStorage.neoview-gist-sync", disposition: "rejected-sensitive" }),
      expect.objectContaining({ sourcePath: "rawLocalStorage.neoview-history", disposition: "pending-data" }),
    ]))
  })

  it("[neoview.bindings.legacy-import-transaction] converts raw localStorage bindings and radial menus into canonical TOML", () => {
    const result = codec.decode({
      version: "2.0.0",
      backupType: "manual",
      rawLocalStorage: {
        "neoview-keybindings": JSON.stringify([{
          action: "nextPage",
          bindings: [{ type: "keyboard", key: "ArrowRight" }, { type: "keyboard", key: "Space" }],
          contextBindings: [{ context: "viewer", input: { type: "mouse", gesture: "click", button: "right" } }],
        }]),
        "neoview-radial-menus": JSON.stringify({
          id: "default",
          name: "旧轮盘",
          items: [{ id: "next", label: "下一页", action: "nextPage" }],
        }),
      },
    }, { modules: ["keybindings"] })

    const bindings = result.configPatch.bindings as { items: unknown[]; radial_menus: { menus: Array<{ layers: unknown[][] }> } }
    expect(bindings.items).toEqual([
      expect.objectContaining({ action: "reader.next-page", context: "global", input: expect.objectContaining({ device: "keyboard", code: "ArrowRight" }) }),
      expect.objectContaining({ action: "reader.next-page", context: "global", input: expect.objectContaining({ device: "keyboard", code: "Space" }) }),
      expect.objectContaining({ action: "reader.next-page", context: "reader", input: expect.objectContaining({ device: "mouse", button: 2, action: "click" }) }),
    ])
    expect(bindings.radial_menus.menus[0]?.layers[0]?.[0]).toMatchObject({ action: "reader.next-page" })
    expect(result.report.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourcePath: "rawLocalStorage.neoview-keybindings[0].bindings[1]", targetPath: "bindings.items.1", disposition: "converted" }),
      expect.objectContaining({ sourcePath: "rawLocalStorage.neoview-radial-menus", targetPath: "bindings.radial_menus", disposition: "converted" }),
    ]))
  })

  it("delegates every legacy upscale source to the versioned preferences codec", () => {
    const result = codec.decode({
      version: "2.0.0",
      backupType: "manual",
      nativeSettings: {
        image: {
          enableSuperResolution: false,
          superResolutionModel: "MODEL_REALESRGAN_ANIMAVIDEOV3_UP2X",
        },
      },
      extendedData: {
        upscalePanelSettings: {
          autoUpscaleEnabled: true,
          selectedModel: "MODEL_REALCUGAN_SE_UP3X",
          scale: 3,
        },
      },
      rawLocalStorage: {
        pyo3_upscale_settings: JSON.stringify({ preUpscaleEnabled: false, preloadPages: 7 }),
      },
    })

    expect(result.configPatch).toMatchObject({
      super_resolution: {
        preferences: {
          schema_version: 1,
          current_image_upscale_enabled: false,
          auto_upscale_enabled: true,
          pre_upscale_enabled: false,
          preload_pages: 7,
          default_model_id: "realcugan",
          default_scale: 3,
        },
      },
    })
    expect(result.configPatch).not.toHaveProperty("upscale")
    expect(result.configPatch).not.toHaveProperty("image.enable_super_resolution")
    expect(result.configPatch).not.toHaveProperty("super_resolution.provider")
  })

  it("reports unknown and malformed fields instead of silently dropping them", () => {
    const result = codec.decode({
      system: { language: "en", futureOption: true },
      view: { defaultZoomMode: Number.POSITIVE_INFINITY },
      futureSection: { enabled: true },
    })

    expect(result.report.fullyRecognized).toBe(false)
    expect(result.report.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourcePath: "system.futureOption", disposition: "unknown" }),
      expect.objectContaining({ sourcePath: "view.defaultZoomMode", disposition: "invalid" }),
      expect.objectContaining({ sourcePath: "futureSection", disposition: "unknown" }),
    ]))
  })
})
