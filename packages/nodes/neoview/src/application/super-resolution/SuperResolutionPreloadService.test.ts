import { setTimeout as delay } from "node:timers/promises"
import { describe, expect, it, vi } from "vitest"

import type { ReaderPage } from "../../domain/page/page.js"
import type { SuperResolutionPreferences } from "../../domain/super-resolution/super-resolution-preferences.js"
import type { ReaderPreloadPlan } from "../preloading/PreloadCoordinator.js"
import { SuperResolutionPreloadService } from "./SuperResolutionPreloadService.js"

describe("SuperResolutionPreloadService", () => {
  it("[neoview.super-resolution.preload-plan] reuses plan order with bounded p-map concurrency", async () => {
    let active = 0
    let peak = 0
    const run = vi.fn(async (input) => {
      active += 1
      peak = Math.max(peak, active)
      await delay(5)
      active -= 1
      return { decision: { kind: "skip" as const, reason: input.page.id } }
    })
    const service = new SuperResolutionPreloadService({ run }, preferences({
      preloadPages: 3,
      backgroundConcurrency: 2,
    }))
    try {
      const result = await service.schedulePlan({
        contextId: "reader-1",
        plan: plan(4, [[1, 2], [3, 4]]),
        pages: pages(6),
        bookPath: "D:/book.cbz",
        destinationFor: (page, context) => `D:/cache/${context.generation}-${page.index}.png`,
      })
      expect(result).toMatchObject({ reason: "completed", planned: 3, settled: 3, failed: 0, cancelled: 0 })
      expect(run.mock.calls.map(([input]) => [input.page.index, input.priority, input.trigger])).toEqual([
        [1, "ahead", "preload"],
        [2, "ahead", "preload"],
        [3, "ahead", "preload"],
      ])
      expect(peak).toBe(2)
    } finally {
      await service.dispose()
    }
  })

  it("[neoview.super-resolution.preload-generation] supersedes stale session work and keeps the new generation", async () => {
    const run = vi.fn(async (input, context) => {
      if (input.destinationPath.includes("1-")) {
        await new Promise<never>((_resolve, reject) => {
          const abort = () => reject(context?.signal?.reason)
          context?.signal?.addEventListener("abort", abort, { once: true })
        })
      }
      return { decision: { kind: "skip" as const, reason: "test" } }
    })
    const service = new SuperResolutionPreloadService({ run }, preferences({ preloadPages: 1 }))
    const destinationFor = (page: ReaderPage, context: { generation: number }) => `D:/cache/${context.generation}-${page.index}.png`
    try {
      const first = service.schedulePlan({
        contextId: "reader-1",
        plan: plan(1, [[1]]),
        pages: pages(3),
        bookPath: "D:/book.cbz",
        destinationFor,
      })
      await vi.waitFor(() => expect(run).toHaveBeenCalledOnce())
      const second = service.schedulePlan({
        contextId: "reader-1",
        plan: plan(2, [[2]]),
        pages: pages(3),
        bookPath: "D:/book.cbz",
        destinationFor,
      })
      await expect(first).resolves.toMatchObject({ generation: 1, cancelled: 1 })
      await expect(second).resolves.toMatchObject({ generation: 2, settled: 1, cancelled: 0 })
      expect(run).toHaveBeenCalledTimes(2)
    } finally {
      await service.dispose()
    }
  })

  it("[neoview.super-resolution.progressive-generation] resets countdown but preserves a running batch across page turns", async () => {
    const runGate = deferred()
    const run = vi.fn(async (_input, context) => {
      await Promise.race([runGate.promise, new Promise<void>((_, reject) => {
        context?.signal?.addEventListener("abort", () => reject(context.signal.reason), { once: true })
      })])
      return { decision: { kind: "skip" as const, reason: "test" } }
    })
    const service = new SuperResolutionPreloadService({ run }, preferences({
      progressiveEnabled: true,
      progressiveDwellTimeMs: 0,
      progressiveMaxPages: 2,
      backgroundConcurrency: 1,
    }))
    try {
      const first = service.scheduleProgressive({
        contextId: "reader-progressive-generation",
        generation: 1,
        currentPageIndex: 0,
        pages: pages(8),
        bookPath: "D:/book.cbz",
        destinationFor: (page) => `D:/cache/${page.index}.png`,
      })
      await vi.waitFor(() => expect(run).toHaveBeenCalledOnce())
      await service.advanceGeneration("reader-progressive-generation", 2)
      expect(service.snapshots("reader-progressive-generation")[0]).toMatchObject({ generation: 1, state: "running" })
      const second = service.scheduleProgressive({
        contextId: "reader-progressive-generation",
        generation: 2,
        currentPageIndex: 1,
        pages: pages(8),
        bookPath: "D:/book.cbz",
        destinationFor: (page) => `D:/cache/${page.index}.png`,
      })
      expect(run).toHaveBeenCalledOnce()
      runGate.resolve()
      await expect(first).resolves.toMatchObject({ generation: 1, settled: 2 })
      await expect(second).resolves.toMatchObject({ generation: 2, settled: 3 })
      expect(run.mock.calls.map(([input]) => input.page.index)).toEqual([4, 5, 6])
    } finally {
      await service.dispose()
    }
  })

  it("[neoview.super-resolution.progressive-countdown-generation] cancels an old dwell and leaves the new generation to start", async () => {
    const run = vi.fn(async () => ({ decision: { kind: "skip" as const, reason: "test" } }))
    const service = new SuperResolutionPreloadService({ run }, preferences({
      progressiveEnabled: true,
      progressiveDwellTimeMs: 60_000,
    }))
    try {
      const first = service.scheduleProgressive({
        contextId: "reader-progressive-countdown",
        generation: 1,
        currentPageIndex: 0,
        pages: pages(3),
        bookPath: "D:/book.cbz",
        destinationFor: (page) => `D:/cache/${page.index}.png`,
      })
      expect(service.snapshots("reader-progressive-countdown")[0]).toMatchObject({ generation: 1, state: "countdown" })
      await service.advanceGeneration("reader-progressive-countdown", 2)
      await expect(first).rejects.toMatchObject({ name: "AbortError" })
      expect(service.snapshots("reader-progressive-countdown")).toEqual([])
    } finally {
      await service.dispose()
    }
  })

  it("[neoview.super-resolution.progressive] waits, then expands forward with the configured bound", async () => {
    const run = vi.fn(async (input) => ({ decision: { kind: "skip" as const, reason: input.page.id } }))
    const service = new SuperResolutionPreloadService({ run }, preferences({
      progressiveEnabled: true,
      progressiveDwellTimeMs: 0,
      progressiveMaxPages: 2,
    }))
    try {
      const result = await service.scheduleProgressive({
        contextId: "reader-1",
        generation: 3,
        currentPageIndex: 1,
        pages: pages(8),
        bookPath: "D:/book.cbz",
        destinationFor: (page) => `D:/cache/${page.index}.png`,
      })
      expect(result).toMatchObject({ mode: "progressive", generation: 3, planned: 2, settled: 2 })
      expect(run.mock.calls.map(([input]) => [input.page.index, input.priority])).toEqual([
        [5, "background"],
        [6, "background"],
      ])
    } finally {
      await service.dispose()
    }
  })

  it("[neoview.super-resolution.rolling-frontier] keeps nearby and progressive ranges contiguous without overlap", async () => {
    const run = vi.fn(async (input) => ({ decision: { kind: "skip" as const, reason: input.page.id } }))
    const service = new SuperResolutionPreloadService({ run }, preferences({
      preloadPages: 3,
      progressiveEnabled: true,
      progressiveDwellTimeMs: 0,
      progressiveMaxPages: 20,
    }))
    try {
      const nearby = service.schedulePlan({
        contextId: "reader-rolling-frontier",
        plan: plan(1, [[3, 4, 5]], [2]),
        pages: pages(30),
        bookPath: "D:/book.cbz",
        destinationFor: (page) => `D:/cache/${page.index}.png`,
      })
      const progressive = service.scheduleProgressive({
        contextId: "reader-rolling-frontier",
        generation: 1,
        currentPageIndex: 2,
        pages: pages(30),
        bookPath: "D:/book.cbz",
        destinationFor: (page) => `D:/cache/${page.index}.png`,
      })

      await expect(nearby).resolves.toMatchObject({ planned: 3, settled: 3 })
      await expect(progressive).resolves.toMatchObject({ planned: 20, settled: 20 })
      const nearbyIndexes = run.mock.calls
        .filter(([input]) => input.priority === "ahead")
        .map(([input]) => input.page.index)
      const progressiveIndexes = run.mock.calls
        .filter(([input]) => input.priority === "background")
        .map(([input]) => input.page.index)
      expect(nearbyIndexes).toEqual([3, 4, 5])
      expect(progressiveIndexes).toEqual(Array.from({ length: 20 }, (_, index) => index + 6))
    } finally {
      await service.dispose()
    }
  })

  it("[neoview.super-resolution.preload-disabled] performs zero destination or page work when preferences disable it", async () => {
    const run = vi.fn()
    const destinationFor = vi.fn()
    const service = new SuperResolutionPreloadService({ run }, preferences({ autoUpscaleEnabled: false }))
    try {
      await expect(service.schedulePlan({
        contextId: "reader-1",
        plan: plan(1, [[1]]),
        pages: pages(3),
        bookPath: "D:/book.cbz",
        destinationFor,
      })).resolves.toMatchObject({ reason: "disabled", planned: 0 })
      await expect(service.scheduleProgressive({
        contextId: "reader-1",
        generation: 1,
        currentPageIndex: 0,
        pages: pages(3),
        bookPath: "D:/book.cbz",
        destinationFor,
      })).resolves.toMatchObject({ reason: "disabled", planned: 0 })
      expect(destinationFor).not.toHaveBeenCalled()
      expect(run).not.toHaveBeenCalled()
    } finally {
      await service.dispose()
    }
  })

  it("[neoview.super-resolution.preload-observer] isolates telemetry observer failures", async () => {
    const run = vi.fn(async () => ({ decision: { kind: "skip" as const, reason: "test" } }))
    const service = new SuperResolutionPreloadService({ run }, preferences({ preloadPages: 1 }))
    try {
      await expect(service.schedulePlan({
        contextId: "reader-1",
        plan: plan(1, [[1]]),
        pages: pages(3),
        bookPath: "D:/book.cbz",
        destinationFor: (page) => `D:/cache/${page.index}.png`,
        onPageSettled: () => { throw new Error("observer failed") },
      })).resolves.toMatchObject({ settled: 1, failed: 0 })
    } finally {
      await service.dispose()
    }
  })

  it("[neoview.super-resolution.preload-progress-snapshot] exposes bounded live progress without resetting shared generations", async () => {
    const gate = deferred()
    const run = vi.fn(async () => {
      await gate.promise
      return { decision: { kind: "skip" as const, reason: "test" } }
    })
    const service = new SuperResolutionPreloadService({ run }, preferences({
      preloadPages: 2,
      backgroundConcurrency: 1,
    }))
    const input = {
      contextId: "reader-live",
      plan: plan(7, [[1, 2]]),
      pages: pages(3),
      bookPath: "D:/book.cbz",
      destinationFor: (page: ReaderPage) => `D:/cache/${page.index}.png`,
    }
    try {
      const first = service.schedulePlan(input)
      await vi.waitFor(() => expect(run).toHaveBeenCalledOnce())
      expect(service.pageState("reader-live", 0)).toBe("none")
      expect(service.pageState("reader-live", 1)).toBe("pending")
      expect(service.pageState("reader-live", 2)).toBe("pending")
      expect(service.snapshots("reader-live")).toEqual([expect.objectContaining({
        generation: 7,
        mode: "nearby",
        state: "running",
        planned: 2,
        settled: 0,
        pending: 2,
        progress: 0,
      })])
      const shared = service.schedulePlan(input)
      expect(service.snapshots("reader-live")[0]).toMatchObject({ state: "running", planned: 2, pending: 2 })
      gate.resolve()
      await expect(first).resolves.toMatchObject({ settled: 2 })
      await expect(shared).resolves.toMatchObject({ settled: 2 })
      expect(run).toHaveBeenCalledTimes(2)
      expect(service.pageState("reader-live", 1)).toBe("settled")
      expect(service.pageState("reader-live", 2)).toBe("settled")
      expect(service.snapshots("reader-live")[0]).toMatchObject({
        state: "completed",
        settled: 2,
        failed: 0,
        pending: 0,
        progress: 1,
      })
    } finally {
      await service.dispose()
    }
  })

  it("[neoview.super-resolution.preload-pause] cancels an active dwell and preserves a paused snapshot", async () => {
    const service = new SuperResolutionPreloadService({ run: vi.fn() }, preferences({
      progressiveEnabled: true,
      progressiveDwellTimeMs: 60_000,
    }))
    try {
      const operation = service.scheduleProgressive({
        contextId: "reader-pause",
        generation: 3,
        currentPageIndex: 0,
        pages: pages(3),
        bookPath: "D:/book.cbz",
        destinationFor: (page) => `D:/cache/${page.index}.png`,
      })
      expect(service.snapshots("reader-pause")[0]).toMatchObject({ state: "countdown", mode: "progressive" })
      await expect(service.pause("reader-pause")).resolves.toEqual([
        expect.objectContaining({ state: "paused", completedAt: expect.any(Number) }),
      ])
      await expect(operation).rejects.toMatchObject({ name: "AbortError" })
      expect(service.snapshots("reader-pause")[0]).toMatchObject({ state: "paused" })
    } finally {
      await service.dispose()
    }
  })

  it("[neoview.super-resolution.preload-running-pause] keeps paused as the terminal state of cancelled page work", async () => {
    const run = vi.fn(async (_input, context) => {
      await new Promise<never>((_resolve, reject) => {
        const abort = () => reject(context?.signal?.reason)
        context?.signal?.addEventListener("abort", abort, { once: true })
      })
    })
    const service = new SuperResolutionPreloadService({ run }, preferences({ preloadPages: 1 }))
    try {
      const operation = service.schedulePlan({
        contextId: "reader-running-pause",
        plan: plan(5, [[1]]),
        pages: pages(2),
        bookPath: "D:/book.cbz",
        destinationFor: (page) => `D:/cache/${page.index}.png`,
      })
      await vi.waitFor(() => expect(run).toHaveBeenCalledOnce())
      await service.pause("reader-running-pause")
      await expect(operation).resolves.toMatchObject({ cancelled: 1 })
      expect(service.snapshots("reader-running-pause")[0]).toMatchObject({
        state: "paused",
        cancelled: 1,
        pending: 0,
        progress: 0,
      })
    } finally {
      await service.dispose()
    }
  })

  it("[neoview.super-resolution.preload-retry] resubmits the canonical failed request and clears released state", async () => {
    let fail = true
    const run = vi.fn(async () => {
      if (fail) throw new Error("GPU unavailable")
      return { decision: { kind: "skip" as const, reason: "test" } }
    })
    const service = new SuperResolutionPreloadService({ run }, preferences({ preloadPages: 1 }))
    const input = {
      contextId: "reader-retry",
      plan: plan(2, [[1]]),
      pages: pages(2),
      bookPath: "D:/book.cbz",
      destinationFor: (page: ReaderPage) => `D:/cache/${page.index}.png`,
    }
    try {
      await expect(service.schedulePlan(input)).resolves.toMatchObject({ failed: 1 })
      expect(service.snapshots("reader-retry")[0]).toMatchObject({ state: "completed", failed: 1 })
      fail = false
      await expect(service.retry("reader-retry", "nearby")).resolves.toMatchObject({ settled: 1, failed: 0 })
      expect(service.snapshots("reader-retry")[0]).toMatchObject({ state: "completed", settled: 1, failed: 0 })
      service.releaseContext("reader-retry")
      expect(service.snapshots("reader-retry")).toEqual([])
      expect(() => service.retry("reader-retry", "nearby")).toThrow("No super-resolution nearby request")
    } finally {
      await service.dispose()
    }
  })
})

function preferences(overrides: Partial<SuperResolutionPreferences> = {}): SuperResolutionPreferences {
  return {
    schemaVersion: 1,
    autoUpscaleEnabled: true,
    preUpscaleEnabled: true,
    conditions: [],
    ...overrides,
  }
}

function pages(count: number): ReaderPage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `page-${index}`,
    index,
    name: `${index}.png`,
    sourcePath: `D:/book/${index}.png`,
    mediaKind: "image" as const,
    dimensions: { width: 100, height: 200 },
    contentVersion: "v1",
    content: { load: vi.fn() },
  }))
}

function plan(generation: number, groups: readonly (readonly number[])[], currentPageIndexes: readonly number[] = [0]): ReaderPreloadPlan {
  return {
    generation,
    frameGeneration: generation,
    direction: "forward",
    directionConfidence: 1,
    mode: "paged",
    admission: "normal",
    velocityPagesPerSecond: 0,
    stableForMs: 1_000,
    focused: true,
    queueWaitMs: 0,
    memoryPressure: "normal",
    currentPageIndexes,
    candidates: groups.map((pageIndexes, index) => ({
      tier: index === 0 ? "ahead" as const : "background" as const,
      priority: index === 0 ? "ahead" as const : "background" as const,
      anchorPageIndex: pageIndexes[0] ?? 0,
      pageIndexes,
      pageIds: pageIndexes.map((pageIndex) => `page-${pageIndex}`),
    })),
  }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((current) => { resolve = current })
  return { promise, resolve }
}
