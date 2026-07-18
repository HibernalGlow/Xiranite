import type { ResourceScheduler } from "../../../ports/ResourceScheduler.js"
import type { SuperResolutionModelManifest } from "../../../ports/SuperResolutionProvider.js"
import { SuperResolutionService } from "../../../application/super-resolution/SuperResolutionService.js"
import type { NeoviewSuperResolutionConfig } from "../../../application/config/ReaderRuntimeConfig.js"
import { LegacyNeoViewDataLocator } from "../../../application/data/LegacyNeoViewDataLocator.js"
import type { NeoviewRuntimeLoadOptions } from "../../config/loadNeoviewRuntimeConfig.js"
import { SystemSuperResolutionCliResolver } from "../SystemSuperResolutionCliResolver.js"
import {
  OpenComicAiSystemProvider,
  type OpenComicSystemCapabilityResolver,
  type OpenComicSystemRuntime,
} from "./OpenComicAiSystemProvider.js"

export interface OpenComicAiSystemCompositionOptions extends NeoviewRuntimeLoadOptions {
  loadRuntime?: () => Promise<OpenComicSystemRuntime>
  runtimeConfig?: NeoviewSuperResolutionConfig
  cliResolver?: OpenComicSystemCapabilityResolver
  resourceScheduler?: ResourceScheduler
  trustedCandidates?: Partial<Record<"upscayl" | "waifu2x" | "realcugan", readonly string[]>>
  modelsDirectory?: string
  resolveDefaultModelsDirectory?: () => string | Promise<string>
  ownerId?: string
}

export async function createOpenComicAiSystemService(
  options: OpenComicAiSystemCompositionOptions = {},
): Promise<SuperResolutionService | undefined> {
  const config = options.runtimeConfig ?? (await loadRuntimeConfig(options))
  if (config.provider === "disabled" || !options.loadRuntime) return undefined

  const runtime = await options.loadRuntime()
  const models = runtimeModels(runtime)
  if (!models.length) throw new Error("OpenComic system runtime did not expose any super-resolution models.")
  const modelsDirectory = options.modelsDirectory
    ?? config.modelsDirectory
    ?? await (options.resolveDefaultModelsDirectory?.() ?? defaultModelsDirectory())
  const cliResolver = options.cliResolver ?? new SystemSuperResolutionCliResolver({
    explicitPaths: {
      upscayl: config.upscaylPath,
      waifu2x: config.waifu2xPath,
      realcugan: config.realcuganPath,
    },
    trustedCandidates: options.trustedCandidates,
  })
  const provider = new OpenComicAiSystemProvider({
    loadRuntime: async () => runtime,
    cliResolver,
    modelsDirectory,
    maxDaemons: config.maxDaemonsPerGpu,
    daemonIdleTimeoutMs: config.daemonIdleTimeoutMs,
    taskTimeoutMs: config.taskTimeoutMs,
  })
  return new SuperResolutionService(provider, {
    scheduler: options.resourceScheduler,
    ownerId: options.ownerId ?? "neoview:super-resolution",
    models,
  })
}

export function runtimeModels(runtime: OpenComicSystemRuntime): readonly SuperResolutionModelManifest[] {
  const seen = new Set<string>()
  const models: SuperResolutionModelManifest[] = []
  for (const modelId of runtime.modelsList) {
    if (seen.has(modelId)) continue
    seen.add(modelId)
    const model = runtime.model(modelId)
    const scales = [...new Set(model.scales)].filter((scale) => Number.isFinite(scale) && scale > 0).sort((left, right) => left - right)
    if (!scales.length) continue
    models.push({
      id: modelId,
      displayName: model.name?.trim() || modelId,
      engine: model.upscaler,
      scales,
      modelFiles: model.files ? [...model.files] : undefined,
    })
  }
  return models
}

async function loadRuntimeConfig(options: NeoviewRuntimeLoadOptions): Promise<NeoviewSuperResolutionConfig> {
  const { loadNeoviewRuntimeConfig } = await import("../../config/loadNeoviewRuntimeConfig.js")
  return (await loadNeoviewRuntimeConfig(options)).superResolution
}

function defaultModelsDirectory(): string {
  return new LegacyNeoViewDataLocator().locate().modelsDirectory
}
