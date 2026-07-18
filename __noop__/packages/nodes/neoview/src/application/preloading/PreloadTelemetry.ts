import type { ReaderPreloadPlan, ReaderPreloadTier } from "./PreloadCoordinator.js"

export type ReaderPreloadOutcome = "started" | "ready" | "failed" | "cancelled" | "evicted"

export interface ReaderPreloadPerformanceMetrics {
  ttfbMs?: number
  decodeMs?: number
  retainedBytes?: number
  activeLeases?: number
}

export interface ReaderPreloadReport {
  generation: number
  pageId: string
  outcome: ReaderPreloadOutcome
  metrics?: ReaderPreloadPerformanceMetrics
}

export interface ReaderPreloadPerformanceDiagnostics {
  ttfbSamples: number
  totalTtfbMs: number
  maxTtfbMs: number
  decodeSamples: number
  totalDecodeMs: number
  maxDecodeMs: number
  retainedByteSamples: number
  totalRetainedBytes: number
  maxRetainedBytes: number
  leaseSamples: number
  totalActiveLeases: number
  maxActiveLeases: number
}

export interface ReaderPreloadTelemetrySnapshot {
  generation?: number
  direction?: ReaderPreloadPlan["direction"]
  directionConfidence?: number
  candidates: Readonly<Record<ReaderPreloadTier, number>>
  active: number
  plannedCandidates: number
  started: number
  ready: number
  failed: number
  cancelled: number
  evicted: number
  staleReports: number
  rejectedReports: number
  duplicateReports: number
  performance: ReaderPreloadPerformanceDiagnostics
  outcomes: readonly { pageId: string; outcome: ReaderPreloadOutcome }[]
}

export interface ReaderPreloadDiagnostics {
  sessions: number
  candidates: Readonly<Record<ReaderPreloadTier, number>>
  active: number
  plannedCandidates: number
  started: number
  ready: number
  failed: number
  cancelled: number
  evicted: number
  staleReports: number
  rejectedReports: number
  duplicateReports: number
  performance: ReaderPreloadPerformanceDiagnostics
}

export interface ReaderPreloadReportResult {
  accepted: boolean
  reason?: "stale-generation" | "unknown-page" | "duplicate" | "invalid-metrics"
}

export class ReaderPreloadTelemetry {
  #plan?: ReaderPreloadPlan
  #candidateIds = new Set<string>()
  #states = new Map<string, ReaderPreloadOutcome>()
  #plannedCandidates = 0
  #started = 0
  #ready = 0
  #failed = 0
  #cancelled = 0
  #evicted = 0
  #staleReports = 0
  #rejectedReports = 0
  #duplicateReports = 0
  readonly #performance = emptyPerformanceDiagnostics()

  updatePlan(plan: ReaderPreloadPlan): void {
    if (this.#plan?.generation === plan.generation) return
    this.#cancelActive()
    this.#plan = plan
    this.#candidateIds = new Set(plan.candidates.flatMap((candidate) => candidate.pageIds))
    this.#states.clear()
    this.#plannedCandidates += this.#candidateIds.size
  }

  report(report: ReaderPreloadReport): ReaderPreloadReportResult {
    if (!this.#plan || report.generation !== this.#plan.generation) {
      this.#staleReports += 1
      return { accepted: false, reason: "stale-generation" }
    }
    if (!this.#candidateIds.has(report.pageId)) {
      this.#rejectedReports += 1
      return { accepted: false, reason: "unknown-page" }
    }
    if (!validPerformanceMetrics(report.metrics)) {
      this.#rejectedReports += 1
      return { accepted: false, reason: "invalid-metrics" }
    }
    const previous = this.#states.get(report.pageId)
    if (previous === report.outcome || (previous !== undefined && isTerminal(previous) && report.outcome !== "evicted")) {
      this.#duplicateReports += 1
      return { accepted: false, reason: "duplicate" }
    }
    if (report.outcome === "started") {
      if (previous !== undefined) {
        this.#duplicateReports += 1
        return { accepted: false, reason: "duplicate" }
      }
      this.#started += 1
    } else {
      if (report.outcome === "ready") this.#ready += 1
      else if (report.outcome === "failed") this.#failed += 1
      else if (report.outcome === "cancelled") this.#cancelled += 1
      else this.#evicted += 1
    }
    this.#states.set(report.pageId, report.outcome)
    recordPerformanceMetrics(this.#performance, report.metrics)
    return { accepted: true }
  }

  close(): void {
    this.#cancelActive()
    this.#states.clear()
    this.#candidateIds.clear()
    this.#plan = undefined
  }

  snapshot(): ReaderPreloadTelemetrySnapshot {
    const candidates = { near: 0, ahead: 0, background: 0 }
    for (const candidate of this.#plan?.candidates ?? []) candidates[candidate.tier] += candidate.pageIds.length
    return {
      generation: this.#plan?.generation,
      direction: this.#plan?.direction,
      directionConfidence: this.#plan?.directionConfidence,
      candidates,
      active: [...this.#states.values()].filter((state) => state === "started").length,
      plannedCandidates: this.#plannedCandidates,
      started: this.#started,
      ready: this.#ready,
      failed: this.#failed,
      cancelled: this.#cancelled,
      evicted: this.#evicted,
      staleReports: this.#staleReports,
      rejectedReports: this.#rejectedReports,
      duplicateReports: this.#duplicateReports,
      performance: { ...this.#performance },
      outcomes: [...this.#states].map(([pageId, outcome]) => ({ pageId, outcome })),
    }
  }

  #cancelActive(): void {
    for (const state of this.#states.values()) if (state === "started") this.#cancelled += 1
  }
}

export function aggregateReaderPreloadTelemetry(snapshots: readonly ReaderPreloadTelemetrySnapshot[]): ReaderPreloadDiagnostics {
  const output: ReaderPreloadDiagnostics = {
    sessions: snapshots.length,
    candidates: { near: 0, ahead: 0, background: 0 },
    active: 0,
    plannedCandidates: 0,
    started: 0,
    ready: 0,
    failed: 0,
    cancelled: 0,
    evicted: 0,
    staleReports: 0,
    rejectedReports: 0,
    duplicateReports: 0,
    performance: emptyPerformanceDiagnostics(),
  }
  const candidates = output.candidates as Record<ReaderPreloadTier, number>
  for (const snapshot of snapshots) {
    candidates.near += snapshot.candidates.near
    candidates.ahead += snapshot.candidates.ahead
    candidates.background += snapshot.candidates.background
    for (const key of ["active", "plannedCandidates", "started", "ready", "failed", "cancelled", "evicted", "staleReports", "rejectedReports", "duplicateReports"] as const) {
      output[key] += snapshot[key]
    }
    for (const key of ["ttfbSamples", "totalTtfbMs", "decodeSamples", "totalDecodeMs", "retainedByteSamples", "totalRetainedBytes", "leaseSamples", "totalActiveLeases"] as const) {
      output.performance[key] += snapshot.performance[key]
    }
    output.performance.maxTtfbMs = Math.max(output.performance.maxTtfbMs, snapshot.performance.maxTtfbMs)
    output.performance.maxDecodeMs = Math.max(output.performance.maxDecodeMs, snapshot.performance.maxDecodeMs)
    output.performance.maxRetainedBytes = Math.max(output.performance.maxRetainedBytes, snapshot.performance.maxRetainedBytes)
    output.performance.maxActiveLeases = Math.max(output.performance.maxActiveLeases, snapshot.performance.maxActiveLeases)
  }
  return output
}

function emptyPerformanceDiagnostics(): ReaderPreloadPerformanceDiagnostics {
  return {
    ttfbSamples: 0,
    totalTtfbMs: 0,
    maxTtfbMs: 0,
    decodeSamples: 0,
    totalDecodeMs: 0,
    maxDecodeMs: 0,
    retainedByteSamples: 0,
    totalRetainedBytes: 0,
    maxRetainedBytes: 0,
    leaseSamples: 0,
    totalActiveLeases: 0,
    maxActiveLeases: 0,
  }
}

function validPerformanceMetrics(metrics: ReaderPreloadPerformanceMetrics | undefined): boolean {
  if (!metrics) return true
  return validDuration(metrics.ttfbMs)
    && validDuration(metrics.decodeMs)
    && validCount(metrics.retainedBytes, Number.MAX_SAFE_INTEGER)
    && validCount(metrics.activeLeases, 1_000_000)
}

function validDuration(value: number | undefined): boolean {
  return value === undefined || (Number.isFinite(value) && value >= 0 && value <= 10 * 60_000)
}

function validCount(value: number | undefined, maximum: number): boolean {
  return value === undefined || (Number.isSafeInteger(value) && value >= 0 && value <= maximum)
}

function recordPerformanceMetrics(target: ReaderPreloadPerformanceDiagnostics, metrics: ReaderPreloadPerformanceMetrics | undefined): void {
  if (!metrics) return
  if (metrics.ttfbMs !== undefined) {
    target.ttfbSamples += 1
    target.totalTtfbMs += metrics.ttfbMs
    target.maxTtfbMs = Math.max(target.maxTtfbMs, metrics.ttfbMs)
  }
  if (metrics.decodeMs !== undefined) {
    target.decodeSamples += 1
    target.totalDecodeMs += metrics.decodeMs
    target.maxDecodeMs = Math.max(target.maxDecodeMs, metrics.decodeMs)
  }
  if (metrics.retainedBytes !== undefined) {
    target.retainedByteSamples += 1
    target.totalRetainedBytes += metrics.retainedBytes
    target.maxRetainedBytes = Math.max(target.maxRetainedBytes, metrics.retainedBytes)
  }
  if (metrics.activeLeases !== undefined) {
    target.leaseSamples += 1
    target.totalActiveLeases += metrics.activeLeases
    target.maxActiveLeases = Math.max(target.maxActiveLeases, metrics.activeLeases)
  }
}

function isTerminal(outcome: ReaderPreloadOutcome): boolean {
  return outcome === "ready" || outcome === "failed" || outcome === "cancelled" || outcome === "evicted"
}
