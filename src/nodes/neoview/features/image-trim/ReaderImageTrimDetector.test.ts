import { describe, expect, it, vi } from "vitest"

import {
  READER_IMAGE_TRIM_MAX_SAMPLE_EDGE,
  analyzeReaderImageTrimPixels,
  detectReaderImageTrim,
  readerImageTrimLineSampleCount,
  readerImageTrimSampleDimensions,
} from "./ReaderImageTrimDetector"

describe("ReaderImageTrimDetector", () => {
  it("[neoview.image-trim.detect-black-white] recognizes explicit black and white borders", () => {
    const signal = new AbortController().signal
    expect(analyzeReaderImageTrimPixels(borderedPixels(100, 80, 10, [0, 0, 0]), 100, 80, {
      threshold: 5,
      target: "black",
      signal,
    })).toEqual({ top: 12.5, bottom: 12.5, left: 10, right: 10 })
    expect(analyzeReaderImageTrimPixels(borderedPixels(100, 80, 8, [255, 255, 255]), 100, 80, {
      threshold: 5,
      target: "white",
      signal,
    })).toEqual({ top: 10, bottom: 10, left: 8, right: 8 })
  })

  it("[neoview.image-trim.detect-auto] derives the target color from the four corners", () => {
    const result = analyzeReaderImageTrimPixels(borderedPixels(100, 100, 15, [23, 31, 42]), 100, 100, {
      threshold: 1,
      target: "auto",
      signal: new AbortController().signal,
    })
    expect(result).toEqual({ top: 15, bottom: 15, left: 15, right: 15 })
  })

  it("[neoview.image-trim.sample-budget] bounds canvas allocation to a 512px longest edge", async () => {
    expect(readerImageTrimSampleDimensions(6000, 4000)).toEqual({ width: READER_IMAGE_TRIM_MAX_SAMPLE_EDGE, height: 341 })
    for (const length of [1, 128, 129, 255, 341, 512]) {
      expect(readerImageTrimLineSampleCount(length)).toBeLessThanOrEqual(128)
    }
    const drawImage = vi.fn()
    const getImageData = vi.fn(() => ({ data: borderedPixels(512, 341, 0, [0, 0, 0]) }))
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage, getImageData } as unknown as CanvasRenderingContext2D)
    const image = document.createElement("img")
    Object.defineProperties(image, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 6000 },
      naturalHeight: { configurable: true, value: 4000 },
    })

    await detectReaderImageTrim(image, { threshold: 5, target: "black", signal: new AbortController().signal })

    expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 512, 341)
    expect(getImageData).toHaveBeenCalledWith(0, 0, 512, 341)
    vi.restoreAllMocks()
  })
})

function borderedPixels(
  width: number,
  height: number,
  border: number,
  borderColor: readonly [number, number, number],
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const color = x < border || x >= width - border || y < border || y >= height - border
        ? borderColor
        : [120, 70, 190] as const
      pixels[offset] = color[0]
      pixels[offset + 1] = color[1]
      pixels[offset + 2] = color[2]
      pixels[offset + 3] = 255
    }
  }
  return pixels
}
