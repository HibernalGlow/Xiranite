/**
 * Adapted from NeoView's VideoPlayer/videoPlayerUtils.ts. The media element still
 * performs decoding; these helpers preserve preview caching and screenshot behavior.
 */
export const CACHE_PRECISION = 0.5
export const MAX_CACHE_SIZE = 100
export const PREVIEW_WIDTH = 160

export function formatVideoTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00"
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`
    : `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`
}

export function videoFrameCacheKey(time: number): number {
  return Math.round(time / CACHE_PRECISION) * CACHE_PRECISION
}

export class ReaderVideoFrameCache {
  readonly #cache = new Map<number, string>()
  #video: HTMLVideoElement | undefined
  #timer: ReturnType<typeof setTimeout> | undefined
  #generating = false

  get(time: number): string | undefined {
    return this.#cache.get(videoFrameCacheKey(time))
  }

  set(time: number, dataUrl: string): void {
    if (this.#cache.size >= MAX_CACHE_SIZE) {
      const first = this.#cache.keys().next().value
      if (first !== undefined) this.#cache.delete(first)
    }
    this.#cache.set(videoFrameCacheKey(time), dataUrl)
  }

  generate(time: number, sourceUrl: string, canvas: HTMLCanvasElement, onGenerated?: (dataUrl: string) => void): void {
    const cached = this.get(time)
    if (cached) {
      drawDataUrl(cached, canvas)
      return
    }
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      if (this.#generating) return
      this.#generating = true
      const video = this.#video ?? document.createElement("video")
      this.#video = video
      video.crossOrigin = "anonymous"
      video.muted = true
      video.preload = "metadata"
      if (video.src !== sourceUrl) video.src = sourceUrl
      const finish = () => { this.#generating = false }
      const seeked = () => {
        try {
          const context = canvas.getContext("2d")
          if (!context || video.videoWidth <= 0 || video.videoHeight <= 0) return
          const height = Math.round(PREVIEW_WIDTH / (video.videoWidth / video.videoHeight))
          canvas.width = PREVIEW_WIDTH
          canvas.height = height
          context.drawImage(video, 0, 0, PREVIEW_WIDTH, height)
          try {
            const dataUrl = canvas.toDataURL("image/jpeg", 0.7)
            this.set(time, dataUrl)
            onGenerated?.(dataUrl)
          } catch {
            // A cross-origin response without CORS can still play but cannot be cached as a data URL.
          }
        } finally {
          finish()
        }
      }
      video.addEventListener("seeked", seeked, { once: true })
      video.addEventListener("error", finish, { once: true })
      video.currentTime = time
    }, 30)
  }

  clear(): void {
    this.#cache.clear()
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = undefined
    if (this.#video) this.#video.removeAttribute("src")
    this.#video = undefined
    this.#generating = false
  }
}

export async function captureVideoScreenshot(video: HTMLVideoElement): Promise<Blob | null> {
  if (video.videoWidth <= 0 || video.videoHeight <= 0) return null
  const canvas = document.createElement("canvas")
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const context = canvas.getContext("2d")
  if (!context) return null
  context.drawImage(video, 0, 0)
  return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
}

export function downloadVideoScreenshot(blob: Blob, currentTime: number): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `screenshot_${formatVideoTime(currentTime).replaceAll(":", "-")}.png`
  anchor.click()
  URL.revokeObjectURL(url)
}

function drawDataUrl(dataUrl: string, canvas: HTMLCanvasElement): void {
  const image = new Image()
  image.onload = () => {
    const context = canvas.getContext("2d")
    if (!context) return
    canvas.width = image.width
    canvas.height = image.height
    context.drawImage(image, 0, 0)
  }
  image.src = dataUrl
}
