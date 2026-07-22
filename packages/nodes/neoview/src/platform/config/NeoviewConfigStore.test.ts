import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { parseToml } from "@xiranite/config"
import { lock } from "proper-lockfile"
import { commitNeoviewConfig, readNeoviewConfig } from "./NeoviewConfigStore.js"
import { parseNeoviewEmmPatch, parseNeoviewRuntimeConfig, parseNeoviewShellControlPatch, parseNeoviewSuperResolutionPreferencesPatch, parseNeoviewSwitchToastPatch } from "../../application/config/ReaderRuntimeConfig.js"

describe("commitNeoviewConfig", () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it("[neoview.super-resolution.preferences-first-write] creates a versioned preferences table from a partial GUI patch", async () => {
    const root = await temporaryRoot(roots)
    const configPath = join(root, "xiranite.config.toml")
    await writeFile(configPath, "[nodes.neoview]\nschema_version = 1\n", "utf8")
    const { tomlPatch } = parseNeoviewSuperResolutionPreferencesPatch({
      superResolution: { preferences: { autoUpscaleEnabled: true } },
    })

    const committed = await commitNeoviewConfig(tomlPatch, { configPath, strategy: "merge" })

    expect(committed.nodeConfig).toMatchObject({ super_resolution: { preferences: { schema_version: 1, auto_upscale_enabled: true } } })
    expect(parseNeoviewRuntimeConfig(committed.nodeConfig).superResolution.preferences.autoUpscaleEnabled).toBe(true)
  })

  it("[neoview.settings.atomic-toml] deep-merges node settings, replaces arrays, backs up, and verifies TOML", async () => {
    const root = await temporaryRoot(roots)
    const configPath = join(root, "xiranite.config.toml")
    const original = [
      "[app.shell]",
      "language = \"zh\"",
      "",
      "[nodes.neoview]",
      "schema_version = 1",
      "",
      "[nodes.neoview.reader.book]",
      "reading_direction = \"left-to-right\"",
      "double_page_view = false",
      "",
      "[nodes.neoview.system]",
      "excluded_paths = [\"D:/old\"]",
      "",
    ].join("\n")
    await writeFile(configPath, original, "utf8")

    const result = await commitNeoviewConfig({
      schema_version: 1,
      reader: { book: { reading_direction: "right-to-left" } },
      system: { excluded_paths: ["D:/new"] },
    }, { configPath, strategy: "merge" })

    expect(result.changed).toBe(true)
    expect(result.nodeConfig).toMatchObject({
      reader: { book: { reading_direction: "right-to-left", double_page_view: false } },
      system: { excluded_paths: ["D:/new"] },
    })
    expect(await readFile(result.backupPath!, "utf8")).toBe(original)
    const writtenText = await readFile(configPath, "utf8")
    const written = parseToml(writtenText) as Record<string, any>
    expect(written.app.shell.language).toBe("zh")
    expect(written.nodes.neoview.reader.book).toEqual({
      reading_direction: "right-to-left",
      double_page_view: false,
    })
    expect(writtenText).toContain("[nodes.neoview.reader.book]")
  })

  it("[neoview.settings.atomic-toml-nullish-leaves] omits optional record fields before write-back verification", async () => {
    const root = await temporaryRoot(roots)
    const configPath = join(root, "xiranite.config.toml")

    const result = await commitNeoviewConfig({
      bindings: {
        radial_menus: {
          menus: [{
            id: "default",
            layers: [[{ id: "open-child", action: null, children: undefined }]],
          }],
        },
      },
    }, { configPath, strategy: "merge" })

    expect(result.nodeConfig).toEqual({
      bindings: { radial_menus: { menus: [{ id: "default", layers: [[{ id: "open-child" }]] }] } },
    })
    const written = await readFile(configPath, "utf8")
    expect(written).not.toContain("children")
    expect(written).not.toContain("action")
  })

  it("[neoview.swimlane.toml] writes each lane as one inline object without touching edge settings", async () => {
    const root = await temporaryRoot(roots)
    const configPath = join(root, "xiranite.config.toml")
    await writeFile(configPath, [
      "[nodes.neoview.panels.edges.left]",
      "pinned = true",
      "trigger_size = 11",
      "",
    ].join("\n"), "utf8")
    const { tomlPatch } = parseNeoviewShellControlPatch({
      expectedRevision: 0,
      shellControl: {
        workspace: {
          mode: "swimlane",
          laneOrder: ["left", "reader", "research", "right"],
          activeLane: "reader",
          readerSolo: true,
          readerSoloOnFocus: false,
          soloLaneId: "research",
          readerWidthRatio: 0.75,
          edgeRevealDelayMs: 280,
          edgeRevealZones: {
            left: { x: 4, y: 16, width: 8, height: 68 },
            right: { x: 88, y: 16, width: 8, height: 68 },
            top: { x: 12, y: 3, width: 76, height: 5 },
            bottom: { x: 12, y: 92, width: 76, height: 5 },
          },
          readerFocusOnHover: true,
          readerFocusHoverDelayMs: 700,
          showLaneNavigatorInReaderSolo: true,
          barHandleStyle: "edge",
          barHandlePosition: "right",
          laneNavigatorPositionX: 83,
          laneNavigatorPositionY: 92,
          laneNavigatorDock: "window-title",
          windowControlsPlacement: "titlebar",
          windowControlsOwnerLaneId: "research",
          windowControlsExpanded: true,
          lanes: {
            left: { width: 420, collapsed: false, activePanelId: "folder" },
            reader: { width: 1440 },
            research: { width: 460, collapsed: false, title: "资料" },
            right: { width: 380, collapsed: true, activePanelId: "info" },
          },
        },
      },
    })

    const committed = await commitNeoviewConfig(tomlPatch, { configPath, strategy: "merge" })
    const written = await readFile(configPath, "utf8")
    expect(written).toContain("[nodes.neoview.panels.swimlane]")
    expect(written).toContain("reader_width_ratio = 0.75")
    expect(written).toContain("reader_solo_on_focus = false")
    expect(written).toContain('solo_lane = "research"')
    expect(written).toContain("edge_reveal_delay_ms = 280")
    expect(written).toContain("left_reveal_zone = { x = 4, y = 16, width = 8, height = 68 }")
    expect(written).toContain("right_reveal_zone = { x = 88, y = 16, width = 8, height = 68 }")
    expect(written).toContain("top_reveal_zone = { x = 12, y = 3, width = 76, height = 5 }")
    expect(written).toContain("bottom_reveal_zone = { x = 12, y = 92, width = 76, height = 5 }")
    expect(written).toContain("reader_focus_on_hover = true")
    expect(written).toContain("reader_focus_hover_delay_ms = 700")
    expect(written).toContain("show_lane_navigator_in_reader_solo = true")
    expect(written).toContain('bar_handle_style = "edge"')
    expect(written).toContain('bar_handle_position = "right"')
    expect(written).toContain("lane_navigator_position_x = 83")
    expect(written).toContain("lane_navigator_position_y = 92")
    expect(written).toContain('lane_navigator_dock = "window-title"')
    expect(written).toContain('window_controls_placement = "titlebar"')
    expect(written).toContain('window_controls_owner_lane_id = "research"')
    expect(written).toContain("window_controls_expanded = true")
    expect(written).toContain('left = { width = 420, collapsed = false, active_panel_id = "folder" }')
    expect(written).toContain("reader = { width = 1440 }")
    expect(written).toContain('research = { width = 460, collapsed = false, title = "资料" }')
    expect(written).toContain('right = { width = 380, collapsed = true, active_panel_id = "info" }')
    expect(written).not.toContain("nodes.neoview.panels.swimlane.left")
    expect(committed.nodeConfig.panels).toMatchObject({
      edges: { left: { pinned: true, trigger_size: 11 } },
      layout_mode: "swimlane",
    })
    expect(parseNeoviewRuntimeConfig(committed.nodeConfig).shellOptions.workspace).toMatchObject({
      mode: "swimlane",
      swimlane: {
        laneOrder: ["left", "reader", "research", "right"],
        readerSoloOnFocus: false,
        soloLaneId: "research",
        edgeRevealZones: {
          left: { x: 4, y: 16, width: 8, height: 68 },
          right: { x: 88, y: 16, width: 8, height: 68 },
          top: { x: 12, y: 3, width: 76, height: 5 },
          bottom: { x: 12, y: 92, width: 76, height: 5 },
        },
        showLaneNavigatorInReaderSolo: true,
        barHandleStyle: "edge",
        barHandlePosition: "right",
        laneNavigatorPositionX: 83,
        laneNavigatorPositionY: 92,
        laneNavigatorDock: "window-title",
        windowControlsPlacement: "titlebar",
        windowControlsOwnerLaneId: "research",
        windowControlsExpanded: true,
        lanes: { research: { width: 460, collapsed: false, title: "资料" } },
      },
    })
  })

  it("overwrite replaces only [nodes.neoview] and is idempotent", async () => {
    const root = await temporaryRoot(roots)
    const configPath = join(root, "xiranite.config.toml")
    await writeFile(configPath, "[nodes.other]\nenabled = true\n[nodes.neoview]\nold = true\n", "utf8")
    const patch = { schema_version: 1, reader: { book: { double_page_view: true } } }

    const first = await commitNeoviewConfig(patch, { configPath, strategy: "overwrite" })
    const second = await commitNeoviewConfig(patch, { configPath, strategy: "overwrite" })

    expect(first.changed).toBe(true)
    expect(second.changed).toBe(false)
    expect(second.nodeConfig).not.toHaveProperty("old")
    const written = parseToml(await readFile(configPath, "utf8")) as Record<string, any>
    expect(written.nodes.other.enabled).toBe(true)
    expect(written.nodes.neoview).toEqual(patch)
  })

  it("[neoview.switch-toast.persistence] atomically writes canonical leaves and preserves future fields", async () => {
    const root = await temporaryRoot(roots)
    const configPath = join(root, "xiranite.config.toml")
    await writeFile(configPath, [
      "[nodes.neoview]",
      "schema_version = 1",
      "[nodes.neoview.view.switch_toast]",
      "enable_book = false",
      "future_field = \"keep\"",
      "",
    ].join("\n"), "utf8")
    const { tomlPatch } = parseNeoviewSwitchToastPatch({ switchToast: {
      enableBook: true,
      positionX: 88,
      bookTitleTemplate: "已切换到 {{book.displayName}}",
    } })
    const committed = await commitNeoviewConfig(tomlPatch, { configPath, strategy: "merge" })
    expect(committed.nodeConfig).toMatchObject({ view: { switch_toast: {
      enable_book: true,
      position_x: 88,
      future_field: "keep",
    } } })
    expect(parseNeoviewRuntimeConfig(committed.nodeConfig).switchToast).toMatchObject({
      enableBook: true,
      positionX: 88,
      bookTitleTemplate: "已切换到 {{book.displayName}}",
    })
    const written = await readFile(configPath, "utf8")
    expect(written).toContain("[nodes.neoview.view.switch_toast]")
    expect((parseToml(written) as Record<string, any>).nodes.neoview.view.switch_toast.future_field).toBe("keep")
  })

  it("[neoview.emm-config.toml-roundtrip] writes the canonical EMM section and preserves future fields", async () => {
    const root = await temporaryRoot(roots)
    const configPath = join(root, "xiranite.config.toml")
    await writeFile(configPath, [
      "[nodes.neoview]",
      "schema_version = 1",
      "[nodes.neoview.emm]",
      "enabled = true",
      "future_field = \"keep\"",
      "",
    ].join("\n"), "utf8")
    const expected = {
      enabled: false,
      databasePaths: ["D:/EMM/database.sqlite", "E:/Alt/database.sqlite"],
      settingPath: "D:/EMM/setting.json",
      translationDatabasePath: "D:/EMM/translations.db",
      translationPath: "D:/EMM/db.text.json",
      defaultRating: 4.6,
    }
    const { tomlPatch } = parseNeoviewEmmPatch({ emm: expected })

    const committed = await commitNeoviewConfig(tomlPatch, { configPath, strategy: "merge" })
    const writtenText = await readFile(configPath, "utf8")
    const written = parseToml(writtenText) as Record<string, any>

    expect(parseNeoviewRuntimeConfig(committed.nodeConfig).emm).toEqual(expected)
    expect(written.nodes.neoview.emm).toMatchObject({
      enabled: false,
      database_paths: expected.databasePaths,
      setting_path: expected.settingPath,
      translation_database_path: expected.translationDatabasePath,
      translation_path: expected.translationPath,
      default_rating: expected.defaultRating,
      future_field: "keep",
    })
    expect(writtenText).toContain("[nodes.neoview.emm]")
  })

  it("[neoview.settings.format-compat] reads optimized, legacy, and mixed formats with optimized values taking precedence", async () => {
    const root = await temporaryRoot(roots)
    const configPath = join(root, "xiranite.config.toml")

    await writeFile(configPath, [
      "[nodes.neoview]",
      "schema_version = 1",
      "config = { reader = { double_page_view = true }, future = { optimized = true } }",
      "[nodes.neoview.reader]",
      "double_page_view = false",
      "reading_direction = \"right-to-left\"",
      "",
    ].join("\n"), "utf8")

    expect(await readNeoviewConfig({ configPath })).toEqual({
      schema_version: 1,
      reader: { double_page_view: true, reading_direction: "right-to-left" },
      future: { optimized: true },
    })
    const runtime = parseNeoviewRuntimeConfig((parseToml(await readFile(configPath, "utf8")) as Record<string, any>).nodes.neoview)
    expect(runtime.viewDefaults.pageMode).toBe("double")
    expect(runtime.sessionOptions.direction).toBe("right-to-left")
  })

  it("[neoview.settings.format-canonicalization] rewrites a semantically unchanged legacy config on the next commit", async () => {
    const root = await temporaryRoot(roots)
    const configPath = join(root, "xiranite.config.toml")
    await writeFile(configPath, "[nodes.neoview.reader]\ndouble_page_view = true\n", "utf8")

    const result = await commitNeoviewConfig({}, { configPath, strategy: "merge" })
    const written = await readFile(configPath, "utf8")

    expect(result.changed).toBe(true)
    expect(written).toContain("[nodes.neoview.reader]\ndouble_page_view = true")
    expect(written).not.toContain("nodes.neoview.config")
  })

  it("[neoview.settings.cross-process-lock] serializes concurrent read-merge-write operations without losing fields", async () => {
    const root = await temporaryRoot(roots)
    const configPath = join(root, "xiranite.config.toml")
    await writeFile(configPath, "[nodes.neoview]\nschema_version = 1\n", "utf8")

    const results = await Promise.all(Array.from({ length: 12 }, (_, index) => commitNeoviewConfig({
      concurrent: { [`writer_${index}`]: index },
    }, { configPath, strategy: "merge" })))

    expect(results.every((result) => result.changed)).toBe(true)
    const written = parseToml(await readFile(configPath, "utf8")) as Record<string, any>
    expect(written.nodes.neoview.concurrent).toEqual(Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [`writer_${index}`, index]),
    ))
  })

  it("[neoview.settings.lock-timeout] fails explicitly without touching TOML when another writer holds the lock", async () => {
    const root = await temporaryRoot(roots)
    const configPath = join(root, "xiranite.config.toml")
    const original = "[nodes.neoview]\nschema_version = 1\n"
    await writeFile(configPath, original, "utf8")
    const release = await lock(configPath, {
      lockfilePath: `${configPath}.xr-write.lock`,
      realpath: false,
      retries: 0,
    })
    try {
      await expect(commitNeoviewConfig({ reader: { changed: true } }, {
        configPath,
        strategy: "merge",
        lockRetries: 0,
      })).rejects.toThrow("Timed out waiting for the Xiranite config writer")
      expect(await readFile(configPath, "utf8")).toBe(original)
    } finally {
      await release()
    }
  })
})

async function temporaryRoot(roots: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-config-"))
  roots.push(root)
  return root
}
