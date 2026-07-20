export interface NeoviewImageProcessingConfig {
  enabled: boolean
  readerTransformEnabled: boolean
  jxlTransformEnabled: boolean
  wicNativeEnabled: boolean
  windowsShellNativeEnabled: boolean
  thumbnailTransformEnabled: boolean
  folderMosaicEnabled: boolean
  sharpFallbackEnabled: boolean
  jxlLossless: boolean
  jxlQuality: number
  thumbnailLossless: boolean
  thumbnailQuality: number
  mosaicLossless: boolean
  mosaicQuality: number
}

export interface NeoviewImageProcessingPatch {
  imageProcessing: Partial<NeoviewImageProcessingConfig>
}

export const DEFAULT_NEOVIEW_IMAGE_PROCESSING_CONFIG: Readonly<NeoviewImageProcessingConfig> = Object.freeze({
  enabled: true,
  readerTransformEnabled: false,
  jxlTransformEnabled: true,
  wicNativeEnabled: true,
  windowsShellNativeEnabled: true,
  thumbnailTransformEnabled: true,
  folderMosaicEnabled: false,
  sharpFallbackEnabled: false,
  jxlLossless: false,
  jxlQuality: 90,
  thumbnailLossless: false,
  thumbnailQuality: 82,
  mosaicLossless: false,
  mosaicQuality: 82,
})

const BOOLEAN_FIELDS = {
  enabled: "enabled",
  readerTransformEnabled: "reader_transform_enabled",
  jxlTransformEnabled: "jxl_transform_enabled",
  wicNativeEnabled: "wic_native_enabled",
  windowsShellNativeEnabled: "windows_shell_native_enabled",
  thumbnailTransformEnabled: "thumbnail_transform_enabled",
  folderMosaicEnabled: "folder_mosaic_enabled",
  sharpFallbackEnabled: "sharp_fallback_enabled",
  jxlLossless: "jxl_lossless",
  thumbnailLossless: "thumbnail_lossless",
  mosaicLossless: "mosaic_lossless",
} as const

const QUALITY_FIELDS = {
  jxlQuality: "jxl_quality",
  thumbnailQuality: "thumbnail_quality",
  mosaicQuality: "mosaic_quality",
} as const

export function parseNeoviewImageProcessingConfig(value: unknown): NeoviewImageProcessingConfig {
  if (value === undefined) return { ...DEFAULT_NEOVIEW_IMAGE_PROCESSING_CONFIG }
  const source = record(value, "[nodes.neoview.image.processing]")
  const config = { ...DEFAULT_NEOVIEW_IMAGE_PROCESSING_CONFIG }
  for (const [field, tomlField] of Object.entries(BOOLEAN_FIELDS) as Array<[keyof typeof BOOLEAN_FIELDS, string]>) {
    const candidate = source[tomlField] ?? source[field]
    if (candidate !== undefined) config[field] = boolean(candidate, `[nodes.neoview.image.processing].${tomlField}`)
  }
  for (const [field, tomlField] of Object.entries(QUALITY_FIELDS) as Array<[keyof typeof QUALITY_FIELDS, string]>) {
    const candidate = source[tomlField] ?? source[field]
    if (candidate !== undefined) config[field] = quality(candidate, `[nodes.neoview.image.processing].${tomlField}`)
  }
  return config
}

export function parseNeoviewImageProcessingPatch(value: unknown): {
  patch: NeoviewImageProcessingPatch
  tomlPatch: { image: { processing: Record<string, boolean | number> } }
} {
  const body = record(value, "reader config patch")
  const source = record(body.imageProcessing, "reader image processing patch")
  const allowed = new Set([...Object.keys(BOOLEAN_FIELDS), ...Object.keys(QUALITY_FIELDS)])
  for (const key of Object.keys(source)) {
    if (!allowed.has(key)) throw new Error(`Unknown reader image processing field: ${key}`)
  }
  const imageProcessing: Partial<NeoviewImageProcessingConfig> = {}
  const processing: Record<string, boolean | number> = {}
  for (const [field, tomlField] of Object.entries(BOOLEAN_FIELDS) as Array<[keyof typeof BOOLEAN_FIELDS, string]>) {
    if (source[field] === undefined) continue
    const parsed = boolean(source[field], `reader image processing patch.${field}`)
    imageProcessing[field] = parsed
    processing[tomlField] = parsed
  }
  for (const [field, tomlField] of Object.entries(QUALITY_FIELDS) as Array<[keyof typeof QUALITY_FIELDS, string]>) {
    if (source[field] === undefined) continue
    const parsed = quality(source[field], `reader image processing patch.${field}`)
    imageProcessing[field] = parsed
    processing[tomlField] = parsed
  }
  if (!Object.keys(imageProcessing).length) throw new Error("Reader image processing patch cannot be empty")
  return { patch: { imageProcessing }, tomlPatch: { image: { processing } } }
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`)
  return value as Record<string, unknown>
}

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${name} must be a boolean`)
  return value
}

function quality(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 100) {
    throw new RangeError(`${name} must be an integer from 1 to 100`)
  }
  return value as number
}
