import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { ReaderHttpController } from "./ReaderHttpController.js"

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("Reader directory filter HTTP", () => {
  it("[neoview.folder.filter-http] filters before pagination and preserves the filter across navigation", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-folder-filter-"))
    cleanup.push(root)
    const nested = join(root, "Nested")
    await mkdir(nested)
    await Promise.all([
      writeFile(join(root, "A.cbz"), Uint8Array.of()),
      writeFile(join(root, "B.zip"), Uint8Array.of()),
      writeFile(join(root, "Clip.mp4"), Uint8Array.of()),
      writeFile(join(root, "Custom.clipx"), Uint8Array.of()),
      writeFile(join(root, "Cover.jpg"), Uint8Array.of()),
      writeFile(join(nested, "Nested.cbz"), Uint8Array.of()),
      writeFile(join(nested, "Nested.jpg"), Uint8Array.of()),
    ])
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "filter-token",
      progressStore: false,
      media: {
        supportedImageFormats: ["jpg"],
        videoFormats: ["mp4", "clipx"],
        mediaMimeTypes: { clipx: "video/x-test" },
      },
    })
    try {
      const opened = await json(controller, "/reader/browser/sessions", "POST", { path: root }, 201) as BrowserPage
      expect(opened).toMatchObject({ filter: "all", filterOptions: ["all", "library", "archive", "directory", "video", "image", "other"], total: 6 })
      const endpoint = `/reader/browser/s/${encodeURIComponent(opened.sessionId)}/filter`

      const archives = await json(controller, endpoint, "PATCH", { filter: "archive", focusPath: join(root, "B.zip") }) as BrowserPage
      expect(archives).toMatchObject({
        generation: opened.generation + 1,
        filter: "archive",
        total: 2,
        suggestedSelection: { path: join(root, "B.zip"), index: 1 },
      })
      expect(archives.entries.map((entry) => entry.name)).toEqual(["A.cbz", "B.zip"])
      await expect(json(controller, `/reader/browser/s/${opened.sessionId}/entries?cursor=1&limit=1`)).resolves.toMatchObject({
        filter: "archive",
        total: 2,
        entries: [{ name: "B.zip" }],
      })

      const archiveSearch = await readNdjson((await controller.handle(authorized(
        `/reader/browser/s/${opened.sessionId}/search?q=${encodeURIComponent(".")}`,
      )))!)
      expect(archiveSearch[0]).toMatchObject({ type: "meta", filter: "archive" })
      const archiveNames = archiveSearch.flatMap((event) => event.type === "entry" ? [String((event.entry as { name: string }).name)] : [])
      expect(archiveNames).toEqual(expect.arrayContaining(["A.cbz", "B.zip", "Nested.cbz"]))
      expect(archiveNames.every((name) => /\.(?:cbz|zip)$/iu.test(name))).toBe(true)

      const navigated = await json(controller, `/reader/browser/s/${opened.sessionId}/navigate`, "POST", { action: "path", path: nested }) as BrowserPage
      expect(navigated).toMatchObject({ filter: "archive", total: 1, entries: [{ name: "Nested.cbz" }] })

      const videos = await json(controller, endpoint, "PATCH", { filter: "video" }) as BrowserPage
      expect(videos).toMatchObject({ filter: "video", total: 0 })
      await json(controller, endpoint, "PATCH", { filter: "invalid" }, 400)
      await json(controller, endpoint, "PATCH", { filter: "all", unknown: true }, 400)
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.folder.filter-media-registry] recognizes configured video extensions", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-folder-filter-media-"))
    cleanup.push(root)
    await Promise.all([
      writeFile(join(root, "Custom.clipx"), Uint8Array.of()),
      writeFile(join(root, "Cover.jpg"), Uint8Array.of()),
    ])
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "filter-token",
      progressStore: false,
      media: {
        supportedImageFormats: ["jpg"],
        videoFormats: ["clipx"],
        mediaMimeTypes: { clipx: "video/x-test" },
      },
    })
    try {
      const opened = await json(controller, "/reader/browser/sessions", "POST", { path: root }, 201) as BrowserPage
      const filtered = await json(controller, `/reader/browser/s/${opened.sessionId}/filter`, "PATCH", { filter: "video" }) as BrowserPage
      expect(filtered).toMatchObject({ total: 1, entries: [{ name: "Custom.clipx" }] })
      const search = await readNdjson((await controller.handle(authorized(
        `/reader/browser/s/${opened.sessionId}/search?q=custom`,
      )))!)
      expect(search).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "meta", filter: "video" }),
        expect.objectContaining({ type: "entry", entry: expect.objectContaining({ name: "Custom.clipx" }) }),
      ]))
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })
})

interface BrowserPage {
  sessionId: string
  generation: number
  filter: string
  filterOptions: string[]
  total: number
  entries: Array<{ name: string; path: string }>
}

async function json(
  controller: ReaderHttpController,
  path: string,
  method = "GET",
  body?: unknown,
  status = 200,
): Promise<unknown> {
  const response = await controller.handle(new Request(`http://127.0.0.1:41000${path}`, {
    method,
    headers: {
      "x-xiranite-token": "filter-token",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }))
  expect(response?.status).toBe(status)
  return response ? response.json() : undefined
}

function authorized(path: string): Request {
  return new Request(`http://127.0.0.1:41000${path}`, { headers: { "x-xiranite-token": "filter-token" } })
}

async function readNdjson(response: Response): Promise<Array<Record<string, unknown>>> {
  return (await response.text()).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
}
