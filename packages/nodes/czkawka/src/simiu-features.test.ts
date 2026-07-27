import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import sharp from "sharp"
import { expect, test } from "vitest"
import { extractSimiuImageFeatures, resolveSimiuWorkerCount } from "./simiu-features.js"

test("extracts the Simiu pHash, dimensions, color mean, and byte size", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xiranite-simiu-"))
  const sourcePath = join(directory, "red.png")
  try {
    await sharp({ create: { width: 16, height: 8, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toFile(sourcePath)
    const [feature] = await extractSimiuImageFeatures([sourcePath], 1)

    expect(feature).toMatchObject({ path: sourcePath, width: 16, height: 8, ratio: 2 })
    expect(feature?.phash).toMatch(/^[01]{64}$/)
    expect(feature?.meanRgb).toEqual([255, 0, 0])
    expect(feature?.size).toBeGreaterThan(0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("keeps source-compatible feature extraction worker limits", () => {
  expect(resolveSimiuWorkerCount(32, 3)).toBe(3)
  expect(resolveSimiuWorkerCount(0, 0)).toBe(0)
  expect(resolveSimiuWorkerCount(0, 1)).toBe(1)
})
