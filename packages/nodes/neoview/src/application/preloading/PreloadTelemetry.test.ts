import { describe, expect, it } from "vitest"

import type { ReaderPreloadPlan } from "./PreloadCoordinator.js"
import { ReaderPreloadTelemetry } from "./PreloadTelemetry.js"

describe("ReaderPreloadTelemetry", () => {
  it("[neoview.preload.telemetry] tracks current-plan outcomes without retaining assets", () => {
    const telemetry = new ReaderPreloadTelemetry()
    telemetry.updatePlan(plan(1, ["p2", "p3"]))
    expect(telemetry.report({ generation: 1, pageId: "p2", outcome: "started" })).toEqual({ accepted: true })
    expect(telemetry.report({ generation: 1, pageId: "p2", outcome: "ready" })).toEqual({ accepted: true })
    expect(telemetry.report({ generation: 1, pageId: "p2", outcome: "evicted" })).toEqual({ accepted: true })
    expect(telemetry.report({ generation: 1, pageId: "p3", outcome: "failed" })).toEqual({ accepted: true })
    expect(telemetry.snapshot()).toMatchObject({
      generation: 1,
      candidates: { near: 2, ahead: 0, background: 0 },
      active: 0,
      plannedCandidates: 2,
      started: 1,
      ready: 1,
      failed: 1,
      evicted: 1,
    })
  })

  it("[neoview.preload.telemetry-generation] cancels active old generations and rejects stale, unknown and duplicate reports", () => {
    const telemetry = new ReaderPreloadTelemetry()
    telemetry.updatePlan(plan(1, ["p2"]))
    telemetry.report({ generation: 1, pageId: "p2", outcome: "started" })
    telemetry.updatePlan(plan(2, ["p4"]))
    expect(telemetry.report({ generation: 1, pageId: "p2", outcome: "ready" })).toEqual({ accepted: false, reason: "stale-generation" })
    expect(telemetry.report({ generation: 2, pageId: "missing", outcome: "started" })).toEqual({ accepted: false, reason: "unknown-page" })
    expect(telemetry.report({ generation: 2, pageId: "p4", outcome: "started" })).toEqual({ accepted: true })
    expect(telemetry.report({ generation: 2, pageId: "p4", outcome: "started" })).toEqual({ accepted: false, reason: "duplicate" })
    telemetry.close()
    expect(telemetry.snapshot()).toMatchObject({
      active: 0,
      plannedCandidates: 2,
      started: 2,
      cancelled: 2,
      staleReports: 1,
      rejectedReports: 1,
      duplicateReports: 1,
    })
  })
})

function plan(generation: number, pageIds: string[]): ReaderPreloadPlan {
  return {
    generation,
    frameGeneration: generation,
    direction: "forward",
    directionConfidence: 1,
    mode: "paged",
    admission: "normal",
    velocityPagesPerSecond: 0,
    stableForMs: Number.MAX_SAFE_INTEGER,
    focused: true,
    queueWaitMs: 0,
    memoryPressure: "normal",
    currentPageIndexes: [0],
    candidates: [{ tier: "near", priority: "view", anchorPageIndex: 1, pageIndexes: pageIds.map((_, index) => index + 1), pageIds }],
  }
}
