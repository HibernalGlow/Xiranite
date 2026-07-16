import { describe, expect, it } from "vitest"

import { buildFrameSnapshot } from "../../domain/frame/frame-builder.js"
import { DEFAULT_READER_LAYOUT } from "../../domain/frame/frame.js"
import type { ReaderPage } from "../../domain/page/page.js"
import { ReaderPreloadCoordinator } from "./PreloadCoordinator.js"

describe("ReaderPreloadCoordinator", () => {
  it("[neoview.preload.plan-single] creates bounded directional tiers without the visible page", () => {
    const pages = pageFixture(8)
    const coordinator = new ReaderPreloadCoordinator(pages)
    const plan = coordinator.update(frame(pages, 2, "single"), "next")
    expect(plan).toMatchObject({ generation: 1, direction: "forward", directionConfidence: 1, currentPageIndexes: [2] })
    expect(plan.candidates).toEqual([
      expect.objectContaining({ tier: "near", priority: "view", pageIndexes: [3] }),
      expect.objectContaining({ tier: "ahead", priority: "ahead", pageIndexes: [4] }),
      expect.objectContaining({ tier: "ahead", priority: "ahead", pageIndexes: [5] }),
      expect.objectContaining({ tier: "background", priority: "background", pageIndexes: [1] }),
    ])
  })

  it("[neoview.preload.plan-double] reuses frame pairing for double-page and RTL", () => {
    const pages = pageFixture(9)
    const coordinator = new ReaderPreloadCoordinator(pages, { aheadFrames: 1 })
    const current = frame(pages, 1, "double", "right-to-left")
    expect(current.pages.map((page) => page.pageIndex)).toEqual([2, 1])
    const plan = coordinator.update(current, "next")
    expect(plan.candidates.map((candidate) => candidate.pageIndexes)).toEqual([[4, 3], [6, 5], [0]])
    expect(new Set(plan.candidates.flatMap((candidate) => candidate.pageIndexes)).size).toBe(5)
  })

  it("[neoview.preload.plan-direction] changes direction for reverse navigation and keeps generations monotonic", () => {
    const pages = pageFixture(10)
    const coordinator = new ReaderPreloadCoordinator(pages, { aheadFrames: 1 })
    coordinator.update(frame(pages, 5, "single", "left-to-right", 3), "initial")
    const reverse = coordinator.update(frame(pages, 2, "single", "left-to-right", 4), "go-to")
    expect(reverse).toMatchObject({ generation: 2, frameGeneration: 4, direction: "backward", directionConfidence: 0.75 })
    expect(reverse.candidates.map((candidate) => candidate.pageIndexes)).toEqual([[1], [0], [3]])
    expect(coordinator.snapshot()).toBe(reverse)
  })

  it("[neoview.preload.viewport-admission] pauses unstable/scrub work and reduces a stable medium-speed continuous window", () => {
    const pages = pageFixture(12)
    const coordinator = new ReaderPreloadCoordinator(pages)
    const current = frame(pages, 5, "single")
    const unstable = coordinator.update(current, "go-to", { mode: "continuous", velocityPagesPerSecond: 2, stableForMs: 80 })
    expect(unstable).toMatchObject({ admission: "paused", mode: "continuous", stableForMs: 80, candidates: [] })
    const reduced = coordinator.update(current, "layout", { mode: "continuous", velocityPagesPerSecond: -2, stableForMs: 150 })
    expect(reduced).toMatchObject({ admission: "reduced", direction: "backward", focused: true })
    expect(reduced.candidates.map((candidate) => [candidate.tier, candidate.pageIndexes])).toEqual([
      ["near", [4]],
      ["ahead", [3]],
    ])
    const scrub = coordinator.update(current, "layout", { mode: "scrub", stableForMs: 500 })
    expect(scrub).toMatchObject({ admission: "paused", candidates: [] })
  })

  it("[neoview.preload.viewport-validation] keeps legacy defaults and validates caller-provided viewport facts", () => {
    const pages = pageFixture(6)
    const coordinator = new ReaderPreloadCoordinator(pages)
    expect(coordinator.update(frame(pages, 2, "single"), "next")).toMatchObject({
      mode: "paged",
      admission: "normal",
      velocityPagesPerSecond: 0,
      stableForMs: Number.MAX_SAFE_INTEGER,
      focused: true,
    })
    expect(() => coordinator.update(frame(pages, 2, "single"), "next", { velocityPagesPerSecond: Number.NaN })).toThrow("velocityPagesPerSecond")
    expect(() => coordinator.update(frame(pages, 2, "single"), "next", { stableForMs: -1 })).toThrow("stableForMs")
  })

  it("handles empty/end frames and validates budgets", () => {
    expect(new ReaderPreloadCoordinator([]).update(frame([], 0, "single"), "initial").candidates).toEqual([])
    const pages = pageFixture(2)
    expect(new ReaderPreloadCoordinator(pages).update(frame(pages, 1, "single"), "next").candidates).toEqual([
      expect.objectContaining({ tier: "background", pageIndexes: [0] }),
    ])
    expect(() => new ReaderPreloadCoordinator(pages, { aheadFrames: 99 })).toThrow("aheadFrames")
  })
})

function frame(
  pages: readonly ReaderPage[],
  anchorPageIndex: number,
  pageMode: "single" | "double",
  direction: "left-to-right" | "right-to-left" = "left-to-right",
  generation = 1,
) {
  return buildFrameSnapshot({
    pages,
    anchorPageIndex,
    generation,
    direction,
    layout: { ...DEFAULT_READER_LAYOUT, pageMode },
  })
}

function pageFixture(count: number): ReaderPage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `page-${index}`,
    index,
    name: `${index}.jpg`,
    sourcePath: `D:/${index}.jpg`,
    mediaKind: "image",
    contentVersion: "v1",
    content: { open: async () => { throw new Error("preload planning must not open page content") } },
  }))
}
