import type { ReaderCacheStatus } from "../cache/ReaderCacheService.js"
import type { ReaderPresentationCacheSnapshot } from "../../ports/ReaderPresentationCache.js"
import type { ResourceClass, ResourcePriority } from "../../ports/ResourceScheduler.js"
import type { ReaderMemoryPressureSnapshot } from "../../platform/memory/ReaderMemoryPressureMonitor.js"
import type { ReaderPreloadDiagnostics } from "../preloading/PreloadTelemetry.js"
import type { ReaderRuntimeResourceSnapshot } from "../../domain/book/book.js"
import type { ReaderFileTreeMemorySnapshot } from "../browser/ReaderFileTreeService.js"
import type { SolidArchiveCacheSnapshot } from "../../platform/archives/sevenzip/SolidArchiveCache.js"

export interface ReaderSchedulerPoolDiagnostics {
  active: number
  queued: number
  queuedByPriority: Readonly<Record<ResourcePriority, number>>
  granted?: number
  released?: number
  cancelled?: number
  queueWaitSamples?: number
  totalQueueWaitMs?: number
  maxQueueWaitMs?: number
  oldestQueuedWaitMs?: number
}

export interface ReaderAssetDiagnostics {
  activeTransformFlights: number
  presentationRetention?: {
    sessions: number
    desiredPages: number
    retainedPresentations: number
  }
  memoryPressure?: ReaderMemoryPressureSnapshot
  presentation: ReaderPresentationCacheSnapshot | null
  thumbnails: {
    demands: number
    activeFlights: number
    queuedFlights: number
    runningFlights: number
    cachedEntries: number
    cachedBytes: number
  } | null
}

export interface ReaderDiagnosticsSnapshot {
  schemaVersion: 1
  sampledAtMs: number
  uptimeSeconds: number
  process: {
    rssBytes: number
    heapTotalBytes: number
    heapUsedBytes: number
    externalBytes: number
    arrayBuffersBytes: number
    availableMemoryBytes?: number
    constrainedMemoryBytes?: number
    cpuUserMicros: number
    cpuSystemMicros: number
  }
  reader: {
    activeSessions: number
    preload?: ReaderPreloadDiagnostics
    runtimeResources?: ReaderRuntimeResourceSnapshot
    browserMemory?: ReaderFileTreeMemorySnapshot
  }
  assets: ReaderAssetDiagnostics
  cache?: ReaderUnifiedCacheDiagnostics
  presentationDiskCache: ReaderCacheStatus
  solidArchiveCache: SolidArchiveCacheSnapshot
  scheduler: Readonly<Record<ResourceClass, ReaderSchedulerPoolDiagnostics>> | null
}

export interface ReaderUnifiedCacheDiagnostics {
  memory: {
    presentationBytes: number
    thumbnailBytes: number
    totalBytes: number
  }
  disk: {
    presentationBytes: number
    solidArchiveBytes: number
    totalBytes: number
  }
  leases: {
    presentationMemory: number
    presentationDisk: number
    solidArchive: number
    thumbnailDemands: number
    total: number
  }
}

export interface ReaderDiagnosticsSources {
  activeSessions(): number
  preload?(): ReaderPreloadDiagnostics
  runtimeResources?(): ReaderRuntimeResourceSnapshot
  browserMemory?(): ReaderFileTreeMemorySnapshot
  assets(): ReaderAssetDiagnostics
  presentationDiskCache(): Promise<ReaderCacheStatus>
  solidArchiveCache(): SolidArchiveCacheSnapshot
  scheduler?(): Readonly<Record<ResourceClass, ReaderSchedulerPoolDiagnostics>>
  close?(): void | Promise<void>
  now?(): number
  uptime?(): number
  memoryUsage?(): NodeJS.MemoryUsage
  cpuUsage?(): NodeJS.CpuUsage
  availableMemory?(): number
  constrainedMemory?(): number
}

export class ReaderDiagnosticsService implements AsyncDisposable {
  #closed = false

  constructor(private readonly sources: ReaderDiagnosticsSources) {}

  async snapshot(): Promise<ReaderDiagnosticsSnapshot> {
    if (this.#closed) throw new Error("Reader diagnostics service is closed.")
    const memory = (this.sources.memoryUsage ?? process.memoryUsage)()
    const cpu = (this.sources.cpuUsage ?? process.cpuUsage)()
    const assets = this.sources.assets()
    const presentationDiskCache = await this.sources.presentationDiskCache()
    const solidArchiveCache = this.sources.solidArchiveCache()
    return {
      schemaVersion: 1,
      sampledAtMs: (this.sources.now ?? Date.now)(),
      uptimeSeconds: (this.sources.uptime ?? process.uptime)(),
      process: {
        rssBytes: memory.rss,
        heapTotalBytes: memory.heapTotal,
        heapUsedBytes: memory.heapUsed,
        externalBytes: memory.external,
        arrayBuffersBytes: memory.arrayBuffers,
        availableMemoryBytes: optionalMemory(this.sources.availableMemory ?? process.availableMemory),
        constrainedMemoryBytes: optionalMemory(this.sources.constrainedMemory ?? process.constrainedMemory),
        cpuUserMicros: cpu.user,
        cpuSystemMicros: cpu.system,
      },
      reader: {
        activeSessions: this.sources.activeSessions(),
        preload: this.sources.preload?.(),
        runtimeResources: this.sources.runtimeResources?.(),
        browserMemory: this.sources.browserMemory?.(),
      },
      assets,
      cache: unifiedCacheDiagnostics(assets, presentationDiskCache, solidArchiveCache),
      presentationDiskCache,
      solidArchiveCache,
      scheduler: this.sources.scheduler?.() ?? null,
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    await this.sources.close?.()
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close()
  }
}

function unifiedCacheDiagnostics(
  assets: ReaderAssetDiagnostics,
  presentationDiskCache: ReaderCacheStatus,
  solidArchiveCache: SolidArchiveCacheSnapshot,
): ReaderUnifiedCacheDiagnostics {
  const presentationBytes = assets.presentation?.bytes ?? 0
  const thumbnailBytes = assets.thumbnails?.cachedBytes ?? 0
  const diskPresentationBytes = presentationDiskCache.enabled ? presentationDiskCache.bytes : 0
  const presentationMemory = assets.presentation?.activeLeases ?? 0
  const presentationDisk = presentationDiskCache.enabled ? presentationDiskCache.activeLeases : 0
  const thumbnailDemands = assets.thumbnails?.demands ?? 0
  return {
    memory: {
      presentationBytes,
      thumbnailBytes,
      totalBytes: presentationBytes + thumbnailBytes,
    },
    disk: {
      presentationBytes: diskPresentationBytes,
      solidArchiveBytes: solidArchiveCache.retainedBytes,
      totalBytes: diskPresentationBytes + solidArchiveCache.retainedBytes,
    },
    leases: {
      presentationMemory,
      presentationDisk,
      solidArchive: solidArchiveCache.activeLeases,
      thumbnailDemands,
      total: presentationMemory + presentationDisk + solidArchiveCache.activeLeases + thumbnailDemands,
    },
  }
}

function optionalMemory(read: (() => number) | undefined): number | undefined {
  if (!read) return undefined
  const value = read()
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
}
