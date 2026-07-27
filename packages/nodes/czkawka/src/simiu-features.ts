import { availableParallelism, cpus } from "node:os"
import { readFile, stat } from "node:fs/promises"
import sharp from "sharp"
import type { SimiuImageFeature } from "./simiu-similarity.js"

const SIMIU_COLOR_SAMPLE_SIZE = 32
type SimiuPHash = (image: Parameters<typeof sharp>[0]) => Promise<string>
let simiuPHash: Promise<SimiuPHash> | undefined

export async function extractSimiuImageFeatures(paths: readonly string[], maxWorkers: number): Promise<SimiuImageFeature[]> {
  const workers = resolveSimiuWorkerCount(maxWorkers, paths.length)
  const features: SimiuImageFeature[] = []
  let cursor = 0
  await Promise.all(Array.from({ length: workers }, async () => {
    while (cursor < paths.length) {
      const path = paths[cursor++]!
      const feature = await extractSimiuImageFeature(path)
      if (feature) features.push(feature)
    }
  }))
  return features
}

export async function extractSimiuImageFeature(path: string): Promise<SimiuImageFeature | undefined> {
  try {
    const [bytes, fileStats] = await Promise.all([readFile(path), stat(path)])
    if (!bytes.length || !fileStats.isFile()) return undefined
    const source = sharp(bytes, { animated: false, failOn: "warning", limitInputPixels: 100_000_000, sequentialRead: true })
    const metadata = await source.metadata()
    if (!metadata.width || !metadata.height) return undefined
    const [hash, color] = await Promise.all([
      calculateSimiuPHash(bytes),
      sharp(bytes, { animated: false, failOn: "warning", limitInputPixels: 100_000_000, sequentialRead: true })
        .resize(SIMIU_COLOR_SAMPLE_SIZE, SIMIU_COLOR_SAMPLE_SIZE, { fit: "fill", kernel: "lanczos3" })
        .toColourspace("srgb")
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true }),
    ])
    const meanRgb = rgbMean(color.data, color.info.channels)
    if (!meanRgb || hash.length !== 64) return undefined
    return {
      path,
      size: fileStats.size,
      modifiedDate: Math.round(fileStats.mtimeMs),
      width: metadata.width,
      height: metadata.height,
      ratio: metadata.width / metadata.height,
      meanRgb,
      phash: hash,
    }
  } catch {
    // The source implementation leaves unreadable images as singleton groups.
    return undefined
  }
}

async function calculateSimiuPHash(bytes: Buffer): Promise<string> {
  if (!simiuPHash) {
    simiuPHash = import("sharp-phash").then((module) => {
      const namespace = module as unknown as { default?: SimiuPHash }
      const candidate = namespace.default ?? module
      if (typeof candidate !== "function") throw new Error("sharp-phash did not export a pHash function.")
      return candidate
    })
  }
  return (await simiuPHash)(bytes)
}

export function resolveSimiuWorkerCount(requested: number, itemCount: number): number {
  if (!itemCount) return 0
  if (requested > 0) return Math.min(Math.max(1, Math.floor(requested)), itemCount)
  const cpuCount = typeof availableParallelism === "function" ? availableParallelism() : cpus().length
  return Math.min(16, Math.max(4, cpuCount || 4), itemCount)
}

function rgbMean(bytes: Uint8Array, channels: number): [number, number, number] | undefined {
  if (channels < 3 || bytes.length < channels) return undefined
  let red = 0
  let green = 0
  let blue = 0
  let pixels = 0
  for (let index = 0; index + 2 < bytes.length; index += channels) {
    red += bytes[index]!
    green += bytes[index + 1]!
    blue += bytes[index + 2]!
    pixels += 1
  }
  return pixels ? [red / pixels, green / pixels, blue / pixels] : undefined
}
