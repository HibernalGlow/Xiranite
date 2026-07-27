import type { SuperResolutionCustomModelManifest } from "../../ports/SuperResolutionProvider.js"
import { parseSuperResolutionPreferences, type SuperResolutionPreferences } from "../../domain/super-resolution/super-resolution-preferences.js"
import * as Models from "./ReaderRuntimeConfigModels.js"
import { boundedNumber, boundedInteger, boundedIntegerWithFallback, optionalConfigPath, requiredManifestIdentifier, requiredManifestText, requiredManifestPath, requiredManifestPaths, requiredManifestScales, requiredManifestNoise, requiredManifestScaleFiles, requiredManifestEngine, optionalHttpsUrl, requiredStringRecord, optionalBoolean, optionalEnum, optionalRecord, requireRecord } from "./ReaderRuntimeConfigParserPrimitives.js"

export function parseSuperResolutionConfig(value: Record<string, unknown> | undefined): Models.NeoviewSuperResolutionConfig {
  if (!value) return Models.DEFAULT_NEOVIEW_SUPER_RESOLUTION_CONFIG
  const artifactCache = optionalRecord(value.artifact_cache, "[nodes.neoview.super_resolution.artifact_cache]")
  return {
    provider:
      optionalEnum(value.provider, "[nodes.neoview.super_resolution].provider", ["opencomic-system", "disabled"] as const) ??
      Models.DEFAULT_NEOVIEW_SUPER_RESOLUTION_CONFIG.provider,
    upscaylPath: optionalConfigPath(value.upscayl_path, "[nodes.neoview.super_resolution].upscayl_path"),
    waifu2xPath: optionalConfigPath(value.waifu2x_path, "[nodes.neoview.super_resolution].waifu2x_path"),
    realcuganPath: optionalConfigPath(value.realcugan_path, "[nodes.neoview.super_resolution].realcugan_path"),
    modelsDirectory: optionalConfigPath(value.models_directory, "[nodes.neoview.super_resolution].models_directory"),
    modelSources: parseSuperResolutionModelSources(value.model_sources, "[nodes.neoview.super_resolution].model_sources"),
    maxDaemonsPerGpu: boundedIntegerWithFallback(
      value.max_daemons_per_gpu,
      0,
      8,
      Models.DEFAULT_NEOVIEW_SUPER_RESOLUTION_CONFIG.maxDaemonsPerGpu,
      "[nodes.neoview.super_resolution].max_daemons_per_gpu",
    ),
    daemonIdleTimeoutMs: boundedIntegerWithFallback(
      value.daemon_idle_timeout_ms,
      1_000,
      3_600_000,
      Models.DEFAULT_NEOVIEW_SUPER_RESOLUTION_CONFIG.daemonIdleTimeoutMs,
      "[nodes.neoview.super_resolution].daemon_idle_timeout_ms",
    ),
    taskTimeoutMs: boundedIntegerWithFallback(
      value.task_timeout_ms,
      1_000,
      24 * 60 * 60_000,
      Models.DEFAULT_NEOVIEW_SUPER_RESOLUTION_CONFIG.taskTimeoutMs,
      "[nodes.neoview.super_resolution].task_timeout_ms",
    ),
    artifactCache: {
      directory: optionalConfigPath(artifactCache?.directory, "[nodes.neoview.super_resolution.artifact_cache].directory"),
      retentionDays: boundedIntegerWithFallback(
        artifactCache?.retention_days,
        1,
        3_650,
        Models.DEFAULT_NEOVIEW_SUPER_RESOLUTION_CONFIG.artifactCache.retentionDays,
        "[nodes.neoview.super_resolution.artifact_cache].retention_days",
      ),
      cleanupIntervalMinutes: boundedIntegerWithFallback(
        artifactCache?.cleanup_interval_minutes,
        1,
        10_080,
        Models.DEFAULT_NEOVIEW_SUPER_RESOLUTION_CONFIG.artifactCache.cleanupIntervalMinutes,
        "[nodes.neoview.super_resolution.artifact_cache].cleanup_interval_minutes",
      ),
    },
    customModels: parseSuperResolutionCustomModels(value.custom_models),
    preferences: parseSuperResolutionPreferences(value.preferences),
  }
}
export function parseSuperResolutionModelSources(value: unknown, path: string): readonly string[] {
  if (value === undefined) return Models.DEFAULT_NEOVIEW_SUPER_RESOLUTION_CONFIG.modelSources
  if (!Array.isArray(value) || value.length > 32) throw new Error(`${path} must be an array of at most 32 paths.`)
  const sources = value.map((entry, index) => {
    const source = optionalConfigPath(entry, `${path}[${index}]`)
    if (!source) throw new Error(`${path}[${index}] must not be empty.`)
    return source
  })
  return Object.freeze([...new Set(sources)])
}
export function parseSuperResolutionCustomModels(value: unknown): readonly SuperResolutionCustomModelManifest[] {
  if (value === undefined) return Models.DEFAULT_NEOVIEW_SUPER_RESOLUTION_CONFIG.customModels
  if (!Array.isArray(value) || value.length > 64) {
    throw new Error("[nodes.neoview.super_resolution].custom_models must be an array of at most 64 tables.")
  }
  const ids = new Set<string>()
  return value.map((entry, index) => {
    const path = `[nodes.neoview.super_resolution].custom_models[${index}]`
    const model = requireRecord(entry, path)
    const id = requiredManifestIdentifier(model.id, `${path}.id`)
    if (ids.has(id)) throw new Error(`${path}.id duplicates custom model ${id}.`)
    ids.add(id)
    const files = requiredManifestPaths(model.files, `${path}.files`)
    const checksums = requiredStringRecord(model.checksums, `${path}.checksums`)
    if (Object.keys(checksums).some((file) => !files.includes(file))) throw new Error(`${path}.checksums contains an unknown model file.`)
    for (const file of files) {
      if (!/^[a-f0-9]{64}$/iu.test(checksums[file] ?? "")) throw new Error(`${path}.checksums must contain SHA-256 for ${file}.`)
    }
    const scales = requiredManifestScales(model.scales, `${path}.scales`)
    const scaleFiles = model.scale_files === undefined ? undefined : requiredManifestScaleFiles(model.scale_files, scales, `${path}.scale_files`)
    const downloadBaseUrl = optionalHttpsUrl(model.download_base_url, `${path}.download_base_url`)
    return {
      id,
      type: optionalEnum(model.type, `${path}.type`, ["upscale", "descreen", "artifact-removal"] as const) ?? "upscale",
      displayName: requiredManifestText(model.name, `${path}.name`),
      engine: requiredManifestEngine(model.engine, `${path}.engine`),
      scales,
      noise: model.noise === undefined ? undefined : requiredManifestNoise(model.noise, `${path}.noise`),
      latency: model.latency === undefined ? undefined : boundedNumber(model.latency, 0, 3600, 1, `${path}.latency`),
      modelDirectory: requiredManifestPath(model.directory, `${path}.directory`),
      modelFiles: files,
      scaleFiles,
      license: requiredManifestText(model.license, `${path}.license`),
      checksums: Object.fromEntries(Object.entries(checksums).map(([file, checksum]) => [file, checksum.toLowerCase()])),
      inputBlob: requiredManifestIdentifier(model.input_blob, `${path}.input_blob`),
      outputBlob: requiredManifestIdentifier(model.output_blob, `${path}.output_blob`),
      downloadBaseUrl,
    }
  })
}
export function parseNeoviewSuperResolutionPreferencesPatch(value: unknown): {
  patch: { superResolution: Models.NeoviewSuperResolutionPatch }
  tomlPatch: Record<string, unknown>
} {
  const record = requireRecord(value, "reader super-resolution patch")
  if (Object.keys(record).some((key) => key !== "superResolution")) {
    throw new Error("reader super-resolution patch contains unsupported fields.")
  }
  const root = requireRecord(record.superResolution, "reader super-resolution patch.superResolution")
  if (Object.keys(root).some((key) => key !== "preferences" && key !== "modelsDirectory" && key !== "modelSources" && key !== "artifactCache")) {
    throw new Error("reader super-resolution patch.superResolution contains unsupported fields.")
  }
  const rootPatch: Models.NeoviewSuperResolutionPatch = {}
  const rootToml: Record<string, unknown> = {}
  if (root.modelsDirectory !== undefined) {
    const modelsDirectory = optionalConfigPath(root.modelsDirectory, "reader super-resolution patch.superResolution.modelsDirectory")
    if (!modelsDirectory) throw new Error("reader super-resolution patch.superResolution.modelsDirectory must not be empty.")
    rootPatch.modelsDirectory = modelsDirectory
    rootToml.models_directory = modelsDirectory
  }
  if (root.modelSources !== undefined) {
    const modelSources = parseSuperResolutionModelSources(root.modelSources, "reader super-resolution patch.superResolution.modelSources")
    rootPatch.modelSources = modelSources
    rootToml.model_sources = modelSources
  }
  if (root.artifactCache !== undefined) {
    const cache = requireRecord(root.artifactCache, "reader super-resolution patch.superResolution.artifactCache")
    const unknown = Object.keys(cache).filter((key) => key !== "directory" && key !== "retentionDays" && key !== "cleanupIntervalMinutes")
    if (unknown.length) throw new Error(`reader super-resolution artifact cache patch contains unsupported fields: ${unknown.join(", ")}.`)
    const cachePatch: Partial<Models.NeoviewSuperResolutionArtifactCacheConfig> = {}
    const cacheToml: Record<string, unknown> = {}
    if (cache.directory !== undefined) {
      const directory = optionalConfigPath(cache.directory, "reader super-resolution patch.superResolution.artifactCache.directory")
      cachePatch.directory = directory
      cacheToml.directory = directory ?? null
    }
    if (cache.retentionDays !== undefined) {
      cachePatch.retentionDays = boundedInteger(cache.retentionDays, 1, 3_650, "reader super-resolution patch.superResolution.artifactCache.retentionDays")
      cacheToml.retention_days = cachePatch.retentionDays
    }
    if (cache.cleanupIntervalMinutes !== undefined) {
      cachePatch.cleanupIntervalMinutes = boundedInteger(
        cache.cleanupIntervalMinutes,
        1,
        10_080,
        "reader super-resolution patch.superResolution.artifactCache.cleanupIntervalMinutes",
      )
      cacheToml.cleanup_interval_minutes = cachePatch.cleanupIntervalMinutes
    }
    if (!Object.keys(cacheToml).length) throw new Error("reader super-resolution artifact cache patch must change at least one field.")
    rootPatch.artifactCache = cachePatch
    rootToml.artifact_cache = cacheToml
  }
  if (root.preferences === undefined) {
    if (!Object.keys(rootPatch).length) throw new Error("reader super-resolution patch must change at least one field.")
    return {
      patch: { superResolution: rootPatch },
      tomlPatch: { super_resolution: rootToml },
    }
  }
  const preferences = requireRecord(root.preferences, "reader super-resolution patch.superResolution.preferences")
  const allowed = new Set([
    "autoUpscaleEnabled",
    "preUpscaleEnabled",
    "globalUpscaleEnabled",
    "currentImageUpscaleEnabled",
    "preloadPages",
    "backgroundConcurrency",
    "showPanelPreview",
    "defaultModelId",
    "defaultScale",
    "defaultTileSize",
    "defaultTileEnabled",
    "defaultNoise",
    "defaultGpuId",
    "defaultTta",
    "progressiveEnabled",
    "progressiveDwellTimeMs",
    "progressiveMaxPages",
    "conditionalEnabled",
    "conditionalMinWidth",
    "conditionalMinHeight",
    "conditions",
  ])
  if (Object.keys(preferences).some((key) => !allowed.has(key))) {
    throw new Error("reader super-resolution preferences patch contains unsupported fields.")
  }
  const patch: Models.NeoviewSuperResolutionPreferencesPatch = {}
  const toml: Record<string, unknown> = { schema_version: 1 }
  const booleanFields = [
    ["autoUpscaleEnabled", "auto_upscale_enabled"],
    ["preUpscaleEnabled", "pre_upscale_enabled"],
    ["globalUpscaleEnabled", "global_upscale_enabled"],
    ["currentImageUpscaleEnabled", "current_image_upscale_enabled"],
    ["showPanelPreview", "show_panel_preview"],
    ["defaultTileEnabled", "default_tile_enabled"],
    ["defaultTta", "default_tta"],
    ["progressiveEnabled", "progressive_enabled"],
    ["conditionalEnabled", "conditional_enabled"],
  ] as const
  for (const [field, tomlField] of booleanFields) {
    if (preferences[field] !== undefined) {
      const parsed = optionalBoolean(preferences[field], `reader super-resolution preferences.${field}`)
      if (parsed === undefined) throw new Error(`reader super-resolution preferences.${field} must be a boolean.`)
      patch[field] = parsed
      toml[tomlField] = parsed
    }
  }
  const integerFields = [
    ["preloadPages", "preload_pages", 0, 1_000],
    ["backgroundConcurrency", "background_concurrency", 1, 32],
    ["defaultScale", "default_scale", 1, 32],
    ["defaultTileSize", "default_tile_size", 1, 65_536],
    ["defaultNoise", "default_noise", -1, 3],
    ["progressiveDwellTimeMs", "progressive_dwell_time_ms", 0, 3_600_000],
    ["progressiveMaxPages", "progressive_max_pages", 0, 10_000],
  ] as const
  for (const [field, tomlField, min, max] of integerFields) {
    if (preferences[field] !== undefined) {
      const parsed = boundedInteger(preferences[field], min, max, `reader super-resolution preferences.${field}`)
      patch[field] = parsed
      toml[tomlField] = parsed
    }
  }
  const directFields = [
    ["defaultModelId", "default_model_id"],
    ["defaultGpuId", "default_gpu_id"],
    ["conditionalMinWidth", "conditional_min_width"],
    ["conditionalMinHeight", "conditional_min_height"],
  ] as const
  for (const [field, tomlField] of directFields) {
    if (preferences[field] !== undefined) toml[tomlField] = preferences[field]
  }
  if (preferences.conditions !== undefined) {
    toml.conditions = superResolutionConditionsToml(preferences.conditions)
  }
  let parsed: SuperResolutionPreferences
  try {
    parsed = parseSuperResolutionPreferences(toml)
  } catch (error) {
    throw new Error(`reader super-resolution preferences patch is invalid: ${error instanceof Error ? error.message : String(error)}`)
  }
  for (const [field] of directFields) {
    if (preferences[field] !== undefined) Object.assign(patch, { [field]: parsed[field] })
  }
  if (preferences.conditions !== undefined) patch.conditions = parsed.conditions
  if (!Object.keys(patch).length) throw new Error("reader super-resolution preferences patch must change at least one field.")
  rootPatch.preferences = patch
  rootToml.preferences = toml
  return {
    patch: { superResolution: rootPatch },
    tomlPatch: { super_resolution: rootToml },
  }
}
export function superResolutionConditionsToml(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("reader super-resolution preferences.conditions must be an array.")
  return value.map((condition, index) => {
    const path = `reader super-resolution preferences.conditions[${index}]`
    const root = remapSuperResolutionFields(condition, path, {
      id: "id",
      name: "name",
      enabled: "enabled",
      priority: "priority",
      match: "match",
      action: "action",
    })
    root.match = remapSuperResolutionFields(root.match, `${path}.match`, {
      minWidth: "min_width",
      minHeight: "min_height",
      maxWidth: "max_width",
      maxHeight: "max_height",
      minMegapixels: "min_megapixels",
      maxMegapixels: "max_megapixels",
      dimensionMode: "dimension_mode",
      createdBetween: "created_between",
      modifiedBetween: "modified_between",
      bookPathRegex: "book_path_regex",
      imagePathRegex: "image_path_regex",
      matchInnerPath: "match_inner_path",
      excludeFromPreload: "exclude_from_preload",
      metadata: "metadata",
    })
    root.action = remapSuperResolutionFields(root.action, `${path}.action`, {
      skip: "skip",
      modelId: "model_id",
      scale: "scale",
      tileSize: "tile_size",
      tileEnabled: "tile_enabled",
      noise: "noise",
      gpuId: "gpu_id",
      useCache: "use_cache",
      tta: "tta",
    })
    return root
  })
}
export function remapSuperResolutionFields(value: unknown, path: string, fields: Readonly<Record<string, string>>): Record<string, unknown> {
  const record = requireRecord(value, path)
  const unsupported = Object.keys(record).find((key) => fields[key] === undefined)
  if (unsupported) throw new Error(`${path} contains unsupported field: ${unsupported}`)
  return Object.fromEntries(Object.entries(record).map(([key, fieldValue]) => [fields[key]!, fieldValue]))
}
