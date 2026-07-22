/**
 * Minimal edge-match: sample a few colors on each page edge and build CSS gradients.
 * No preload hooks, no network warm, no PNG encode.
 */

export const EDGE_MATCH_DEFAULTS = {
  sampleMaxEdge: 48,
  stops: 6,
  depth: 1,
} as const

export interface EdgeColorFrame {
  top: string[]
  right: string[]
  bottom: string[]
  left: string[]
}

export interface EdgeMatchPresentation {
  css: string
  average: string
}

export function sampleEdgeColorsFromPixels(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  stops = EDGE_MATCH_DEFAULTS.stops,
  depth = EDGE_MATCH_DEFAULTS.depth,
): EdgeColorFrame {
  const stopCount = Math.min(12, Math.max(4, Math.round(stops)))
  const edgeDepth = Math.min(depth, width, height, 3)
  return {
    top: sampleHorizontal(pixels, width, height, 0, edgeDepth, stopCount),
    bottom: sampleHorizontal(pixels, width, height, height - edgeDepth, edgeDepth, stopCount),
    left: sampleVertical(pixels, width, 0, edgeDepth, height, stopCount),
    right: sampleVertical(pixels, width, width - edgeDepth, edgeDepth, height, stopCount),
  }
}

export function sampleImageEdgeColors(image: CanvasImageSource & { naturalWidth?: number; width?: number; naturalHeight?: number; height?: number }): EdgeColorFrame {
  const naturalWidth = Math.max(1, Math.round(image.naturalWidth ?? image.width ?? 0))
  const naturalHeight = Math.max(1, Math.round(image.naturalHeight ?? image.height ?? 0))
  const scale = Math.min(1, EDGE_MATCH_DEFAULTS.sampleMaxEdge / Math.max(naturalWidth, naturalHeight))
  const width = Math.max(1, Math.round(naturalWidth * scale))
  const height = Math.max(1, Math.round(naturalHeight * scale))

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (!context) throw new Error("Canvas 2D is unavailable")
  context.drawImage(image as CanvasImageSource, 0, 0, width, height)
  return sampleEdgeColorsFromPixels(context.getImageData(0, 0, width, height).data, width, height)
}

export function edgeFrameToPresentation(frame: EdgeColorFrame): EdgeMatchPresentation {
  const top = ensureStops(frame.top)
  const right = ensureStops(frame.right)
  const bottom = ensureStops(frame.bottom)
  const left = ensureStops(frame.left)
  const average = averageHex([...top, ...right, ...bottom, ...left])
  const css = [
    `linear-gradient(to bottom, ${stopsAcross(top)}, ${average} 70%)`,
    `linear-gradient(to top, ${stopsAcross(bottom)}, transparent 70%)`,
    `linear-gradient(to right, ${stopsAcross(left)}, transparent 70%)`,
    `linear-gradient(to left, ${stopsAcross(right)}, transparent 70%)`,
  ].join(",")
  return { css, average }
}

export async function computeEdgeMatchPresentation(src: string, signal?: AbortSignal): Promise<EdgeMatchPresentation> {
  if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError")
  const image = await loadImage(src, signal)
  if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError")
  return edgeFrameToPresentation(sampleImageEdgeColors(image))
}

async function loadImage(src: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  const image = new Image()
  image.decoding = "async"
  image.crossOrigin = "anonymous"
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      reject(new DOMException("The operation was aborted.", "AbortError"))
    }
    const cleanup = () => {
      image.onload = null
      image.onerror = null
      signal?.removeEventListener("abort", onAbort)
    }
    image.onload = () => {
      cleanup()
      resolve()
    }
    image.onerror = () => {
      cleanup()
      reject(new Error("Failed to load image for edge match"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
    image.src = src
  })
  try {
    await image.decode?.()
  } catch {
    if (!image.complete || image.naturalWidth <= 0) throw new Error("Failed to decode image for edge match")
  }
  return image
}

function sampleHorizontal(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  startY: number,
  depth: number,
  stops: number,
): string[] {
  const colors: string[] = []
  for (let stop = 0; stop < stops; stop += 1) {
    const x = stops <= 1 ? 0 : Math.min(width - 1, Math.round((stop / (stops - 1)) * (width - 1)))
    colors.push(averageRegion(pixels, width, height, x, startY, 1, depth))
  }
  return colors
}

function sampleVertical(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  startX: number,
  depth: number,
  height: number,
  stops: number,
): string[] {
  const colors: string[] = []
  for (let stop = 0; stop < stops; stop += 1) {
    const y = stops <= 1 ? 0 : Math.min(height - 1, Math.round((stop / (stops - 1)) * (height - 1)))
    colors.push(averageRegion(pixels, width, height, startX, y, depth, 1))
  }
  return colors
}

function averageRegion(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  startX: number,
  startY: number,
  regionWidth: number,
  regionHeight: number,
): string {
  let red = 0
  let green = 0
  let blue = 0
  let count = 0
  const x0 = Math.max(0, startX)
  const y0 = Math.max(0, startY)
  const x1 = Math.min(width, startX + regionWidth)
  const y1 = Math.min(height, startY + regionHeight)
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const index = (y * width + x) * 4
      red += pixels[index]!
      green += pixels[index + 1]!
      blue += pixels[index + 2]!
      count += 1
    }
  }
  if (count === 0) return "#000000"
  return rgbToHex(Math.round(red / count), Math.round(green / count), Math.round(blue / count))
}

function ensureStops(colors: string[]): string[] {
  if (colors.length >= 2) return colors
  if (colors.length === 1) return [colors[0]!, colors[0]!]
  return ["#000000", "#000000"]
}

function stopsAcross(stops: string[]): string {
  const last = Math.max(1, stops.length - 1)
  return stops.map((color, index) => `${color} ${Math.round((index / last) * 42)}%`).join(",")
}

function averageHex(colors: string[]): string {
  let red = 0
  let green = 0
  let blue = 0
  for (const color of colors) {
    const value = color.replace("#", "")
    red += Number.parseInt(value.slice(0, 2), 16) || 0
    green += Number.parseInt(value.slice(2, 4), 16) || 0
    blue += Number.parseInt(value.slice(4, 6), 16) || 0
  }
  const count = Math.max(1, colors.length)
  return rgbToHex(Math.round(red / count), Math.round(green / count), Math.round(blue / count))
}

function rgbToHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue].map((channel) => Math.max(0, Math.min(255, channel)).toString(16).padStart(2, "0")).join("")}`
}
