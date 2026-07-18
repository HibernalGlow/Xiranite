import { describe, expect, it, vi } from "vitest"

import type { SuperResolutionRequest } from "../../../ports/SuperResolutionProvider.js"
import {
  OpenComicAiSystemProvider,
  type OpenComicSystemRuntime,
} from "./OpenComicAiSystemProvider.js"

const request: SuperResolutionRequest = {
  sourcePath: "D:/books/input.png",
  destinationPath: "D:/cache/output.png",
  model: {
    id: "realesr-animevideov3",
    displayName: "AnimeVideoV3",
    engine: "upscayl",
    scales: [2],
  },
  scale: 2,
  tileSize: 200,
  tta: false,
  gpuId: "0",
}

describe("OpenComicAiSystemProvider", () => {
  it("[neoview.super-resolution.provider-lazy] probes capabilities without loading the runtime", async () => {
    const runtime = fakeRuntime()
    const loadRuntime = vi.fn(async () => runtime)
    const provider = createProvider({ runtime, loadRuntime })
    await expect(provider.capabilities()).resolves.toMatchObject({ engines: [{ engine: "upscayl", available: true }] })
    expect(loadRuntime).not.toHaveBeenCalled()
  })

  it("[neoview.super-resolution.provider-run] injects the resolved CLI and validates output dimensions", async () => {
    const runtime = fakeRuntime()
    const progress = vi.fn()
    const provider = createProvider({ runtime })
    await expect(provider.upscale(request, { onProgress: progress })).resolves.toEqual({
      sourcePath: request.sourcePath,
      destinationPath: request.destinationPath,
      modelId: request.model.id,
      engine: "upscayl",
      scale: 2,
      width: 960,
      height: 1276,
      elapsedMs: 25,
    })
    expect(runtime.setModelsPath).toHaveBeenCalledWith("D:/models")
    expect(runtime.setConcurrentDaemons).toHaveBeenCalledWith(1)
    expect(runtime.setDaemonIdleTimeout).toHaveBeenCalledWith(300_000)
    const resolver = runtime.setBinaryResolver.mock.calls[0]?.[0]
    expect(resolver?.({ upscaler: "upscayl", executableName: "upscayl-bin" })).toBe("D:/Tools/upscayl-bin.exe")
    expect(runtime.pipeline).toHaveBeenCalledWith(
      request.sourcePath,
      request.destinationPath,
      [{ model: request.model.id, scale: 2, noise: undefined, tileSize: 200, gpuId: "0", tta: false }],
      expect.any(Function),
      false,
    )
    runtime.pipeline.mock.calls[0]?.[3]?.(1.5)
    expect(progress).toHaveBeenCalledWith({ completed: 1 })
  })

  it("[neoview.super-resolution.provider-capability] fails before runtime load when the CLI is unavailable", async () => {
    const runtime = fakeRuntime()
    const loadRuntime = vi.fn(async () => runtime)
    const provider = createProvider({ runtime, loadRuntime, available: false })
    await expect(provider.upscale(request)).rejects.toThrow("Vulkan CLI missing")
    expect(loadRuntime).not.toHaveBeenCalled()
    expect(runtime.pipeline).not.toHaveBeenCalled()
  })

  it("[neoview.super-resolution.provider-output] rejects missing or incorrectly sized output", async () => {
    const runtime = fakeRuntime()
    const provider = createProvider({
      runtime,
      inspectImage: vi.fn(async (path: string) => path === request.sourcePath
        ? { bytes: 10, width: 480, height: 638 }
        : { bytes: 10, width: 959, height: 1276 }),
    })
    await expect(provider.upscale(request)).rejects.toThrow("do not match expected 960x1276")
  })

  it("[neoview.super-resolution.provider-abort] closes owned daemons when a task is cancelled", async () => {
    let finish!: (value: string) => void
    const runtime = fakeRuntime()
    runtime.pipeline.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve }))
    const provider = createProvider({ runtime })
    const controller = new AbortController()
    const task = provider.upscale(request, { signal: controller.signal })
    await vi.waitFor(() => expect(runtime.pipeline).toHaveBeenCalledOnce())
    controller.abort(new Error("cancelled"))
    await expect(task).rejects.toThrow("cancelled")
    expect(runtime.closeAllProcesses).toHaveBeenCalledOnce()
    finish(request.destinationPath)
  })

  it("[neoview.super-resolution.provider-dispose] releases resolver and daemon state", async () => {
    const runtime = fakeRuntime()
    const provider = createProvider({ runtime })
    await provider.upscale(request)
    await provider.dispose()
    expect(runtime.closeAllProcesses).toHaveBeenCalledOnce()
    expect(runtime.setBinaryResolver).toHaveBeenLastCalledWith()
    await expect(provider.upscale(request)).rejects.toThrow("disposed")
  })
})

function createProvider(options: {
  runtime: ReturnType<typeof fakeRuntime>
  loadRuntime?: () => Promise<OpenComicSystemRuntime>
  available?: boolean
  inspectImage?: (path: string) => Promise<{ bytes: number; width: number; height: number }>
}) {
  let now = 100
  return new OpenComicAiSystemProvider({
    loadRuntime: options.loadRuntime ?? (async () => options.runtime),
    cliResolver: {
      resolve: vi.fn(async () => options.available === false
        ? { engine: "upscayl", available: false, reason: "Vulkan CLI missing" }
        : { engine: "upscayl", available: true, executablePath: "D:/Tools/upscayl-bin.exe" }),
      capabilities: vi.fn(async () => ({
        engines: [{ engine: "upscayl", available: true, executablePath: "D:/Tools/upscayl-bin.exe" }],
        probedAt: 1,
      })),
    },
    modelsDirectory: "D:/models",
    inspectImage: options.inspectImage ?? (async (path) => path === request.sourcePath
      ? { bytes: 10, width: 480, height: 638 }
      : { bytes: 20, width: 960, height: 1276 }),
    now: () => {
      const value = now
      now += 25
      return value
    },
  })
}

function fakeRuntime() {
  return {
    modelsList: [request.model.id],
    model: vi.fn(() => ({ name: "AnimeVideoV3", upscaler: "upscayl", scales: [2] })),
    setBinaryResolver: vi.fn(),
    setModelsPath: vi.fn(),
    setConcurrentDaemons: vi.fn(),
    setDaemonIdleTimeout: vi.fn(),
    pipeline: vi.fn(async (_sourcePath: string, destinationPath: string) => destinationPath),
    closeAllProcesses: vi.fn(),
  } satisfies OpenComicSystemRuntime
}
