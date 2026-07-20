import sharp from "sharp"

import {
  createWicImageThumbnail,
  createWicImageThumbnailEncoded,
  getCachedSystemThumbnail,
  getCachedSystemThumbnailEncoded,
} from "../dist/index.js"

const path = process.argv[2]
const iterations = Number(process.argv[3] ?? 12)
if (!path) throw new Error("Usage: benchmark-system-thumbnail.mjs <image-path> [iterations]")

const shell = await benchmarkShell(path, iterations)
const avif = await sharp(path).resize({ width: 2000, height: 3000, fit: "inside", withoutEnlargement: false }).avif({ quality: 80 }).toBuffer()
const wic = await benchmarkWic(avif, iterations)

console.log(JSON.stringify({
  iterations,
  shell,
  wic,
}, null, 2))

async function benchmarkShell(path, iterations) {
  const raw = await getCachedSystemThumbnail({ path, maxDimension: 416 })
  if (!raw) return null
  const nativeWarm = await getCachedSystemThumbnailEncoded({ path, maxDimension: 416, format: "webp", lossless: false, quality: 82 })
  if (!nativeWarm) return null
  await encodeSharp(raw)
  const native = await measure(iterations, async () => {
    const output = await getCachedSystemThumbnailEncoded({ path, maxDimension: 416, format: "webp", lossless: false, quality: 82 })
    if (!output) throw new Error("Native encoded thumbnail disappeared during the benchmark")
    return output.data
  })
  const sharpResult = await measure(iterations, async () => {
    const image = await getCachedSystemThumbnail({ path, maxDimension: 416 })
    if (!image) throw new Error("Raw Shell thumbnail disappeared during the benchmark")
    return encodeSharp(image)
  })
  return { dimensions: [raw.width, raw.height], native, sharp: sharpResult }
}

async function benchmarkWic(input, iterations) {
  await createWicImageThumbnailEncoded({ data: input, maxDimension: 416, format: "webp", lossless: false, quality: 82 })
  const rawWarm = await createWicImageThumbnail({ data: input, maxDimension: 416 })
  await encodeSharp(rawWarm)
  const native = await measure(iterations, async () => (
    await createWicImageThumbnailEncoded({ data: input, maxDimension: 416, format: "webp", lossless: false, quality: 82 })
  ).data)
  const sharpResult = await measure(iterations, async () => {
    const image = await createWicImageThumbnail({ data: input, maxDimension: 416 })
    return encodeSharp(image)
  })
  const nativeLossless = await measure(iterations, async () => (
    await createWicImageThumbnailEncoded({ data: input, maxDimension: 416, format: "webp", lossless: true, quality: 100 })
  ).data)
  const sharpLossless = await measure(iterations, async () => {
    const image = await createWicImageThumbnail({ data: input, maxDimension: 416 })
    return encodeSharp(image, true)
  })
  return {
    inputBytes: input.byteLength,
    dimensions: [rawWarm.width, rawWarm.height],
    lossy: { native, sharp: sharpResult },
    lossless: { native: nativeLossless, sharp: sharpLossless },
  }
}

async function measure(iterations, operation) {
  const started = performance.now()
  let bytes = 0
  for (let index = 0; index < iterations; index += 1) bytes = (await operation()).byteLength
  const totalMs = performance.now() - started
  return { totalMs, perImageMs: totalMs / iterations, bytes }
}

function encodeSharp(image, lossless = false) {
  return sharp(image.rgba, {
    raw: {
      width: image.width,
      height: image.height,
      channels: 4,
      premultiplied: image.premultiplied,
    },
  }).webp({ quality: lossless ? 100 : 82, lossless, effort: 2, smartSubsample: true }).toBuffer()
}
