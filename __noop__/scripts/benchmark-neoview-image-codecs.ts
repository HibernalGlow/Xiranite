import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import sharp from "sharp"

type SourceFormat = "jpeg" | "webp" | "avif" | "jxl"
type Engine = "sharp" | "wic"

interface WorkerResult {
  format: SourceFormat
  engine: Engine
  iterations: number
  inputBytes: number
  outputBytes: number
  p50Ms: number
  p95Ms: number
  averageMs: number
  operationsPerSecond: number
  peakRssDeltaBytes: number
}

const args = parseArgs({
  options: {
    worker: { type: "boolean", default: false },
    format: { type: "string" },
    engine: { type: "string" },
    source: { type: "string" },
    iterations: { type: "string", default: "10" },
    warmup: { type: "string", default: "3" },
    output: { type: "string" },
  },
})

const iterations = positiveInteger(args.values.iterations, "iterations", 1_000)
const warmup = positiveInteger(args.values.warmup, "warmup", 100)

if (args.values.worker) {
  const format = sourceFormat(args.values.format)
  const engine = benchmarkEngine(args.values.engine)
  if (!args.values.source) throw new Error("--source is required in worker mode.")
  process.stdout.write(`${JSON.stringify(await benchmarkWorker(format, engine, args.values.source, iterations, warmup))}\n`)
} else {
  await benchmarkMatrix(iterations, warmup)
}

async function benchmarkMatrix(iterationCount: number, warmupCount: number): Promise<void> {
  if (process.platform !== "win32") throw new Error("The WIC comparison benchmark requires Windows.")
  const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-codecs-"))
  try {
    const sources = await createSources(directory)
    const results: WorkerResult[] = []
    for (const format of Object.keys(sources) as SourceFormat[]) {
      for (const engine of ["sharp", "wic"] as const) {
        results.push(await runWorker(format, engine, sources[format], iterationCount, warmupCount))
      }
    }
    const report = JSON.stringify({
      corpus: { width: 3840, height: 2160, generated: true },
      output: { format: "webp", maxDimension: 416, quality: 82 },
      runtime: {
        sharp: sharp.versions.sharp,
        vips: sharp.versions.vips,
        jxl: sharp.format.jxl.input.buffer && sharp.format.jxl.output.buffer,
      },
      results,
    }, null, 2)
    if (args.values.output) await writeFile(resolve(args.values.output), `${report}\n`)
    process.stdout.write(`${report}\n`)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function createSources(directory: string): Promise<Record<SourceFormat, string>> {
  if (!sharp.format.jxl.input.buffer || !sharp.format.jxl.output.buffer) {
    throw new Error("This benchmark requires the JXL-capable sharp runtime.")
  }
  const width = 3840
  const height = 2160
  const pixels = Buffer.allocUnsafe(width * height * 3)
  for (let y = 0, offset = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1, offset += 3) {
      const detail = ((x * 17) ^ (y * 31) ^ ((x * y) >>> 5)) & 0xff
      pixels[offset] = (x * 255 / width + detail * 0.35) & 0xff
      pixels[offset + 1] = (y * 255 / height + detail * 0.25) & 0xff
      pixels[offset + 2] = (((x + y) * 127 / (width + height)) + detail * 0.5) & 0xff
    }
  }
  const image = sharp(pixels, { raw: { width, height, channels: 3 } })
  const encoded: Record<SourceFormat, Uint8Array> = {
    jpeg: await image.clone().jpeg({ quality: 90, mozjpeg: true }).toBuffer(),
    webp: await image.clone().webp({ quality: 90, smartSubsample: true }).toBuffer(),
    avif: await image.clone().avif({ quality: 70, effort: 4 }).toBuffer(),
    jxl: await image.clone().jxl({ quality: 90 }).toBuffer(),
  }
  const paths = {} as Record<SourceFormat, string>
  for (const format of Object.keys(encoded) as SourceFormat[]) {
    const path = join(directory, `source.${format === "jpeg" ? "jpg" : format}`)
    await writeFile(path, encoded[format])
    paths[format] = path
  }
  return paths
}

async function runWorker(format: SourceFormat, engine: Engine, source: string, iterationCount: number, warmupCount: number): Promise<WorkerResult> {
  const child = Bun.spawn([
    process.execPath,
    import.meta.path,
    "--worker",
    `--format=${format}`,
    `--engine=${engine}`,
    `--source=${source}`,
    `--iterations=${iterationCount}`,
    `--warmup=${warmupCount}`,
  ], { stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(`${format}/${engine} benchmark failed: ${stderr.trim() || `exit ${exitCode}`}`)
  return JSON.parse(stdout) as WorkerResult
}

async function benchmarkWorker(format: SourceFormat, engine: Engine, source: string, iterationCount: number, warmupCount: number): Promise<WorkerResult> {
  const input = await readFile(source)
  const transform = engine === "sharp" ? sharpTransform : wicTransform
  const baselineRss = process.memoryUsage.rss()
  let peakRss = baselineRss
  for (let index = 0; index < warmupCount; index += 1) {
    await transform(input)
    peakRss = Math.max(peakRss, process.memoryUsage.rss())
  }
  Bun.gc(true)
  let outputBytes = 0
  const samples: number[] = []
  for (let index = 0; index < iterationCount; index += 1) {
    const started = performance.now()
    const output = await transform(input)
    samples.push(performance.now() - started)
    outputBytes = output.byteLength
    peakRss = Math.max(peakRss, process.memoryUsage.rss())
  }
  samples.sort((left, right) => left - right)
  const total = samples.reduce((sum, sample) => sum + sample, 0)
  return {
    format,
    engine,
    iterations: iterationCount,
    inputBytes: input.byteLength,
    outputBytes,
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    averageMs: total / samples.length,
    operationsPerSecond: samples.length * 1_000 / total,
    peakRssDeltaBytes: Math.max(0, peakRss - baselineRss),
  }
}

async function sharpTransform(input: Uint8Array): Promise<Uint8Array> {
  return sharp(input, { sequentialRead: true })
    .rotate()
    .resize({ width: 416, height: 416, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82, smartSubsample: true })
    .toBuffer()
}

async function wicTransform(input: Uint8Array): Promise<Uint8Array> {
  const { createWicImageThumbnail } = await import("@xiranite/arcthumb-native")
  const decoded = await createWicImageThumbnail({ data: input, maxDimension: 416 })
  return sharp(decoded.rgba, {
    raw: { width: decoded.width, height: decoded.height, channels: 4, premultiplied: decoded.premultiplied },
  }).webp({ quality: 82, smartSubsample: true }).toBuffer()
}

function percentile(sorted: number[], ratio: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]!
}

function positiveInteger(value: string | undefined, label: string, maximum: number): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`--${label} must be an integer from 1 to ${maximum}.`)
  }
  return parsed
}

function sourceFormat(value: string | undefined): SourceFormat {
  if (value === "jpeg" || value === "webp" || value === "avif" || value === "jxl") return value
  throw new Error("--format must be jpeg, webp, avif, or jxl.")
}

function benchmarkEngine(value: string | undefined): Engine {
  if (value === "sharp" || value === "wic") return value
  throw new Error("--engine must be sharp or wic.")
}
