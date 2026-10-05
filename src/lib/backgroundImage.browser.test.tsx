import { describe, expect, test } from "vitest"

import {
  BACKGROUND_IMAGE_MAX_DATA_URL_BYTES,
  BACKGROUND_IMAGE_MAX_EDGE,
  BackgroundImageTooLargeError,
  estimateBackgroundImageBytes,
  fitBackgroundImageEdge,
  isBackgroundImageDataUrl,
  prepareBackgroundImage,
  shrinkStoredBackgroundImageUrl,
} from "./backgroundImage"
import { createNoisePngFile, readBlobAsDataUrl } from "@/test/noiseImageFixture"

async function decodeSize(dataUrl: string): Promise<{ width: number; height: number }> {
  const blob = await (await fetch(dataUrl)).blob()
  const bitmap = await createImageBitmap(blob)
  try {
    return { width: bitmap.width, height: bitmap.height }
  } finally {
    bitmap.close()
  }
}

describe("background image resize plan", () => {
  test("caps the longest edge and keeps the aspect ratio", () => {
    expect(fitBackgroundImageEdge(4000, 1000)).toEqual({ width: 2048, height: 512 })
    expect(fitBackgroundImageEdge(3000, 2000)).toEqual({ width: 2048, height: 1365 })
  })

  test("leaves images that already fit untouched", () => {
    expect(fitBackgroundImageEdge(1920, 1080)).toEqual({ width: 1920, height: 1080 })
    expect(fitBackgroundImageEdge(100, 100, 50)).toEqual({ width: 50, height: 50 })
  })

  test("estimates payload bytes of a base64 data URL", () => {
    const payload = "a".repeat(400)
    expect(isBackgroundImageDataUrl(`data:image/png;base64,${payload}`)).toBe(true)
    expect(isBackgroundImageDataUrl("https://example.com/bg.png")).toBe(false)
    expect(estimateBackgroundImageBytes(`data:image/png;base64,${payload}`)).toBe(300)
    expect(estimateBackgroundImageBytes("C:/Images/bg.png")).toBe("C:/Images/bg.png".length)
  })
})

describe("background image compression", () => {
  test("shrinks an oversized image below the data URL cap", async () => {
    const file = await createNoisePngFile(1600, 1200)
    expect(file.size).toBeGreaterThan(BACKGROUND_IMAGE_MAX_DATA_URL_BYTES)

    const prepared = await prepareBackgroundImage(file)

    expect(prepared.recompressed).toBe(true)
    expect(prepared.outputBytes).toBeLessThanOrEqual(BACKGROUND_IMAGE_MAX_DATA_URL_BYTES)
    expect(prepared.width).toBeLessThanOrEqual(BACKGROUND_IMAGE_MAX_EDGE)
    expect(prepared.height).toBeLessThanOrEqual(BACKGROUND_IMAGE_MAX_EDGE)
    expect(estimateBackgroundImageBytes(prepared.dataUrl)).toBe(prepared.outputBytes)
  }, 60_000)

  test("keeps the aspect ratio while shrinking", async () => {
    // 最长边超过上限才测得出缩放：直通也能保住比例，只有必须缩小才证明这条路径在跑。
    const prepared = await prepareBackgroundImage(await createNoisePngFile(3000, 1200))
    const decoded = await decodeSize(prepared.dataUrl)

    expect(prepared.recompressed).toBe(true)
    expect(prepared.width).toBe(BACKGROUND_IMAGE_MAX_EDGE)
    expect(decoded.width).toBe(prepared.width)
    expect(decoded.height).toBe(prepared.height)
    expect(Math.abs(decoded.width / decoded.height - 3000 / 1200)).toBeLessThan(0.05)
  }, 60_000)

  test("passes a small image through without re-encoding", async () => {
    const file = await createNoisePngFile(240, 160)
    const prepared = await prepareBackgroundImage(file)

    expect(prepared.recompressed).toBe(false)
    expect(prepared.sourceBytes).toBe(file.size)
    expect(prepared.dataUrl).toBe(await readBlobAsDataUrl(file))
  }, 60_000)

  test("refuses an undecodable image above the cap instead of storing it", async () => {
    const huge = new Blob([new Uint8Array(BACKGROUND_IMAGE_MAX_DATA_URL_BYTES + 1)], { type: "image/svg+xml" })
    await expect(prepareBackgroundImage(huge)).rejects.toBeInstanceOf(BackgroundImageTooLargeError)
  })

  test("shrinks a stored oversized data URL but leaves plain URLs alone", async () => {
    expect(await shrinkStoredBackgroundImageUrl("D:/wallpaper.png")).toBe("D:/wallpaper.png")
    expect(await shrinkStoredBackgroundImageUrl("https://example.com/bg.jpg")).toBe("https://example.com/bg.jpg")

    const oversized = await readBlobAsDataUrl(await createNoisePngFile(1600, 1200))
    expect(estimateBackgroundImageBytes(oversized)).toBeGreaterThan(BACKGROUND_IMAGE_MAX_DATA_URL_BYTES)

    const shrunk = await shrinkStoredBackgroundImageUrl(oversized)
    expect(estimateBackgroundImageBytes(shrunk)).toBeLessThanOrEqual(BACKGROUND_IMAGE_MAX_DATA_URL_BYTES)
  }, 60_000)
})
