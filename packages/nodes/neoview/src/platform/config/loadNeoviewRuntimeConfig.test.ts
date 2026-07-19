import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { loadNeoviewRuntimeConfig, loadNeoviewSessionOptions } from "./loadNeoviewRuntimeConfig.js"
import { createReaderCacheService, createReaderHttpController } from "../../platform.js"

describe("loadNeoviewSessionOptions", () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it("[neoview.settings.runtime] reads [nodes.neoview] and gives explicit composition options priority", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-runtime-config-"))
    roots.push(root)
    const configPath = join(root, "xiranite.config.toml")
    await writeFile(configPath, [
      "[nodes.neoview]",
      "schema_version = 1",
      "",
      "[nodes.neoview.reader]",
      "reading_direction = \"right-to-left\"",
      "double_page_view = true",
      "default_zoom_mode = \"fitWidth\"",
      "tail_overflow_behavior = \"loop\"",
      "[nodes.neoview.slideshow]",
      "interval_seconds = 13",
      "loop = true",
      "random = false",
      "fade_transition = false",
      "",
    ].join("\n"), "utf8")

    const configured = await loadNeoviewSessionOptions({ configPath })
    expect(configured).toMatchObject({
      direction: "right-to-left",
      layout: { pageMode: "double" },
      tailOverflow: "loop",
    })
    expect((await loadNeoviewRuntimeConfig({ configPath })).viewDefaults).toEqual({
      fitMode: "fit-width",
      pageMode: "double",
      orientation: "horizontal",
      autoRotation: "none",
      widePageStretch: "uniform-height",
    })
    expect((await loadNeoviewRuntimeConfig({ configPath })).slideshow).toEqual({ intervalSeconds: 13, loop: true, random: false, fadeTransition: false })

    const explicit = await loadNeoviewSessionOptions({
      configPath,
      sessionOptions: {
        direction: "left-to-right",
        layout: { pageMode: "single", panorama: false, singleFirstPage: true, singleLastPage: true, treatWidePageAsSingle: true },
        tailOverflow: "next-book",
      },
    })
    expect(explicit).toMatchObject({
      direction: "left-to-right",
      layout: { pageMode: "single" },
      tailOverflow: "next-book",
    })
    expect((await loadNeoviewRuntimeConfig({
      configPath,
      sessionOptions: {
        layout: { pageMode: "single", panorama: false, singleFirstPage: true, singleLastPage: true, treatWidePageAsSingle: true },
      },
    })).viewDefaults.pageMode).toBe("single")
  })

  it("[neoview.cache.cli-composition] opens the shared cache service from the same node TOML", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-cache-config-"))
    roots.push(root)
    const configPath = join(root, "xiranite.config.toml")
    await writeFile(configPath, [
      "[nodes.neoview]",
      "schema_version = 1",
      "[nodes.neoview.performance.presentation_disk_cache]",
      "enabled = false",
      "",
    ].join("\n"), "utf8")
    const disabled = await createReaderCacheService({ configPath, cwd: root })
    expect(await disabled.status()).toEqual({ enabled: false })
    await disabled[Symbol.asyncDispose]()

    await writeFile(configPath, [
      "[nodes.neoview]",
      "schema_version = 1",
      "[nodes.neoview.performance.presentation_disk_cache]",
      "enabled = true",
      "directory = \"relative-l3\"",
      "max_size_mb = 64",
      "max_entry_size_mb = 8",
      "min_free_space_mb = 0",
      "",
    ].join("\n"), "utf8")
    const enabled = await createReaderCacheService({ configPath, cwd: root })
    expect(await enabled.status()).toMatchObject({ enabled: true, entries: 0, bytes: 0, maxBytes: 64 * 1024 * 1024 })
    await enabled[Symbol.asyncDispose]()
  })

  it("does not create a config file when the default source is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-runtime-default-"))
    roots.push(root)
    expect(await loadNeoviewSessionOptions({ configPath: join(root, "missing.toml") })).toEqual({})
  })

  it("loads shell options from the same TOML snapshot as reader defaults", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-shell-config-"))
    roots.push(root)
    const configPath = join(root, "xiranite.config.toml")
    await writeFile(configPath, [
      "[nodes.neoview.panels]",
      "left_sidebar_visible = true",
      "sidebar_opacity = 70",
      "[nodes.neoview.panels.hover_areas]",
      "left_trigger_width = 9",
      "[nodes.neoview.panels.sidebars.left]",
      "width = 444",
      "height = \"half\"",
      "[[nodes.neoview.panels.layout.sidebarConfig.panels]]",
      "id = \"pageList\"",
      "visible = false",
      "order = 17",
      "position = \"left\"",
    ].join("\n"), "utf8")
    expect((await loadNeoviewRuntimeConfig({ configPath })).shellOptions).toMatchObject({
      opacity: { sidebar: 70 },
      edges: { left: { enabled: true, triggerSize: 9 } },
      sidebars: { left: { width: 444, height: "half" } },
      panelLayout: { pageList: { visible: false, order: 17, position: "left" } },
    })
  })

  it("[neoview.settings.runtime-gui] [neoview.folder.settings-toml] [neoview.folder.search-settings-toml] applies shared TOML defaults", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-runtime-http-"))
    roots.push(root)
    const bookPath = join(root, "book")
    const configPath = join(root, "xiranite.config.toml")
    await mkdir(bookPath)
    await Promise.all(Array.from({ length: 4 }, (_, index) => writeFile(
      join(bookPath, `${String(index + 1).padStart(3, "0")}.png`),
      pngHeader(50 + index, 70 + index),
    )))
    await writeFile(configPath, [
      "[nodes.neoview]",
      "schema_version = 1",
      "[nodes.neoview.reader]",
      "reading_direction = \"right-to-left\"",
      "double_page_view = true",
      "default_zoom_mode = \"fitHeight\"",
      "[nodes.neoview.panels.sidebar_control]",
      "future_controller = \"keep\"",
      "[nodes.neoview.panels.edges.top]",
      "future_edge = \"keep\"",
      "",
    ].join("\n"), "utf8")

    const controller = await createReaderHttpController({
      baseUrl: "http://127.0.0.1:43125",
      token: "runtime-token",
      configPath,
    })
    try {
      const response = await controller.handle(new Request("http://127.0.0.1:43125/reader/sessions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-xiranite-token": "runtime-token" },
        body: JSON.stringify({ path: bookPath, initialPage: 1 }),
      }))
      expect(response?.status).toBe(201)
      expect(await response?.json()).toMatchObject({
        frame: { direction: "right-to-left", layout: { pageMode: "double" } },
        visiblePages: [{ index: 2 }, { index: 1 }],
      })
      const shellResponse = await controller.handle(new Request("http://127.0.0.1:43125/reader/config", {
        headers: { "x-xiranite-token": "runtime-token" },
      }))
      expect(await shellResponse?.json()).toMatchObject({
        schemaVersion: 1,
        shell: { revision: 0, floatingControl: { enabled: true, position: { x: 100, y: 100 } }, edges: { left: { triggerSize: 32 } } },
        viewDefaults: { fitMode: "fit-height", pageMode: "double" },
        slideshow: { intervalSeconds: 5, loop: false, random: false, fadeTransition: true },
      })
      const shellPatched = await controller.handle(new Request("http://127.0.0.1:43125/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-xiranite-token": "runtime-token" },
        body: JSON.stringify({
          expectedRevision: 0,
          shellControl: {
            floating: { enabled: false, position: { x: 321, y: 123 } },
            edges: { top: { enabled: false, initialVisible: false, pinned: false, triggerSize: 14, lockMode: "locked-hidden" } },
          },
        }),
      }))
      expect(await shellPatched?.json()).toMatchObject({ shell: {
        revision: 1,
        floatingControl: { enabled: false, position: { x: 321, y: 123 } },
        edges: { top: { enabled: false, initialVisible: false, pinned: false, triggerSize: 14, lockMode: "locked-hidden" } },
      } })
      expect((await controller.handle(new Request("http://127.0.0.1:43125/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-xiranite-token": "runtime-token" },
        body: JSON.stringify({ expectedRevision: 0, shellControl: { floating: { enabled: true } } }),
      })))?.status).toBe(409)
      const resetShell = await controller.handle(new Request("http://127.0.0.1:43125/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-xiranite-token": "runtime-token" },
        body: JSON.stringify({ expectedRevision: 1, shellControl: { reset: "known-defaults" } }),
      }))
      expect(await resetShell?.json()).toMatchObject({ shell: {
        revision: 2,
        floatingControl: { enabled: true, position: { x: 100, y: 100 } },
        edges: { top: { enabled: true, initialVisible: true, pinned: false, triggerSize: 32, lockMode: "auto" } },
      } })
      const shellConfig = await readFile(configPath, "utf8")
      expect(shellConfig).toContain("[nodes.neoview.panels]")
      expect(shellConfig).toContain("future_controller = \"keep\"")
      expect(shellConfig).not.toContain("[nodes.neoview.panels.edges.top]")
      expect(shellConfig).toContain("future_edge = \"keep\"")
      expect((await loadNeoviewRuntimeConfig({ configPath })).shellOptions).toMatchObject({
        floatingControl: { enabled: true, position: { x: 100, y: 100 } },
        edges: { top: { enabled: true, initialVisible: true, pinned: false, triggerSize: 32, lockMode: "auto" } },
      })
      const viewPatched = await controller.handle(new Request("http://127.0.0.1:43125/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-xiranite-token": "runtime-token" },
        body: JSON.stringify({ viewDefaults: { fitMode: "original", pageMode: "single" } }),
      }))
      expect(await viewPatched?.json()).toMatchObject({ viewDefaults: { fitMode: "original", pageMode: "single" } })
      expect(await readFile(configPath, "utf8")).toContain("default_zoom_mode = \"original\"")
      expect(await readFile(configPath, "utf8")).toContain("double_page_view = false")
      const slideshowPatched = await controller.handle(new Request("http://127.0.0.1:43125/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-xiranite-token": "runtime-token" },
        body: JSON.stringify({ slideshow: { intervalSeconds: 14, loop: true, random: true, fadeTransition: false } }),
      }))
      expect(await slideshowPatched?.json()).toMatchObject({ slideshow: { intervalSeconds: 14, loop: true, random: true, fadeTransition: false } })
      const persistedConfig = await readFile(configPath, "utf8")
      expect(persistedConfig).toContain("[nodes.neoview.slideshow]")
      expect(persistedConfig).toContain("interval_seconds = 14")
      expect(persistedConfig).toContain("fade_transition = false")
      const folderPatched = await controller.handle(new Request("http://127.0.0.1:43125/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-xiranite-token": "runtime-token" },
        body: JSON.stringify({ folderView: {
          viewMode: "details",
          previewCount: 9,
          thumbnailWidthPercent: 36,
          bannerWidthPercent: 70,
          emptyArea: { singleClickAction: "goBack", doubleClickAction: "none", showBackButton: true },
          details: { columnOrder: ["name", "rating", "path"], hiddenColumns: ["tags"], pinnedLeft: ["name"], pinnedRight: ["rating"], columnWidths: { name: 264, path: 408 } },
          search: { includeSubfolders: false, showHistoryOnFocus: false, searchInPath: true },
          tree: { visible: true, layout: "top", size: 240, pinnedPaths: ["D:/Pinned"] },
        } }),
      }))
      expect(await folderPatched?.json()).toMatchObject({
        folderView: {
          viewMode: "details",
          previewCount: 9,
          thumbnailWidthPercent: 36,
          bannerWidthPercent: 70,
          emptyArea: { singleClickAction: "goBack", doubleClickAction: "none", showBackButton: true },
          details: { hiddenColumns: ["tags"], pinnedRight: ["rating"] },
          search: { includeSubfolders: false, showHistoryOnFocus: false, searchInPath: true },
          tree: { visible: true, layout: "top", size: 240, pinnedPaths: ["D:/Pinned"] },
        },
      })
      const folderConfig = await readFile(configPath, "utf8")
      expect(folderConfig).toContain("[nodes.neoview.folder]")
      expect(folderConfig).toContain("view_mode = \"details\"")
      expect(folderConfig).toContain("preview_count = 9")
      expect(folderConfig).toContain("thumbnail_width_percent = 36")
      expect(folderConfig).toContain("banner_width_percent = 70")
      expect(folderConfig).toContain("[nodes.neoview.folder.empty_area]")
      expect(folderConfig).toContain('single_click_action = "goBack"')
      expect(folderConfig).toContain('double_click_action = "none"')
      expect(folderConfig).toContain("show_back_button = true")
      expect(folderConfig).toContain("[nodes.neoview.folder.details]")
      expect(folderConfig).not.toContain("[nodes.neoview.folder.details.column_widths]")
      expect(folderConfig).toContain("[nodes.neoview.folder.search]")
      expect(folderConfig).toContain("include_subfolders = false")
      expect(folderConfig).toContain("show_history_on_focus = false")
      expect(folderConfig).toContain("search_in_path = true")
      expect(folderConfig).toContain("[nodes.neoview.folder.tree_view]")
      expect(folderConfig).toContain("layout = \"top\"")
      expect(folderConfig).toContain("size = 240")
      expect(folderConfig).toContain('pinned_paths = [ "D:/Pinned" ]')
      expect(folderConfig).toContain("name = 264")
      expect((await loadNeoviewRuntimeConfig({ configPath })).folderView).toMatchObject({
        viewMode: "details",
        previewCount: 9,
        thumbnailWidthPercent: 36,
        bannerWidthPercent: 70,
        emptyArea: { singleClickAction: "goBack", doubleClickAction: "none", showBackButton: true },
        details: { columnOrder: ["name", "rating", "path", "type", "extension", "size", "modifiedAt", "dimensions", "pageCount", "tags"], hiddenColumns: ["tags"], pinnedLeft: ["name"], pinnedRight: ["rating"], columnWidths: { name: 264, path: 408 } },
        search: { includeSubfolders: false, showHistoryOnFocus: false, searchInPath: true },
        tree: { visible: true, layout: "top", size: 240, pinnedPaths: ["D:/Pinned"] },
      })
      const reopened = await controller.handle(new Request("http://127.0.0.1:43125/reader/sessions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-xiranite-token": "runtime-token" },
        body: JSON.stringify({ path: bookPath, initialPage: 1 }),
      }))
      expect(await reopened?.json()).toMatchObject({
        frame: { layout: { pageMode: "single" }, pages: [{ pageIndex: 1 }] },
        visiblePages: [{ index: 1 }],
      })
      const patched = await controller.handle(new Request("http://127.0.0.1:43125/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-xiranite-token": "runtime-token" },
        body: JSON.stringify({ side: "left", pinned: false, width: 438, height: "half", verticalAlign: 25 }),
      }))
      expect(await patched?.json()).toMatchObject({ shell: { edges: { left: { pinned: false } }, sidebars: { left: { width: 438, height: "half", verticalAlign: 25 } } } })
      expect(await readFile(configPath, "utf8")).toContain("width = 438")
      expect(await readFile(configPath, "utf8")).toContain("pinned = false")
      const cardPatched = await controller.handle(new Request("http://127.0.0.1:43125/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-xiranite-token": "runtime-token" },
        body: JSON.stringify({ cardId: "page-navigation", expanded: false }),
      }))
      expect(await cardPatched?.json()).toMatchObject({ shell: { cardLayout: { "page-navigation": { expanded: false } } } })
      expect(await readFile(configPath, "utf8")).toContain("expanded = false")

      const privatePath = join(root, "private")
      await mkdir(privatePath)
      const browserOpened = await controller.handle(new Request("http://127.0.0.1:43125/reader/browser/sessions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-xiranite-token": "runtime-token" },
        body: JSON.stringify({ path: root }),
      }))
      const browser = await browserOpened?.json() as { sessionId: string }
      const exclusionPatched = await controller.handle(new Request(`http://127.0.0.1:43125/reader/browser/s/${browser.sessionId}/tree/exclusions`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-xiranite-token": "runtime-token" },
        body: JSON.stringify({ action: "exclude", path: privatePath }),
      }))
      expect(await exclusionPatched?.json()).toMatchObject({ excludedPaths: [privatePath] })
      const treeConfig = await readFile(configPath, "utf8")
      expect(treeConfig).toContain("[nodes.neoview.folder]")
      expect(treeConfig).toContain("excluded_paths = [")
      expect((await loadNeoviewRuntimeConfig({ configPath })).fileTree).toEqual({ excludedPaths: [privatePath] })
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })
})

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  for (let offset = 0; offset < 4; offset += 1) {
    bytes[16 + offset] = (width >>> ((3 - offset) * 8)) & 0xff
    bytes[20 + offset] = (height >>> ((3 - offset) * 8)) & 0xff
  }
  return bytes
}
