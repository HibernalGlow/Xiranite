import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { loadNeoviewRuntimeConfig, loadNeoviewSessionOptions } from "./loadNeoviewRuntimeConfig.js"
import { createReaderHttpController } from "../../platform.js"

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
      "tail_overflow_behavior = \"loop\"",
      "",
    ].join("\n"), "utf8")

    const configured = await loadNeoviewSessionOptions({ configPath })
    expect(configured).toMatchObject({
      direction: "right-to-left",
      layout: { pageMode: "double" },
      tailOverflow: "loop",
    })

    const explicit = await loadNeoviewSessionOptions({
      configPath,
      sessionOptions: { direction: "left-to-right", tailOverflow: "next-book" },
    })
    expect(explicit).toMatchObject({
      direction: "left-to-right",
      layout: { pageMode: "double" },
      tailOverflow: "next-book",
    })
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

  it("[neoview.settings.runtime-gui] applies the same TOML defaults in the HTTP composition", async () => {
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
      expect(await shellResponse?.json()).toMatchObject({ schemaVersion: 1, shell: { edges: { left: { triggerSize: 32 } } } })
      const patched = await controller.handle(new Request("http://127.0.0.1:43125/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-xiranite-token": "runtime-token" },
        body: JSON.stringify({ side: "left", width: 438, height: "half", verticalAlign: 25 }),
      }))
      expect(await patched?.json()).toMatchObject({ shell: { sidebars: { left: { width: 438, height: "half", verticalAlign: 25 } } } })
      expect(await readFile(configPath, "utf8")).toContain("width = 438")
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
