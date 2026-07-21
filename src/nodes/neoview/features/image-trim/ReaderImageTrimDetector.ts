import type { ReaderImageTrimTarget } from "@xiranite/node-neoview/ui-core"

export const READER_IMAGE_TRIM_MAX_SAMPLE_EDGE = 512
export const READER_IMAGE_TRIM_MAX_CROP_RATIO = 0.4
export const READER_IMAGE_TRIM_LINE_SAMPLE_LIMIT = 128

export interface ReaderImageTrimMargins {
  top: number
  bottom: number
  left: number
  right: number
}

export interface ReaderImageTrimDetectionOptions {
  threshold: number
  target: ReaderImageTrimTarget
  signal: AbortSignal
}

export type ReaderImageTrimDetector = (
  image: HTMLImageElement,
  options: ReaderImageTrimDetectionOptions,
) => Promise<ReaderImageTrimMargins>

export const detectReaderImageTrim: ReaderImageTrimDetector = async (image, options) => {
  throwIfAborted(options.signal)
  if (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    throw new Error("The active reader image is not decoded")
  }

  const { width, height } = readerImageTrimSampleDimensions(image.naturalWidth, image.naturalHeight)
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (!context) throw new Error("Canvas 2D is unavailable")

  context.drawImage(image, 0, 0, width, height)
  throwIfAborted(options.signal)
  const pixels = context.getImageData(0, 0, width, height).data
  const result = analyzeReaderImageTrimPixels(pixels, width, height, options)
  throwIfAborted(options.signal)
  return result
}

export function readerImageTrimSampleDimensions(naturalWidth: number, naturalHeight: number): {
  width: number
  height: number
} {
  const width = Math.max(1, Math.round(naturalWidth))
  const height = Math.max(1, Math.round(naturalHeight))
  const scale = Math.min(1, READER_IMAGE_TRIM_MAX_SAMPLE_EDGE / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export function readerImageTrimLineSampleCount(length: number): number {
  const normalized = Math.max(1, Math.floor(length))
  return Math.ceil(normalized / readerImageTrimLineStep(normalized))
}

export function analyzeReaderImageTrimPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: Pick<ReaderImageTrimDetectionOptions, "threshold" | "target" | "signal">,
): ReaderImageTrimMargins {
  if (pixels.length < width * height * 4) throw new RangeError("Image data is smaller than its dimensions")
  throwIfAborted(options.signal)

  const target = targetColor(pixels, width, height, options.target)
  const maximumRows = Math.floor(height * READER_IMAGE_TRIM_MAX_CROP_RATIO)
  const maximumColumns = Math.floor(width * READER_IMAGE_TRIM_MAX_CROP_RATIO)
  let top = 0
  let bottom = 0
  let left = 0
  let right = 0

  for (let y = 0; y < maximumRows; y += 1) {
    if (!isBorderLine(pixels, width, height, "row", y, target, options.threshold)) break
    top += 1
  }
  for (let y = height - 1; y >= height - maximumRows; y -= 1) {
    if (!isBorderLine(pixels, width, height, "row", y, target, options.threshold)) break
    bottom += 1
  }
  for (let x = 0; x < maximumColumns; x += 1) {
    if (!isBorderLine(pixels, width, height, "column", x, target, options.threshold)) break
    left += 1
  }
  for (let x = width - 1; x >= width - maximumColumns; x -= 1) {
    if (!isBorderLine(pixels, width, height, "column", x, target, options.threshold)) break
    right += 1
  }

  throwIfAborted(options.signal)
  return {
    top: percentage(top, height),
    bottom: percentage(bottom, height),
    left: percentage(left, width),
    right: percentage(right, width),
  }
}

function targetColor(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  target: ReaderImageTrimTarget,
): readonly [number, number, number] {
  if (target === "black") return [0, 0, 0]
  if (target === "white") return [255, 255, 255]
  const corners = [
    pixelAt(pixels, width, 0, 0),
    pixelAt(pixels, width, width - 1, 0),
    pixelAt(pixels, width, 0, height - 1),
    pixelAt(pixels, width, width - 1, height - 1),
  ]
  const average = (channel: 0 | 1 | 2) => corners.reduce((sum, color) => sum + color[channel], 0) / corners.length
  return [average(0), average(1), average(2)]
}

function pixelAt(pixels: Uint8ClampedArray, width: number, x: number, y: number): readonly [number, number, number] {
  const offset = (y * width + x) * 4
  return [pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!]
}

function isBorderLine(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  axis: "row" | "column",
  position: number,
  target: readonly [number, number, number],
  threshold: number,
): boolean {
  const length = axis === "row" ? width : height
  const step = readerImageTrimLineStep(length)
  let samples = 0
  let matches = 0
  for (let index = 0; index < length; index += step) {
    const x = axis === "row" ? index : position
    const y = axis === "row" ? position : index
    const offset = (y * width + x) * 4
    samples += 1
    if (
      Math.abs(pixels[offset]! - target[0]) <= threshold
      && Math.abs(pixels[offset + 1]! - target[1]) <= threshold
      && Math.abs(pixels[offset + 2]! - target[2]) <= threshold
    ) matches += 1
  }
  return samples > 0 && matches / samples >= 0.9
}

function readerImageTrimLineStep(length: number): number {
  return Math.max(1, Math.ceil(length / READER_IMAGE_TRIM_LINE_SAMPLE_LIMIT))
}

function percentage(pixels: number, size: number): number {
  return Math.round((pixels / size) * 1000) / 10
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw signal.reason ?? new DOMException("Image trim detection was aborted", "AbortError")
}
