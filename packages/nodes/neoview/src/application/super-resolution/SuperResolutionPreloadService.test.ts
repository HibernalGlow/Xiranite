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
        [3, "background", "preload"],
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
        pages: pages(6),
        bookPath: "D:/book.cbz",
        destinationFor: (page) => `D:/cache/${page.index}.png`,
      })
      expect(result).toMatchObject({ mode: "progressive", generation: 3, planned: 2, settled: 2 })
      expect(run.mock.calls.map(([input]) => [input.page.index, input.priority])).toEqual([
        [2, "background"],
        [3, "background"],
      ])
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

function plan(generation: number, groups: readonly (readonly number[])[]): ReaderPreloadPlan {
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
    currentPageIndexes: [0],
    candidates: groups.map((pageIndexes, index) => ({
      tier: index === 0 ? "ahead" as const : "background" as const,
      priority: index === 0 ? "ahead" as const : "background" as const,
      anchorPageIndex: pageIndexes[0] ?? 0,
      pageIndexes,
      pageIds: pageIndexes.map((pageIndex) => `page-${pageIndex}`),
    })),
  }
}
