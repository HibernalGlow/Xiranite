import { describe, expect, it, vi } from "vitest"

import { ReaderDiagnosticsService } from "./ReaderDiagnosticsService.js"
import { parseReaderDiagnosticsHistory, parseReaderDiagnosticsSnapshot } from "./ReaderDiagnosticsWireSchema.js"

describe("ReaderDiagnosticsService", () => {
  it("[neoview.diagnostics.snapshot] aggregates bounded runtime sources without paths or persistent writes", async () => {
    const close = vi.fn(async () => undefined)
    const service = new ReaderDiagnosticsService({
      activeSessions: () => 2,
      runtimeResources: () => ({ archiveProviders: 1, archiveIndexEntries: 8, archiveIndexPayloadBytes: 512, archiveActiveExtractions: 2 }),
      browserMemory: () => ({
        sessions: 1,
        listingEntries: 0,
        listingPayloadBytes: 24,
        releasedListings: 1,
        navigationPaths: 2,
        navigationPayloadBytes: 32,
        randomSeeds: 0,
        randomSeedPayloadBytes: 0,
      }),
      assets: () => ({
        activeTransformFlights: 1,
        presentation: { entries: 3, bytes: 30, activeLeases: 2, maxBytes: 100, maxEntryBytes: 50, hits: 4, misses: 2, evictions: 1 },
        thumbnails: {
          demands: 2, activeFlights: 1, queuedFlights: 0, runningFlights: 1, cachedEntries: 4, cachedBytes: 40,
          telemetry: {
            cacheHits: 3, cacheMisses: 4, completed: 2, failed: 1, cancelled: 1, evictions: 2,
            byLane: { "reader-visible": { demands: 7, cacheHits: 3, cacheMisses: 4, completed: 2, failed: 1, cancelled: 1 } },
          },
        },
      }),
      presentationDiskCache: async () => ({
        enabled: true, entries: 5, bytes: 70, maxBytes: 500, maxEntryBytes: 100, activeLeases: 3,
        hits: 1, misses: 2, writes: 3, rejectedWrites: 0, evictions: 0, integrityFailures: 0,
      }),
      solidArchiveCache: () => ({
        entries: 1,
        retainedBytes: 80,
        maxBytes: 200,
        activeEntries: 1,
        activeLeases: 4,
        indexCache: { entries: 2, maxEntries: 32, payloadBytes: 512, maxPayloadBytes: 768, hits: 3, misses: 2, evictions: 1 },
      }),
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

    const snapshot = await service.snapshot()
    expect(snapshot).toEqual(expect.objectContaining({
      schemaVersion: 1,
      sampledAtMs: 123,
      uptimeSeconds: 4.5,
      process: expect.objectContaining({ rssBytes: 100, heapUsedBytes: 50, availableMemoryBytes: 1_000, cpuUserMicros: 11 }),
      reader: {
        activeSessions: 2,
        runtimeResources: { archiveProviders: 1, archiveIndexEntries: 8, archiveIndexPayloadBytes: 512, archiveActiveExtractions: 2 },
        browserMemory: expect.objectContaining({ listingEntries: 0, releasedListings: 1 }),
      },
      assets: expect.objectContaining({ activeTransformFlights: 1, presentation: expect.objectContaining({ bytes: 30 }) }),
      cache: {
        memory: { presentationBytes: 30, thumbnailBytes: 40, totalBytes: 70 },
        disk: { presentationBytes: 70, solidArchiveBytes: 80, totalBytes: 150 },
        leases: { presentationMemory: 2, presentationDisk: 3, solidArchive: 4, thumbnailDemands: 2, total: 11 },
      },
      solidArchiveCache: {
        entries: 1,
        retainedBytes: 80,
        maxBytes: 200,
        activeEntries: 1,
        activeLeases: 4,
        indexCache: { entries: 2, maxEntries: 32, payloadBytes: 512, maxPayloadBytes: 768, hits: 3, misses: 2, evictions: 1 },
      },
      scheduler: expect.objectContaining({ cpu: expect.objectContaining({ active: 1, queued: 2 }) }),
    }))
    expect(snapshot.assets.thumbnails?.telemetry).toMatchObject({ cacheHits: 3, cacheMisses: 4, completed: 2, failed: 1, cancelled: 1, evictions: 2 })
    expect(parseReaderDiagnosticsSnapshot(snapshot)).toEqual(snapshot)
    const sampled = await service.sample()
    expect(service.history({ limit: 1 })).toMatchObject({ schemaVersion: 1, samples: [sampled], droppedSamples: 0 })
    expect(parseReaderDiagnosticsHistory(service.history())).toEqual(service.history())
    expect(service.resetHistory()).toBe(1)
    expect(service.history().samples).toHaveLength(0)
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
