import { describe, expect, it, vi } from "vitest"

import { ReaderDiagnosticsService } from "./ReaderDiagnosticsService.js"

describe("ReaderDiagnosticsService", () => {
  it("[neoview.diagnostics.snapshot] aggregates bounded runtime sources without paths or persistent writes", async () => {
    const close = vi.fn(async () => undefined)
    const service = new ReaderDiagnosticsService({
      activeSessions: () => 2,
      assets: () => ({
        activeTransformFlights: 1,
        presentation: { entries: 3, bytes: 30, maxBytes: 100, maxEntryBytes: 50, hits: 4, misses: 2, evictions: 1 },
        thumbnails: { demands: 2, activeFlights: 1, queuedFlights: 0, runningFlights: 1, cachedEntries: 4, cachedBytes: 40 },
      }),
      presentationDiskCache: async () => ({ enabled: false }),
      solidArchiveCache: () => ({ entries: 1, retainedBytes: 80, maxBytes: 200 }),
      scheduler: () => ({
        cpu: pool(1, 2), io: pool(0, 1), gpu: pool(0, 0),
      }),
      now: () => 123,
      uptime: () => 4.5,
      memoryUsage: () => ({ rss: 100, heapTotal: 90, heapUsed: 50, external: 20, arrayBuffers: 10 }),
      cpuUsage: () => ({ user: 11, system: 12 }),
      availableMemory: () => 1_000,
      constrainedMemory: () => 2_000,
      close,
    })

    await expect(service.snapshot()).resolves.toEqual(expect.objectContaining({
      schemaVersion: 1,
      sampledAtMs: 123,
      uptimeSeconds: 4.5,
      process: expect.objectContaining({ rssBytes: 100, heapUsedBytes: 50, availableMemoryBytes: 1_000, cpuUserMicros: 11 }),
      reader: { activeSessions: 2 },
      assets: expect.objectContaining({ activeTransformFlights: 1, presentation: expect.objectContaining({ bytes: 30 }) }),
      solidArchiveCache: { entries: 1, retainedBytes: 80, maxBytes: 200 },
      scheduler: expect.objectContaining({ cpu: expect.objectContaining({ active: 1, queued: 2 }) }),
    }))
    await service.close()
    await service.close()
    expect(close).toHaveBeenCalledOnce()
    await expect(service.snapshot()).rejects.toThrow("closed")
  })
})

function pool(active: number, queued: number) {
  return {
    active,
    queued,
    queuedByPriority: { interactive: queued, view: 0, ahead: 0, background: 0 },
  }
}
