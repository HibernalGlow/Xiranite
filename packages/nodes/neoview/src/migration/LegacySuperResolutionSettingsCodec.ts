import { z } from "zod"

import {
  SuperResolutionPreferencesWireSchema,
  type SuperResolutionPreferencesWire,
} from "../domain/super-resolution/super-resolution-preferences.js"

export type LegacySuperResolutionDisposition = "converted" | "invalid" | "unknown" | "host-replaced"

export interface LegacySuperResolutionReportEntry {
  sourcePath: string
  targetPath?: string
  disposition: LegacySuperResolutionDisposition
  message?: string
}

export interface DecodedLegacySuperResolutionSettings {
  preferencesPatch: SuperResolutionPreferencesWire
  entries: readonly LegacySuperResolutionReportEntry[]
}

const legacyExpressionSchema = z.object({
  operator: z.enum(["eq", "ne", "gt", "gte", "lt", "lte", "regex", "contains"]),
  value: z.union([z.string().max(4_096), z.number().finite()]),
}).passthrough()

const legacyMatchSchema = z.object({
  minWidth: z.number().finite().nonnegative().optional(),
  minHeight: z.number().finite().nonnegative().optional(),
  maxWidth: z.number().finite().nonnegative().optional(),
  maxHeight: z.number().finite().nonnegative().optional(),
  minPixels: z.number().finite().nonnegative().optional(),
  maxPixels: z.number().finite().nonnegative().optional(),
  dimensionMode: z.enum(["and", "or"]).optional(),
  createdBetween: z.tuple([z.number().finite().nonnegative(), z.number().finite().nonnegative()]).optional(),
  modifiedBetween: z.tuple([z.number().finite().nonnegative(), z.number().finite().nonnegative()]).optional(),
  regexBookPath: z.string().max(4_096).optional(),
  regexImagePath: z.string().max(4_096).optional(),
  matchInnerPath: z.boolean().optional(),
  excludeFromPreload: z.boolean().optional(),
  metadata: z.record(z.string(), legacyExpressionSchema).optional(),
}).passthrough()

const legacyActionSchema = z.object({
  model: z.string().trim().min(1).max(256).optional(),
  modelName: z.string().trim().min(1).max(256).optional(),
  scale: z.number().int().min(1).max(32).optional(),
  tileSize: z.number().int().nonnegative().max(65_536).optional(),
  tileEnabled: z.boolean().optional(),
  noiseLevel: z.number().int().min(-1).max(3).optional(),
  gpuId: z.union([z.number().int().nonnegative(), z.string().trim().min(1).max(128)]).optional(),
  useCache: z.boolean().optional(),
  skip: z.boolean().optional(),
  tta: z.boolean().optional(),
}).passthrough()

const legacyConditionSchema = z.object({
  id: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(256),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).max(10_000),
  match: legacyMatchSchema.default({}),
  action: legacyActionSchema,
}).passthrough()

const PANEL_FIELDS = new Set([
  "autoUpscaleEnabled",
  "preUpscaleEnabled",
  "globalUpscaleEnabled",
  "currentImageUpscaleEnabled",
  "preloadPages",
  "backgroundConcurrency",
  "showPanelPreview",
  "conditionalUpscaleEnabled",
  "conditionalMinWidth",
  "conditionalMinHeight",
  "conditionsList",
  "conditions",
  "selectedModel",
  "scale",
  "tileSize",
  "tileEnabled",
  "noiseLevel",
  "gpuId",
  "mangaJanaiModelDir",
  "progressiveUpscaleEnabled",
  "progressiveDwellTime",
  "progressiveMaxPages",
])
const CONDITION_FIELDS = new Set(["id", "name", "enabled", "priority", "match", "action"])
const CONDITION_MATCH_FIELDS = new Set([
  "minWidth", "minHeight", "maxWidth", "maxHeight", "minPixels", "maxPixels", "dimensionMode",
  "createdBetween", "modifiedBetween", "regexBookPath", "regexImagePath", "matchInnerPath",
  "excludeFromPreload", "metadata",
])
const CONDITION_ACTION_FIELDS = new Set([
  "model", "modelName", "scale", "tileSize", "tileEnabled", "noiseLevel", "gpuId", "useCache", "skip", "tta",
])

const RUNTIME_MODEL_IDS = new Set([
  "realcugan",
  "realesr-animevideov3",
  "realesrgan-x4plus",
  "realesrgan-x4plus-anime",
  "waifu2x-models-cunet",
])

interface MappedModel {
  id: string
  scale?: number
  noise?: number
  tta?: boolean
}

export class LegacySuperResolutionSettingsCodec {
  readonly version = 1 as const

  decodeNativeImage(value: unknown, sourcePath: string): DecodedLegacySuperResolutionSettings {
    const entries: LegacySuperResolutionReportEntry[] = []
    const patch: Record<string, unknown> = { schema_version: 1 }
    if (!isRecord(value)) return invalidResult(sourcePath, "Expected an image settings object.")

    mapBoolean(value.enableSuperResolution, "current_image_upscale_enabled", `${sourcePath}.enableSuperResolution`, patch, entries)
    mapBoolean(value.currentImageUpscaleEnabled, "current_image_upscale_enabled", `${sourcePath}.currentImageUpscaleEnabled`, patch, entries)
    if (value.superResolutionModel !== undefined) {
      mapDefaultModel(value.superResolutionModel, `${sourcePath}.superResolutionModel`, patch, entries)
    }
    return result(patch, entries)
  }

  decodePanel(value: unknown, sourcePath: string): DecodedLegacySuperResolutionSettings {
    if (!isRecord(value)) return invalidResult(sourcePath, "Expected an upscale settings object.")
    const entries: LegacySuperResolutionReportEntry[] = []
    const patch: Record<string, unknown> = { schema_version: 1 }

    mapBooleanField(value, "autoUpscaleEnabled", "auto_upscale_enabled", sourcePath, patch, entries)
    mapBooleanField(value, "preUpscaleEnabled", "pre_upscale_enabled", sourcePath, patch, entries)
    mapBooleanField(value, "globalUpscaleEnabled", "global_upscale_enabled", sourcePath, patch, entries)
    mapBooleanField(value, "currentImageUpscaleEnabled", "current_image_upscale_enabled", sourcePath, patch, entries)
    mapBooleanField(value, "showPanelPreview", "show_panel_preview", sourcePath, patch, entries)
    mapBooleanField(value, "conditionalUpscaleEnabled", "conditional_enabled", sourcePath, patch, entries)
    mapBooleanField(value, "tileEnabled", "default_tile_enabled", sourcePath, patch, entries)
    mapBooleanField(value, "progressiveUpscaleEnabled", "progressive_enabled", sourcePath, patch, entries)

    mapIntegerField(value, "preloadPages", "preload_pages", 0, 1_000, sourcePath, patch, entries)
    mapIntegerField(value, "backgroundConcurrency", "background_concurrency", 1, 32, sourcePath, patch, entries)
    mapNumberField(value, "conditionalMinWidth", "conditional_min_width", 0, Number.MAX_SAFE_INTEGER, sourcePath, patch, entries)
    mapNumberField(value, "conditionalMinHeight", "conditional_min_height", 0, Number.MAX_SAFE_INTEGER, sourcePath, patch, entries)
    mapIntegerField(value, "scale", "default_scale", 1, 32, sourcePath, patch, entries)
    if (value.tileSize === 0) {
      entries.push({
        sourcePath: `${sourcePath}.tileSize`,
        disposition: "converted",
        message: "Legacy tile size 0 means automatic/no explicit tile size and is omitted.",
      })
    } else {
      mapIntegerField(value, "tileSize", "default_tile_size", 1, 65_536, sourcePath, patch, entries)
    }
    mapIntegerField(value, "noiseLevel", "default_noise", -1, 3, sourcePath, patch, entries)
    mapProgressiveDwellTime(value.progressiveDwellTime, `${sourcePath}.progressiveDwellTime`, patch, entries)
    mapIntegerField(value, "progressiveMaxPages", "progressive_max_pages", 0, 10_000, sourcePath, patch, entries)
    mapGpu(value.gpuId, `${sourcePath}.gpuId`, "default_gpu_id", patch, entries)

    if (value.selectedModel !== undefined) mapDefaultModel(value.selectedModel, `${sourcePath}.selectedModel`, patch, entries)
    const conditions = value.conditionsList ?? legacySingleCondition(value.conditions)
    if (conditions !== undefined) mapConditions(conditions, `${sourcePath}.${value.conditionsList === undefined ? "conditions" : "conditionsList"}`, patch, entries)

    if (value.mangaJanaiModelDir !== undefined) {
      entries.push({
        sourcePath: `${sourcePath}.mangaJanaiModelDir`,
        disposition: "unknown",
        message: "MangaJaNai requires an explicit custom_models manifest; its legacy directory is not a runtime model registry.",
      })
    }
    for (const key of Object.keys(value)) {
      if (!PANEL_FIELDS.has(key)) entries.push({ sourcePath: `${sourcePath}.${key}`, disposition: "unknown" })
    }
    return result(patch, entries)
  }
}

function mapConditions(
  value: unknown,
  sourcePath: string,
  patch: Record<string, unknown>,
  entries: LegacySuperResolutionReportEntry[],
): void {
  if (!Array.isArray(value) || value.length > 256) {
    entries.push({ sourcePath, disposition: "invalid", message: "Expected at most 256 upscale conditions." })
    return
  }
  const converted: unknown[] = []
  for (let index = 0; index < value.length; index += 1) {
    const itemPath = `${sourcePath}[${index}]`
    const parsed = legacyConditionSchema.safeParse(value[index])
    if (!parsed.success) {
      entries.push({ sourcePath: itemPath, disposition: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid condition." })
      continue
    }
    const condition = parsed.data
    reportUnknownFields(condition, CONDITION_FIELDS, itemPath, entries)
    reportUnknownFields(condition.match, CONDITION_MATCH_FIELDS, `${itemPath}.match`, entries)
    reportUnknownFields(condition.action, CONDITION_ACTION_FIELDS, `${itemPath}.action`, entries)
    const skip = condition.action.skip === true
    const legacyModel = condition.action.model ?? condition.action.modelName
    const model = legacyModel ? mapLegacyModel(legacyModel) : undefined
    if (!skip && !model) {
      entries.push({
        sourcePath: `${itemPath}.action.model`,
        disposition: "unknown",
        message: `Legacy model ${legacyModel ?? "(missing)"} has no proven equivalent and the condition was not made executable.`,
      })
      continue
    }
    if (legacyModel && model) addModelConversionEntry(`${itemPath}.action.model`, model, entries, "super_resolution.preferences.conditions[].action.model_id")
    const conditionId = safeConditionId(condition.id, index)
    if (conditionId !== condition.id) {
      entries.push({
        sourcePath: `${itemPath}.id`,
        targetPath: "super_resolution.preferences.conditions[].id",
        disposition: "converted",
        message: `Invalid legacy condition ID was replaced with ${conditionId}.`,
      })
    }
    const wire = {
      id: conditionId,
      name: condition.name,
      enabled: condition.enabled,
      priority: condition.priority,
      match: compact({
        min_width: condition.match.minWidth,
        min_height: condition.match.minHeight,
        max_width: condition.match.maxWidth,
        max_height: condition.match.maxHeight,
        min_megapixels: condition.match.minPixels,
        max_megapixels: condition.match.maxPixels,
        dimension_mode: condition.match.dimensionMode,
        created_between: condition.match.createdBetween,
        modified_between: condition.match.modifiedBetween,
        book_path_regex: condition.match.regexBookPath,
        image_path_regex: condition.match.regexImagePath,
        match_inner_path: condition.match.matchInnerPath,
        exclude_from_preload: condition.match.excludeFromPreload,
        metadata: condition.match.metadata,
      }),
      action: compact({
        skip,
        model_id: model?.id,
        scale: condition.action.scale ?? model?.scale,
        tile_size: condition.action.tileEnabled === false || condition.action.tileSize === 0 ? undefined : condition.action.tileSize,
        tile_enabled: condition.action.tileEnabled,
        noise: condition.action.noiseLevel ?? model?.noise,
        gpu_id: condition.action.gpuId === undefined ? undefined : String(condition.action.gpuId),
        use_cache: condition.action.useCache,
        tta: condition.action.tta ?? model?.tta,
      }),
    }
    const checked = z.array(SuperResolutionPreferencesWireSchema.shape.conditions.unwrap().element).safeParse([wire])
    if (!checked.success) {
      entries.push({ sourcePath: itemPath, disposition: "invalid", message: checked.error.issues[0]?.message ?? "Invalid converted condition." })
      continue
    }
    converted.push(checked.data[0])
  }
  patch.conditions = converted
  entries.push({ sourcePath, targetPath: "super_resolution.preferences.conditions", disposition: "converted" })
}

function legacySingleCondition(value: unknown): unknown[] | undefined {
  if (!isRecord(value)) return undefined
  return [{
    id: "migrated-condition",
    name: "Migrated condition",
    enabled: value.enabled ?? true,
    priority: 0,
    match: {
      minWidth: value.minWidth,
      minHeight: value.minHeight,
      excludeFromPreload: false,
    },
    action: {
      model: value.model,
      scale: value.scale,
      tileSize: value.tileSize,
      tileEnabled: value.tileEnabled,
      noiseLevel: value.noiseLevel,
      gpuId: value.gpuId,
      useCache: value.useCache,
    },
  }]
}

function mapDefaultModel(
  value: unknown,
  sourcePath: string,
  patch: Record<string, unknown>,
  entries: LegacySuperResolutionReportEntry[],
): void {
  if (typeof value !== "string" || !value.trim()) {
    entries.push({ sourcePath, disposition: "invalid", message: "Expected a non-empty legacy model identifier." })
    return
  }
  const mapped = mapLegacyModel(value)
  if (!mapped) {
    entries.push({ sourcePath, disposition: "unknown", message: `Legacy model ${value} has no proven runtime equivalent.` })
    return
  }
  patch.default_model_id = mapped.id
  if (mapped.scale !== undefined && patch.default_scale === undefined) patch.default_scale = mapped.scale
  if (mapped.noise !== undefined && patch.default_noise === undefined) patch.default_noise = mapped.noise
  if (mapped.tta !== undefined) patch.default_tta = mapped.tta
  addModelConversionEntry(sourcePath, mapped, entries, "super_resolution.preferences.default_model_id")
}

function mapLegacyModel(value: string): MappedModel | undefined {
  const normalized = value.trim()
  if (RUNTIME_MODEL_IDS.has(normalized)) return { id: normalized }
  const tta = normalized.endsWith("_TTA")
  const noise = normalized.match(/_DENOISE([0-3])X(?:_TTA)?$/u)?.[1]
  let match = normalized.match(/^MODEL_REALESRGAN_ANIMAVIDEOV3_UP([234])X(?:_TTA)?$/u)
  if (match) return { id: "realesr-animevideov3", scale: Number(match[1]), tta }
  match = normalized.match(/^MODEL_REALESRGAN_X4PLUS_ANIME_UP4X(?:_TTA)?$/u)
  if (match) return { id: "realesrgan-x4plus-anime", scale: 4, tta }
  match = normalized.match(/^MODEL_REALESRGAN_X4PLUS_UP4X(?:_TTA)?$/u)
  if (match) return { id: "realesrgan-x4plus", scale: 4, tta }
  match = normalized.match(/^MODEL_REALCUGAN_SE_UP([234])X(?:_DENOISE[0-3]X)?(?:_TTA)?$/u)
  if (match) return { id: "realcugan", scale: Number(match[1]), noise: noise === undefined ? undefined : Number(noise), tta }
  match = normalized.match(/^MODEL_WAIFU2X_CUNET_UP(2|4|8|16|32)X(?:_DENOISE[0-3]X)?(?:_TTA)?$/u)
  if (match) return { id: "waifu2x-models-cunet", scale: Number(match[1]), noise: noise === undefined ? undefined : Number(noise), tta }
  return undefined
}

function addModelConversionEntry(
  sourcePath: string,
  model: MappedModel,
  entries: LegacySuperResolutionReportEntry[],
  targetPath: string,
): void {
  entries.push({
    sourcePath,
    targetPath,
    disposition: "converted",
    message: `Mapped to runtime model ${model.id}.`,
  })
}

function mapProgressiveDwellTime(
  value: unknown,
  sourcePath: string,
  patch: Record<string, unknown>,
  entries: LegacySuperResolutionReportEntry[],
): void {
  if (value === undefined) return
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 3_600) {
    entries.push({ sourcePath, disposition: "invalid", message: "Expected an integer between 0 and 3600 seconds." })
    return
  }
  patch.progressive_dwell_time_ms = value * 1_000
  entries.push({ sourcePath, targetPath: "super_resolution.preferences.progressive_dwell_time_ms", disposition: "converted" })
}

function mapBooleanField(
  source: Record<string, unknown>,
  sourceKey: string,
  targetKey: string,
  sourcePath: string,
  patch: Record<string, unknown>,
  entries: LegacySuperResolutionReportEntry[],
): void {
  mapBoolean(source[sourceKey], targetKey, `${sourcePath}.${sourceKey}`, patch, entries)
}

function mapBoolean(
  value: unknown,
  targetKey: string,
  sourcePath: string,
  patch: Record<string, unknown>,
  entries: LegacySuperResolutionReportEntry[],
): void {
  if (value === undefined) return
  if (typeof value !== "boolean") {
    entries.push({ sourcePath, disposition: "invalid", message: "Expected a boolean." })
    return
  }
  patch[targetKey] = value
  entries.push({ sourcePath, targetPath: `super_resolution.preferences.${targetKey}`, disposition: "converted" })
}

function mapIntegerField(
  source: Record<string, unknown>,
  sourceKey: string,
  targetKey: string,
  minimum: number,
  maximum: number,
  sourcePath: string,
  patch: Record<string, unknown>,
  entries: LegacySuperResolutionReportEntry[],
): void {
  const value = source[sourceKey]
  if (value === undefined) return
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    entries.push({ sourcePath: `${sourcePath}.${sourceKey}`, disposition: "invalid", message: `Expected an integer between ${minimum} and ${maximum}.` })
    return
  }
  patch[targetKey] = value
  entries.push({ sourcePath: `${sourcePath}.${sourceKey}`, targetPath: `super_resolution.preferences.${targetKey}`, disposition: "converted" })
}

function mapNumberField(
  source: Record<string, unknown>,
  sourceKey: string,
  targetKey: string,
  minimum: number,
  maximum: number,
  sourcePath: string,
  patch: Record<string, unknown>,
  entries: LegacySuperResolutionReportEntry[],
): void {
  const value = source[sourceKey]
  if (value === undefined) return
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    entries.push({ sourcePath: `${sourcePath}.${sourceKey}`, disposition: "invalid", message: `Expected a number between ${minimum} and ${maximum}.` })
    return
  }
  patch[targetKey] = value
  entries.push({ sourcePath: `${sourcePath}.${sourceKey}`, targetPath: `super_resolution.preferences.${targetKey}`, disposition: "converted" })
}

function mapGpu(
  value: unknown,
  sourcePath: string,
  targetKey: string,
  patch: Record<string, unknown>,
  entries: LegacySuperResolutionReportEntry[],
): void {
  if (value === undefined) return
  if ((typeof value !== "number" || !Number.isInteger(value) || value < 0) && (typeof value !== "string" || !value.trim())) {
    entries.push({ sourcePath, disposition: "invalid", message: "Expected a non-negative GPU index or identifier." })
    return
  }
  patch[targetKey] = String(value).trim()
  entries.push({ sourcePath, targetPath: `super_resolution.preferences.${targetKey}`, disposition: "converted" })
}

function safeConditionId(value: string, index: number): string {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(value) ? value : `legacy-condition-${index}`
}

function result(patch: Record<string, unknown>, entries: LegacySuperResolutionReportEntry[]): DecodedLegacySuperResolutionSettings {
  return { preferencesPatch: SuperResolutionPreferencesWireSchema.parse(patch), entries }
}

function invalidResult(sourcePath: string, message: string): DecodedLegacySuperResolutionSettings {
  return result({ schema_version: 1 }, [{ sourcePath, disposition: "invalid", message }])
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}

function reportUnknownFields(
  value: Record<string, unknown>,
  known: ReadonlySet<string>,
  sourcePath: string,
  entries: LegacySuperResolutionReportEntry[],
): void {
  for (const key of Object.keys(value)) {
    if (!known.has(key)) entries.push({ sourcePath: `${sourcePath}.${key}`, disposition: "unknown" })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
