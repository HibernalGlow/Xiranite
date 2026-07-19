import type {
  ReaderDiagnosticsHistory,
  ReaderDiagnosticsSnapshot,
} from "./ReaderDiagnosticsService.js"

export type ReaderDiagnosticsHistoryExportFormat = "json" | "csv"

export interface ReaderDiagnosticsHistoryExport {
  readonly format: ReaderDiagnosticsHistoryExportFormat
  readonly contentType: string
  readonly filename: string
  readonly body: string
}

const CSV_COLUMNS = [
  "historyDroppedSamples",
  "schemaVersion",
  "sampledAtMs",
  "uptimeSeconds",
  "activeSessions",
  "rssBytes",
  "heapTotalBytes",
  "heapUsedBytes",
  "externalBytes",
  "arrayBuffersBytes",
  "availableMemoryBytes",
  "constrainedMemoryBytes",
  "cpuUserMicros",
  "cpuSystemMicros",
  "readerPreloadJson",
  "readerRuntimeResourcesJson",
  "readerBrowserMemoryJson",
  "activeTransformFlights",
  "presentationBytes",
  "thumbnailBytes",
  "assetsPresentationJson",
  "assetsThumbnailsJson",
  "assetsPresentationRetentionJson",
  "assetsMemoryPressureJson",
  "cacheMemoryBytes",
  "cacheDiskBytes",
  "cacheLeasesTotal",
  "cacheMemoryJson",
  "cacheDiskJson",
  "cacheLeasesJson",
  "presentationDiskCacheJson",
  "solidArchiveCacheJson",
  "videoProcessJson",
  "schedulerJson",
  "sharedSchedulerJson",
  "preloadActive",
  "preloadStarted",
  "preloadReady",
  "preloadFailed",
  "preloadCancelled",
  "preloadTtfbSamples",
  "preloadTotalTtfbMs",
  "preloadDecodeSamples",
  "preloadTotalDecodeMs",
  "schedulerCpuActive",
  "schedulerCpuQueued",
  "schedulerCpuOldestQueuedWaitMs",
  "schedulerIoActive",
  "schedulerIoQueued",
  "schedulerIoOldestQueuedWaitMs",
  "schedulerGpuActive",
  "schedulerGpuQueued",
  "schedulerGpuOldestQueuedWaitMs",
] as const

export function exportReaderDiagnosticsHistory(
  history: ReaderDiagnosticsHistory,
  format: ReaderDiagnosticsHistoryExportFormat,
): ReaderDiagnosticsHistoryExport {
  if (format === "json") {
    return {
      format,
      contentType: "application/json; charset=utf-8",
      filename: "neoview-diagnostics-history.json",
      body: `${JSON.stringify(history)}\n`,
    }
  }
  return {
    format,
    contentType: "text/csv; charset=utf-8",
    filename: "neoview-diagnostics-history.csv",
    body: `${CSV_COLUMNS.join(",")}\n${history.samples.map((snapshot) => csvRow(snapshot, history.droppedSamples)).join("\n")}${history.samples.length ? "\n" : ""}`,
  }
}

function csvRow(snapshot: ReaderDiagnosticsSnapshot, droppedSamples: number): string {
  const preload = snapshot.reader.preload
  const performance = preload?.performance
  const scheduler = snapshot.scheduler
  const values: readonly unknown[] = [
    droppedSamples,
    snapshot.schemaVersion,
    snapshot.sampledAtMs,
    snapshot.uptimeSeconds,
    snapshot.reader.activeSessions,
    snapshot.process.rssBytes,
    snapshot.process.heapTotalBytes,
    snapshot.process.heapUsedBytes,
    snapshot.process.externalBytes,
    snapshot.process.arrayBuffersBytes,
    snapshot.process.availableMemoryBytes,
    snapshot.process.constrainedMemoryBytes,
    snapshot.process.cpuUserMicros,
    snapshot.process.cpuSystemMicros,
    jsonCell(preload),
    jsonCell(snapshot.reader.runtimeResources),
    jsonCell(snapshot.reader.browserMemory),
    snapshot.assets.activeTransformFlights,
    snapshot.assets.presentation?.bytes,
    snapshot.assets.thumbnails?.cachedBytes,
    jsonCell(snapshot.assets.presentation),
    jsonCell(snapshot.assets.thumbnails),
    jsonCell(snapshot.assets.presentationRetention),
    jsonCell(snapshot.assets.memoryPressure),
    snapshot.cache?.memory.totalBytes,
    snapshot.cache?.disk.totalBytes,
    snapshot.cache?.leases.total,
    jsonCell(snapshot.cache?.memory),
    jsonCell(snapshot.cache?.disk),
    jsonCell(snapshot.cache?.leases),
    jsonCell(snapshot.presentationDiskCache),
    jsonCell(snapshot.solidArchiveCache),
    jsonCell(snapshot.videoProcess),
    jsonCell(snapshot.scheduler),
    jsonCell(snapshot.sharedScheduler),
    preload?.active,
    preload?.started,
    preload?.ready,
    preload?.failed,
    preload?.cancelled,
    performance?.ttfbSamples,
    performance?.totalTtfbMs,
    performance?.decodeSamples,
    performance?.totalDecodeMs,
    scheduler?.cpu?.active,
    scheduler?.cpu?.queued,
    scheduler?.cpu?.oldestQueuedWaitMs,
    scheduler?.io?.active,
    scheduler?.io?.queued,
    scheduler?.io?.oldestQueuedWaitMs,
    scheduler?.gpu?.active,
    scheduler?.gpu?.queued,
    scheduler?.gpu?.oldestQueuedWaitMs,
  ]
  return values.map(csvCell).join(",")
}

function jsonCell(value: unknown): string | undefined {
  return value === undefined ? undefined : JSON.stringify(value)
}

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return ""
  const text = String(value)
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text
}
