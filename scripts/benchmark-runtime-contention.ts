#!/usr/bin/env bun
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { availableParallelism, tmpdir } from "node:os"
import { join } from "node:path"
import { performance } from "node:perf_hooks"
import { parseArgs } from "node:util"

import { createXiraniteNodeClient, createXiraniteSystemClient } from "../packages/api/src/client"
import type { XlchemyData, XlchemyInput } from "../packages/nodes/xlchemy/src/core"
import {
  createZipFixture,
  deterministicBytes,
} from "../packages/nodes/neoview/test/fixture-builders/create-zip-fixture"
import { startIsolatedTestBackend } from "./test-backend"
import {
  EventLoopDelaySampler,
  ProcessResourceSampler,
  ProcessTreeSampler,
  round,
  summarize,
} from "./lib/runtime-benchmark-metrics"

const MIB = 1024 * 1024
const args = parseArgs({
  options: {
    "xl-images": { type: "string", default: "4" },
    "reader-pages": { type: "string", default: "6" },
    "reader-cycles": { type: "string", default: "2" },
    width: { type: "string", default: "2560" },
    height: { type: "string", default: "1440" },
    threads: { type: "string", default: String(availableParallelism()) },
    "health-interval-ms": { type: "string", default: "50" },
    "event-loop-interval-ms": { type: "string", default: "10" },
    "baseline-ms": { type: "string", default: "1000" },
    "process-tree": { type: "boolean", default: false },
    scenario: { type: "string", default: "combined" },
    "memory-guard": { type: "string", default: "on" },
    "cpu-profile": { type: "boolean", default: false },
    "assert-event-loop-p99-ms": { type: "string" },
    "assert-health-p95-ms": { type: "string" },
  },
  strict: true,
  allowPositionals: false,
})

const options = {
  xlImages: integer(args.values["xl-images"], "xl-images", 1, 64),
  readerPages: integer(args.values["reader-pages"], "reader-pages", 2, 64),
  readerCycles: integer(args.values["reader-cycles"], "reader-cycles", 1, 20),
  width: integer(args.values.width, "width", 256, 16_384),
  height: integer(args.values.height, "height", 256, 16_384),
  threads: integer(args.values.threads, "threads", 1, 64),
  healthIntervalMs: integer(args.values["health-interval-ms"], "health-interval-ms", 10, 5_000),
  eventLoopIntervalMs: integer(args.values["event-loop-interval-ms"], "event-loop-interval-ms", 1, 1_000),
  baselineMs: integer(args.values["baseline-ms"], "baseline-ms", 250, 60_000),
  processTree: args.values["process-tree"],
  scenario: scenario(args.values.scenario),
  memoryGuard: onOff(args.values["memory-guard"], "memory-guard"),
  cpuProfile: args.values["cpu-profile"],
  assertEventLoopP99Ms: optionalPositive(args.values["assert-event-loop-p99-ms"], "assert-event-loop-p99-ms"),
  assertHealthP95Ms: optionalPositive(args.values["assert-health-p95-ms"], "assert-health-p95-ms"),
}

const workspace = await mkdtemp(join(tmpdir(), "xiranite-runtime-contention-"))
const { inputDirectory, outputDirectory, jpeg, fixture } = await createBenchmarkSetup(workspace).catch(async (error) => {
  await rm(workspace, { recursive: true, force: true })
  throw error
})
const isolated = await startIsolatedTestBackend(options.memoryGuard === "on" ? {} : {
  nodeMemoryProtection: {
    defaultPolicy: { maxRetainedEvents: 1_000, sampleIntervalMs: 250 },
    nodePolicies: { xlchemy: { maxRetainedEvents: 256, sampleIntervalMs: 100 } },
  },
}).catch(async (error) => {
  await fixture.cleanup()
  await rm(workspace, { recursive: true, force: true })
  throw error
})
let readerSessionId: string | undefined
try {
  const { backend } = isolated
  const headers = { "content-type": "application/json", "x-xiranite-token": backend.token }
  const openResponse = await fetch(`${backend.url}/reader/sessions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ path: fixture.path }),
  })
  if (!openResponse.ok) throw new Error(`Reader session open failed: ${openResponse.status} ${await openResponse.text()}`)
  const opened = await openResponse.json() as { sessionId: string }
  readerSessionId = opened.sessionId

  const nodeClient = createXiraniteNodeClient(backend.url, { token: backend.token })
  const systemClient = createXiraniteSystemClient(backend.url, { token: backend.token })
  const memoryProtection = await systemClient.getNodeMemoryProtection()
  const healthWarmup = await fetch(`${backend.url}/health`)
  if (!healthWarmup.ok) throw new Error(`Health warmup failed: ${healthWarmup.status}`)

  const xlInput: XlchemyInput = {
    action: "convert",
    paths: [inputDirectory],
    format: "AVIF",
    avifEncoder: "slimg",
    lossless: false,
    quality: 60,
    effort: 6,
    threads: options.threads,
    outputMode: "directory",
    outputDir: outputDirectory,
    preserveMetadata: false,
    preserveStructure: false,
    overwrite: true,
    existingPolicy: "replace",
    recursive: false,
  }
  await warmReaderTransform(backend.url, backend.token, opened.sessionId)
  const warmup = await nodeClient.runNode<XlchemyInput, XlchemyData>("xlchemy", {
    ...xlInput,
    paths: [join(inputDirectory, "input-001.jpg")],
    threads: Math.min(2, options.threads),
  })
  if (!warmup.success || warmup.data?.convertedCount !== 1) throw new Error(`XLchemy warmup failed: ${warmup.message}`)
  await rm(outputDirectory, { recursive: true, force: true })
  await mkdir(outputDirectory)
  const baseline = await measureControlPlaneBaseline(
    backend.url,
    options.baselineMs,
    options.healthIntervalMs,
    options.eventLoopIntervalMs,
  )

  const eventLoop = new EventLoopDelaySampler(options.eventLoopIntervalMs)
  const processResources = new ProcessResourceSampler()
  const processTree = options.processTree ? new ProcessTreeSampler() : undefined
  const cpuProfiler = options.cpuProfile ? await startCpuProfiler() : undefined
  let stopHealth = false
  eventLoop.start()
  processResources.start()
  processTree?.start()
  const healthPromise = sampleHealth(backend.url, options.healthIntervalMs, () => stopHealth)
  const started = performance.now()
  const xlStarted = performance.now()
  const xlPromise = options.scenario === "reader"
    ? Promise.resolve(undefined)
    : nodeClient.runNode<XlchemyInput, XlchemyData>("xlchemy", xlInput)
      .then((result) => ({ result, elapsedMs: performance.now() - xlStarted }))
  const readerPromise = options.scenario === "xlchemy"
    ? Promise.resolve(undefined)
    : runReaderScenario(
        backend.url,
        backend.token,
        opened.sessionId,
        options.readerPages,
        options.readerCycles,
      )
  let workload: Awaited<ReturnType<typeof collectWorkload>> | undefined
  let workloadError: unknown
  let cpuProfile: Awaited<ReturnType<NonNullable<typeof cpuProfiler>["stop"]>> | undefined
  try {
    workload = await collectWorkload(xlPromise, readerPromise)
  } catch (error) {
    workloadError = error
  } finally {
    stopHealth = true
    cpuProfile = await cpuProfiler?.stop()
  }
  const elapsedMs = performance.now() - started
  const [healthResult, eventLoopDelay] = await Promise.all([
    healthPromise.then((value) => ({ value })).catch((error: unknown) => ({ error })),
    eventLoop.stop(),
  ])
  const bunProcess = processResources.stop()
  const tree = processTree
    ? await processTree.stop()
    : { available: false, samples: 0, error: "Disabled by default because Windows WMI sampling perturbs latency; rerun with --process-tree for a diagnostic pass." }
  if (workloadError) throw workloadError
  if ("error" in healthResult) throw healthResult.error
  const health = healthResult.value
  const { xl, reader } = workload!

  if (xl && !xl.result.success) throw new Error(`XLchemy benchmark failed: ${xl.result.message}`)
  if (xl && xl.result.data?.convertedCount !== options.xlImages) {
    throw new Error(`XLchemy converted ${xl.result.data?.convertedCount ?? 0}/${options.xlImages}: ${xl.result.data?.errors.join("; ") ?? "missing result data"}`)
  }
  const xlInputMiB = options.xlImages * jpeg.byteLength / MIB
  const report = {
    benchmark: "single-bun-runtime-contention",
    scenario: options.scenario,
    memoryGuardSampling: options.memoryGuard,
    runtime: `Bun ${Bun.version}`,
    platform: `${process.platform}-${process.arch}`,
    topology: "isolated in-process HTTP backend; one Bun control plane; native encoder threads admitted by the global weighted scheduler",
    cacheState: "NeoView transform path, XLchemy runtime, and slimg binding warmed once before sampling; operating-system file cache unspecified",
    sample: {
      width: options.width,
      height: options.height,
      jpegMiB: round(jpeg.byteLength / MIB),
      jpegSha256: createHash("sha256").update(jpeg).digest("hex"),
      xlImages: options.xlImages,
      readerPages: options.readerPages,
      readerCycles: options.readerCycles,
      requestedThreads: options.threads,
    },
    elapsedMs: round(elapsedMs),
    baseline,
    eventLoopDelayMs: eventLoopDelay,
    healthScheduledLatencyMs: health,
    reader: reader ?? null,
    xlchemy: xl ? {
      elapsedMs: round(xl.elapsedMs),
      converted: xl.result.data.convertedCount,
      inputMiB: round(xlInputMiB),
      imagesPerSecond: round(options.xlImages / (xl.elapsedMs / 1_000)),
      inputMiBPerSecond: round(xlInputMiB / (xl.elapsedMs / 1_000)),
    } : null,
    resources: { bunProcess, processTree: tree },
    cpuProfile: cpuProfile ?? null,
    memoryProtection: memoryProtection.settings ? {
      defaultPolicy: memoryProtection.settings.defaultPolicy,
      xlchemyPolicy: memoryProtection.settings.nodePolicies.xlchemy,
      attribution: "process-wide growth per operation; concurrent same-process allocations are not attributable until compute-process isolation",
    } : null,
  }
  assertBudgets(report)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} finally {
  if (readerSessionId) {
    await fetch(`${isolated.backend.url}/reader/s/${readerSessionId}`, {
      method: "DELETE",
      headers: { "x-xiranite-token": isolated.backend.token },
    }).catch(() => undefined)
  }
  await isolated.close()
  await fixture.cleanup()
  await rm(workspace, { recursive: true, force: true })
}

async function collectWorkload<TReader>(
  xlPromise: Promise<{ result: { success: boolean; message: string; data?: XlchemyData }; elapsedMs: number } | undefined>,
  readerPromise: Promise<TReader | undefined>,
) {
  const [xl, reader] = await Promise.all([xlPromise, readerPromise])
  return { xl, reader }
}

async function startCpuProfiler() {
  const { Session } = await import("node:inspector/promises")
  const session = new Session()
  session.connect()
  await session.post("Profiler.enable")
  await session.post("Profiler.start")
  let stopped = false
  return {
    async stop() {
      if (stopped) return { totalSamples: 0, topSelf: [] }
      stopped = true
      const { profile } = await session.post("Profiler.stop")
      session.disconnect()
      const nodes = profile.nodes.map((node) => ({
        function: node.callFrame.functionName || "(anonymous)",
        url: node.callFrame.url || "[native]",
        line: node.callFrame.lineNumber < 0 ? undefined : node.callFrame.lineNumber + 1,
        selfSamples: node.hitCount ?? 0,
      }))
      const totalSamples = nodes.reduce((sum, node) => sum + node.selfSamples, 0)
      return {
        totalSamples,
        topSelf: nodes
          .filter((node) => node.selfSamples > 0)
          .sort((left, right) => right.selfSamples - left.selfSamples)
          .slice(0, 20)
          .map((node) => ({
            ...node,
            selfPercent: totalSamples ? round(node.selfSamples / totalSamples * 100) : 0,
          })),
      }
    },
  }
}

async function createBenchmarkJpeg(width: number, height: number): Promise<Buffer> {
  const sharpModule = await import("sharp")
  const sharp = (sharpModule as unknown as { default?: typeof import("sharp") }).default ?? sharpModule
  const pixels = deterministicBytes(width * height * 3)
  return await sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 88 }).toBuffer()
}

async function createBenchmarkSetup(workspace: string) {
  const inputDirectory = join(workspace, "xl-input")
  const outputDirectory = join(workspace, "xl-output")
  await Promise.all([mkdir(inputDirectory), mkdir(outputDirectory)])
  const jpeg = await createBenchmarkJpeg(options.width, options.height)
  for (let index = 0; index < options.xlImages; index += 1) {
    await writeFile(join(inputDirectory, `input-${String(index + 1).padStart(3, "0")}.jpg`), jpeg)
  }
  const fixture = await createZipFixture({
    name: "runtime-contention.cbz",
    entries: Array.from({ length: options.readerPages }, (_, index) => ({
      path: `pages/${String(index + 1).padStart(3, "0")}.jpg`,
      bytes: jpeg,
      level: index % 2 === 0 ? 0 : 6,
    })),
  })
  return { inputDirectory, outputDirectory, jpeg, fixture }
}

async function warmReaderTransform(backendUrl: string, token: string, sessionId: string): Promise<void> {
  const headers = { "content-type": "application/json", "x-xiranite-token": token }
  const response = await fetch(`${backendUrl}/reader/s/${sessionId}/navigate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "goTo", pageIndex: 0 }),
  })
  if (!response.ok) throw new Error(`Reader warmup navigation failed: ${response.status}`)
  const page = (await response.json() as { visiblePages: Array<{ assetUrl: string }> }).visiblePages[0]
  if (!page) throw new Error("Reader warmup page is missing.")
  const assetUrl = new URL(page.assetUrl)
  assetUrl.searchParams.set("width", "736")
  assetUrl.searchParams.set("format", "webp")
  const asset = await fetch(assetUrl)
  if (!asset.ok) throw new Error(`Reader warmup asset failed: ${asset.status}`)
  await asset.arrayBuffer()
}

async function sampleHealth(url: string, intervalMs: number, shouldStop: () => boolean) {
  const samples: number[] = []
  let scheduledAt = performance.now()
  while (!shouldStop()) {
    scheduledAt += intervalMs
    await Bun.sleep(Math.max(0, scheduledAt - performance.now()))
    const response = await fetch(`${url}/health`)
    if (!response.ok) throw new Error(`Health sample failed: ${response.status}`)
    const completedAt = performance.now()
    samples.push(Math.max(0, completedAt - scheduledAt))
    scheduledAt = Math.max(scheduledAt, completedAt)
  }
  return summarize(samples)
}

async function measureControlPlaneBaseline(
  backendUrl: string,
  durationMs: number,
  healthIntervalMs: number,
  eventLoopIntervalMs: number,
) {
  const eventLoop = new EventLoopDelaySampler(eventLoopIntervalMs)
  let stopHealth = false
  eventLoop.start()
  const healthPromise = sampleHealth(backendUrl, healthIntervalMs, () => stopHealth)
  await Bun.sleep(durationMs)
  stopHealth = true
  const [eventLoopDelayMs, healthScheduledLatencyMs] = await Promise.all([eventLoop.stop(), healthPromise])
  return { durationMs, eventLoopDelayMs, healthScheduledLatencyMs }
}

async function runReaderScenario(
  backendUrl: string,
  token: string,
  sessionId: string,
  pageCount: number,
  cycles: number,
) {
  const navigation: number[] = []
  const firstByte: number[] = []
  const fullResponse: number[] = []
  let streamedBytes = 0
  const headers = { "content-type": "application/json", "x-xiranite-token": token }
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const navigationStarted = performance.now()
      const navigationResponse = await fetch(`${backendUrl}/reader/s/${sessionId}/navigate`, {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "goTo", pageIndex }),
      })
      if (!navigationResponse.ok) throw new Error(`Reader navigation failed: ${navigationResponse.status}`)
      const navigationResult = await navigationResponse.json() as { visiblePages: Array<{ assetUrl: string }> }
      navigation.push(performance.now() - navigationStarted)
      const page = navigationResult.visiblePages[0]
      if (!page) throw new Error(`Reader page ${pageIndex} is missing.`)
      const assetUrl = new URL(page.assetUrl)
      assetUrl.searchParams.set("width", String(768 + cycle * 32))
      assetUrl.searchParams.set("format", "webp")
      const responseStarted = performance.now()
      const response = await fetch(assetUrl)
      if (!response.ok || !response.body) throw new Error(`Reader asset failed: ${response.status}`)
      const reader = response.body.getReader()
      const first = await reader.read()
      firstByte.push(performance.now() - responseStarted)
      let bytes = first.value?.byteLength ?? 0
      if (!first.done) {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          bytes += chunk.value.byteLength
        }
      }
      streamedBytes += bytes
      fullResponse.push(performance.now() - responseStarted)
    }
  }
  return {
    requests: pageCount * cycles,
    navigationMs: summarize(navigation),
    firstByteMs: summarize(firstByte),
    fullResponseMs: summarize(fullResponse),
    streamedMiB: round(streamedBytes / MIB),
  }
}

function assertBudgets(report: {
  eventLoopDelayMs: { p99: number }
  healthScheduledLatencyMs: { p95: number }
}): void {
  const failures: string[] = []
  if (options.assertEventLoopP99Ms !== undefined && report.eventLoopDelayMs.p99 > options.assertEventLoopP99Ms) {
    failures.push(`event-loop p99 ${report.eventLoopDelayMs.p99} ms > ${options.assertEventLoopP99Ms} ms`)
  }
  if (options.assertHealthP95Ms !== undefined && report.healthScheduledLatencyMs.p95 > options.assertHealthP95Ms) {
    failures.push(`health p95 ${report.healthScheduledLatencyMs.p95} ms > ${options.assertHealthP95Ms} ms`)
  }
  if (failures.length) throw new Error(`Runtime contention budget failed:\n- ${failures.join("\n- ")}`)
}

function integer(value: string | undefined, name: string, minimum: number, maximum: number): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RangeError(`--${name} must be an integer from ${minimum} to ${maximum}.`)
  }
  return parsed
}

function optionalPositive(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new RangeError(`--${name} must be positive.`)
  return parsed
}

function scenario(value: string | undefined): "combined" | "reader" | "xlchemy" {
  if (value === "combined" || value === "reader" || value === "xlchemy") return value
  throw new RangeError("--scenario must be combined, reader, or xlchemy.")
}

function onOff(value: string | undefined, name: string): "on" | "off" {
  if (value === "on" || value === "off") return value
  throw new RangeError(`--${name} must be on or off.`)
}
