import { describe, expect, it, vi } from "vitest"

import { LazySuperResolutionPagePort } from "./LazySuperResolutionPagePort.js"

describe("LazySuperResolutionPagePort", () => {
  it("[neoview.super-resolution.headless-lazy] loads once on first execution and disposes the capability", async () => {
    const run = vi.fn(async () => ({ decision: { kind: "skip" as const, reason: "test" } }))
    const dispose = vi.fn(async () => undefined)
    const load = vi.fn(async () => capability(run, dispose))
    const port = new LazySuperResolutionPagePort(load)

    expect(load).not.toHaveBeenCalled()
    await port.run(pageInput())
    await port.run(pageInput())
    expect(load).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledTimes(2)

    await port[Symbol.asyncDispose]()
    await port[Symbol.asyncDispose]()
    expect(dispose).toHaveBeenCalledOnce()
    await expect(port.run(pageInput())).rejects.toThrow("disposed")
  })

  it("[neoview.super-resolution.headless-unavailable] reports a missing optional runtime without executing", async () => {
    const port = new LazySuperResolutionPagePort(async () => undefined)
    await expect(port.run(pageInput())).rejects.toThrow("runtime is unavailable")
    await expect(port.inspect()).resolves.toEqual({ available: false, reason: "runtime-unavailable", models: [], engines: [] })
    await port[Symbol.asyncDispose]()
  })

  it("[neoview.super-resolution.runtime-reconfigure] disposes the loaded capability and reloads it on next demand", async () => {
    const firstDispose = vi.fn(async () => undefined)
    const secondDispose = vi.fn(async () => undefined)
    const run = vi.fn(async () => ({ decision: { kind: "skip" as const, reason: "test" } }))
    const load = vi.fn()
      .mockResolvedValueOnce(capability(run, firstDispose))
      .mockResolvedValueOnce(capability(run, secondDispose))
    const port = new LazySuperResolutionPagePort(load)
    await port.run(pageInput())
    await port.reconfigure()
    expect(firstDispose).toHaveBeenCalledOnce()
    await port.run(pageInput())
    expect(load).toHaveBeenCalledTimes(2)
    await port[Symbol.asyncDispose]()
    expect(secondDispose).toHaveBeenCalledOnce()
  })

  it("[neoview.super-resolution.artifact-lazy] reuses the same lazy capability for artifact execution", async () => {
    const acquireOrGenerate = vi.fn(async () => ({
      status: "bypassed" as const,
      decision: { kind: "run" as const, reason: "test", modelId: "model", scale: 2, useCache: false },
    }))
    const load = vi.fn(async () => ({
      ...capability(vi.fn(), async () => undefined),
      artifactPages: { acquireOrGenerate },
    }))
    const port = new LazySuperResolutionPagePort(load)
    await expect(port.acquireOrGenerate({
      page: pageInput().page,
      trigger: "manual",
      artifactFor: () => ({
        key: `neoview:super-resolution:v1:${"a".repeat(43)}`,
        metadata: { bookKey: "book", contentType: "image/png", extension: "png" },
      }),
    })).resolves.toMatchObject({ status: "bypassed" })
    expect(load).toHaveBeenCalledOnce()
    expect(acquireOrGenerate).toHaveBeenCalledOnce()
    await port[Symbol.asyncDispose]()
  })

  it("[neoview.super-resolution.headless-cancel] cancels one waiter without poisoning the shared load", async () => {
    const run = vi.fn(async () => ({ decision: { kind: "skip" as const, reason: "test" } }))
    let resolveLoad!: (value: ReturnType<typeof capability<typeof run>>) => void
    const load = new Promise<ReturnType<typeof capability<typeof run>>>((resolve) => { resolveLoad = resolve })
    const port = new LazySuperResolutionPagePort(() => load)
    const abort = new AbortController()
    const cancelled = port.run(pageInput(), { signal: abort.signal })
    abort.abort(new Error("cancelled"))
    await expect(cancelled).rejects.toThrow("cancelled")

    resolveLoad(capability(run, async () => undefined))
    await expect(port.run(pageInput())).resolves.toMatchObject({ decision: { kind: "skip" } })
    expect(run).toHaveBeenCalledOnce()
    await port[Symbol.asyncDispose]()
  })

  it("[neoview.super-resolution.preload-control-lazy] exposes live controls without loading on snapshot or release", async () => {
    const snapshot = {
      contextId: "reader:one",
      generation: 2,
      mode: "nearby" as const,
      state: "running" as const,
      planned: 1,
      settled: 0,
      failed: 0,
      cancelled: 0,
      pending: 1,
      progress: 0,
      startedAt: 1,
      updatedAt: 1,
    }
    const schedulePlan = vi.fn(async () => batchResult())
    const scheduleProgressive = vi.fn(async () => batchResult("progressive"))
    const snapshots = vi.fn(() => [snapshot])
    const pause = vi.fn(async () => [{ ...snapshot, state: "paused" as const }])
    const retry = vi.fn(async () => batchResult())
    const releaseContext = vi.fn()
    const load = vi.fn(async () => ({
      ...capability(vi.fn(), async () => undefined),
      preload: { schedulePlan, scheduleProgressive, snapshots, pause, retry, releaseContext },
    }))
    const port = new LazySuperResolutionPagePort(load)
    expect(await port.snapshots("reader:one")).toEqual([])
    await port.releaseContext("reader:one")
    expect(load).not.toHaveBeenCalled()

    const input = preloadInput()
    await expect(port.startPlan(input)).resolves.toEqual([snapshot])
    expect(schedulePlan).toHaveBeenCalledWith(input)
    expect(load).toHaveBeenCalledOnce()
    await expect(port.pause("reader:one")).resolves.toEqual([expect.objectContaining({ state: "paused" })])
    await expect(port.retry("reader:one", "nearby")).resolves.toEqual([snapshot])
    await port.releaseContext("reader:one")
    expect(releaseContext).toHaveBeenCalledWith("reader:one")
    await port[Symbol.asyncDispose]()
  })

  it("[neoview.super-resolution.preload-release-pending-load] does not block session release on optional runtime loading", async () => {
    const releaseContext = vi.fn()
    let resolveLoad!: (value: ReturnType<typeof capability> & { preload: object }) => void
    const loading = new Promise<ReturnType<typeof capability> & { preload: object }>((resolve) => { resolveLoad = resolve })
    const port = new LazySuperResolutionPagePort(() => loading as never)
    const execution = port.run(pageInput()).catch(() => undefined)
    await expect(port.snapshots("reader:closing")).resolves.toEqual([])
    await expect(port.releaseContext("reader:closing")).resolves.toBeUndefined()
    resolveLoad({
      ...capability(vi.fn(async () => ({ decision: { kind: "skip" as const, reason: "test" } })), async () => undefined),
      preload: { releaseContext },
    })
    await execution
    await vi.waitFor(() => expect(releaseContext).toHaveBeenCalledWith("reader:closing"))
    await port[Symbol.asyncDispose]()
  })
})

function capability<T>(run: T, dispose: () => Promise<void>) {
  return {
    pages: { run },
    listModels: () => [{ id: "model", displayName: "Model", engine: "upscayl" as const, scales: [2] }],
    capabilities: async () => ({
      engines: [{ engine: "upscayl" as const, available: true }],
      probedAt: 1,
    }),
    dispose,
  }
}

function pageInput() {
  return {
    page: {
      id: "page-0",
      index: 0,
      name: "page.png",
      sourcePath: "D:/page.png",
      mediaKind: "image" as const,
      contentVersion: "v1",
      dimensions: { width: 100, height: 100 },
      content: { load: async () => { throw new Error("unused") } },
    },
    destinationPath: "D:/output.png",
    trigger: "manual" as const,
  }
}

function preloadInput() {
  return {
    contextId: "reader:one",
    plan: {
      generation: 2,
      frameGeneration: 2,
      direction: "forward" as const,
      directionConfidence: 1,
      mode: "paged" as const,
      admission: "normal" as const,
      velocityPagesPerSecond: 0,
      stableForMs: 1_000,
      focused: true,
      queueWaitMs: 0,
      memoryPressure: "normal" as const,
      currentPageIndexes: [0],
      candidates: [],
    },
    pages: [pageInput().page],
    bookPath: "D:/book",
    artifactFor: vi.fn(),
  }
}

function batchResult(mode: "nearby" | "progressive" = "nearby") {
  return {
    contextId: "reader:one",
    generation: 2,
    mode,
    reason: "empty" as const,
    planned: 0,
    settled: 0,
    failed: 0,
    cancelled: 0,
    outcomes: [],
  }
}
