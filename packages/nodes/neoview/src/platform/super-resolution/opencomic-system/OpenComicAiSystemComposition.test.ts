import { describe, expect, it, vi } from "vitest"

import type { NeoviewSuperResolutionConfig } from "../../../application/config/ReaderRuntimeConfig.js"
import type { OpenComicSystemRuntime } from "./OpenComicAiSystemProvider.js"
import { createOpenComicAiSystemService, runtimeModels } from "./OpenComicAiSystemComposition.js"

const enabledConfig: NeoviewSuperResolutionConfig = {
  provider: "opencomic-system",
  upscaylPath: "D:/Tools/upscayl-bin.exe",
  maxDaemonsPerGpu: 1,
  daemonIdleTimeoutMs: 300_000,
  taskTimeoutMs: 600_000,
}

describe("OpenComic AI system composition", () => {
  it("[neoview.super-resolution.composition-disabled] does not load runtime when disabled", async () => {
    const loadRuntime = vi.fn(async () => fakeRuntime())
    await expect(createOpenComicAiSystemService({
      loadRuntime,
      runtimeConfig: { ...enabledConfig, provider: "disabled" },
    })).resolves.toBeUndefined()
    expect(loadRuntime).not.toHaveBeenCalled()
  })

  it("[neoview.super-resolution.composition-uninstalled] remains unavailable without a runtime loader", async () => {
    await expect(createOpenComicAiSystemService({ runtimeConfig: enabledConfig })).resolves.toBeUndefined()
  })

  it("[neoview.super-resolution.composition] derives manifests from the runtime instead of duplicating its model table", async () => {
    const runtime = fakeRuntime()
    const service = await createOpenComicAiSystemService({
      loadRuntime: async () => runtime,
      runtimeConfig: enabledConfig,
      modelsDirectory: "D:/Models",
      cliResolver: fakeResolver(),
    })
    expect(service?.listModels()).toEqual([
      {
        id: "realesr-animevideov3",
        displayName: "AnimeVideoV3",
        engine: "upscayl",
        scales: [2, 4],
        modelFiles: ["model.param", "model.bin"],
      },
      {
        id: "realcugan-pro",
        displayName: "realcugan-pro",
        engine: "realcugan",
        scales: [2],
        modelFiles: undefined,
      },
    ])
    expect(runtime.pipeline).not.toHaveBeenCalled()
  })

  it("[neoview.super-resolution.runtime-model-filter] deduplicates IDs and skips invalid scale declarations", () => {
    const runtime = fakeRuntime()
    runtime.modelsList = ["realesr-animevideov3", "realesr-animevideov3", "invalid"]
    runtime.model.mockImplementation((id: string) => id === "invalid"
      ? { upscaler: "waifu2x", scales: [0, Number.NaN] }
      : { upscaler: "upscayl", scales: [4, 2, 2] })
    expect(runtimeModels(runtime)).toEqual([{
      id: "realesr-animevideov3",
      displayName: "realesr-animevideov3",
      engine: "upscayl",
      scales: [2, 4],
      modelFiles: undefined,
    }])
  })
})

function fakeRuntime() {
  return {
    modelsList: ["realesr-animevideov3", "realcugan-pro"],
    model: vi.fn((id: string) => id === "realesr-animevideov3"
      ? { name: "AnimeVideoV3", upscaler: "upscayl", scales: [4, 2, 2], files: ["model.param", "model.bin"] }
      : { upscaler: "realcugan", scales: [2] }),
    setBinaryResolver: vi.fn(),
    setModelsPath: vi.fn(),
    setConcurrentDaemons: vi.fn(),
    setDaemonIdleTimeout: vi.fn(),
    pipeline: vi.fn(async (_source: string, destination: string) => destination),
    closeAllProcesses: vi.fn(),
  } satisfies OpenComicSystemRuntime
}

function fakeResolver() {
  return {
    resolve: vi.fn(async (engine: "upscayl" | "waifu2x" | "realcugan") => ({
      engine,
      available: true,
      executablePath: `D:/Tools/${engine}.exe`,
    })),
    capabilities: vi.fn(async () => ({ engines: [], probedAt: 1 })),
  }
}
