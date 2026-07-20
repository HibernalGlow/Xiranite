import { describe, expect, it } from "vitest"

import { imageTransformCacheKey, parseImageTransform } from "./image-transform.js"

describe("image transform request", () => {
  it("[neoview.image.transform-query] leaves the original asset path untouched without transform parameters", () => {
    expect(parseImageTransform(new URLSearchParams("token=opaque&version=v1"))).toBeUndefined()
  })

  it("[neoview.image.transform-query] normalizes viewport dimensions, DPR, fit, format and quality", () => {
    const request = parseImageTransform(new URLSearchParams(
      "width=800&height=1200&dpr=1.5&fit=contain&format=avif&quality=75",
    ))!
    expect(request).toEqual({ width: 800, height: 1200, dpr: 1.5, fit: "contain", format: "avif", quality: 75 })
    expect(imageTransformCacheKey(request)).toBe("800:1200:1.5:contain:avif:75")
  })

  it("[neoview.image.transform-query] defaults resized output to bounded WebP without cropping", () => {
    expect(parseImageTransform(new URLSearchParams("width=640"))).toEqual({
      width: 640,
      height: undefined,
      dpr: 1,
      fit: "inside",
      format: "webp",
      quality: 82,
    })
  })

  it("[neoview.image.transform-lossless] accepts caller-selected WebP loss mode and quality", () => {
    const lossless = parseImageTransform(new URLSearchParams("width=640&format=webp&lossless=true&quality=100"))!
    const lossy = parseImageTransform(new URLSearchParams("width=640&format=webp&lossless=false&quality=68"))!
    expect(lossless).toMatchObject({ format: "webp", lossless: true, quality: 100 })
    expect(lossy).toMatchObject({ format: "webp", lossless: false, quality: 68 })
    expect(imageTransformCacheKey(lossless)).toContain(":lossless:")
    expect(imageTransformCacheKey(lossy)).not.toContain(":lossless:")
  })

  it("[neoview.image.transform-validation] rejects duplicates, invalid combinations and oversized DPR output", () => {
    expect(() => parseImageTransform(new URLSearchParams("width=1&width=2"))).toThrow("Duplicate")
    expect(() => parseImageTransform(new URLSearchParams("dpr=2"))).toThrow("require width or height")
    expect(() => parseImageTransform(new URLSearchParams("quality=80"))).toThrow("requires format")
    expect(() => parseImageTransform(new URLSearchParams("width=10000&dpr=2"))).toThrow("must not exceed")
    expect(() => parseImageTransform(new URLSearchParams("width=20&format=jxl"))).toThrow("Unsupported format")
    expect(() => parseImageTransform(new URLSearchParams("width=20&lossless=maybe"))).toThrow("true or false")
  })
})
