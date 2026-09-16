import { describe, expect, it } from "vitest"

import type { ReaderPreloadPlanDto } from "../../adapters/reader-http-client"
import { readerAdjacentPreloadEnabled, readerPreloadPlanRequiresRelease } from "./readerPreloadPolicy"

describe("readerAdjacentPreloadEnabled", () => {
  it("[neoview.preload.gate-decoupled] follows the config switch and the deferred frame mount only", () => {
    expect(readerAdjacentPreloadEnabled({ browserPredecodeEnabled: true, readerFrameAllowed: true })).toBe(true)
    expect(readerAdjacentPreloadEnabled({ browserPredecodeEnabled: false, readerFrameAllowed: true })).toBe(false)
    expect(readerAdjacentPreloadEnabled({ browserPredecodeEnabled: true, readerFrameAllowed: false })).toBe(false)
    expect(readerAdjacentPreloadEnabled({ browserPredecodeEnabled: true, readerFrameAllowed: true, sessionId: "reader-1" })).toBe(true)
  })

  it("[neoview.preload.gate-decoupled] still stands down for the frame the user cancelled", () => {
    const base = { browserPredecodeEnabled: true, readerFrameAllowed: true, sessionId: "reader-1", frameGeneration: 4 }
    expect(readerAdjacentPreloadEnabled({ ...base, cancelledPreloadFrame: { sessionId: "reader-1", generation: 3 } })).toBe(true)
    expect(readerAdjacentPreloadEnabled({ ...base, cancelledPreloadFrame: { sessionId: "reader-1", generation: 4 } })).toBe(false)
    expect(readerAdjacentPreloadEnabled({ ...base, cancelledPreloadFrame: { sessionId: "reader-2", generation: 4 } })).toBe(true)
  })
})

describe("readerPreloadPlanRequiresRelease", () => {
  it("[neoview.preload.paused-retains] treats a recent page turn as a suspend, not a teardown", () => {
    expect(readerPreloadPlanRequiresRelease(preloadPlan({ admission: "paused", stableForMs: 0 }))).toBe(false)
    expect(readerPreloadPlanRequiresRelease(preloadPlan({ admission: "paused", queueWaitMs: 500 }))).toBe(false)
  })

  it("[neoview.preload.paused-releases] releases for memory pressure, a background document and scrub", () => {
    expect(readerPreloadPlanRequiresRelease(preloadPlan({ admission: "paused", memoryPressure: "critical" }))).toBe(true)
    expect(readerPreloadPlanRequiresRelease(preloadPlan({ admission: "paused", focused: false }))).toBe(true)
    expect(readerPreloadPlanRequiresRelease(preloadPlan({ admission: "paused", mode: "scrub" }))).toBe(true)
  })
})

function preloadPlan(overrides: Partial<ReaderPreloadPlanDto> = {}): ReaderPreloadPlanDto {
  return {
    generation: 7,
    frameGeneration: 2,
    direction: "forward",
    directionConfidence: 1,
    mode: "paged",
    admission: "normal",
    velocityPagesPerSecond: 0,
    stableForMs: 1_000,
    focused: true,
    queueWaitMs: 0,
    memoryPressure: "normal",
    currentPageIndexes: [3],
    candidates: [],
    ...overrides,
  }
}
