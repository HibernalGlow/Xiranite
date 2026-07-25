import { availableParallelism, cpus, tmpdir } from "node:os"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { performance } from "node:perf_hooks"
import { normalizeXlchemyInput, runXlchemy, type XlchemyRuntime } from "../packages/nodes/xlchemy/src/core.js"
import { createNodeXlchemyRuntime } from "../packages/nodes/xlchemy/src/platform.js"

interface CpuSnapshot { idle: number; total: number }
interface CpuSample { percent: number; activeEncoders: number; weight: number }

const threads = numberArgument("--threads", Math.max(1, availableParallelism() - 1))
const fileCount = numberArgument("--files", 32)
const width = numberArgument("--width", 2560)
const height = numberArgument("--height", 1440)
const parallelOnly = process.argv.includes("--parallel-only")
const workspace = await mkdtemp(join(tmpdir(), "xiranite-xlchemy-avif-benchmark-"))
const inputDirectory = join(workspace, "input")
const baseRuntime = createNodeXlchemyRuntime()

try {
  await baseRuntime.ensureDir(inputDirectory)
  const magick = await baseRuntime.resolveCommand(["magick"])
  if (!magick) throw new Error("ImageMagick is required to generate benchmark inputs.")

  const firstInput = join(inputDirectory, "001.png")
  const generated = await baseRuntime.runCommand(magick, [
    "-seed", "1",
    "-size", `${width}x${height}`,
    "plasma:fractal",
    "-colorspace", "sRGB",
    firstInput,
  ])
  if (generated.exitCode !== 0) throw new Error(generated.stderr.trim() || "Failed to generate a benchmark input.")
  for (let index = 1; index < fileCount; index += 1) {
    await baseRuntime.copyFile(firstInput, join(inputDirectory, `${String(index + 1).padStart(3, "0")}.png`))
  }

  const baseline = parallelOnly ? undefined : await benchmark("sequential")
  const parallel = await benchmark("original")
  process.stdout.write(`${JSON.stringify({
    parameters: { format: "AVIF", encoder: "aom", quality: 60, effort: 6, threads, fileCount, width, height },
    baseline,
    parallel,
    improvement: baseline ? {
      elapsedPercent: rounded((1 - parallel.elapsedSeconds / baseline.elapsedSeconds) * 100),
      throughputPercent: rounded((parallel.throughputFilesPerSecond / baseline.throughputFilesPerSecond - 1) * 100),
      averageCpuPoints: rounded(parallel.cpu.averagePercent - baseline.cpu.averagePercent),
      p10CpuPoints: rounded(parallel.cpu.p10Percent - baseline.cpu.p10Percent),
    } : undefined,
  }, null, 2)}\n`)
} finally {
  await rm(workspace, { recursive: true, force: true })
}

async function benchmark(processingOrder: "sequential" | "original") {
  const benchmarkRuntime = createNodeXlchemyRuntime()
  const outputDirectory = join(workspace, processingOrder)
  await benchmarkRuntime.ensureDir(outputDirectory)
  let activeEncoders = 0
  let peakActiveEncoders = 0
  let encoderSeconds = 0
  const commandDurations: number[] = []
  const schedulerLogs: string[] = []
  const runtime: XlchemyRuntime = {
    ...benchmarkRuntime,
    runCommand: async (command, args, isCancelled) => {
      const started = performance.now()
      activeEncoders += 1
      peakActiveEncoders = Math.max(peakActiveEncoders, activeEncoders)
      try {
        return await benchmarkRuntime.runCommand(command, args, isCancelled)
      } finally {
        const duration = performance.now() - started
        commandDurations.push(duration)
        encoderSeconds += duration / 1_000
        activeEncoders -= 1
      }
    },
  }

  const cpuSamples: CpuSample[] = []
  let previousCpu = cpuSnapshot()
  const sampler = setInterval(() => {
    const currentCpu = cpuSnapshot()
    const totalDelta = currentCpu.total - previousCpu.total
    const idleDelta = currentCpu.idle - previousCpu.idle
    if (totalDelta > 0) cpuSamples.push({ percent: (1 - idleDelta / totalDelta) * 100, activeEncoders, weight: totalDelta })
    previousCpu = currentCpu
  }, 250)

  const started = performance.now()
  let result
  try {
    result = await runXlchemy(normalizeXlchemyInput({
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
      processingOrder,
      excludedFormats: [],
      ramOptimizer: "dynamic",
    }), runtime, (event) => {
      if (event.type === "log" && (event.message.startsWith("Batch scheduler:") || event.message.startsWith("Batch completed"))) schedulerLogs.push(event.message)
    })
  } finally {
    clearInterval(sampler)
  }
  const elapsedSeconds = (performance.now() - started) / 1_000

  if (!result.success || result.data?.convertedCount !== fileCount) {
    throw new Error(result.data?.errors.join("\n") || result.message)
  }

  const expectedEncoders = processingOrder === "sequential" ? 1 : Math.min(threads, fileCount)
  const saturatedSamples = cpuSamples.filter((sample) => sample.activeEncoders >= expectedEncoders)
  const commandDurationsSorted = [...commandDurations].sort((left, right) => left - right)
  return {
    elapsedSeconds: rounded(elapsedSeconds),
    throughputFilesPerSecond: rounded(fileCount / elapsedSeconds),
    cpu: {
      averagePercent: rounded(weightedAverage(cpuSamples)),
      p10Percent: rounded(weightedPercentile(cpuSamples, 0.1)),
      p50Percent: rounded(weightedPercentile(cpuSamples, 0.5)),
      p90Percent: rounded(weightedPercentile(cpuSamples, 0.9)),
      samples: cpuSamples.length,
      timeAtOrAbove90Percent: rounded(weightShare(cpuSamples.filter((sample) => sample.percent >= 90), cpuSamples) * 100),
      whileSchedulerFull: {
        expectedEncoders,
        samples: saturatedSamples.length,
        timeSharePercent: rounded(weightShare(saturatedSamples, cpuSamples) * 100),
        averagePercent: rounded(weightedAverage(saturatedSamples)),
        p10Percent: rounded(weightedPercentile(saturatedSamples, 0.1)),
        p90Percent: rounded(weightedPercentile(saturatedSamples, 0.9)),
      },
    },
    encoders: {
      peakActive: peakActiveEncoders,
      averageActiveWhileRunning: rounded(encoderSeconds / elapsedSeconds),
      aggregateSeconds: rounded(encoderSeconds),
      averageCommandSeconds: rounded(average(commandDurations) / 1_000),
      p10CommandSeconds: rounded(percentile(commandDurationsSorted, 0.1) / 1_000),
      p90CommandSeconds: rounded(percentile(commandDurationsSorted, 0.9) / 1_000),
    },
    schedulerLogs,
  }
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

function weightedAverage(samples: CpuSample[]): number {
  const totalWeight = samples.reduce((sum, sample) => sum + sample.weight, 0)
  return totalWeight ? samples.reduce((sum, sample) => sum + sample.percent * sample.weight, 0) / totalWeight : 0
}

function weightedPercentile(samples: CpuSample[], fraction: number): number {
  if (!samples.length) return 0
  const sorted = [...samples].sort((left, right) => left.percent - right.percent)
  const target = sorted.reduce((sum, sample) => sum + sample.weight, 0) * fraction
  let cumulative = 0
  for (const sample of sorted) {
    cumulative += sample.weight
    if (cumulative >= target) return sample.percent
  }
  return sorted.at(-1)?.percent ?? 0
}

function weightShare(samples: CpuSample[], allSamples: CpuSample[]): number {
  const totalWeight = allSamples.reduce((sum, sample) => sum + sample.weight, 0)
  return totalWeight ? samples.reduce((sum, sample) => sum + sample.weight, 0) / totalWeight : 0
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100
}
