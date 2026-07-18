import { z } from "zod"

const finiteNonNegative = z.number().finite().nonnegative()
const optionalPositiveInteger = z.number().int().positive().max(65_536).optional()
const identifier = z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u)
const boundedRegex = z.string().max(4_096).refine((value) => {
  try {
    new RegExp(value, "u")
    return true
  } catch {
    return false
  }
}, "must be a valid regular expression")

const conditionExpressionSchema = z.object({
  operator: z.enum(["eq", "ne", "gt", "gte", "lt", "lte", "regex", "contains"]),
  value: z.union([z.string().max(4_096), z.number().finite()]),
}).strict()

const conditionMatchSchema = z.object({
  min_width: finiteNonNegative.optional(),
  min_height: finiteNonNegative.optional(),
  max_width: finiteNonNegative.optional(),
  max_height: finiteNonNegative.optional(),
  min_megapixels: finiteNonNegative.optional(),
  max_megapixels: finiteNonNegative.optional(),
  dimension_mode: z.enum(["and", "or"]).optional(),
  created_between: z.tuple([finiteNonNegative, finiteNonNegative]).optional(),
  modified_between: z.tuple([finiteNonNegative, finiteNonNegative]).optional(),
  book_path_regex: boundedRegex.optional(),
  image_path_regex: boundedRegex.optional(),
  match_inner_path: z.boolean().optional(),
  exclude_from_preload: z.boolean().optional(),
  metadata: z.record(z.string().min(1).max(128), conditionExpressionSchema).optional(),
}).strict().superRefine((value, context) => {
  if (value.created_between && value.created_between[0] > value.created_between[1]) {
    context.addIssue({ code: "custom", path: ["created_between"], message: "start must not exceed end" })
  }
  if (value.modified_between && value.modified_between[0] > value.modified_between[1]) {
    context.addIssue({ code: "custom", path: ["modified_between"], message: "start must not exceed end" })
  }
  if (value.metadata && Object.keys(value.metadata).length > 64) {
    context.addIssue({ code: "custom", path: ["metadata"], message: "must contain at most 64 entries" })
  }
})

const conditionActionSchema = z.object({
  skip: z.boolean().optional(),
  model_id: identifier.optional(),
  scale: z.number().int().min(1).max(32).optional(),
  tile_size: optionalPositiveInteger,
  tile_enabled: z.boolean().optional(),
  noise: z.number().int().min(-1).max(3).optional(),
  gpu_id: z.string().trim().min(1).max(128).optional(),
  use_cache: z.boolean().optional(),
  tta: z.boolean().optional(),
}).strict().superRefine((value, context) => {
  if (value.skip !== true && !value.model_id) {
    context.addIssue({ code: "custom", path: ["model_id"], message: "is required unless the condition skips upscale" })
  }
})

const conditionSchema = z.object({
  id: identifier,
  name: z.string().trim().min(1).max(256),
  enabled: z.boolean(),
  priority: z.number().int().min(0).max(10_000),
  match: conditionMatchSchema,
  action: conditionActionSchema,
}).strict()

export const SuperResolutionPreferencesWireSchema = z.object({
  schema_version: z.literal(1),
  auto_upscale_enabled: z.boolean().optional(),
  pre_upscale_enabled: z.boolean().optional(),
  global_upscale_enabled: z.boolean().optional(),
  current_image_upscale_enabled: z.boolean().optional(),
  preload_pages: z.number().int().min(0).max(1_000).optional(),
  background_concurrency: z.number().int().min(1).max(32).optional(),
  show_panel_preview: z.boolean().optional(),
  default_model_id: identifier.optional(),
  default_scale: z.number().int().min(1).max(32).optional(),
  default_tile_size: optionalPositiveInteger,
  default_tile_enabled: z.boolean().optional(),
  default_noise: z.number().int().min(-1).max(3).optional(),
  default_gpu_id: z.string().trim().min(1).max(128).optional(),
  default_tta: z.boolean().optional(),
  progressive_enabled: z.boolean().optional(),
  progressive_dwell_time_ms: z.number().int().min(0).max(3_600_000).optional(),
  progressive_max_pages: z.number().int().min(0).max(10_000).optional(),
  conditional_enabled: z.boolean().optional(),
  conditional_min_width: finiteNonNegative.optional(),
  conditional_min_height: finiteNonNegative.optional(),
  conditions: z.array(conditionSchema).max(256).optional(),
}).strict()

export type SuperResolutionPreferencesWire = z.infer<typeof SuperResolutionPreferencesWireSchema>

export interface SuperResolutionConditionExpression {
  operator: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "regex" | "contains"
  value: string | number
}

export interface SuperResolutionCondition {
  id: string
  name: string
  enabled: boolean
  priority: number
  match: {
    minWidth?: number
    minHeight?: number
    maxWidth?: number
    maxHeight?: number
    minMegapixels?: number
    maxMegapixels?: number
    dimensionMode?: "and" | "or"
    createdBetween?: readonly [number, number]
    modifiedBetween?: readonly [number, number]
    bookPathRegex?: string
    imagePathRegex?: string
    matchInnerPath?: boolean
    excludeFromPreload?: boolean
    metadata?: Readonly<Record<string, SuperResolutionConditionExpression>>
  }
  action: {
    skip: boolean
    modelId?: string
    scale?: number
    tileSize?: number
    tileEnabled?: boolean
    noise?: number
    gpuId?: string
    useCache?: boolean
    tta?: boolean
  }
}

export interface SuperResolutionPreferences {
  schemaVersion: 1
  autoUpscaleEnabled?: boolean
  preUpscaleEnabled?: boolean
  globalUpscaleEnabled?: boolean
  currentImageUpscaleEnabled?: boolean
  preloadPages?: number
  backgroundConcurrency?: number
  showPanelPreview?: boolean
  defaultModelId?: string
  defaultScale?: number
  defaultTileSize?: number
  defaultTileEnabled?: boolean
  defaultNoise?: number
  defaultGpuId?: string
  defaultTta?: boolean
  progressiveEnabled?: boolean
  progressiveDwellTimeMs?: number
  progressiveMaxPages?: number
  conditionalEnabled?: boolean
  conditionalMinWidth?: number
  conditionalMinHeight?: number
  conditions: readonly SuperResolutionCondition[]
}

export function parseSuperResolutionPreferences(value: unknown): SuperResolutionPreferences {
  const wire = SuperResolutionPreferencesWireSchema.parse(value ?? { schema_version: 1 })
  return {
    schemaVersion: 1,
    autoUpscaleEnabled: wire.auto_upscale_enabled,
    preUpscaleEnabled: wire.pre_upscale_enabled,
    globalUpscaleEnabled: wire.global_upscale_enabled,
    currentImageUpscaleEnabled: wire.current_image_upscale_enabled,
    preloadPages: wire.preload_pages,
    backgroundConcurrency: wire.background_concurrency,
    showPanelPreview: wire.show_panel_preview,
    defaultModelId: wire.default_model_id,
    defaultScale: wire.default_scale,
    defaultTileSize: wire.default_tile_size,
    defaultTileEnabled: wire.default_tile_enabled,
    defaultNoise: wire.default_noise,
    defaultGpuId: wire.default_gpu_id,
    defaultTta: wire.default_tta,
    progressiveEnabled: wire.progressive_enabled,
    progressiveDwellTimeMs: wire.progressive_dwell_time_ms,
    progressiveMaxPages: wire.progressive_max_pages,
    conditionalEnabled: wire.conditional_enabled,
    conditionalMinWidth: wire.conditional_min_width,
    conditionalMinHeight: wire.conditional_min_height,
    conditions: (wire.conditions ?? []).map((condition) => ({
      id: condition.id,
      name: condition.name,
      enabled: condition.enabled,
      priority: condition.priority,
      match: {
        minWidth: condition.match.min_width,
        minHeight: condition.match.min_height,
        maxWidth: condition.match.max_width,
        maxHeight: condition.match.max_height,
        minMegapixels: condition.match.min_megapixels,
        maxMegapixels: condition.match.max_megapixels,
        dimensionMode: condition.match.dimension_mode,
        createdBetween: condition.match.created_between,
        modifiedBetween: condition.match.modified_between,
        bookPathRegex: condition.match.book_path_regex,
        imagePathRegex: condition.match.image_path_regex,
        matchInnerPath: condition.match.match_inner_path,
        excludeFromPreload: condition.match.exclude_from_preload,
        metadata: condition.match.metadata,
      },
      action: {
        skip: condition.action.skip === true,
        modelId: condition.action.model_id,
        scale: condition.action.scale,
        tileSize: condition.action.tile_size,
        tileEnabled: condition.action.tile_enabled,
        noise: condition.action.noise,
        gpuId: condition.action.gpu_id,
        useCache: condition.action.use_cache,
        tta: condition.action.tta,
      },
    })),
  }
}
