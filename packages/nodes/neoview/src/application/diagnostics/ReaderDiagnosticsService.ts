import type { ReaderCacheStatus } from "../cache/ReaderCacheService.js"
import type { ReaderPresentationCacheSnapshot } from "../../ports/ReaderPresentationCache.js"
import type { ResourceClass, ResourcePriority } from "../../ports/ResourceScheduler.js"
import type { ReaderMemoryPressureSnapshot } from "../../platform/memory/ReaderMemoryPressureMonitor.js"
import type { ReaderPreloadDiagnostics } from "../preloading/PreloadTelemetry.js"

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
}

export interface ReaderAssetDiagnostics {
  activeTransformFlights: number
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
  reader: { activeSessions: number; preload?: ReaderPreloadDiagnostics }
  assets: ReaderAssetDiagnostics
  presentationDiskCache: ReaderCacheStatus
  solidArchiveCache: { entries: number; retainedBytes: number; maxBytes: number }
  scheduler: Readonly<Record<ResourceClass, ReaderSchedulerPoolDiagnostics>> | null
}

export interface ReaderDiagnosticsSources {
  activeSessions(): number
  preload?(): ReaderPreloadDiagnostics
  assets(): ReaderAssetDiagnostics
  presentationDiskCache(): Promise<ReaderCacheStatus>
  solidArchiveCache(): { entries: number; retainedBytes: number; maxBytes: number }
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
      reader: { activeSessions: this.sources.activeSessions(), preload: this.sources.preload?.() },
      assets: this.sources.assets(),
      presentationDiskCache: await this.sources.presentationDiskCache(),
      solidArchiveCache: this.sources.solidArchiveCache(),
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

function optionalMemory(read: (() => number) | undefined): number | undefined {
  if (!read) return undefined
  const value = read()
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
}
