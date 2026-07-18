import { writeFile, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ReaderPage } from "../../domain/page/page.js"
import { CacacheSuperResolutionArtifactStore } from "../../platform/super-resolution/CacacheSuperResolutionArtifactStore.js"
import { buildSuperResolutionArtifactKey } from "../../platform/super-resolution/SuperResolutionArtifactKey.js"
import { SuperResolutionPageService } from "./SuperResolutionPageService.js"
import { SuperResolutionArtifactPageService } from "./SuperResolutionArtifactPageService.js"
import { SuperResolutionPreloadService } from "./SuperResolutionPreloadService.js"

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 0, 0, 0, 0])

describe("SuperResolutionArtifactPageService", () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "xr-artifact-pages-"))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it("[neoview.super-resolution.artifact-page-hit] generates once, returns a stream lease, and skips the provider on hit", async () => {
    const runner = outputRunner()
    const policy = runPolicy()
    const store = createStore()
    const service = new SuperResolutionArtifactPageService(new SuperResolutionPageService(runner, policy), store)
    const input = artifactInput("hit")

    const generated = await service.acquireOrGenerate(input)
    expect(generated.status).toBe("generated")
    if (generated.status !== "generated") throw new Error("expected generated artifact")
    expect(generated.execution).not.toHaveProperty("sourcePath")
    expect(generated.execution).not.toHaveProperty("destinationPath")
    generated.artifact.release()

    const hit = await service.acquireOrGenerate(input)
    expect(hit.status).toBe("hit")
    if (!("artifact" in hit)) throw new Error("expected artifact lease")
    let bytes = 0
    for await (const chunk of hit.artifact.openStream()) bytes += Buffer.byteLength(chunk)
    expect(bytes).toBe(PNG.length)
    hit.artifact.release()
    expect(policy.decide).toHaveBeenCalledTimes(2)
    expect(runner.run).toHaveBeenCalledOnce()
    await store.close()
  })

  it("[neoview.super-resolution.artifact-page-shared] shares one provider execution between concurrent page demands", async () => {
    const gate = deferred()
    const runner = outputRunner(async () => gate.promise)
    const store = createStore()
    const service = new SuperResolutionArtifactPageService(new SuperResolutionPageService(runner, runPolicy()), store)
    const input = artifactInput("shared")
    const first = service.acquireOrGenerate(input)
    await vi.waitFor(() => expect(runner.run).toHaveBeenCalledOnce())
    const second = service.acquireOrGenerate(input)
    gate.resolve()
    const results = await Promise.all([first, second])
    expect(results.map((result) => result.status).sort()).toEqual(["generated", "shared"])
    for (const result of results) if ("artifact" in result) result.artifact.release()
    expect(runner.run).toHaveBeenCalledOnce()
    await store.close()
  })

  it("[neoview.super-resolution.artifact-page-skip] preserves policy skips without materializing or publishing", async () => {
    const runner = outputRunner()
    const store = createStore()
    const pages = new SuperResolutionPageService(runner, { decide: () => ({ kind: "skip", reason: "condition-skip" }) })
    const result = await new SuperResolutionArtifactPageService(pages, store).warm(artifactInput("skip"))
    expect(result).toEqual({ status: "skipped", decision: { kind: "skip", reason: "condition-skip" } })
    expect(runner.run).not.toHaveBeenCalled()
    expect(await store.snapshot()).toMatchObject({ entries: 0, writes: 0 })
    await store.close()
  })

  it("[neoview.super-resolution.artifact-page-rejected] reports a completed execution when disk admission rejects persistence", async () => {
    const runner = outputRunner()
    const store = createStore({ minFreeBytes: 1, availableBytes: async () => 0 })
    const service = new SuperResolutionArtifactPageService(new SuperResolutionPageService(runner, runPolicy()), store)
    await expect(service.warm(artifactInput("low-disk"))).resolves.toMatchObject({
      status: "rejected",
      execution: { modelId: "model", scale: 2 },
    })
    expect(await store.snapshot()).toMatchObject({ entries: 0, rejectedWrites: 1 })
    await store.close()
  })

  it("[neoview.super-resolution.artifact-page-shared-rejection] gives all concurrent low-disk waiters a typed rejection", async () => {
    const gate = deferred()
    const runner = outputRunner(async () => gate.promise)
    const store = createStore({ minFreeBytes: 1, availableBytes: async () => 0 })
    const service = new SuperResolutionArtifactPageService(new SuperResolutionPageService(runner, runPolicy()), store)
    const input = artifactInput("shared-low-disk")
    const first = service.warm(input)
    await vi.waitFor(() => expect(runner.run).toHaveBeenCalledOnce())
    const second = service.warm(input)
    gate.resolve()
    const results = await Promise.all([first, second])
    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"])
    expect(results.filter((result) => result.status === "rejected" && result.execution)).toHaveLength(1)
    await store.close()
  })

  it("[neoview.super-resolution.artifact-page-cache-bypass] honors the canonical policy cache hint", async () => {
    const runner = outputRunner()
    const policy = runPolicy()
    policy.decide.mockReturnValue({ ...policy.decide(), useCache: false })
    const store = createStore()
    const service = new SuperResolutionArtifactPageService(new SuperResolutionPageService(runner, policy), store)
    await expect(service.warm(artifactInput("bypass"))).resolves.toMatchObject({
      status: "bypassed",
      decision: { kind: "run", useCache: false },
    })
    expect(runner.run).not.toHaveBeenCalled()
    expect(await store.snapshot()).toMatchObject({ entries: 0, writes: 0 })
    await store.close()
  })

  it("[neoview.super-resolution.preload-artifact] lets progressive work warm opaque artifacts without a raw destination resolver", async () => {
    const pages = { run: vi.fn() }
    const artifactPages = { warm: vi.fn(async (input) => {
      const artifact = await input.artifactFor({
        kind: "run",
        reason: "default-policy",
        modelId: "model",
        scale: 2,
        useCache: true,
      })
      expect(artifact.key).toMatch(/^neoview:super-resolution:/)
      return { status: "hit" as const }
    }) }
    const preload = new SuperResolutionPreloadService(pages, {
      schemaVersion: 1,
      autoUpscaleEnabled: true,
      preUpscaleEnabled: true,
      preloadPages: 1,
      conditions: [],
    }, artifactPages)
    try {
      await expect(preload.schedulePlan({
        contextId: "reader-1",
        plan: {
          generation: 4,
          frameGeneration: 4,
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
          candidates: [{ tier: "ahead", priority: "ahead", anchorPageIndex: 1, pageIndexes: [1], pageIds: ["page-1"] }],
        },
        pages: [page(0), page(1)],
        bookPath: "D:/book.cbz",
        artifactFor: (candidate) => descriptor(candidate.id),
      })).resolves.toMatchObject({ settled: 1, failed: 0, outcomes: [{ output: { status: "hit" } }] })
      expect(artifactPages.warm).toHaveBeenCalledWith(expect.objectContaining({
        page: expect.objectContaining({ id: "page-1" }),
        artifactFor: expect.any(Function),
        priority: "ahead",
      }), { signal: expect.any(AbortSignal) })
      expect(pages.run).not.toHaveBeenCalled()
    } finally {
      await preload.dispose()
    }
  })

  function createStore(options: Partial<ConstructorParameters<typeof CacacheSuperResolutionArtifactStore>[0]> = {}) {
    return new CacacheSuperResolutionArtifactStore({
      root,
      maxBytes: 1024,
      maxEntryBytes: 512,
      minFreeBytes: 0,
      minimumRetentionMs: 0,
      ...options,
    })
  }
})

function artifactInput(identity: string) {
  return {
    page: page(0),
    artifactFor: (decision: { modelId: string; scale: number }) => descriptor(identity, decision),
    trigger: "preload" as const,
    bookPath: "D:/book",
    priority: "background" as const,
  }
}

function descriptor(identity: string, decision: { modelId: string; scale: number } = { modelId: "model", scale: 2 }) {
  return {
    key: buildSuperResolutionArtifactKey({
      sourceIdentity: "D:/book",
      sourceRevision: "v1",
      pageIdentity: identity,
      modelId: decision.modelId,
      scale: decision.scale,
      producerVersion: "test-1",
    }),
    metadata: { bookKey: "book:one", contentType: "image/png" as const, extension: "png" as const },
  }
}

function outputRunner(beforeWrite?: () => Promise<void>) {
  return {
    run: vi.fn(async (input: { sourcePath: string; destinationPath: string; modelId: string; scale: number }) => {
      await beforeWrite?.()
      await writeFile(input.destinationPath, PNG)
      return {
        sourcePath: input.sourcePath,
        destinationPath: input.destinationPath,
        modelId: input.modelId,
        engine: "upscayl" as const,
        scale: input.scale,
        width: 200,
        height: 400,
        elapsedMs: 10,
      }
    }),
  }
}

function runPolicy() {
  return {
    decide: vi.fn(() => ({
      kind: "run" as const,
      reason: "default-policy",
      modelId: "model",
      scale: 2,
      useCache: true,
    })),
  }
}

function page(index: number): ReaderPage {
  return {
    id: `page-${index}`,
    index,
    name: `${index}.png`,
    sourcePath: `D:/book/${index}.png`,
    mediaKind: "image",
    dimensions: { width: 100, height: 200 },
    contentVersion: "v1",
    content: { load: vi.fn() },
  }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((current) => { resolve = current })
  return { promise, resolve }
}
