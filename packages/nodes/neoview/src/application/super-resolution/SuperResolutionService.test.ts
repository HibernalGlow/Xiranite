import { describe, expect, it, vi } from "vitest"

import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"
import type { SuperResolutionProvider } from "../../ports/SuperResolutionProvider.js"
import {
  SuperResolutionOutputBusyError,
  SuperResolutionService,
} from "./SuperResolutionService.js"

const model = {
  id: "illustration-janai-2x",
  displayName: "IllustrationJaNai 2x",
  engine: "upscayl" as const,
  scales: [2],
}

describe("SuperResolutionService", () => {
  it("[neoview.super-resolution.lazy] remains process-free until capabilities or run is requested", async () => {
    const provider = fakeProvider()
    const service = new SuperResolutionService(provider, { models: [model] })
    expect(service.listModels()).toEqual([model])
    expect(provider.capabilities).not.toHaveBeenCalled()
    expect(provider.upscale).not.toHaveBeenCalled()
    await service.dispose()
  })

  it("[neoview.super-resolution.capability-cache] shares capability probes and allows explicit refresh", async () => {
    const provider = fakeProvider()
    const service = new SuperResolutionService(provider)
    await Promise.all([service.capabilities(), service.capabilities()])
    expect(provider.capabilities).toHaveBeenCalledOnce()
    await service.capabilities({ refresh: true })
    expect(provider.capabilities).toHaveBeenCalledTimes(2)
  })

  it("[neoview.super-resolution.gpu-lease] runs through the host GPU scheduler and always releases", async () => {
    const release = vi.fn()
    const scheduler: ResourceScheduler = { acquire: vi.fn(async () => ({ release })) }
    const provider = fakeProvider()
    const service = new SuperResolutionService(provider, { models: [model], scheduler, ownerId: "reader:test" })
    await expect(service.run({ sourcePath: "in.png", destinationPath: "out.png", modelId: model.id, scale: 2 })).resolves.toMatchObject({ modelId: model.id })
    expect(scheduler.acquire).toHaveBeenCalledWith({
      resource: "gpu",
      kind: "neoview.super-resolution.upscayl",
      priority: "view",
      ownerId: "reader:test",
    }, undefined)
    expect(release).toHaveBeenCalledOnce()
  })

  it("[neoview.super-resolution.output-lock] rejects concurrent writes to the same output", async () => {
    let resolveRun!: () => void
    const provider = fakeProvider()
    provider.upscale.mockImplementation(async (request) => {
      await new Promise<void>((resolve) => { resolveRun = resolve })
      return resultFor(request)
    })
    const service = new SuperResolutionService(provider, { models: [model] })
    const first = service.run({ sourcePath: "one.png", destinationPath: "same.png", modelId: model.id, scale: 2 })
    await vi.waitFor(() => expect(provider.upscale).toHaveBeenCalledOnce())
    await expect(service.run({ sourcePath: "two.png", destinationPath: "same.png", modelId: model.id, scale: 2 })).rejects.toBeInstanceOf(SuperResolutionOutputBusyError)
    resolveRun()
    await first
  })

  it("[neoview.super-resolution.validation] rejects unsupported models and scales before acquiring resources", async () => {
    const scheduler: ResourceScheduler = { acquire: vi.fn() }
    const provider = fakeProvider()
    const service = new SuperResolutionService(provider, { models: [model], scheduler })
    await expect(service.run({ sourcePath: "in", destinationPath: "out", modelId: "missing", scale: 2 })).rejects.toThrow("not registered")
    await expect(service.run({ sourcePath: "in", destinationPath: "out", modelId: model.id, scale: 4 })).rejects.toThrow("does not support")
    expect(scheduler.acquire).not.toHaveBeenCalled()
    expect(provider.upscale).not.toHaveBeenCalled()
  })

  it("[neoview.super-resolution.abort] does not acquire or start work for an aborted request", async () => {
    const scheduler: ResourceScheduler = { acquire: vi.fn() }
    const provider = fakeProvider()
    const service = new SuperResolutionService(provider, { models: [model], scheduler })
    const controller = new AbortController()
    controller.abort(new Error("cancelled"))
    await expect(service.run({ sourcePath: "in", destinationPath: "out", modelId: model.id, scale: 2 }, { signal: controller.signal })).rejects.toThrow("cancelled")
    expect(scheduler.acquire).not.toHaveBeenCalled()
    expect(provider.upscale).not.toHaveBeenCalled()
  })

  it("[neoview.super-resolution.acquire-failure] releases the output lock when scheduler admission fails", async () => {
    const scheduler: ResourceScheduler = { acquire: vi.fn(async () => { throw new Error("GPU busy") }) }
    const provider = fakeProvider()
    const service = new SuperResolutionService(provider, { models: [model], scheduler })
    const input = { sourcePath: "in", destinationPath: "out", modelId: model.id, scale: 2 }
    await expect(service.run(input)).rejects.toThrow("GPU busy")
    await expect(service.run(input)).rejects.toThrow("GPU busy")
    expect(scheduler.acquire).toHaveBeenCalledTimes(2)
  })

  it("[neoview.super-resolution.no-overwrite] rejects in-place output before provider execution", async () => {
    const provider = fakeProvider()
    const service = new SuperResolutionService(provider, { models: [model] })
    await expect(service.run({ sourcePath: "same.png", destinationPath: "same.png", modelId: model.id, scale: 2 })).rejects.toThrow("must be different")
    expect(provider.upscale).not.toHaveBeenCalled()
  })
})

function fakeProvider() {
  return {
    capabilities: vi.fn(async () => ({ engines: [], probedAt: 1 })),
    upscale: vi.fn(async (request) => resultFor(request)),
    dispose: vi.fn(),
  } satisfies SuperResolutionProvider
}

function resultFor(request: Parameters<SuperResolutionProvider["upscale"]>[0]) {
  return {
    sourcePath: request.sourcePath,
    destinationPath: request.destinationPath,
    modelId: request.model.id,
    engine: request.model.engine,
    scale: request.scale,
    elapsedMs: 1,
  }
}
