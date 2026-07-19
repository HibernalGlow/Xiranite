import { describe, expect, it } from "vitest"

import type {
  ReaderDiagnosticsHistory,
  ReaderDiagnosticsSnapshot,
} from "./ReaderDiagnosticsService.js"
import { exportReaderDiagnosticsHistory } from "./ReaderDiagnosticsHistoryExport.js"

describe("exportReaderDiagnosticsHistory", () => {
  it("[neoview.diagnostics.history-export-csv-complete] keeps dropped counts and nested diagnostics in CSV", () => {
    const snapshot = {
      schemaVersion: 1,
      sampledAtMs: 123,
      uptimeSeconds: 4.5,
      process: {
        rssBytes: 100,
        heapTotalBytes: 90,
        heapUsedBytes: 50,
        externalBytes: 20,
        arrayBuffersBytes: 10,
        availableMemoryBytes: 1_000,
        constrainedMemoryBytes: 2_000,
        cpuUserMicros: 11,
        cpuSystemMicros: 12,
      },
      reader: {
        activeSessions: 2,
        runtimeResources: { archiveProviders: 1 },
        browserMemory: { listingEntries: 3 },
        preload: { active: 1, started: 2, ready: 1, failed: 0, cancelled: 0, performance: { ttfbSamples: 1, totalTtfbMs: 5, decodeSamples: 1, totalDecodeMs: 6 } },
      },
      assets: {
        activeTransformFlights: 3,
        presentation: { entries: 1, bytes: 2 },
        thumbnails: { demands: 1, activeFlights: 1, queuedFlights: 0, runningFlights: 1, cachedEntries: 1, cachedBytes: 4, telemetry: { cacheHits: 1 } },
        presentationRetention: { sessions: 1, desiredPages: 2, retainedPresentations: 1 },
        memoryPressure: { level: "normal", availableBytes: 100 },
      },
      cache: {
        memory: { presentationBytes: 2, thumbnailBytes: 4, totalBytes: 6 },
        disk: { presentationBytes: 7, solidArchiveBytes: 8, totalBytes: 15 },
        leases: { presentationMemory: 1, presentationDisk: 2, solidArchive: 3, thumbnailDemands: 4, total: 10 },
      },
      presentationDiskCache: { enabled: false },
      solidArchiveCache: { entries: 0, retainedBytes: 8, maxBytes: 20, activeEntries: 0, activeLeases: 0 },
      videoProcess: { active: 1, queued: 2, maxConcurrent: 3 },
      scheduler: { cpu: { active: 1, queued: 2 } },
      sharedScheduler: { topology: "shared-queue", active: 1, queued: 2, queuedByPriority: {} },
    } as unknown as ReaderDiagnosticsSnapshot
    const history: ReaderDiagnosticsHistory = { schemaVersion: 1, samples: [snapshot], droppedSamples: 7 }

    const body = exportReaderDiagnosticsHistory(history, "csv").body
    const [header, row] = body.trimEnd().split("\n")
    expect(header).toContain("historyDroppedSamples")
    expect(header).toContain("heapTotalBytes")
    expect(header).toContain("readerPreloadJson")
    expect(header).toContain("thumbnailBytes")
    expect(header).toContain("schedulerJson")
    expect(row).toContain("7")
    expect(row).toContain("90")
    expect(row).toContain("archiveProviders")
    expect(row).toContain("maxConcurrent")
  })

  it("[neoview.diagnostics.history-export-csv-empty] emits a stable header for empty history", () => {
    const body = exportReaderDiagnosticsHistory({ schemaVersion: 1, samples: [], droppedSamples: 2 }, "csv").body
    expect(body.endsWith("\n")).toBe(true)
    expect(body.split("\n")).toHaveLength(2)
    expect(body).toContain("historyDroppedSamples")
  })
})
