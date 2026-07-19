import { describe, expect, it, vi } from "vitest"

import type { ReaderThumbnailMaintenanceSnapshot } from "../../ports/ReaderThumbnailStore.js"
import { ReaderThumbnailMaintenanceService } from "./ReaderThumbnailMaintenanceService.js"

describe("ReaderThumbnailMaintenanceService", () => {
  it("[neoview.thumbnail.maintenance-service] centralizes bounded maintenance policy", async () => {
    const snapshot = fixtureSnapshot()
    const maintenanceSnapshot = vi.fn(async () => snapshot)
    const cleanup = vi.fn(async () => 7)
    const cleanupInvalid = vi.fn(async () => ({ scanned: 40, deleted: 3, unavailableVolumeRowsPreserved: 2, wrapped: false }))
    const clearFailures = vi.fn(async () => 4)
    const service = new ReaderThumbnailMaintenanceService(
      { maintenanceSnapshot, cleanup, cleanupInvalid, clearFailures },
      { now: () => Date.parse("2026-07-15T00:00:00Z") },
    )

    expect(await service.status()).toEqual({ enabled: true, snapshot })
    expect(await service.cleanup({ kind: "empty", limit: 100 })).toEqual({ enabled: true, kind: "empty", deleted: 7 })
    expect(await service.cleanup({ kind: "expired", days: 30, limit: 250 })).toEqual({
      enabled: true,
      kind: "expired",
      deleted: 7,
      cutoff: "2026-06-15 00:00:00",
      foldersPreserved: true,
    })
    expect(cleanup).toHaveBeenLastCalledWith({
      kind: "expired",
      cutoff: "2026-06-15 00:00:00",
      limit: 250,
      preserveFolders: true,
    }, undefined)
    expect(await service.cleanup({ kind: "invalid", scanLimit: 40, deleteLimit: 20 })).toEqual({
      enabled: true,
      kind: "invalid",
      result: { scanned: 40, deleted: 3, unavailableVolumeRowsPreserved: 2, wrapped: false },
    })
    expect(await service.cleanup({ kind: "path-prefix", prefix: " D:/library ", limit: 25 })).toEqual({
      enabled: true,
      kind: "path-prefix",
      prefix: "D:/library",
      deleted: 7,
    })
    expect(cleanup).toHaveBeenLastCalledWith({ kind: "path-prefix", prefix: "D:/library", limit: 25 }, undefined)
    expect(await service.clearFailures({ reason: "decode-error", limit: 50 })).toEqual({ enabled: true, deleted: 4 })
  })

  it("returns disabled capabilities without touching the database port", async () => {
    const service = new ReaderThumbnailMaintenanceService({})
    expect(await service.status()).toEqual({ enabled: false })
    expect(await service.cleanup({ kind: "empty", limit: 1 })).toEqual({ enabled: false })
    expect(await service.cleanup({ kind: "expired", days: 30, limit: 1 })).toEqual({ enabled: false })
    expect(await service.cleanup({ kind: "invalid", scanLimit: 1, deleteLimit: 1 })).toEqual({ enabled: false })
    expect(await service.cleanup({ kind: "path-prefix", prefix: "D:/library", limit: 1 })).toEqual({ enabled: false })
    expect(await service.clearFailures({ limit: 1 })).toEqual({ enabled: false })
  })

  it("rejects unsafe batch sizes before invoking the store", async () => {
    const cleanupInvalid = vi.fn(async () => ({ scanned: 0, deleted: 0, unavailableVolumeRowsPreserved: 0, wrapped: false }))
    const cleanup = vi.fn(async () => 0)
    const service = new ReaderThumbnailMaintenanceService({ cleanup, cleanupInvalid })
    await expect(service.cleanup({ kind: "invalid", scanLimit: 500, deleteLimit: 501 })).rejects.toThrow("deleteLimit")
    await expect(service.cleanup({ kind: "expired", days: 0, limit: 1 })).rejects.toThrow("days")
    await expect(service.cleanup({ kind: "empty", limit: 10_001 })).rejects.toThrow("limit")
    await expect(service.cleanup({ kind: "path-prefix", prefix: "\0", limit: 1 })).rejects.toThrow("prefix")
    expect(cleanupInvalid).not.toHaveBeenCalled()
    expect(cleanup).not.toHaveBeenCalled()
  })

  it("[neoview.thumbnail.maintenance-cancel-service] forwards cancellation and rejects pre-cancelled work before touching the store", async () => {
    const cleanupInvalid = vi.fn(async () => ({ scanned: 0, deleted: 0, unavailableVolumeRowsPreserved: 0, wrapped: false }))
    const service = new ReaderThumbnailMaintenanceService({ cleanupInvalid })
    const active = new AbortController()
    await service.cleanup({ kind: "invalid", scanLimit: 20, deleteLimit: 10 }, active.signal)
    expect(cleanupInvalid).toHaveBeenCalledWith({ scanLimit: 20, deleteLimit: 10 }, active.signal)

    const cancelled = new AbortController()
    cancelled.abort(new DOMException("cancelled", "AbortError"))
    await expect(service.cleanup({ kind: "invalid", scanLimit: 20, deleteLimit: 10 }, cancelled.signal))
      .rejects.toMatchObject({ name: "AbortError" })
    expect(cleanupInvalid).toHaveBeenCalledOnce()
  })

  it("does not report a store operation as successful when cancellation arrives before it settles", async () => {
    const pending = deferred<number>()
    const cleanup = vi.fn(async () => pending.promise)
    const service = new ReaderThumbnailMaintenanceService({ cleanup })
    const controller = new AbortController()
    const operation = service.cleanup({ kind: "empty", limit: 1 }, controller.signal)

    controller.abort(new DOMException("cancelled", "AbortError"))
    pending.resolve(1)

    await expect(operation).rejects.toMatchObject({ name: "AbortError" })
    expect(cleanup).toHaveBeenCalledOnce()
  })
})

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
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
