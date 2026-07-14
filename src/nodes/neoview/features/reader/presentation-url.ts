import type { ReaderPageDto } from "../../adapters/reader-http-client"

export interface ReaderViewport {
  width: number
  height: number
  dpr: number
}

const TRANSFORMABLE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"])
const DIMENSION_QUANTUM = 64
const MIN_PIXEL_REDUCTION = 2
const SMALL_SOURCE_BYTES = 512 * 1024
const MIN_SMALL_SOURCE_REDUCTION = 4
const MAX_TRANSFORM_DIMENSION = 16_384

export function readerPresentationUrl(
  page: ReaderPageDto,
  viewport: ReaderViewport,
  visiblePageCount: number,
): string {
  const dimensions = page.dimensions
  const mimeType = page.mimeType?.toLowerCase().split(";", 1)[0]
  if (
    page.mediaKind !== "image"
    || !dimensions
    || !mimeType
    || !TRANSFORMABLE_MIME_TYPES.has(mimeType)
    || viewport.width <= 0
    || viewport.height <= 0
  ) return page.assetUrl

  const slotWidth = viewport.width / Math.max(1, visiblePageCount)
  const scale = Math.min(slotWidth / dimensions.width, viewport.height / dimensions.height, 1)
  if (!Number.isFinite(scale) || scale >= 1) return page.assetUrl

  const dpr = clamp(round(viewport.dpr, 2), 1, 2)
  const maxCssDimension = Math.floor(MAX_TRANSFORM_DIMENSION / dpr)
  const width = Math.min(maxCssDimension, quantizeUp(Math.max(1, Math.ceil(dimensions.width * scale))))
  const height = Math.min(maxCssDimension, quantizeUp(Math.max(1, Math.ceil(dimensions.height * scale))))
  const sourcePixels = dimensions.width * dimensions.height
  const targetPixels = Math.min(sourcePixels, width * dpr * height * dpr)
  const reduction = sourcePixels / targetPixels
  if (reduction < MIN_PIXEL_REDUCTION) return page.assetUrl
  if ((page.byteLength ?? Number.POSITIVE_INFINITY) < SMALL_SOURCE_BYTES && reduction < MIN_SMALL_SOURCE_REDUCTION) {
    return page.assetUrl
  }

  const url = new URL(page.assetUrl)
  url.searchParams.set("width", String(width))
  url.searchParams.set("height", String(height))
  url.searchParams.set("dpr", String(dpr))
  url.searchParams.set("fit", "inside")
  url.searchParams.set("format", "webp")
  url.searchParams.set("quality", "82")
  return url.href
}

function quantizeUp(value: number): number {
  return Math.ceil(value / DIMENSION_QUANTUM) * DIMENSION_QUANTUM
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
