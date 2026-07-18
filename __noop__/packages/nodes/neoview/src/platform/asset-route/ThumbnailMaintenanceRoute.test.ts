import { describe, expect, it, vi } from "vitest"

import type { ReaderThumbnailMaintenanceSnapshot, ReaderThumbnailStore } from "../../ports/ReaderThumbnailStore.js"
import { ThumbnailMaintenanceRoute } from "./ThumbnailMaintenanceRoute.js"

describe("ThumbnailMaintenanceRoute", () => {
  it("[neoview.thumbnail.maintenance.http] exposes aggregate stats without database paths or thumbnail keys", async () => {
    const snapshot = fixtureSnapshot()
    const maintenanceSnapshot = vi.fn(async () => snapshot)
    const route = new ThumbnailMaintenanceRoute({ token: "secret", thumbnailStore: store({ maintenanceSnapshot }) })
    expect((await route.handle(request("/reader/thumbnails/maintenance")))?.status).toBe(401)
    const response = (await route.handle(request("/reader/thumbnails/maintenance?token=secret")))!
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(JSON.parse(text)).toEqual({ snapshot })
    expect(text).not.toContain("thumbnails.db")
    expect(text).not.toContain("D:/private")
  })

  it("[neoview.thumbnail.maintenance.bounded] requires a header and maps cleanup requests to bounded store operations", async () => {
    const cleanup = vi.fn(async () => 17)
    const cleanupInvalid = vi.fn(async () => ({ scanned: 500, deleted: 2, unavailableVolumeRowsPreserved: 4, wrapped: false }))
    const clearFailures = vi.fn(async () => 3)
    const route = new ThumbnailMaintenanceRoute({
      token: "secret",
      thumbnailStore: store({ cleanup, cleanupInvalid, clearFailures }),
      now: () => Date.parse("2026-07-15T00:00:00Z"),
    })
    expect((await route.handle(jsonRequest("/reader/thumbnails/maintenance/cleanup?token=secret", { kind: "empty" })))?.status).toBe(401)
    const expired = (await route.handle(jsonRequest("/reader/thumbnails/maintenance/cleanup", {
      kind: "expired",
      days: 30,
      limit: 250,
      preserveFolders: true,
    }, true)))!
    expect(await expired.json()).toEqual({ deleted: 17, cutoff: "2026-06-15 00:00:00" })
    expect(cleanup).toHaveBeenCalledWith(
      { kind: "expired", cutoff: "2026-06-15 00:00:00", limit: 250, preserveFolders: true },
      expect.any(AbortSignal),
    )
    expect((await route.handle(jsonRequest("/reader/thumbnails/maintenance/cleanup", {
      kind: "expired", days: 30, preserveFolders: false,
    }, true)))?.status).toBe(400)
    const invalid = (await route.handle(jsonRequest("/reader/thumbnails/maintenance/cleanup", {
      kind: "invalid", limit: 20, scanLimit: 500,
    }, true)))!
    expect(await invalid.json()).toEqual({ result: { scanned: 500, deleted: 2, unavailableVolumeRowsPreserved: 4, wrapped: false } })
    expect(cleanupInvalid).toHaveBeenCalledWith({ scanLimit: 500, deleteLimit: 20 }, expect.any(AbortSignal))
    expect((await route.handle(jsonRequest("/reader/thumbnails/maintenance/cleanup", {
      kind: "invalid", limit: 501,
    }, true)))?.status).toBe(400)
    expect((await route.handle(jsonRequest("/reader/thumbnails/maintenance/cleanup", {
      kind: "invalid", scanLimit: 2001,
    }, true)))?.status).toBe(400)

    const cleared = (await route.handle(jsonRequest("/reader/thumbnails/maintenance/failures/clear", {
      reason: "decode-error",
      limit: 100,
    }, true)))!
    expect(await cleared.json()).toEqual({ deleted: 3 })
    expect(clearFailures).toHaveBeenCalledWith({ reason: "decode-error", limit: 100 }, expect.any(AbortSignal))
  })

  it("[neoview.thumbnail.maintenance-cancel-http] propagates request cancellation instead of converting it to a database error", async () => {
    const started = Promise.withResolvers<AbortSignal>()
    const cleanupInvalid = vi.fn(async (_options: unknown, signal?: AbortSignal) => {
      started.resolve(signal!)
      return new Promise<never>((_resolve, reject) => {
        signal!.addEventListener("abort", () => reject(signal!.reason), { once: true })
      })
    })
    const route = new ThumbnailMaintenanceRoute({ token: "secret", thumbnailStore: store({ cleanupInvalid }) })
    const cancellation = new AbortController()
    const operation = route.handle(new Request("http://127.0.0.1:41000/reader/thumbnails/maintenance/cleanup", {
      method: "POST",
      headers: { "content-type": "application/json", "x-xiranite-token": "secret" },
      body: JSON.stringify({ kind: "invalid", scanLimit: 20, limit: 10 }),
      signal: cancellation.signal,
    }))
    const forwarded = await started.promise
    cancellation.abort(new DOMException("cancelled", "AbortError"))
    await expect(operation).rejects.toMatchObject({ name: "AbortError" })
    expect(forwarded.aborted).toBe(true)
  })

  it("returns 501 when the active thumbnail store is read-only or disabled", async () => {
    const route = new ThumbnailMaintenanceRoute({ token: "secret", thumbnailStore: store({}) })
    expect((await route.handle(request("/reader/thumbnails/maintenance?token=secret")))?.status).toBe(501)
    expect((await route.handle(jsonRequest("/reader/thumbnails/maintenance/cleanup", { kind: "empty" }, true)))?.status).toBe(501)
  })
})

function store(overrides: Partial<ReaderThumbnailStore>): ReaderThumbnailStore {
  return { get: async () => undefined, ...overrides }
}

function fixtureSnapshot(): ReaderThumbnailMaintenanceSnapshot {
  return {
    totalRows: 12,
    fileRows: 7,
    folderRows: 5,
    blobBytes: 1024,
    emptyBlobs: 0,
    failedRows: 1,
    failuresByReason: { "decode-error": 1 },
    databaseBytes: 4096,
    walBytes: 128,
    writer: {
      pendingWrites: 0,
      flushing: false,
      committedBatches: 2,
      committedWrites: 12,
      busyRetries: 0,
      failedBatches: 0,
    },
  }
}

function request(path: string): Request {
  return new Request(`http://127.0.0.1:41000${path}`)
}

function jsonRequest(path: string, body: unknown, authorized = false): Request {
  return new Request(`http://127.0.0.1:41000${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(authorized ? { "x-xiranite-token": "secret" } : {}) },
    body: JSON.stringify(body),
  })
}
