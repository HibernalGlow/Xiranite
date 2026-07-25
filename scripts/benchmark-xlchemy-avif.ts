import { cpus, tmpdir } from "node:os"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { performance } from "node:perf_hooks"
import { normalizeXlchemyInput, runXlchemy, type XlchemyRuntime } from "../packages/nodes/xlchemy/src/core.js"
import { createNodeXlchemyRuntime } from "../packages/nodes/xlchemy/src/platform.js"

interface CpuSnapshot { idle: number; total: number }

const threads = numberArgument("--threads", 32)
const fileCount = numberArgument("--files", 16)
const width = numberArgument("--width", 2560)
const height = numberArgument("--height", 1440)
const workspace = await mkdtemp(join(tmpdir(), "xiranite-xlchemy-avif-benchmark-"))
const inputDirectory = join(workspace, "input")
const outputDirectory = join(workspace, "output")
const baseRuntime = createNodeXlchemyRuntime()

try {
  await baseRuntime.ensureDir(inputDirectory)
  await baseRuntime.ensureDir(outputDirectory)
  const magick = await baseRuntime.resolveCommand(["magick"])
  if (!magick) throw new Error("ImageMagick is required to generate benchmark inputs.")

  for (let index = 0; index < fileCount; index += 1) {
    const generated = await baseRuntime.runCommand(magick, [
      "-size", `${width}x${height}`,
      `plasma:fractal`,
      "-seed", String(index + 1),
      "-colorspace", "sRGB",
      join(inputDirectory, `${String(index + 1).padStart(3, "0")}.png`),
    ])
    if (generated.exitCode !== 0) throw new Error(generated.stderr.trim() || "Failed to generate a benchmark input.")
  }

  let activeEncoders = 0
  let peakActiveEncoders = 0
  let encoderSeconds = 0
  const commandDurations: number[] = []
  const runtime: XlchemyRuntime = {
    ...baseRuntime,
    runCommand: async (command, args, isCancelled) => {
      const started = performance.now()
      activeEncoders += 1
      peakActiveEncoders = Math.max(peakActiveEncoders, activeEncoders)
      try {
        return await baseRuntime.runCommand(command, args, isCancelled)
      } finally {
        const duration = performance.now() - started
        commandDurations.push(duration)
        encoderSeconds += duration / 1_000
        activeEncoders -= 1
      }
    },
  }

  const cpuSamples: number[] = []
  let previousCpu = cpuSnapshot()
  const sampler = setInterval(() => {
    const currentCpu = cpuSnapshot()
    const totalDelta = currentCpu.total - previousCpu.total
    const idleDelta = currentCpu.idle - previousCpu.idle
    if (totalDelta > 0) cpuSamples.push((1 - idleDelta / totalDelta) * 100)
    previousCpu = currentCpu
  }, 250)

  const started = performance.now()
  const result = await runXlchemy(normalizeXlchemyInput({
    action: "convert",
    paths: [inputDirectory],
    format: "AVIF",
    avifEncoder: "aom",
    quality: 60,
    effort: 6,
    threads,
    outputMode: "directory",
    outputDir: outputDirectory,
    preserveStructure: false,
    preserveMetadata: false,
    metadataMode: "encoder-wipe",
    existingPolicy: "replace",
    excludedFormats: [],
    ramOptimizer: "dynamic",
  }), runtime)
  const elapsedSeconds = (performance.now() - started) / 1_000
  clearInterval(sampler)

  if (!result.success || result.data?.convertedCount !== fileCount) {
    throw new Error(result.data?.errors.join("\n") || result.message)
  }

  const sortedCpu = [...cpuSamples].sort((left, right) => left - right)
  process.stdout.write(`${JSON.stringify({
    parameters: { format: "AVIF", encoder: "aom", quality: 60, effort: 6, threads, fileCount, width, height },
    elapsedSeconds: rounded(elapsedSeconds),
    throughputFilesPerSecond: rounded(fileCount / elapsedSeconds),
    cpu: {
      averagePercent: rounded(average(cpuSamples)),
      p10Percent: rounded(percentile(sortedCpu, 0.1)),
      p50Percent: rounded(percentile(sortedCpu, 0.5)),
      p90Percent: rounded(percentile(sortedCpu, 0.9)),
      samples: cpuSamples.length,
    },
    encoders: {
      peakActive: peakActiveEncoders,
      aggregateSeconds: rounded(encoderSeconds),
      averageCommandSeconds: rounded(average(commandDurations) / 1_000),
    },
  }, null, 2)}\n`)
} finally {
  await rm(workspace, { recursive: true, force: true })
}

function numberArgument(name: string, fallback: number): number {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? Number(process.argv[index + 1]) : fallback
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`)
  return value
}

function cpuSnapshot(): CpuSnapshot {
  let idle = 0
  let total = 0
  for (const cpu of cpus()) {
    idle += cpu.times.idle
    total += Object.values(cpu.times).reduce((sum, value) => sum + value, 0)
  }
  return { idle, total }
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0
  return values[Math.min(values.length - 1, Math.floor(values.length * fraction))] ?? 0
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100
}
