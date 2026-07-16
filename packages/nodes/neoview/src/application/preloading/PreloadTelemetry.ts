import type { ReaderPreloadPlan, ReaderPreloadTier } from "./PreloadCoordinator.js"

export type ReaderPreloadOutcome = "started" | "ready" | "failed" | "cancelled" | "evicted"

export interface ReaderPreloadReport {
  generation: number
  pageId: string
  outcome: ReaderPreloadOutcome
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
}

export interface ReaderPreloadReportResult {
  accepted: boolean
  reason?: "stale-generation" | "unknown-page" | "duplicate"
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
  }
  const candidates = output.candidates as Record<ReaderPreloadTier, number>
  for (const snapshot of snapshots) {
    candidates.near += snapshot.candidates.near
    candidates.ahead += snapshot.candidates.ahead
    candidates.background += snapshot.candidates.background
    for (const key of ["active", "plannedCandidates", "started", "ready", "failed", "cancelled", "evicted", "staleReports", "rejectedReports", "duplicateReports"] as const) {
      output[key] += snapshot[key]
    }
  }
  return output
}

function isTerminal(outcome: ReaderPreloadOutcome): boolean {
  return outcome === "ready" || outcome === "failed" || outcome === "cancelled" || outcome === "evicted"
}
