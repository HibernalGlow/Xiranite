import { describe, expect, it, vi } from "vitest"

import type { NeoviewSuperResolutionConfig } from "../../../application/config/ReaderRuntimeConfig.js"
import type { SuperResolutionArtifactStore } from "../../../ports/SuperResolutionArtifactStore.js"
import type { OpenComicSystemModelInfo, OpenComicSystemRuntime } from "./OpenComicAiSystemProvider.js"
import {
  createOpenComicAiSystemCapability,
  createOpenComicAiSystemService,
  registerRuntimeCustomModels,
  runtimeModels,
} from "./OpenComicAiSystemComposition.js"
import { OpenComicSystemRuntimeUnavailableError } from "./OpenComicSystemRuntimeLoader.js"

const enabledConfig: NeoviewSuperResolutionConfig = {
  provider: "opencomic-system",
  upscaylPath: "D:/Tools/upscayl-bin.exe",
  maxDaemonsPerGpu: 1,
  daemonIdleTimeoutMs: 300_000,
  taskTimeoutMs: 600_000,
  customModels: [],
  preferences: {
    schemaVersion: 1,
    autoUpscaleEnabled: true,
    defaultModelId: "realesr-animevideov3",
    defaultScale: 2,
    conditions: [],
  },
}

const customModel = {
  id: "illustration-janai",
  type: "upscale" as const,
  displayName: "IllustrationJaNai",
  engine: "upscayl" as const,
  scales: [2],
  modelDirectory: "illustration-janai",
  modelFiles: ["model.param", "model.bin"],
  license: "MIT",
  checksums: { "model.param": "a".repeat(64), "model.bin": "b".repeat(64) },
  inputBlob: "in0",
  outputBlob: "out0",
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
    await expect(createOpenComicAiSystemService({
      runtimeConfig: enabledConfig,
      loadRuntime: async () => { throw new OpenComicSystemRuntimeUnavailableError("not installed") },
    })).resolves.toBeUndefined()
  })

  it("[neoview.super-resolution.composition] derives manifests from the runtime instead of duplicating its model table", async () => {
    const runtime = fakeRuntime()
    const service = await createOpenComicAiSystemService({
      loadRuntime: async () => runtime,
      runtimeConfig: enabledConfig,
      modelsDirectory: "D:/Models",
      cliResolver: fakeResolver(),
    })
    expect(service?.listModels()).toMatchObject([
      {
        id: "realesr-animevideov3",
        displayName: "AnimeVideoV3",
        engine: "upscayl",
        scales: [2, 4],
        modelFiles: ["model.param", "model.bin"],
        inputBlob: "in0",
        outputBlob: "out0",
        license: "MIT",
        checksums: { "model.param": "a".repeat(64), "model.bin": "b".repeat(64) },
      },
      {
        id: "realcugan-pro",
        displayName: "realcugan-pro",
        engine: "realcugan",
        scales: [2],
        modelFiles: undefined,
        inputBlob: undefined,
        outputBlob: undefined,
        license: undefined,
        checksums: undefined,
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
      inputBlob: undefined,
      outputBlob: undefined,
      license: undefined,
      checksums: undefined,
    }])
  })

  it("[neoview.super-resolution.preload-composition] shares the page workflow instead of creating another provider", async () => {
    const runtime = fakeRuntime()
    const artifactStore = fakeArtifactStore()
    const capability = await createOpenComicAiSystemCapability({
      runtimeConfig: enabledConfig,
      loadRuntime: async () => runtime,
      cliResolver: fakeResolver(),
      modelsDirectory: "D:/models",
      artifactStore,
    })
    expect(capability?.preload).toBeDefined()
    expect(capability?.artifactPages).toBeDefined()
    await capability?.dispose()
    expect(artifactStore.close).not.toHaveBeenCalled()
  })

  it("[neoview.super-resolution.policy-composition] composes policy and execution around one runtime config", async () => {
    const capability = await createOpenComicAiSystemCapability({
      loadRuntime: async () => fakeRuntime(),
      runtimeConfig: enabledConfig,
      modelsDirectory: "D:/Models",
      cliResolver: fakeResolver(),
    })
    expect(capability?.service.listModels().map((model) => model.id)).toContain("realesr-animevideov3")
    expect(capability?.policy.decide({
      trigger: "automatic-current",
      width: 800,
      height: 1_200,
      bookPath: "D:/book.cbz",
      imagePath: "page.png",
    })).toMatchObject({
      kind: "run",
      modelId: "realesr-animevideov3",
      scale: 2,
    })
    expect(capability?.pages).toBeDefined()
    await capability?.service.dispose()
  })

  it("[neoview.super-resolution.runtime-model-default] selects an installed default model when preferences omit one", async () => {
    const capability = await createOpenComicAiSystemCapability({
      loadRuntime: async () => fakeRuntime(),
      runtimeConfig: { ...enabledConfig, preferences: { ...enabledConfig.preferences, defaultModelId: undefined, defaultScale: undefined } },
      modelsDirectory: "D:/Models",
      cliResolver: fakeResolver(),
    })
    expect(capability?.policy.decide({
      trigger: "automatic-current",
      width: 800,
      height: 1_200,
      bookPath: "D:/book.cbz",
      imagePath: "page.png",
    })).toMatchObject({ kind: "run", modelId: "realesr-animevideov3", scale: 2 })
    await capability?.dispose()
  })

  it("[neoview.super-resolution.custom-model-registration] registers TOML manifests once per shared runtime", () => {
    const runtime = fakeRuntime()
    registerRuntimeCustomModels(runtime, [customModel])
    registerRuntimeCustomModels(runtime, [customModel])
    expect(runtime.registerModels).toHaveBeenCalledOnce()
    expect(runtime.registerModels).toHaveBeenCalledWith([{
      id: customModel.id,
      type: "upscale",
      name: customModel.displayName,
      upscaler: "upscayl",
      scales: [2],
      noise: undefined,
      latency: undefined,
      folder: customModel.modelDirectory,
      files: ["model.param", "model.bin"],
      scaleFiles: undefined,
      license: "MIT",
      checksums: customModel.checksums,
      inputBlob: "in0",
      outputBlob: "out0",
      downloadBaseUrl: undefined,
    }])
  })

  it("[neoview.super-resolution.custom-model-collision] rejects built-in or differently owned IDs", () => {
    const runtime = fakeRuntime()
    runtime.modelsList.push(customModel.id)
    expect(() => registerRuntimeCustomModels(runtime, [customModel])).toThrow("collides")
    expect(runtime.registerModels).not.toHaveBeenCalled()
  })
})

function fakeRuntime() {
  const records = new Map<string, OpenComicSystemModelInfo>([
    ["realesr-animevideov3", builtInModel("realesr-animevideov3")],
    ["realcugan-pro", builtInModel("realcugan-pro")],
  ])
  const runtime = {
    modelsList: ["realesr-animevideov3", "realcugan-pro"],
    model: vi.fn((id: string) => records.get(id) ?? { upscaler: "upscayl" as const, scales: [2] }),
    registerModels: vi.fn((manifests) => {
      for (const manifest of manifests) {
        runtime.modelsList.push(manifest.id)
        records.set(manifest.id, {
          name: manifest.name,
          upscaler: manifest.upscaler,
          scales: manifest.scales,
          files: manifest.files,
          inputBlob: manifest.inputBlob,
          outputBlob: manifest.outputBlob,
          license: manifest.license,
          checksums: manifest.checksums,
        })
      }
      return manifests.map((manifest) => records.get(manifest.id)!)
    }),
    unregisterModel: vi.fn(() => false),
    setBinaryResolver: vi.fn(),
    setModelsPath: vi.fn(),
    setConcurrentDaemons: vi.fn(),
    setDaemonIdleTimeout: vi.fn(),
    pipeline: vi.fn(async (_source: string, destination: string) => destination),
    closeAllProcesses: vi.fn(),
  } satisfies OpenComicSystemRuntime
  return runtime
}

function fakeArtifactStore(): SuperResolutionArtifactStore {
  return {
    acquire: vi.fn(async () => undefined),
    publish: vi.fn(async () => false),
    invalidate: vi.fn(async () => undefined),
    clearBook: vi.fn(async () => cleanupResult("book")),
    cleanup: vi.fn(async () => cleanupResult("explicit")),
    clear: vi.fn(async () => cleanupResult("explicit")),
    snapshot: vi.fn(async () => snapshot()),
    close: vi.fn(async () => undefined),
    [Symbol.asyncDispose]: vi.fn(async () => undefined),
  }
}

function cleanupResult(reason: "book" | "explicit") {
  return { ...snapshot(), reason, removedEntries: 0, removedBytes: 0 }
}

function snapshot() {
  return {
    entries: 0,
    bytes: 0,
    maxBytes: 1024,
    maxEntryBytes: 512,
    activeLeases: 0,
    hits: 0,
    misses: 0,
    writes: 0,
    rejectedWrites: 0,
    evictions: 0,
    integrityFailures: 0,
  }
}

function builtInModel(id: string) {
  return id === "realesr-animevideov3"
    ? {
        name: "AnimeVideoV3",
        upscaler: "upscayl" as const,
        scales: [4, 2, 2],
        files: ["model.param", "model.bin"],
        inputBlob: "in0",
        outputBlob: "out0",
        license: "MIT",
        checksums: { "model.param": "a".repeat(64), "model.bin": "b".repeat(64) },
      }
    : { upscaler: "realcugan" as const, scales: [2] }
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
