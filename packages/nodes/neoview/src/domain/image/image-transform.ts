export type ImageTransformFit = "contain" | "cover" | "fill" | "inside" | "outside"
export type ImageTransformFormat = "avif" | "jpeg" | "png" | "webp"

export interface ImageTransformRequest {
  width?: number
  height?: number
  dpr: number
  fit: ImageTransformFit
  format: ImageTransformFormat
  lossless?: boolean
  quality: number
}

const TRANSFORM_KEYS = ["width", "height", "dpr", "fit", "format", "lossless", "quality"] as const
const FITS = new Set<ImageTransformFit>(["contain", "cover", "fill", "inside", "outside"])
const FORMATS = new Set<ImageTransformFormat>(["avif", "jpeg", "png", "webp"])
const MAX_OUTPUT_DIMENSION = 16_384

export function parseImageTransform(searchParams: URLSearchParams): ImageTransformRequest | undefined {
  if (!TRANSFORM_KEYS.some((key) => searchParams.has(key))) return undefined
  for (const key of TRANSFORM_KEYS) {
    if (searchParams.getAll(key).length > 1) throw new RangeError(`Duplicate image transform parameter: ${key}`)
  }

  const width = optionalInteger(searchParams.get("width"), "width", 1, MAX_OUTPUT_DIMENSION)
  const height = optionalInteger(searchParams.get("height"), "height", 1, MAX_OUTPUT_DIMENSION)
  const hasResize = width !== undefined || height !== undefined
  const dpr = optionalNumber(searchParams.get("dpr"), "dpr", 0.25, 4) ?? 1
  const fit = optionalEnum(searchParams.get("fit"), "fit", FITS) ?? "inside"
  const format = optionalEnum(searchParams.get("format"), "format", FORMATS) ?? "webp"
  const lossless = optionalBoolean(searchParams.get("lossless"), "lossless")
  const quality = optionalInteger(searchParams.get("quality"), "quality", 1, 100) ?? 82

  if (!hasResize && (searchParams.has("dpr") || searchParams.has("fit"))) {
    throw new RangeError("dpr and fit require width or height")
  }
  if (!hasResize && searchParams.has("quality") && !searchParams.has("format")) {
    throw new RangeError("quality requires format when no resize is requested")
  }
  if ((width !== undefined && Math.round(width * dpr) > MAX_OUTPUT_DIMENSION)
    || (height !== undefined && Math.round(height * dpr) > MAX_OUTPUT_DIMENSION)) {
    throw new RangeError(`Scaled image dimensions must not exceed ${MAX_OUTPUT_DIMENSION}`)
  }

  return {
    width,
    height,
    dpr,
    fit,
    format,
    ...(lossless === undefined ? {} : { lossless }),
    quality,
  }
}

export function imageTransformCacheKey(request: ImageTransformRequest): string {
  return [
    request.width ?? "auto",
    request.height ?? "auto",
    request.dpr,
    request.fit,
    request.format,
    ...(request.lossless === true ? ["lossless"] : []),
    request.quality,
  ].join(":")
}

export function imageTransformContentType(format: ImageTransformFormat): string {
  return format === "jpeg" ? "image/jpeg" : `image/${format}`
}

export function appendImageTransform(searchParams: URLSearchParams, request: ImageTransformRequest): void {
  if (request.width !== undefined) searchParams.set("width", String(request.width))
  if (request.height !== undefined) searchParams.set("height", String(request.height))
  if (request.width !== undefined || request.height !== undefined) {
    searchParams.set("dpr", String(request.dpr))
    searchParams.set("fit", request.fit)
  }
  searchParams.set("format", request.format)
  if (request.lossless !== undefined) searchParams.set("lossless", String(request.lossless))
  searchParams.set("quality", String(request.quality))
}

function optionalInteger(value: string | null, name: string, minimum: number, maximum: number): number | undefined {
  if (value === null) return undefined
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}`)
  }
  return parsed
}

function optionalNumber(value: string | null, name: string, minimum: number, maximum: number): number | undefined {
  if (value === null) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new RangeError(`${name} must be a number from ${minimum} to ${maximum}`)
  }
  return parsed
}

function optionalBoolean(value: string | null, name: string): boolean | undefined {
  if (value === null) return undefined
  if (value === "true" || value === "1") return true
  if (value === "false" || value === "0") return false
  throw new RangeError(`${name} must be true or false`)
}

function optionalEnum<T extends string>(
  value: string | null,
  name: string,
  allowed: ReadonlySet<T>,
): T | undefined {
  if (value === null) return undefined
  if (!allowed.has(value as T)) throw new RangeError(`Unsupported ${name}: ${value}`)
  return value as T
}
