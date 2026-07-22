import { describe, expect, it } from "vitest"

import { edgeFrameToPresentation, sampleEdgeColorsFromPixels } from "./edgeMatchBackground"

function solid(width: number, height: number, fill: [number, number, number]): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4
    pixels[offset] = fill[0]
    pixels[offset + 1] = fill[1]
    pixels[offset + 2] = fill[2]
    pixels[offset + 3] = 255
  }
  return pixels
}

function setPixel(pixels: Uint8ClampedArray, width: number, x: number, y: number, rgb: [number, number, number]): void {
  const offset = (y * width + x) * 4
  pixels[offset] = rgb[0]
  pixels[offset + 1] = rgb[1]
  pixels[offset + 2] = rgb[2]
  pixels[offset + 3] = 255
}

describe("edgeMatchBackground", () => {
  it("[neoview.ambient-background.edge-sample] keeps four solid edges independent", () => {
    const width = 32
    const height = 24
    const pixels = solid(width, height, [10, 10, 10])
    for (let x = 0; x < width; x += 1) {
      setPixel(pixels, width, x, 0, [200, 20, 20])
      setPixel(pixels, width, x, height - 1, [20, 200, 20])
    }
    for (let y = 0; y < height; y += 1) {
      setPixel(pixels, width, 0, y, [20, 20, 200])
      setPixel(pixels, width, width - 1, y, [200, 200, 20])
    }

    const frame = sampleEdgeColorsFromPixels(pixels, width, height, 5, 1)
    expect(frame.top[2]).toBe("#c81414")
    expect(frame.bottom[2]).toBe("#14c814")
    expect(frame.left[2]).toBe("#1414c8")
    expect(frame.right[2]).toBe("#c8c814")
  })

  it("[neoview.ambient-background.edge-render] keeps pure white edges white", () => {
    const white = Array.from({ length: 6 }, () => "#ffffff")
    const presentation = edgeFrameToPresentation({ top: white, right: white, bottom: white, left: white })
    expect(presentation.average).toBe("#ffffff")
    expect(presentation.css).toContain("#ffffff")
  })
})
