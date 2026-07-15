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
      view: {
        defaultZoomMode: "fitWidth",
        pageLayout: { splitHorizontalPages: true, widePageStretch: "uniformHeight" },
      },
      book: { readingDirection: "right-to-left", doublePageView: true },
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
        reading_direction: "right-to-left",
        double_page_view: true,
        view: { page_layout: { split_horizontal_pages: true, wide_page_stretch: "uniformHeight" } },
        subtitle: { font_size: 1.2 },
      },
    })
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

  it("maps full exports, defers database data, and replaces themes", () => {
    const result = codec.decode({
      version: "1.0.0",
      includeNativeSettings: true,
      includeExtendedData: true,
      nativeSettings: { system: { language: "ja" }, view: { defaultZoomMode: "fit" } },
      appSettings: {
        version: "1.0.0",
        timestamp: 123,
        keybindings: { next: ["ArrowRight"] },
        radialMenus: { reader: ["next"] },
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
      bindings: { keybindings: { next: ["ArrowRight"] }, radial_menus: { reader: ["next"] } },
      integrations: { emm: { enable_emm: true, file_list_tag_display_mode: "collect" } },
      file_browser: { sort_field: "name", sort_order: "asc" },
      panels: { layout: { sidebars: ["pages"] } },
      system: { excluded_paths: ["D:/skip"] },
    })
    expect(result.pendingData).toEqual({
      bookmarks: [{ name: "Book", path: "D:/book.cbz" }],
      history: [{ path: "D:/book.cbz", currentPage: 4 }],
    })
    expect(result.report.summary["pending-data"]).toBe(2)
    expect(result.report.summary["host-replaced"]).toBe(2)
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
