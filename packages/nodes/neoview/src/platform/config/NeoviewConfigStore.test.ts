import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { parseToml } from "@xiranite/config"
import { lock } from "proper-lockfile"
import { commitNeoviewConfig, readNeoviewConfig } from "./NeoviewConfigStore.js"
import { parseNeoviewRuntimeConfig, parseNeoviewSuperResolutionPreferencesPatch, parseNeoviewSwitchToastPatch } from "../../application/config/ReaderRuntimeConfig.js"

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
    expect(written.nodes.neoview.config.reader.book).toEqual({
      reading_direction: "right-to-left",
      double_page_view: false,
    })
    expect(writtenText).not.toContain("[nodes.neoview.reader")
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
    expect(written.nodes.neoview).toEqual({ config: patch })
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
    expect(written).toContain("config = { ")
    expect(written).not.toContain("[nodes.neoview.view.switch_toast]")
    expect((parseToml(written) as Record<string, any>).nodes.neoview.config.view.switch_toast.future_field).toBe("keep")
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
    expect(written).toContain("[nodes.neoview]\nconfig = { reader = { double_page_view = true } }")
    expect(written).not.toContain("[nodes.neoview.reader]")
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
    expect(written.nodes.neoview.config.concurrent).toEqual(Object.fromEntries(
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
