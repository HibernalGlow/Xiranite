import { z } from "zod"

import type { ReaderDiagnosticsHistory, ReaderDiagnosticsSnapshot } from "./ReaderDiagnosticsService.js"

const count = z.number().finite().int().nonnegative()
const measurement = z.number().finite().nonnegative()
const loose = <T extends z.ZodRawShape>(shape: T) => z.object(shape).passthrough()

const schedulerPool = loose({
  active: count,
  queued: count,
  queuedByPriority: z.record(z.string(), count),
  granted: count.optional(),
  released: count.optional(),
  cancelled: count.optional(),
  queueWaitSamples: count.optional(),
  totalQueueWaitMs: measurement.optional(),
  maxQueueWaitMs: measurement.optional(),
  oldestQueuedWaitMs: measurement.optional(),
})

const preloadPerformance = loose({
  ttfbSamples: count,
  totalTtfbMs: measurement,
  maxTtfbMs: measurement,
  decodeSamples: count,
  totalDecodeMs: measurement,
  maxDecodeMs: measurement,
  retainedByteSamples: count,
  totalRetainedBytes: count,
  maxRetainedBytes: count,
  leaseSamples: count,
  totalActiveLeases: count,
  maxActiveLeases: count,
})

const preload = loose({
  sessions: count,
  candidates: loose({ near: count, ahead: count, background: count }),
  active: count,
  plannedCandidates: count,
  started: count,
  ready: count,
  failed: count,
  cancelled: count,
  evicted: count,
  staleReports: count,
  rejectedReports: count,
  duplicateReports: count,
  performance: preloadPerformance.optional(),
})

const presentation = loose({
  entries: count,
  bytes: count,
  pinnedEntries: count.optional(),
  pinnedBytes: count.optional(),
  activeLeases: count.optional(),
  maxBytes: count,
  maxEntryBytes: count,
  hits: count,
  misses: count,
  evictions: count,
})

const thumbnails = loose({
  demands: count,
  activeFlights: count,
  queuedFlights: count,
  runningFlights: count,
  cachedEntries: count,
  cachedBytes: count,
  telemetry: loose({
    cacheHits: count,
    cacheMisses: count,
    completed: count,
    failed: count,
    cancelled: count,
    evictions: count,
    byLane: z.record(z.string(), loose({
      demands: count,
      cacheHits: count,
      cacheMisses: count,
      completed: count,
      failed: count,
      cancelled: count,
    })),
  }).optional(),
})

const memoryPressure = loose({
  level: z.enum(["normal", "elevated", "critical"]),
  availableBytes: count.optional(),
  samples: count,
  elevatedReliefs: count,
  criticalReliefs: count,
  admissionRejections: count,
  lastReliefAtMs: measurement.optional(),
})

const assets = loose({
  activeTransformFlights: count,
  presentationRetention: loose({
    sessions: count,
    desiredPages: count,
    retainedPresentations: count,
  }).optional(),
  memoryPressure: memoryPressure.optional(),
  presentation: presentation.nullable(),
  thumbnails: thumbnails.nullable(),
})

const presentationDiskCache = z.discriminatedUnion("enabled", [
  loose({ enabled: z.literal(false) }),
  loose({
    enabled: z.literal(true),
    entries: count,
    bytes: count,
    maxBytes: count,
    maxEntryBytes: count,
    activeLeases: count,
    hits: count,
    misses: count,
    writes: count,
    rejectedWrites: count,
    evictions: count,
    integrityFailures: count,
  }),
])

const unifiedCache = loose({
  memory: loose({ presentationBytes: count, thumbnailBytes: count, totalBytes: count }),
  disk: loose({ presentationBytes: count, solidArchiveBytes: count, totalBytes: count }),
  leases: loose({
    presentationMemory: count,
    presentationDisk: count,
    solidArchive: count,
    thumbnailDemands: count,
    total: count,
  }),
})

export const ReaderDiagnosticsWireSchema = loose({
  schemaVersion: z.literal(1),
  sampledAtMs: measurement,
  uptimeSeconds: measurement,
  process: loose({
    rssBytes: count,
    heapTotalBytes: count,
    heapUsedBytes: count,
    externalBytes: count,
    arrayBuffersBytes: count,
    availableMemoryBytes: count.optional(),
    constrainedMemoryBytes: count.optional(),
    cpuUserMicros: count,
    cpuSystemMicros: count,
  }),
  reader: loose({
    activeSessions: count,
    preload: preload.optional(),
    runtimeResources: loose({
      archiveProviders: count,
      archiveIndexEntries: count,
      archiveIndexPayloadBytes: count,
      archiveActiveExtractions: count,
    }).optional(),
    browserMemory: loose({
      sessions: count,
      listingEntries: count,
      listingPayloadBytes: count,
      releasedListings: count.optional(),
      navigationPaths: count,
      navigationPayloadBytes: count,
      randomSeeds: count,
      randomSeedPayloadBytes: count,
    }).optional(),
  }),
  assets,
  cache: unifiedCache.optional(),
  presentationDiskCache,
  solidArchiveCache: loose({
    entries: count,
    retainedBytes: count,
    maxBytes: count,
    activeEntries: count.optional(),
    activeLeases: count.optional(),
    memoryBytes: count.optional(),
    maxMemoryBytes: count.optional(),
    maxMemoryEntryBytes: count.optional(),
    indexCache: loose({
      entries: count,
      maxEntries: count,
      payloadBytes: count,
      maxPayloadBytes: count,
      hits: count,
      misses: count,
      evictions: count,
    }).optional(),
  }),
  scheduler: loose({ cpu: schedulerPool, io: schedulerPool, gpu: schedulerPool }).nullable(),
})

export const ReaderDiagnosticsHistoryWireSchema = loose({
  schemaVersion: z.literal(1),
  samples: z.array(ReaderDiagnosticsWireSchema).max(1_000),
  droppedSamples: count,
})

export function parseReaderDiagnosticsSnapshot(value: unknown): ReaderDiagnosticsSnapshot {
  const parsed = ReaderDiagnosticsWireSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error("Xiranite Reader returned an invalid diagnostics response.", { cause: parsed.error })
  }
  return parsed.data as ReaderDiagnosticsSnapshot
}

export function parseReaderDiagnosticsHistory(value: unknown): ReaderDiagnosticsHistory {
  const parsed = ReaderDiagnosticsHistoryWireSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error("Xiranite Reader returned an invalid diagnostics history response.", { cause: parsed.error })
  }
  return parsed.data as ReaderDiagnosticsHistory
}
