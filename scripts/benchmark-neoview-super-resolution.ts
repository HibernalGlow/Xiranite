#!/usr/bin/env bun

import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { access, mkdir, mkdtemp, rm, symlink } from "node:fs/promises"
import { cpus, tmpdir, totalmem } from "node:os"
import { dirname, join, resolve } from "node:path"
import { performance } from "node:perf_hooks"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"

import sharp from "sharp"

import type { NeoviewSuperResolutionConfig } from "../packages/nodes/neoview/src/application/config/ReaderRuntimeConfig.js"
import type { SuperResolutionCustomModelManifest, SuperResolutionEngine } from "../packages/nodes/neoview/src/ports/SuperResolutionProvider.js"
import { SystemSuperResolutionCliResolver } from "../packages/nodes/neoview/src/platform/super-resolution/SystemSuperResolutionCliResolver.js"
import { createOpenComicAiSystemCapability } from "../packages/nodes/neoview/src/platform/super-resolution/opencomic-system/OpenComicAiSystemComposition.js"
import { loadOpenComicSystemRuntime } from "../packages/nodes/neoview/src/platform/super-resolution/opencomic-system/OpenComicSystemRuntimeLoader.js"

const execFileAsync = promisify(execFile)
const ASSERT = process.argv.includes("--assert")
const PROBE_ONLY = process.argv.includes("--probe-only")
const RUNS = boundedInteger(Number(argument("--runs") ?? process.env.NEOVIEW_UPSCALE_BENCH_RUNS ?? 2), 1, 10, "runs")
const UPSCAYL_DAEMONS = boundedInteger(Number(argument("--upscayl-daemons") ?? process.env.NEOVIEW_UPSCALE_DAEMONS ?? 1), 0, 8, "upscayl daemons")
const RUNTIME_SPECIFIER = argument("--runtime") ?? process.env.NEOVIEW_UPSCALE_RUNTIME ?? "@hibernalglow/opencomic-ai-system"
const selectedEngines = parseEngines(argument("--engines") ?? process.env.NEOVIEW_UPSCALE_ENGINES ?? "upscayl,waifu2x,realcugan")
if (ASSERT && RUNS < 2) throw new Error("--assert requires at least two runs per engine for cold/warm evidence.")
const budgets = {
  coldMs: positiveNumber(Number(process.env.NEOVIEW_UPSCALE_MAX_COLD_MS ?? 60_000), "NEOVIEW_UPSCALE_MAX_COLD_MS"),
  warmP95Ms: positiveNumber(Number(process.env.NEOVIEW_UPSCALE_MAX_WARM_P95_MS ?? 30_000), "NEOVIEW_UPSCALE_MAX_WARM_P95_MS"),
  rssDeltaMiB: positiveNumber(Number(process.env.NEOVIEW_UPSCALE_MAX_RSS_DELTA_MIB ?? 1_024), "NEOVIEW_UPSCALE_MAX_RSS_DELTA_MIB"),
  gpuDeltaMiB: positiveNumber(Number(process.env.NEOVIEW_UPSCALE_MAX_GPU_DELTA_MIB ?? 6_144), "NEOVIEW_UPSCALE_MAX_GPU_DELTA_MIB"),
}

const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-upscale-benchmark-"))
const inputPath = join(root, "input.png")
const modelRoot = join(root, "models")
const outputRoot = join(root, "output")
const resolver = new SystemSuperResolutionCliResolver()
const rssBefore = process.memoryUsage().rss
let peakRss = rssBefore
let capability: Awaited<ReturnType<typeof createOpenComicAiSystemCapability>>
let runtime: Awaited<ReturnType<typeof loadRuntime>> | undefined

try {
  const capabilities = await resolver.capabilities({ refresh: true })
  const selectedCapabilities = capabilities.engines.filter((entry) => selectedEngines.includes(entry.engine))
  if (selectedCapabilities.some((entry) => !entry.available || !entry.executablePath)) {
    throw new Error(`Required system CLI is unavailable: ${JSON.stringify(selectedCapabilities)}`)
  }
  const processBaseline = await engineProcessCounts()
  const installedExecutables = Object.fromEntries(await Promise.all(selectedCapabilities.map(async (entry) => [
    entry.engine,
    await resolveInstalledExecutable(entry.engine, entry.executablePath!),
  ])))
  const prepared = await prepareSystemModels(modelRoot, installedExecutables)
  await mkdir(outputRoot, { recursive: true })
  await createInput(inputPath)

  if (PROBE_ONLY) {
    process.stdout.write(`${JSON.stringify({
      benchmark: "neoview-super-resolution-system",
      benchmarkIds: ["upscale-cold", "upscale-warm"],
      probeOnly: true,
      runtimeSpecifier: RUNTIME_SPECIFIER,
      capabilities: selectedCapabilities,
      models: prepared.models.map(({ engine, modelId, scale }) => ({ engine, modelId, scale })),
    }, null, 2)}\n`)
    process.exitCode = 0
  } else {
    runtime = await loadRuntime(RUNTIME_SPECIFIER)
    const config: NeoviewSuperResolutionConfig = {
      provider: "opencomic-system",
      maxDaemonsPerGpu: UPSCAYL_DAEMONS,
      daemonIdleTimeoutMs: 30_000,
      taskTimeoutMs: Math.max(60_000, budgets.coldMs * 2),
      customModels: prepared.customModels,
      modelsDirectory: modelRoot,
      preferences: { schemaVersion: 1, conditions: [] },
    }
    capability = await createOpenComicAiSystemCapability({
      runtimeConfig: config,
      loadRuntime: async () => runtime!,
      cliResolver: resolver,
      modelsDirectory: modelRoot,
    })
    if (!capability) throw new Error("OpenComic system capability is unavailable.")

    const gpu = await gpuSnapshot()
    const gpuBeforeMiB = gpu?.usedMiB
    let peakGpuMiB = gpuBeforeMiB
    const measurements: Measurement[] = []
    for (const model of prepared.models.filter((entry) => selectedEngines.includes(entry.engine))) {
      for (let run = 0; run < RUNS; run += 1) {
        const destinationPath = join(outputRoot, `${model.engine}-${run}.png`)
        const sampled = await runWithGpuSampling(async () => await capability!.service.run({
            sourcePath: inputPath,
            destinationPath,
            modelId: model.modelId,
            scale: model.scale,
            noise: model.noise,
            tileSize: model.tileSize,
            gpuId: "0",
            priority: "background",
        }))
        const result = sampled.result
        const metadata = await sharp(destinationPath).metadata()
        if (metadata.width !== prepared.input.width * model.scale || metadata.height !== prepared.input.height * model.scale) {
          throw new Error(`${model.engine} output dimensions are invalid: ${metadata.width}x${metadata.height}`)
        }
        peakRss = Math.max(peakRss, process.memoryUsage().rss)
        if (sampled.peakUsedMiB !== undefined) peakGpuMiB = Math.max(peakGpuMiB ?? sampled.peakUsedMiB, sampled.peakUsedMiB)
        measurements.push({
          engine: model.engine,
          modelId: model.modelId,
          run,
          phase: run === 0 ? "cold" : "warm",
          wallMs: round(sampled.workMs),
          providerMs: round(result.elapsedMs),
          outputBytes: (await Bun.file(destinationPath).arrayBuffer()).byteLength,
          outputSha256: await sha256(destinationPath),
          width: metadata.width,
          height: metadata.height,
        })
      }
    }

    await capability.service.dispose()
    capability = undefined
    await delay(500)
    const processAfter = await engineProcessCounts()
    const residualProcesses = Object.fromEntries(Object.entries(processAfter)
      .map(([name, count]) => [name, Math.max(0, count - (processBaseline[name] ?? 0))])
      .filter(([, count]) => count > 0))
    const report = {
      benchmark: "neoview-super-resolution-system",
      benchmarkIds: ["upscale-cold", "upscale-warm"],
      runtime: `Bun ${Bun.version}`,
      platform: `${process.platform}-${process.arch}`,
      host: {
        cpu: cpus()[0]?.model,
        memoryMiB: round(totalmem() / 1024 / 1024),
        gpu: gpu ? { name: gpu.name, driverVersion: gpu.driverVersion, totalMiB: gpu.totalMiB } : undefined,
      },
      runtimeSpecifier: RUNTIME_SPECIFIER,
      capabilities: selectedCapabilities,
      input: { ...prepared.input, sha256: await sha256(inputPath) },
      runs: RUNS,
      upscaylDaemons: UPSCAYL_DAEMONS,
      measurements,
      summaries: Object.fromEntries(selectedEngines.map((engine) => {
        const values = measurements.filter((entry) => entry.engine === engine)
        return [engine, {
          coldMs: values[0]?.wallMs,
          warm: summarize(values.filter((entry) => entry.phase === "warm").map((entry) => entry.wallMs)),
        }]
      })),
      memory: {
        rssBeforeMiB: round(rssBefore / 1024 / 1024),
        peakRssMiB: round(peakRss / 1024 / 1024),
        rssDeltaMiB: round((peakRss - rssBefore) / 1024 / 1024),
        gpuBeforeMiB,
        peakGpuMiB,
        gpuDeltaMiB: gpuBeforeMiB === undefined || peakGpuMiB === undefined ? undefined : round(peakGpuMiB - gpuBeforeMiB),
      },
      residualProcesses,
      budgets,
    }
    if (ASSERT) assertReport(report)
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  }
} finally {
  await capability?.service.dispose().catch(() => undefined)
  await Promise.resolve(runtime?.closeAllProcesses()).catch(() => undefined)
  await rm(root, { recursive: true, force: true }).catch(() => undefined)
}

interface PreparedModel {
  engine: SuperResolutionEngine
  modelId: string
  scale: number
  noise?: number
  tileSize?: number
}

interface Measurement {
  engine: SuperResolutionEngine
  modelId: string
  run: number
  phase: "cold" | "warm"
  wallMs: number
  providerMs: number
  outputBytes: number
  outputSha256: string
  width?: number
  height?: number
}

async function prepareSystemModels(
  rootPath: string,
  executables: Partial<Record<SuperResolutionEngine, string>>,
): Promise<{ input: { width: number; height: number }; customModels: SuperResolutionCustomModelManifest[]; models: PreparedModel[] }> {
  await mkdir(rootPath, { recursive: true })
  const models: PreparedModel[] = []
  const customModels: SuperResolutionCustomModelManifest[] = []
  if (executables.waifu2x) {
    await linkDirectory(join(dirname(executables.waifu2x), "models-cunet"), join(rootPath, "upscale", "waifu2x", "models-cunet"))
    models.push({ engine: "waifu2x", modelId: "waifu2x-models-cunet", scale: 2, noise: 0, tileSize: 128 })
  }
  if (executables.realcugan) {
    await linkDirectory(join(dirname(executables.realcugan), "models-se"), join(rootPath, "upscale", "realcugan", "models-se"))
    models.push({ engine: "realcugan", modelId: "realcugan", scale: 2, noise: 0, tileSize: 128 })
  }
  if (executables.upscayl) {
    const installedModels = resolve(dirname(executables.upscayl), "..", "models")
    const modelName = "upscayl-lite-4x"
    const files = [`${modelName}.param`, `${modelName}.bin`]
    await linkDirectory(installedModels, join(rootPath, "upscale", "upscayl"))
    const checksums = Object.fromEntries(await Promise.all(files.map(async (file) => [file, await sha256(join(installedModels, file))])))
    customModels.push({
      id: "system-upscayl-lite-4x",
      type: "upscale",
      displayName: "System Upscayl Lite 4x",
      engine: "upscayl",
      scales: [4],
      modelDirectory: "upscayl",
      modelFiles: files,
      scaleFiles: { 4: modelName },
      license: "UNKNOWN (installed Upscayl model bundle does not expose per-model license metadata)",
      checksums,
      inputBlob: "data",
      outputBlob: "output",
    })
    models.unshift({ engine: "upscayl", modelId: "system-upscayl-lite-4x", scale: 4, tileSize: 128 })
  }
  return { input: { width: 256, height: 384 }, customModels, models }
}

async function resolveInstalledExecutable(engine: SuperResolutionEngine, reportedPath: string): Promise<string> {
  if (await modelDirectoryExists(engine, reportedPath)) return reportedPath
  if (process.platform === "win32") {
    const command = engine === "upscayl" ? "upscayl-bin" : engine === "waifu2x" ? "waifu2x-ncnn-vulkan" : "realcugan-ncnn-vulkan"
    try {
      const { stdout } = await execFileAsync("cmd.exe", ["/d", "/s", "/c", `scoop.cmd which ${command}`], {
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
      })
      const installed = stdout.split(/\r?\n/u).map((entry) => entry.trim()).find(Boolean)
      if (installed && await modelDirectoryExists(engine, installed)) return installed
    } catch {
      // Fall through to the actionable error below.
    }
  }
  throw new Error(`Could not locate installed ${engine} model directory from ${reportedPath}.`)
}

async function modelDirectoryExists(engine: SuperResolutionEngine, executablePath: string): Promise<boolean> {
  const path = engine === "upscayl"
    ? resolve(dirname(executablePath), "..", "models")
    : join(dirname(executablePath), engine === "waifu2x" ? "models-cunet" : "models-se")
  return await fileExists(path)
}

async function createInput(path: string): Promise<void> {
  const width = 256
  const height = 384
  const bytes = new Uint8Array(width * height * 3)
  let state = 0x9e3779b9
  for (let index = 0; index < bytes.length; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    bytes[index] = state >>> 24
  }
  await sharp(bytes, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 3 }).toFile(path)
}

async function linkDirectory(target: string, path: string): Promise<void> {
  await access(target)
  await mkdir(dirname(path), { recursive: true })
  await symlink(target, path, process.platform === "win32" ? "junction" : "dir")
}

async function loadRuntime(specifier: string) {
  const resolvedSpecifier = await fileExists(specifier) ? pathToFileURL(resolve(specifier)).href : specifier
  return await loadOpenComicSystemRuntime({
    packageName: resolvedSpecifier,
    importModule: async (value) => await import(value),
  })
}

async function fileExists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest("hex")
}

interface GpuSnapshot {
  name: string
  driverVersion: string
  totalMiB: number
  usedMiB: number
}

async function gpuSnapshot(): Promise<GpuSnapshot | undefined> {
  try {
    const { stdout } = await execFileAsync("nvidia-smi", ["--query-gpu=name,driver_version,memory.total,memory.used", "--format=csv,noheader,nounits"], {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    })
    const rows = stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map((line) => line.split(",").map((value) => value.trim()))
    if (!rows.length) return undefined
    return {
      name: rows.map((row) => row[0]).filter(Boolean).join(" + "),
      driverVersion: rows.map((row) => row[1]).filter(Boolean).join(" + "),
      totalMiB: rows.reduce((sum, row) => sum + Number(row[2] ?? 0), 0),
      usedMiB: rows.reduce((sum, row) => sum + Number(row[3] ?? 0), 0),
    }
  } catch {
    return undefined
  }
}

async function runWithGpuSampling<T>(work: () => Promise<T>): Promise<{ result: T; workMs: number; peakUsedMiB?: number }> {
  let active = true
  let peakUsedMiB: number | undefined
  const sampler = (async () => {
    while (active) {
      const sample = await gpuSnapshot()
      if (sample) peakUsedMiB = Math.max(peakUsedMiB ?? 0, sample.usedMiB)
      if (active) await delay(250)
    }
  })()
  try {
    const started = performance.now()
    const result = await work()
    return { result, workMs: performance.now() - started, peakUsedMiB }
  } finally {
    active = false
    await sampler
  }
}

async function engineProcessCounts(): Promise<Record<string, number>> {
  const names = ["upscayl-bin.exe", "waifu2x-ncnn-vulkan.exe", "realcugan-ncnn-vulkan.exe"]
  const result: Record<string, number> = {}
  for (const name of names) {
    try {
      const { stdout } = await execFileAsync("tasklist.exe", ["/FI", `IMAGENAME eq ${name}`, "/FO", "CSV", "/NH"], {
        encoding: "utf8",
        timeout: 5_000,
        windowsHide: true,
      })
      result[name] = stdout.split(/\r?\n/u).filter((line) => line.trim().startsWith(`"${name}"`)).length
    } catch {
      result[name] = 0
    }
  }
  return result
}

function assertReport(report: {
  measurements: Measurement[]
  summaries: Record<string, { coldMs?: number; warm: ReturnType<typeof summarize> }>
  memory: { rssDeltaMiB: number; gpuDeltaMiB?: number }
  residualProcesses: Record<string, number>
}): void {
  for (const [engine, summary] of Object.entries(report.summaries)) {
    if (summary.coldMs === undefined || summary.coldMs > budgets.coldMs) throw new Error(`${engine} cold benchmark exceeded ${budgets.coldMs} ms.`)
    if (summary.warm.p95 === undefined || summary.warm.p95 > budgets.warmP95Ms) throw new Error(`${engine} warm p95 exceeded ${budgets.warmP95Ms} ms.`)
  }
  if (report.memory.rssDeltaMiB > budgets.rssDeltaMiB) throw new Error(`Upscale RSS delta exceeded ${budgets.rssDeltaMiB} MiB.`)
  if (report.memory.gpuDeltaMiB !== undefined && report.memory.gpuDeltaMiB > budgets.gpuDeltaMiB) throw new Error(`Upscale GPU delta exceeded ${budgets.gpuDeltaMiB} MiB.`)
  if (Object.keys(report.residualProcesses).length) throw new Error(`Upscale processes remained after dispose: ${JSON.stringify(report.residualProcesses)}`)
  if (report.measurements.length !== selectedEngines.length * RUNS) throw new Error("Upscale benchmark did not execute every selected engine/run.")
}

function summarize(values: number[]): { min?: number; p50?: number; p95?: number; max?: number } {
  if (!values.length) return {}
  const sorted = [...values].sort((left, right) => left - right)
  return { min: round(sorted[0]!), p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), max: round(sorted.at(-1)!) }
}

function percentile(sorted: number[], fraction: number): number {
  return round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!)
}

function parseEngines(value: string): SuperResolutionEngine[] {
  const engines = value.split(",").map((entry) => entry.trim()).filter(Boolean)
  const allowed = new Set<SuperResolutionEngine>(["upscayl", "waifu2x", "realcugan"])
  if (!engines.length || engines.some((entry) => !allowed.has(entry as SuperResolutionEngine))) throw new Error(`Invalid engines: ${value}`)
  return [...new Set(engines)] as SuperResolutionEngine[]
}

function argument(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index < 0 ? undefined : process.argv[index + 1]
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`)
  return value
}

function positiveNumber(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive.`)
  return value
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}
