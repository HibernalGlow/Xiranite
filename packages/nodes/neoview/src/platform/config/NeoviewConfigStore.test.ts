import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { parseToml } from "@xiranite/config"
import { commitNeoviewConfig } from "./NeoviewConfigStore.js"

describe("commitNeoviewConfig", () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
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
    const written = parseToml(await readFile(configPath, "utf8")) as Record<string, any>
    expect(written.app.shell.language).toBe("zh")
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
  })
})

async function temporaryRoot(roots: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-config-"))
  roots.push(root)
  return root
}
