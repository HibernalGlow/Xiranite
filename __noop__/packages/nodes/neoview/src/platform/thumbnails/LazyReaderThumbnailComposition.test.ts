import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderThumbnailStore } from "../../ports/ReaderThumbnailStore.js"
import { createReaderHttpController } from "../../platform.js"

describe("NeoView platform thumbnail composition", () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it("[neoview.thumbnail.store-composition-lazy] opens the main database only for thumbnail capability use", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-thumbnail-lazy-"))
    roots.push(root)
    const bookPath = join(root, "book")
    await mkdir(bookPath)
    const pageBytes = pngHeader(32, 48)
    await writeFile(join(bookPath, "001.png"), pageBytes)
    const dispose = vi.fn(async () => undefined)
    const maintenanceSnapshot = vi.fn(async () => ({
      totalRows: 0,
      fileRows: 0,
      folderRows: 0,
      blobBytes: 0,
      emptyBlobs: 0,
      failedRows: 0,
      failuresByReason: {},
      writer: { pendingWrites: 0, flushing: false, committedBatches: 0, committedWrites: 0, busyRetries: 0, failedBatches: 0 },
    }))
    const loadedStore: ReaderThumbnailStore & AsyncDisposable = {
      get: async () => undefined,
      maintenanceSnapshot,
      [Symbol.asyncDispose]: dispose,
    }
    const loadLegacyThumbnailStore = vi.fn(async () => loadedStore)
    const controller = await createReaderHttpController({
      baseUrl: "http://127.0.0.1:43126",
      token: "runtime-token",
      configPath: join(root, "missing.toml"),
      legacyThumbnailDatabasePath: join(root, "thumbnails.db"),
      loadLegacyThumbnailStore,
    })

    const config = await controller.handle(authorized("http://127.0.0.1:43126/reader/config"))
    expect(config?.status).toBe(200)
    expect(loadLegacyThumbnailStore).not.toHaveBeenCalled()

    const opened = await controller.handle(new Request("http://127.0.0.1:43126/reader/sessions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-xiranite-token": "runtime-token" },
      body: JSON.stringify({ path: bookPath }),
    }))
    expect(opened?.status).toBe(201)
    const session = await opened!.json() as { visiblePages: Array<{ assetUrl: string }> }
    const page = await controller.handle(new Request(session.visiblePages[0]!.assetUrl))
    expect(page?.status).toBe(200)
    expect(new Uint8Array(await page!.arrayBuffer())).toEqual(pageBytes)
    expect(loadLegacyThumbnailStore).not.toHaveBeenCalled()

    const maintenance = await controller.handle(authorized("http://127.0.0.1:43126/reader/thumbnails/maintenance"))
    expect(maintenance?.status).toBe(200)
    expect(loadLegacyThumbnailStore).toHaveBeenCalledOnce()
    expect(loadLegacyThumbnailStore).toHaveBeenCalledWith(join(root, "thumbnails.db"))
    expect(maintenanceSnapshot).toHaveBeenCalledOnce()

    await controller[Symbol.asyncDispose]()
    expect(dispose).toHaveBeenCalledOnce()
  })
})

function authorized(url: string): Request {
  return new Request(url, { headers: { "x-xiranite-token": "runtime-token" } })
}

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8)
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  bytes[24] = 8
  bytes[25] = 2
  return bytes
}
