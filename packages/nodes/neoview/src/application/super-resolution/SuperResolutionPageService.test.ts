import { describe, expect, it, vi } from "vitest"

import type { ReaderPage } from "../../domain/page/page.js"
import type { ReaderPageMaterializationLease } from "../../ports/ReaderPageMaterializer.js"
import { SuperResolutionPageService } from "./SuperResolutionPageService.js"

describe("SuperResolutionPageService", () => {
  it("[neoview.super-resolution.page-policy-skip] does not materialize or invoke a provider when policy skips", async () => {
    const runner = { run: vi.fn() }
    const materializer = { materialize: vi.fn() }
    const service = new SuperResolutionPageService(runner, {
      decide: vi.fn(() => ({ kind: "skip", reason: "condition-skip" })),
    }, materializer)

    await expect(service.run({
      page: page({ entryPath: "page.png" }),
      destinationPath: "D:/output.png",
      trigger: "automatic-current",
    })).resolves.toEqual({ decision: { kind: "skip", reason: "condition-skip" } })
    expect(materializer.materialize).not.toHaveBeenCalled()
    expect(runner.run).not.toHaveBeenCalled()
  })

  it("[neoview.super-resolution.page-file-fast-path] sends filesystem pages directly to the shared runner", async () => {
    const runner = fakeRunner()
    const materializer = { materialize: vi.fn() }
    const service = new SuperResolutionPageService(runner, runPolicy(), materializer)

    const completed = await service.run({
      page: page(),
      destinationPath: "D:/output.png",
      trigger: "manual",
      priority: "interactive",
    })
    expect(completed.result).toMatchObject({ sourcePath: "D:/book/page.png", destinationPath: "D:/output.png" })
    expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({
      sourcePath: "D:/book/page.png",
      destinationPath: "D:/output.png",
      modelId: "realcugan",
      scale: 2,
      priority: "interactive",
    }), {})
    expect(materializer.materialize).not.toHaveBeenCalled()
  })

  it("[neoview.super-resolution.page-archive-materialize] leases archive content only for the provider call", async () => {
    const release = vi.fn(async () => undefined)
    const materializer = {
      materialize: vi.fn(async (): Promise<ReaderPageMaterializationLease> => ({
        path: "D:/temp/page.png",
        byteLength: 100,
        release,
        [Symbol.asyncDispose]: release,
      })),
    }
    const runner = fakeRunner()
    const service = new SuperResolutionPageService(runner, runPolicy(), materializer)
    const signal = new AbortController().signal

    await service.run({
      page: page({ sourcePath: "D:/book.cbz", entryPath: "chapter/page.png" }),
      destinationPath: "D:/output.png",
      trigger: "preload",
      maxMaterializationBytes: 64 * 1024 * 1024,
    }, { signal })
    expect(materializer.materialize).toHaveBeenCalledWith(expect.objectContaining({ entryPath: "chapter/page.png" }), {
      signal,
      maxBytes: 64 * 1024 * 1024,
    })
    expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({ sourcePath: "D:/temp/page.png" }), { signal })
    expect(release).toHaveBeenCalledOnce()
  })

  it("[neoview.super-resolution.page-unsupported-file-materialize] converts filesystem AVIF before invoking the native runner", async () => {
    const release = vi.fn(async () => undefined)
    const materializer = {
      materialize: vi.fn(async (): Promise<ReaderPageMaterializationLease> => ({
        path: "D:/temp/xr-native-input.png",
        byteLength: 100,
        release,
        [Symbol.asyncDispose]: release,
      })),
    }
    const runner = fakeRunner()
    const service = new SuperResolutionPageService(runner, runPolicy(), materializer)
    await service.run({
      page: page({ name: "page.avif", sourcePath: "D:/book/page.avif", mimeType: "image/avif" }),
      destinationPath: "D:/output.png",
      trigger: "manual",
    })
    expect(materializer.materialize).toHaveBeenCalledOnce()
    expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({ sourcePath: "D:/temp/xr-native-input.png" }), {})
    expect(release).toHaveBeenCalledOnce()
  })

  it("[neoview.super-resolution.page-release] releases materialized input after provider and cleanup failures", async () => {
    const providerError = new Error("provider failed")
    const release = vi.fn(async () => { throw new Error("cleanup failed") })
    const materializer = {
      materialize: vi.fn(async (): Promise<ReaderPageMaterializationLease> => ({
        path: "D:/temp/page.png",
        byteLength: 100,
        release,
        [Symbol.asyncDispose]: release,
      })),
    }
    const runner = { run: vi.fn(async () => { throw providerError }) }
    const service = new SuperResolutionPageService(runner, runPolicy(), materializer)
    await expect(service.run({
      page: page({ entryPath: "page.png" }),
      destinationPath: "D:/output.png",
      trigger: "manual",
    })).rejects.toBe(providerError)
    expect(release).toHaveBeenCalledOnce()
  })

  it("[neoview.super-resolution.page-validation] validates dimensions and archive materializer availability", async () => {
    const service = new SuperResolutionPageService(fakeRunner(), runPolicy())
    await expect(service.run({
      page: page({ dimensions: undefined }),
      destinationPath: "D:/output.png",
      trigger: "manual",
    })).rejects.toThrow("requires page dimensions")
    await expect(service.run({
      page: page({ entryPath: "page.png" }),
      destinationPath: "D:/output.png",
      trigger: "manual",
    })).rejects.toThrow("requires a page materializer")
  })
})

function runPolicy() {
  return {
    decide: vi.fn(() => ({
      kind: "run" as const,
      reason: "default-policy",
      modelId: "realcugan",
      scale: 2,
      useCache: true,
    })),
  }
}

function fakeRunner() {
  return {
    run: vi.fn(async (input: { sourcePath: string; destinationPath: string; modelId: string; scale: number }) => ({
      sourcePath: input.sourcePath,
      destinationPath: input.destinationPath,
      modelId: input.modelId,
      engine: "realcugan" as const,
      scale: input.scale,
      elapsedMs: 10,
    })),
  }
}

function page(overrides: Partial<ReaderPage> = {}): ReaderPage {
  return {
    id: "page-1",
    index: 0,
    name: "page.png",
    sourcePath: "D:/book/page.png",
    mediaKind: "image",
    dimensions: { width: 800, height: 1_200 },
    contentVersion: "v1",
    content: { load: vi.fn() },
    ...overrides,
  }
}
