import { join } from "node:path"

import type { ResourceScheduler } from "../../../ports/ResourceScheduler.js"
import type { SuperResolutionCustomModelManifest, SuperResolutionModelManifest } from "../../../ports/SuperResolutionProvider.js"
import { SuperResolutionService } from "../../../application/super-resolution/SuperResolutionService.js"
import { SuperResolutionPolicyService } from "../../../application/super-resolution/SuperResolutionPolicyService.js"
import { SuperResolutionPageService } from "../../../application/super-resolution/SuperResolutionPageService.js"
import { SuperResolutionPreloadService } from "../../../application/super-resolution/SuperResolutionPreloadService.js"
import { SuperResolutionArtifactPageService } from "../../../application/super-resolution/SuperResolutionArtifactPageService.js"
import type { ReaderPageMaterializer } from "../../../ports/ReaderPageMaterializer.js"
import type { SuperResolutionArtifactStore } from "../../../ports/SuperResolutionArtifactStore.js"
import type { NeoviewSuperResolutionConfig } from "../../../application/config/ReaderRuntimeConfig.js"
import type { SuperResolutionPreferences } from "../../../domain/super-resolution/super-resolution-preferences.js"
import { LegacyNeoViewDataLocator } from "../../../application/data/LegacyNeoViewDataLocator.js"
import type { NeoviewRuntimeLoadOptions } from "../../config/loadNeoviewRuntimeConfig.js"
import { SystemSuperResolutionCliResolver } from "../SystemSuperResolutionCliResolver.js"
import { resolveManagedUpscaylExecutable } from "../ManagedSuperResolutionCliLocator.js"
import { aggregateModelSources, enrichModelManifests } from "../ModelSourceAggregator.js"
import { PlatformReaderPageMaterializer } from "../../content/PlatformReaderPageMaterializer.js"
import {
  OpenComicAiSystemProvider,
  type OpenComicSystemCapabilityResolver,
  type OpenComicSystemCustomModelManifest,
  type OpenComicSystemRuntime,
} from "./OpenComicAiSystemProvider.js"
import {
  loadOpenComicSystemRuntime,
  OpenComicSystemRuntimeUnavailableError,
} from "./OpenComicSystemRuntimeLoader.js"

export interface OpenComicAiSystemCompositionOptions extends NeoviewRuntimeLoadOptions {
  loadRuntime?: () => Promise<OpenComicSystemRuntime>
  runtimeConfig?: NeoviewSuperResolutionConfig
  cliResolver?: OpenComicSystemCapabilityResolver
  resourceScheduler?: ResourceScheduler
  trustedCandidates?: Partial<Record<"upscayl" | "waifu2x" | "realcugan", readonly string[]>>
  modelsDirectory?: string
  resolveDefaultModelsDirectory?: () => string | Promise<string>
  ownerId?: string
  pageMaterializer?: ReaderPageMaterializer
  artifactStore?: SuperResolutionArtifactStore
}

const registeredCustomModels = new WeakMap<object, Map<string, string>>()

export interface OpenComicAiSystemCapability {
  service: SuperResolutionService
  policy: SuperResolutionPolicyService
  pages: SuperResolutionPageService
  preload: SuperResolutionPreloadService
  artifactPages?: SuperResolutionArtifactPageService
  dispose(): Promise<void>
  [Symbol.asyncDispose](): Promise<void>
}

export async function createOpenComicAiSystemService(
  options: OpenComicAiSystemCompositionOptions = {},
): Promise<SuperResolutionService | undefined> {
  return (await createOpenComicAiSystemCapability(options))?.service
}

export async function createOpenComicAiSystemCapability(
  options: OpenComicAiSystemCompositionOptions = {},
): Promise<OpenComicAiSystemCapability | undefined> {
  const config = options.runtimeConfig ?? (await loadRuntimeConfig(options))
  if (config.provider === "disabled") return undefined

  let runtime: OpenComicSystemRuntime
  try {
    runtime = await (options.loadRuntime ?? loadOpenComicSystemRuntime)()
  } catch (error) {
    if (error instanceof OpenComicSystemRuntimeUnavailableError) return undefined
    throw error
  }
  const modelsDirectory = options.modelsDirectory
    ?? config.modelsDirectory
    ?? await (options.resolveDefaultModelsDirectory?.() ?? defaultModelsDirectory())
  const aggregation = await aggregateModelSources(modelsDirectory, config.modelSources ?? [])
  registerRuntimeCustomModels(runtime, config.customModels)
  const configuredIds = new Set(config.customModels.map((model) => model.id))
  registerRuntimeCustomModels(runtime, aggregation.customModels.filter((model) => !configuredIds.has(model.id)))
  const models = await enrichModelManifests(runtimeModels(runtime), modelsDirectory, aggregation.metadata)
  if (!models.length) throw new Error("OpenComic system runtime did not expose any super-resolution models.")
  const preferences = withRuntimeModelDefaults(config.preferences, models)
  const cliResolver = options.cliResolver ?? new SystemSuperResolutionCliResolver({
    explicitPaths: {
      upscayl: config.upscaylPath,
      waifu2x: config.waifu2xPath,
      realcugan: config.realcuganPath,
    },
    managedCandidates: { upscayl: [await resolveManagedUpscaylExecutable(options)] },
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
  const service = new SuperResolutionService(provider, {
      scheduler: options.resourceScheduler,
      ownerId: options.ownerId ?? "neoview:super-resolution",
      models,
    })
  const policy = new SuperResolutionPolicyService(preferences)
  const pages = new SuperResolutionPageService(
    service,
    policy,
    options.pageMaterializer ?? new PlatformReaderPageMaterializer({
      resourceScheduler: options.resourceScheduler,
      purpose: "super-resolution",
    }),
  )
  const artifactPages = options.artifactStore ? new SuperResolutionArtifactPageService(pages, options.artifactStore) : undefined
  const dispose = async () => {
    await preload.dispose()
    await service.dispose()
  }
  const preload = new SuperResolutionPreloadService(pages, preferences, artifactPages)
  return {
    service,
    policy,
    pages,
    preload,
    artifactPages,
    dispose,
    [Symbol.asyncDispose]: dispose,
  }
}

function withRuntimeModelDefaults(
  preferences: SuperResolutionPreferences,
  models: readonly SuperResolutionModelManifest[],
): SuperResolutionPreferences {
  if (preferences.defaultModelId && preferences.defaultScale !== undefined) return preferences
  const model = models.find((candidate) => candidate.id === preferences.defaultModelId)
    ?? models.find((candidate) => candidate.id === "realesr-animevideov3")
    ?? models[0]!
  return {
    ...preferences,
    defaultModelId: preferences.defaultModelId ?? model.id,
    defaultScale: preferences.defaultScale ?? (model.scales.includes(2) ? 2 : model.scales[0]!),
  }
}

export function registerRuntimeCustomModels(
  runtime: OpenComicSystemRuntime,
  manifests: readonly SuperResolutionCustomModelManifest[],
): void {
  if (!manifests.length) return
  const known = registeredCustomModels.get(runtime) ?? new Map<string, string>()
  const pending: OpenComicSystemCustomModelManifest[] = []
  const pendingSignatures = new Map<string, string>()
  for (const manifest of manifests) {
    const signature = customModelSignature(manifest)
    if (runtime.modelsList.includes(manifest.id)) {
      if (known.get(manifest.id) !== signature) throw new Error(`Custom super-resolution model collides with existing model: ${manifest.id}`)
      continue
    }
    pending.push({
      id: manifest.id,
      type: manifest.type,
      name: manifest.displayName,
      upscaler: manifest.engine,
      scales: [...manifest.scales],
      noise: manifest.noise ? [...manifest.noise] : undefined,
      latency: manifest.latency,
      folder: manifest.modelDirectory,
      files: [...manifest.modelFiles],
      scaleFiles: manifest.scaleFiles ? { ...manifest.scaleFiles } : undefined,
      license: manifest.license,
      checksums: { ...manifest.checksums },
      inputBlob: manifest.inputBlob,
      outputBlob: manifest.outputBlob,
      downloadBaseUrl: manifest.downloadBaseUrl,
    })
    pendingSignatures.set(manifest.id, signature)
  }
  if (!pending.length) return
  runtime.registerModels(pending)
  for (const [id, signature] of pendingSignatures) known.set(id, signature)
  registeredCustomModels.set(runtime, known)
}

function customModelSignature(manifest: SuperResolutionCustomModelManifest): string {
  return JSON.stringify({
    ...manifest,
    scales: [...manifest.scales],
    noise: manifest.noise ? [...manifest.noise] : undefined,
    modelFiles: [...manifest.modelFiles],
    scaleFiles: manifest.scaleFiles ? Object.entries(manifest.scaleFiles).sort(([left], [right]) => Number(left) - Number(right)) : undefined,
    checksums: Object.entries(manifest.checksums).sort(([left], [right]) => left.localeCompare(right)),
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
      modelType: model.type,
      modelDirectory: model.folder ? join(model.type ?? "upscale", model.folder) : undefined,
      noise: model.noise ? [...model.noise] : undefined,
      inputBlob: model.inputBlob,
      outputBlob: model.outputBlob,
      license: model.license,
      checksums: model.checksums ? { ...model.checksums } : undefined,
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
