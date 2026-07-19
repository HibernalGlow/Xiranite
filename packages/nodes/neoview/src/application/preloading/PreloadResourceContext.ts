import type { ResourceClass } from "../../ports/ResourceScheduler.js"
import type { ReaderPreloadContext } from "./PreloadCoordinator.js"

export interface ReaderPreloadResourceSources {
  scheduler?: Partial<Record<ResourceClass, { oldestQueuedWaitMs?: number }>> | null
  sharedScheduler?: { oldestQueuedWaitMs?: number } | null
  memoryPressure?: { level?: string } | null
}

export function deriveReaderPreloadResourceContext(
  sources: ReaderPreloadResourceSources,
): Pick<ReaderPreloadContext, "queueWaitMs" | "memoryPressure"> {
  let queueWaitMs = 0
  for (const pool of Object.values(sources.scheduler ?? {})) {
    const value = pool?.oldestQueuedWaitMs
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) queueWaitMs = Math.max(queueWaitMs, value)
  }
  const sharedWait = sources.sharedScheduler?.oldestQueuedWaitMs
  if (typeof sharedWait === "number" && Number.isFinite(sharedWait) && sharedWait >= 0) {
    queueWaitMs = Math.max(queueWaitMs, sharedWait)
  }
  const level = sources.memoryPressure?.level
  const memoryPressure = level === "elevated" || level === "critical" ? level : "normal"
  return { queueWaitMs: Math.min(queueWaitMs, 60_000), memoryPressure }
}
