import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CoreReaderService } from "./application/reader/ReaderService.js"
import type { ResourceTaskRequest } from "./ports/ResourceScheduler.js"
import { createZipFixture, type ZipFixture } from "../test/fixture-builders/create-zip-fixture.js"
import { createReaderAssetRoute, createReaderBookLoader, createReaderHttpController } from "./platform.js"

const cleanupDirectories: string[] = []
const cleanupArchives: ZipFixture[] = []
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64",
)

afterEach(async () => {
  await Promise.all(cleanupArchives.splice(0).map((fixture) => fixture.cleanup()))
  await Promise.all(cleanupDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("NeoView platform composition", () => {
  it("[neoview.asset-route.scheduler-host-injection] routes direct image transforms through the host CPU pool", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-platform-scheduler-"))
    cleanupDirectories.push(directory)
    await writeFile(join(directory, "page.png"), ONE_PIXEL_PNG)
    const requests: ResourceTaskRequest[] = []
    const release = vi.fn()
    const resourceScheduler = {
      acquire: vi.fn(async (request: ResourceTaskRequest) => {
        requests.push(request)
        return { release }
      }),
    }
    const service = new CoreReaderService(await createReaderBookLoader())
    const route = await createReaderAssetRoute(service, {
      baseUrl: "http://127.0.0.1:41000",
      token: "route-token",
      resourceScheduler,
    })
    try {
      const session = await service.openViewSource({ kind: "directory", path: directory })
      const url = new URL(route.pageUrl(session.id, session.book.pages[0]!.id))
      url.searchParams.set("width", "1")
      url.searchParams.set("format", "webp")
      const response = (await route.handle(new Request(url)))!
      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toBe("image/webp")
      expect(Buffer.from(await response.arrayBuffer()).subarray(0, 4).toString("ascii")).toBe("RIFF")
      expect(requests).toContainEqual(expect.objectContaining({
        resource: "cpu",
        kind: "neoview.image-transform",
        priority: "interactive",
      }))
      expect(release).toHaveBeenCalledOnce()
    } finally {
      route.close()
      await service[Symbol.asyncDispose]()
    }
  })

  it("[neoview.archive.zip-scheduler-host-injection] shares one host lease across ZIP extraction and image transform", async () => {
    const archive = await createZipFixture({
      entries: [{ path: "page.png", bytes: ONE_PIXEL_PNG, level: 6 }],
    })
    cleanupArchives.push(archive)
    const requests: ResourceTaskRequest[] = []
    let activeLeases = 0
    const resourceScheduler = {
      acquire: vi.fn(async (request: ResourceTaskRequest) => {
        requests.push({ ...request })
        activeLeases += 1
        let released = false
        return {
          release() {
            if (released) return
            released = true
            activeLeases -= 1
          },
        }
      }),
    }
    const controller = await createReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "route-token",
      resourceScheduler,
      legacyThumbnailDatabasePath: false,
    })
    try {
      const opened = (await controller.handle(new Request("http://127.0.0.1:41000/reader/sessions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-xiranite-token": "route-token" },
        body: JSON.stringify({ path: archive.path }),
      })))!
      expect(opened.status).toBe(201)
      const session = await opened.json() as { visiblePages: Array<{ assetUrl: string }> }
      requests.length = 0
      const transformedUrl = new URL(session.visiblePages[0]!.assetUrl)
      transformedUrl.searchParams.set("width", "1")
      transformedUrl.searchParams.set("format", "webp")
      const transformed = (await controller.handle(new Request(transformedUrl)))!
      expect(transformed.status).toBe(200)
      expect(Buffer.from(await transformed.arrayBuffer()).subarray(0, 4).toString("ascii")).toBe("RIFF")
      expect(requests).toEqual([{
        resource: "cpu",
        kind: "neoview.image-transform",
        priority: "interactive",
        ownerId: undefined,
      }])
      expect(activeLeases).toBe(0)
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })
})
