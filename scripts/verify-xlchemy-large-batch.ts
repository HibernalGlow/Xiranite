#!/usr/bin/env bun
import { createWriteStream } from "node:fs"
import { access, mkdir, writeFile } from "node:fs/promises"
import { availableParallelism } from "node:os"
import { dirname, join, resolve } from "node:path"
import { finished } from "node:stream/promises"
import { parseArgs } from "node:util"
import type {
  NodeOperationDTO,
  NodeOperationEventsResponseDTO,
  NodeOperationStreamMessageDTO,
  NodeRunEventDTO,
} from "@xiranite/shared"
import { startIsolatedTestBackend, type IsolatedTestBackend } from "./test-backend.js"
import { collectXlchemyAcceptanceEnvironment } from "./lib/xlchemy-acceptance-environment.js"
import {
  buildXlchemyCorpus,
  buildXlchemyPreparationDirectory,
  buildXlchemyPreparationEfu,
  loadXlchemyCorpusManifest,
  verifyXlchemyOutputs,
  verifyXlchemySources,
} from "./lib/xlchemy-large-batch-corpus.js"
import {
  ProcessResourceSampler,
  ProcessTreeSampler,
  round,
  type ProcessResourceSample,
  type ProcessTreeSample,
  type ProcessTreeSummary,
} from "./lib/runtime-benchmark-metrics.js"
import {
  compareXlchemyGoReference,
  loadXlchemyGoReferenceSummary,
} from "./lib/xlchemy-go-reference-comparison.js"

type Mode = "corpus" | "convert" | "prepare"

interface XlchemyResultData {
  files: Array<{ sourcePath: string; outputPath: string; status: string; error?: string }>
  inputCount: number
  convertedCount: number
  skippedCount: number
  errorCount: number
  inputBytes: number
  outputBytes: number
  errors: string[]
  detailsTruncated?: boolean
  elapsedMs?: number
}

interface OperationEvidence {
  label: string
  operation: NodeOperationDTO<XlchemyResultData>
  startedAt: string
  finishedAt: string
  elapsedMs: number
  processTree: ProcessTreeSummary
  bunProcess: ReturnType<ProcessResourceSampler["stop"]>
  eventMetrics: EventMetrics
  retainedEventCount: number
  retainedEventTotal: number
  cancellationLatencyMs?: number
  samplingCoverage: ReturnType<typeof summarizeSamplingCoverage>
  bunSamplingCoverage: ReturnType<typeof summarizeSamplingCoverage>
  cpu: ReturnType<typeof summarizeCpuUsage>
  plateau: ReturnType<typeof analyzeMemoryPlateau>
}

interface EventMetrics {
  observedCount: number
  firstEventAt?: string
  firstDiscoveredAt?: string
  firstProcessedAt?: string
  firstConvertedAt?: string
  directDiscoveryCompletedAt?: string
  efuDiscoveryCompletedAt?: string
  lastEventAt?: string
  requestedConcurrency?: number
  configuredWorkerCount?: number
  peakActiveEncoders?: number
}

interface Options {
  mode: Mode
  sourceRoot?: string
  workspace: string
  corpusCount: number
  preparationCount: number
  minimumShortSide: number
  minimumLongSide: number
  threads: number
  quality: number
  runs: number
  cancelAfter: number
  timeoutMinutes: number
  referenceSummary?: string
}

const MIB = 1024 * 1024
const MAX_RESULT_DETAILS = 1_000
const MAX_RETAINED_EVENTS = 256

const options = parseOptions(process.argv.slice(2))

await mkdir(options.workspace, { recursive: true })
if (options.mode === "corpus") {
  if (!options.sourceRoot) throw new Error("--source-root is required in corpus mode.")
  await buildXlchemyCorpus({
    sourceRoot: options.sourceRoot,
    workspace: options.workspace,
    count: options.corpusCount,
    minimumShortSide: options.minimumShortSide,
    minimumLongSide: options.minimumLongSide,
  })
}
else if (options.mode === "convert") await runConversionAcceptance(options)
else await runPreparationAcceptance(options)

async function runConversionAcceptance(config: Options): Promise<void> {
  const manifest = await loadXlchemyCorpusManifest(config.workspace, config.corpusCount, config.minimumShortSide, config.minimumLongSide)
  const artifactRoot = join(config.workspace, "conversion")
  const outputRoot = join(artifactRoot, "output")
  await mkdir(outputRoot, { recursive: true })
  const sourcePreflight = await verifyXlchemySources(manifest.entries, "preflight")
  await writeJson(join(artifactRoot, "source-preflight.json"), sourcePreflight)
  assertNoVerificationErrors(sourcePreflight, "source preflight")
  const environment = await collectXlchemyAcceptanceEnvironment()
  if (!config.referenceSummary) throw new Error("--reference-summary is required in convert mode; run scripts/benchmark-xlchemy-go-reference.ts first.")
  const reference = await loadXlchemyGoReferenceSummary({
    summaryPath: config.referenceSummary,
    workspace: config.workspace,
    corpusRoot: manifest.corpusRoot,
    corpusCount: manifest.entries.length,
    threads: config.threads,
    quality: config.quality,
    runs: config.runs,
    slimgSha256: environment.slimg.sha256,
  })

  const isolated = await startAcceptanceBackend()
  const runs: OperationEvidence[] = []
  let cleanup: Awaited<ReturnType<typeof closeAndAuditBackend>> | undefined
  try {
    for (let index = 0; index < config.runs; index += 1) {
      const label = `conversion-${String(index + 1).padStart(2, "0")}`
      const input = conversionInput(manifest.corpusRoot, outputRoot, config)
      const evidence = await runOperation(isolated, input, artifactRoot, label, config.timeoutMinutes)
      assertConversionResult(evidence.operation, manifest.entries.length)
      assertOperationTimings(evidence, true)
      assertConversionConcurrency(evidence, config.threads)
      assertMemoryGate(evidence, 4_096)
      runs.push(evidence)
      process.stdout.write(`[xlchemy-acceptance] ${label}: ${formatOperation(evidence)}\n`)
    }

    const idleSampler = new ProcessTreeSampler(process.pid, 500, { refreshTreeIntervalMs: 0 })
    idleSampler.start()
    await idleSampler.waitForFirstSample()
    await Bun.sleep(12_000)
    const idleProcessTree = await idleSampler.stop()
    await writeSamples(join(artifactRoot, "post-run-idle-samples.ndjson"), idleSampler.samples())
    await writeJson(join(artifactRoot, "post-run-idle-summary.json"), idleProcessTree)
    if ((idleProcessTree.endPrivateMiB ?? Number.POSITIVE_INFINITY) > 1_024) throw new Error(`Post-run idle private memory is ${idleProcessTree.endPrivateMiB ?? "unknown"} MiB; gate is 1024 MiB.`)

    const outputVerification = await verifyXlchemyOutputs(manifest.entries, outputRoot)
    await writeJson(join(artifactRoot, "output-verification.json"), outputVerification)
    assertNoVerificationErrors(outputVerification, "output verification")
    assertAggregateBytes(runs, manifest.summary.totalBytes, outputVerification.totalOutputBytes)
    const sourcePostflight = await verifyXlchemySources(manifest.entries, "postflight")
    await writeJson(join(artifactRoot, "source-postflight.json"), sourcePostflight)
    assertNoVerificationErrors(sourcePostflight, "source postflight")

    cleanup = await closeAndAuditBackend(isolated)
    const warmedMedian = summarizeWarmedRuns(runs)
    const performanceComparison = compareXlchemyGoReference(warmedMedian, reference)
    const summary = {
      schemaVersion: 1,
      completedAt: new Date().toISOString(),
      configuration: {
        input: [manifest.corpusRoot],
        outputRoot,
        sourceCount: manifest.entries.length,
        threads: config.threads,
        quality: config.quality,
        runs: config.runs,
        format: "AVIF",
        encoder: "slimg DLL",
        runClassification: runs.map((_run, index) => index === 0 ? "cold runtime / warm filesystem" : "warm runtime / warm filesystem"),
        sourceCachePolicy: "Mandatory SHA-256 preflight warms source files before run 1; all compared runs use the same policy.",
        nodeInput: conversionInput(manifest.corpusRoot, outputRoot, config),
      },
      corpus: manifest.summary,
      decoder: manifest.decoder,
      environment,
      runs,
      warmedMedian,
      goReference: reference,
      performanceComparison,
      outputVerification,
      sourcePreflight,
      sourcePostflight,
      postRunIdle: idleProcessTree,
      cleanup,
    }
    await writeJson(join(artifactRoot, "summary.json"), summary)
    process.stdout.write(`[xlchemy-acceptance] conversion acceptance passed: ${join(artifactRoot, "summary.json")}\n`)
  } finally {
    if (!cleanup) await isolated.close().catch(() => undefined)
  }
}

async function runPreparationAcceptance(config: Options): Promise<void> {
  const manifest = await loadXlchemyCorpusManifest(config.workspace, config.corpusCount, config.minimumShortSide, config.minimumLongSide)
  const artifactRoot = join(config.workspace, "preparation")
  const directoryRoot = join(artifactRoot, `directory-${config.preparationCount}`)
  const efuPath = join(artifactRoot, `sources-${config.preparationCount}.efu`)
  const outputRoot = join(artifactRoot, "planned-output")
  await mkdir(artifactRoot, { recursive: true })
  await buildXlchemyPreparationDirectory(manifest.entries, directoryRoot, config.preparationCount, artifactRoot)
  await buildXlchemyPreparationEfu(manifest.entries, efuPath, config.preparationCount)
  await mkdir(outputRoot, { recursive: true })
  const environment = await collectXlchemyAcceptanceEnvironment()

  const isolated = await startAcceptanceBackend()
  let cleanup: Awaited<ReturnType<typeof closeAndAuditBackend>> | undefined
  try {
    const directory = await runOperation(
      isolated,
      planInput([directoryRoot], [], outputRoot, config),
      artifactRoot,
      "directory-full",
      config.timeoutMinutes,
    )
    assertPreparationResult(directory.operation, config.preparationCount)
    assertOperationTimings(directory, false)
    assertPreparationMemory(directory)

    const efu = await runOperation(
      isolated,
      planInput([], [efuPath], outputRoot, config),
      artifactRoot,
      "efu-full",
      config.timeoutMinutes,
    )
    assertPreparationResult(efu.operation, config.preparationCount)
    assertOperationTimings(efu, false)
    assertPreparationMemory(efu)

    const directoryCancellation = await runOperation(
      isolated,
      planInput([directoryRoot], [], outputRoot, config),
      artifactRoot,
      "directory-cancel",
      config.timeoutMinutes,
      config.cancelAfter,
    )
    assertPreparationCancellation(directoryCancellation)

    const efuCancellation = await runOperation(
      isolated,
      planInput([], [efuPath], outputRoot, config),
      artifactRoot,
      "efu-cancel",
      config.timeoutMinutes,
      config.cancelAfter,
    )
    assertPreparationCancellation(efuCancellation)

    cleanup = await closeAndAuditBackend(isolated)
    const summary = {
      schemaVersion: 1,
      completedAt: new Date().toISOString(),
      configuration: {
        directoryInput: [directoryRoot],
        efuInput: [efuPath],
        sourceCount: config.preparationCount,
        cancellationAfter: config.cancelAfter,
      },
      environment,
      directory,
      efu,
      directoryCancellation,
      efuCancellation,
      cleanup,
    }
    await writeJson(join(artifactRoot, "summary.json"), summary)
    process.stdout.write(`[xlchemy-acceptance] preparation acceptance passed: ${join(artifactRoot, "summary.json")}\n`)
  } finally {
    if (!cleanup) await isolated.close().catch(() => undefined)
  }
}

async function runOperation(
  isolated: IsolatedTestBackend,
  input: Record<string, unknown>,
  artifactRoot: string,
  label: string,
  timeoutMinutes: number,
  cancelAfter?: number,
): Promise<OperationEvidence> {
  const sampler = new ProcessTreeSampler(process.pid, 500, { refreshTreeIntervalMs: 0 })
  sampler.start()
  try { await sampler.waitForFirstSample() }
  catch (error) { await sampler.stop(); throw error }
  const processSampler = new ProcessResourceSampler(250)
  processSampler.start()
  let started: { operation: NodeOperationDTO<XlchemyResultData> }
  try {
    started = await requestJson(isolated, "/nodes/xlchemy/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input }) })
  } catch (error) {
    processSampler.stop()
    await sampler.stop()
    throw error
  }
  const startedAtMs = Date.now()
  const eventPath = join(artifactRoot, `${label}-events.ndjson`)
  const eventStream = createWriteStream(eventPath, { encoding: "utf8" })
  const streamController = new AbortController()
  let cancellationRequestedAt: number | undefined
  const metrics: EventMetrics = { observedCount: 0 }
  let operation: NodeOperationDTO<XlchemyResultData> | undefined
  let operationFinishedAtMs: number | undefined
  let operationError: unknown
  const consumePromise = consumeOperationStream(
    isolated,
    started.operation.operationId,
    eventStream,
    metrics,
    streamController.signal,
    async (completed) => {
      if (cancelAfter === undefined || completed < cancelAfter || cancellationRequestedAt !== undefined) return
      cancellationRequestedAt = Date.now()
      await requestJson(isolated, `/node-operations/${started.operation.operationId}/cancel`, { method: "POST" })
    },
  )
  try {
    operation = await withTimeout(consumePromise, timeoutMinutes * 60_000, `${label} exceeded ${timeoutMinutes} minute(s).`)
    operationFinishedAtMs = Date.now()
  } catch (error) {
    operationError = error
    streamController.abort(error)
    await consumePromise.catch(() => undefined)
  } finally {
    eventStream.end()
    await finished(eventStream).catch(() => undefined)
  }
  const bunProcess = processSampler.stop()
  const bunSamples = processSampler.samples()
  const processTree = await sampler.stop()
  const samples = sampler.samples()
  await writeSamples(join(artifactRoot, `${label}-samples.ndjson`), samples)
  await writeSamples(join(artifactRoot, `${label}-bun-samples.ndjson`), bunSamples)
  if (operationError) throw operationError
  if (!operation || operationFinishedAtMs === undefined) throw new Error(`${label} ended without an operation result.`)
  const retained = await requestJson<NodeOperationEventsResponseDTO<XlchemyResultData>>(
    isolated,
    `/node-operations/${started.operation.operationId}/events?from=0&limit=10000`,
  )
  if (retained.events.length > MAX_RETAINED_EVENTS) {
    throw new Error(`${label} retained ${retained.events.length} events; limit is ${MAX_RETAINED_EVENTS}.`)
  }
  const samplingCoverage = summarizeSamplingCoverage(samples, startedAtMs, operationFinishedAtMs)
  if (!samplingCoverage.available || samplingCoverage.maximumGapMs > 1_000) {
    throw new Error(`${label} process sampling gap reached ${samplingCoverage.maximumGapMs} ms; gate is 1000 ms.`)
  }
  const bunSamplingCoverage = summarizeSamplingCoverage(bunSamples, startedAtMs, operationFinishedAtMs)
  if (!bunSamplingCoverage.available || bunSamplingCoverage.maximumGapMs > 1_000) {
    throw new Error(`${label} Bun heap sampling gap reached ${bunSamplingCoverage.maximumGapMs} ms; gate is 1000 ms.`)
  }
  const evidence: OperationEvidence = {
    label,
    operation,
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date(operationFinishedAtMs).toISOString(),
    elapsedMs: operationFinishedAtMs - startedAtMs,
    processTree,
    bunProcess,
    eventMetrics: metrics,
    retainedEventCount: retained.events.length,
    retainedEventTotal: retained.total,
    ...(cancellationRequestedAt === undefined ? {} : { cancellationLatencyMs: operationFinishedAtMs - cancellationRequestedAt }),
    samplingCoverage,
    bunSamplingCoverage,
    cpu: summarizeCpuUsage(samples, startedAtMs, operationFinishedAtMs),
    plateau: analyzeMemoryPlateau(samples),
  }
  await writeJson(join(artifactRoot, `${label}-operation.json`), evidence)
  return evidence
}

async function consumeOperationStream(
  isolated: IsolatedTestBackend,
  operationId: string,
  output: ReturnType<typeof createWriteStream>,
  metrics: EventMetrics,
  signal: AbortSignal,
  onCompleted: (completed: number) => Promise<void>,
): Promise<NodeOperationDTO<XlchemyResultData>> {
  const response = await request(isolated, `/node-operations/${operationId}/stream?from=0`, { signal })
  if (!response.body) throw new Error(`Operation ${operationId} returned no event stream.`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffered = ""
  try {
    for (;;) {
      const { value, done } = await reader.read()
      buffered += decoder.decode(value, { stream: !done })
      let newline = buffered.indexOf("\n")
      while (newline >= 0) {
        const line = buffered.slice(0, newline).trim()
        buffered = buffered.slice(newline + 1)
        if (line) {
          const observedAt = new Date().toISOString()
          const message = JSON.parse(line) as NodeOperationStreamMessageDTO<XlchemyResultData>
          await writeStreamLine(output, { observedAt, ...message })
          if (message.type === "event") {
            updateEventMetrics(metrics, message.event, observedAt)
            await onCompleted(eventCompletedCount(message.event))
          }
          if (message.type === "result") return message.operation
        }
        newline = buffered.indexOf("\n")
      }
      if (done) break
    }
  } finally {
    reader.releaseLock()
  }
  throw new Error(`Operation ${operationId} stream ended without a result.`)
}

function updateEventMetrics(metrics: EventMetrics, event: NodeRunEventDTO, observedAt: string): void {
  metrics.observedCount += 1
  metrics.firstEventAt ??= observedAt
  metrics.lastEventAt = observedAt
  const completed = eventCompletedCount(event)
  if (completed > 0) metrics.firstProcessedAt ??= observedAt
  if (event.type !== "log") return
  if (event.message.includes(" first accepted input after ")) metrics.firstDiscoveredAt ??= observedAt
  if (/Worker #\d+ converted /.test(event.message)) metrics.firstConvertedAt ??= observedAt
  if (event.message.startsWith("Direct source stream completed:")) metrics.directDiscoveryCompletedAt = observedAt
  if (event.message.startsWith("EFU stream completed:")) metrics.efuDiscoveryCompletedAt = observedAt
  const scheduler = /Batch scheduler: (\d+) worker\(s\); CPU thread budget (\d+)/.exec(event.message)
  if (scheduler) {
    metrics.configuredWorkerCount = Number(scheduler[1])
    metrics.requestedConcurrency = Number(scheduler[2])
  }
  const completion = /Batch completed .*; peak active files \d+; peak active encoders (\d+);/.exec(event.message)
  if (completion) metrics.peakActiveEncoders = Number(completion[1])
}

function eventCompletedCount(event: NodeRunEventDTO): number {
  if (!event.data || typeof event.data !== "object") return 0
  const completed = (event.data as { completed?: unknown }).completed
  return typeof completed === "number" && Number.isFinite(completed) ? completed : 0
}

function conversionInput(corpusRoot: string, outputRoot: string, config: Options): Record<string, unknown> {
  return {
    action: "convert",
    paths: [corpusRoot],
    efuFiles: [],
    format: "AVIF",
    avifEncoder: "slimg",
    slimgBackend: "dll",
    quality: config.quality,
    threads: config.threads,
    outputMode: "directory",
    outputDir: outputRoot,
    preserveStructure: false,
    preserveMetadata: false,
    preserveTimestamps: false,
    deleteOriginal: false,
    existingPolicy: "replace",
    recursive: true,
    processingOrder: "original",
    metadataMode: "encoder-wipe",
    ramOptimizer: "dynamic",
    excludedFormats: [],
  }
}

function planInput(paths: string[], efuFiles: string[], outputRoot: string, config: Options): Record<string, unknown> {
  return {
    ...conversionInput(paths[0] ?? "", outputRoot, config),
    action: "plan",
    paths,
    efuFiles,
  }
}

function assertConversionResult(operation: NodeOperationDTO<XlchemyResultData>, expected: number): void {
  const data = operation.result?.data
  if (operation.phase !== "completed" || operation.result?.success !== true) throw new Error(`Conversion failed: ${JSON.stringify(operation.result)}`)
  if (!data || data.inputCount !== expected || data.convertedCount !== expected || data.skippedCount !== 0 || data.errorCount !== 0) {
    throw new Error(`Conversion counts are invalid: ${JSON.stringify(data)}`)
  }
  if (!data.detailsTruncated || data.files.length > MAX_RESULT_DETAILS) throw new Error(`Conversion result details are not bounded: ${data.files.length}.`)
}

function assertPreparationResult(operation: NodeOperationDTO<XlchemyResultData>, expected: number): void {
  const data = operation.result?.data
  if (operation.phase !== "completed" || operation.result?.success !== true) throw new Error(`Preparation failed: ${JSON.stringify(operation.result)}`)
  if (!data || data.inputCount !== expected || data.errorCount !== 0) throw new Error(`Preparation counts are invalid: ${JSON.stringify(data)}`)
  if (!data.detailsTruncated || data.files.length > MAX_RESULT_DETAILS) throw new Error(`Preparation result details are not bounded: ${data.files.length}.`)
}

function assertMemoryGate(evidence: OperationEvidence, maximumPrivateMiB: number): void {
  const peak = evidence.processTree.peakPrivateMiB
  if (peak === undefined) throw new Error(`${evidence.label} did not produce private-memory samples.`)
  if (peak > maximumPrivateMiB) throw new Error(`${evidence.label} peaked at ${peak} MiB private memory; gate is ${maximumPrivateMiB} MiB.`)
  if (evidence.bunProcess.heapPeakMiB > 1_024) throw new Error(`${evidence.label} peaked at ${evidence.bunProcess.heapPeakMiB} MiB Bun heap; gate is 1024 MiB.`)
}

function assertPreparationMemory(evidence: OperationEvidence): void {
  assertMemoryGate(evidence, 1_024)
  if (evidence.plateau.endGrowthMiB > 256) throw new Error(`${evidence.label} retained ${evidence.plateau.endGrowthMiB} MiB over its starting private memory.`)
}

function assertOperationTimings(evidence: OperationEvidence, requiresConversion: boolean): void {
  if (!evidence.eventMetrics.firstDiscoveredAt || !evidence.eventMetrics.firstProcessedAt) {
    throw new Error(`${evidence.label} did not record first-discovery and first-processed timestamps.`)
  }
  if (requiresConversion && !evidence.eventMetrics.firstConvertedAt) throw new Error(`${evidence.label} did not record a first-conversion timestamp.`)
  if (!evidence.cpu.available) throw new Error(`${evidence.label} did not record enough CPU samples.`)
}

function assertConversionConcurrency(evidence: OperationEvidence, requestedThreads: number): void {
  const expected = Math.min(16, requestedThreads)
  const minimumGranted = Math.min(expected, Math.max(1, Math.min(15, availableParallelism() - 2)))
  const active = evidence.eventMetrics.peakActiveEncoders ?? 0
  if (evidence.eventMetrics.requestedConcurrency !== requestedThreads || evidence.eventMetrics.configuredWorkerCount !== expected || active < minimumGranted || active > expected) {
    throw new Error(`${evidence.label} concurrency evidence is invalid: ${JSON.stringify(evidence.eventMetrics)}; expected ${minimumGranted}-${expected} active encoder(s) from ${requestedThreads} requested thread(s).`)
  }
}

function assertPreparationCancellation(evidence: OperationEvidence): void {
  if (evidence.operation.phase !== "cancelled") throw new Error(`${evidence.label} ended in ${evidence.operation.phase}.`)
  if ((evidence.cancellationLatencyMs ?? Number.POSITIVE_INFINITY) > 5_000) {
    throw new Error(`${evidence.label} took ${evidence.cancellationLatencyMs ?? "unknown"} ms to cancel; expected at most 5000 ms.`)
  }
  if (!evidence.eventMetrics.firstDiscoveredAt || !evidence.eventMetrics.firstProcessedAt) {
    throw new Error(`${evidence.label} did not record first-discovery and first-processed timestamps before cancellation.`)
  }
  assertMemoryGate(evidence, 1_024)
}

function assertNoVerificationErrors(result: { expected: number; verified: number; errors: string[] }, label: string): void {
  if (result.verified !== result.expected || result.errors.length) throw new Error(`${label} failed: ${JSON.stringify(result.errors.slice(0, 20))}`)
}

function assertAggregateBytes(runs: OperationEvidence[], expectedInputBytes: number, expectedOutputBytes: number): void {
  for (const run of runs) {
    const data = run.operation.result?.data
    if (data?.inputBytes !== expectedInputBytes || data.outputBytes !== expectedOutputBytes) {
      throw new Error(`${run.label} byte totals differ from independent verification: input ${data?.inputBytes}/${expectedInputBytes}, output ${data?.outputBytes}/${expectedOutputBytes}.`)
    }
  }
}

function analyzeMemoryPlateau(samples: ProcessTreeSample[]) {
  if (!samples.length) return { available: false, startPrivateMiB: 0, endPrivateMiB: 0, peakPrivateMiB: 0, endGrowthMiB: 0, tailSlopeMiBPerMinute: 0 }
  const values = samples.map((sample) => sample.privateBytes / MIB)
  const tail = samples.slice(Math.floor(samples.length / 2))
  const slopeBytesPerMs = linearSlope(tail.map((sample) => [sample.timestampMs, sample.privateBytes] as const))
  return {
    available: true,
    startPrivateMiB: round(values[0]!),
    endPrivateMiB: round(values.at(-1)!),
    peakPrivateMiB: round(Math.max(...values)),
    endGrowthMiB: round(Math.max(0, values.at(-1)! - values[0]!)),
    tailSlopeMiBPerMinute: round(slopeBytesPerMs * 60_000 / MIB),
  }
}

function summarizeSamplingCoverage(samples: ReadonlyArray<Pick<ProcessTreeSample | ProcessResourceSample, "timestampMs">>, startedAtMs: number, finishedAtMs: number) {
  const beforeFinish = samples.filter((sample) => sample.timestampMs <= finishedAtMs)
  const baseline = beforeFinish.filter((sample) => sample.timestampMs <= startedAtMs).at(-1) ?? beforeFinish[0]
  if (!baseline) return { available: false, samples: 0, maximumGapMs: Number.POSITIVE_INFINITY, initialGapMs: Number.POSITIVE_INFINITY, terminalGapMs: Number.POSITIVE_INFINITY }
  const covered = [baseline, ...beforeFinish.filter((sample) => sample.timestampMs > startedAtMs)]
  const gaps = covered.slice(1).map((sample, index) => sample.timestampMs - covered[index]!.timestampMs)
  const initialGapMs = Math.max(0, startedAtMs - baseline.timestampMs)
  const terminalGapMs = Math.max(0, finishedAtMs - covered.at(-1)!.timestampMs)
  return {
    available: true,
    samples: covered.length,
    maximumGapMs: Math.max(initialGapMs, terminalGapMs, ...gaps),
    initialGapMs,
    terminalGapMs,
  }
}

function summarizeCpuUsage(samples: ProcessTreeSample[], startedAtMs: number, finishedAtMs: number) {
  const beforeFinish = samples.filter((sample) => sample.timestampMs <= finishedAtMs)
  const baseline = beforeFinish.filter((sample) => sample.timestampMs <= startedAtMs).at(-1) ?? beforeFinish[0]
  if (!baseline) return { available: false, logicalProcessors: availableParallelism(), sampledCpuTimeMs: 0, averageActiveCores: 0, peakActiveCores: 0, averageMachinePercent: 0, peakMachinePercent: 0 }
  const covered = [baseline, ...beforeFinish.filter((sample) => sample.timestampMs > startedAtMs)]
  const activeCores = covered.slice(1).flatMap((sample, index) => {
    const previous = covered[index]!
    const elapsedMs = sample.timestampMs - previous.timestampMs
    return elapsedMs > 0 ? [Math.max(0, sample.cpu100ns - previous.cpu100ns) / 10_000 / elapsedMs] : []
  })
  const sampledCpuTimeMs = Math.max(0, covered.at(-1)!.cpu100ns - covered[0]!.cpu100ns) / 10_000
  const sampledElapsedMs = Math.max(1, covered.at(-1)!.timestampMs - covered[0]!.timestampMs)
  const logicalProcessors = availableParallelism()
  const averageActiveCores = sampledCpuTimeMs / sampledElapsedMs
  const peakActiveCores = Math.max(0, ...activeCores)
  return {
    available: covered.length > 1,
    logicalProcessors,
    sampledCpuTimeMs: round(sampledCpuTimeMs),
    averageActiveCores: round(averageActiveCores),
    peakActiveCores: round(peakActiveCores),
    averageMachinePercent: round(averageActiveCores / logicalProcessors * 100),
    peakMachinePercent: round(peakActiveCores / logicalProcessors * 100),
  }
}

function linearSlope(points: ReadonlyArray<readonly [number, number]>): number {
  if (points.length < 2) return 0
  const origin = points[0]![0]
  const xs = points.map(([x]) => x - origin)
  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length
  const meanY = points.reduce((sum, [, value]) => sum + value, 0) / points.length
  let numerator = 0
  let denominator = 0
  for (let index = 0; index < points.length; index += 1) {
    const dx = xs[index]! - meanX
    numerator += dx * (points[index]![1] - meanY)
    denominator += dx * dx
  }
  return denominator ? numerator / denominator : 0
}

function summarizeWarmedRuns(runs: OperationEvidence[]) {
  const warmed = runs.length > 1 ? runs.slice(1) : runs
  const elapsed = warmed.map((run) => run.operation.result?.data?.elapsedMs ?? run.elapsedMs).sort((left, right) => left - right)
  const throughput = warmed.map((run) => {
    const data = run.operation.result?.data
    return (data?.inputCount ?? 0) / Math.max((data?.elapsedMs ?? run.elapsedMs) / 1_000, 0.001)
  }).sort((left, right) => left - right)
  const privatePeaks = warmed.flatMap((run) => run.processTree.peakPrivateMiB ?? [])
  const averageActiveCores = warmed.map((run) => run.cpu.averageActiveCores).sort((left, right) => left - right)
  return {
    runCount: warmed.length,
    medianElapsedMs: percentile(elapsed, 0.5),
    medianImagesPerSecond: round(percentile(throughput, 0.5)),
    medianPeakPrivateMiB: round(percentile(privatePeaks.sort((left, right) => left - right), 0.5)),
    medianAverageActiveCores: round(percentile(averageActiveCores, 0.5)),
  }
}

function percentile(sorted: number[], fraction: number): number {
  if (!sorted.length) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))]!
}

async function startAcceptanceBackend(): Promise<IsolatedTestBackend> {
  process.env.XIRANITE_NODE_SOURCE = "1"
  process.env.XIRANITE_XLCHEMY_MAX_RETAINED_EVENTS = String(MAX_RETAINED_EVENTS)
  process.env.XIRANITE_XLCHEMY_MEMORY_SAMPLE_INTERVAL_MS = "1000"
  process.env.XIRANITE_XLCHEMY_MAX_RSS_GROWTH_MIB = "6144"
  process.env.XIRANITE_XLCHEMY_MAX_HEAP_GROWTH_MIB = "1024"
  return await startIsolatedTestBackend()
}

async function closeAndAuditBackend(isolated: IsolatedTestBackend) {
  const url = isolated.backend.url
  const dataDir = isolated.dataDir
  await isolated.close()
  const listenerClosed = !await fetch(`${url}/health`, { signal: AbortSignal.timeout(1_000) }).then(() => true).catch(() => false)
  const dataDirRemoved = !await exists(dataDir)
  if (!listenerClosed || !dataDirRemoved) throw new Error(`Backend cleanup failed: listenerClosed=${listenerClosed}, dataDirRemoved=${dataDirRemoved}.`)
  return { listenerClosed, dataDirRemoved, url, dataDir }
}

async function request(isolated: IsolatedTestBackend, path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(new URL(path, isolated.backend.url), {
    ...init,
    headers: { "x-xiranite-token": isolated.backend.token, ...init.headers },
  })
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} failed (${response.status}): ${await response.text()}`)
  return response
}

async function requestJson<T>(isolated: IsolatedTestBackend, path: string, init: RequestInit = {}): Promise<T> {
  return await (await request(isolated, path, init)).json() as T
}

async function writeSamples(path: string, samples: readonly unknown[]): Promise<void> {
  await writeFile(path, samples.map((sample) => JSON.stringify(sample)).join("\n") + (samples.length ? "\n" : ""))
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function writeStreamLine(stream: ReturnType<typeof createWriteStream>, value: unknown): Promise<void> {
  const line = typeof value === "string" ? value : JSON.stringify(value)
  if (!stream.write(`${line}\n`)) await new Promise<void>((resolveDrain) => stream.once("drain", resolveDrain))
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs) }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function parseOptions(argv: string[]): Options {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: false,
    strict: true,
    options: {
      mode: { type: "string" },
      "source-root": { type: "string" },
      workspace: { type: "string" },
      count: { type: "string", default: "10000" },
      "preparation-count": { type: "string", default: "200000" },
      "minimum-short-side": { type: "string", default: "1080" },
      "minimum-long-side": { type: "string", default: "1920" },
      threads: { type: "string", default: "16" },
      quality: { type: "string", default: "60" },
      runs: { type: "string", default: "4" },
      "cancel-after": { type: "string", default: "1000" },
      "timeout-minutes": { type: "string", default: "360" },
      "reference-summary": { type: "string" },
    },
  })
  const mode = parsed.values.mode
  if (mode !== "corpus" && mode !== "convert" && mode !== "prepare") throw new Error("--mode must be corpus, convert, or prepare.")
  const workspace = parsed.values.workspace
  if (!workspace) throw new Error("--workspace is required.")
  return {
    mode,
    sourceRoot: parsed.values["source-root"],
    workspace: resolve(workspace),
    corpusCount: positiveInteger(parsed.values.count, "--count"),
    preparationCount: positiveInteger(parsed.values["preparation-count"], "--preparation-count"),
    minimumShortSide: positiveInteger(parsed.values["minimum-short-side"], "--minimum-short-side"),
    minimumLongSide: positiveInteger(parsed.values["minimum-long-side"], "--minimum-long-side"),
    threads: positiveInteger(parsed.values.threads, "--threads"),
    quality: boundedInteger(parsed.values.quality, "--quality", 0, 100),
    runs: positiveInteger(parsed.values.runs, "--runs"),
    cancelAfter: positiveInteger(parsed.values["cancel-after"], "--cancel-after"),
    timeoutMinutes: positiveInteger(parsed.values["timeout-minutes"], "--timeout-minutes"),
    referenceSummary: parsed.values["reference-summary"] ? resolve(parsed.values["reference-summary"]) : undefined,
  }
}

function positiveInteger(value: string | undefined, name: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`)
  return parsed
}

function boundedInteger(value: string | undefined, name: string, minimum: number, maximum: number): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`)
  return parsed
}

function formatOperation(evidence: OperationEvidence): string {
  const data = evidence.operation.result?.data
  const seconds = Math.max((data?.elapsedMs ?? evidence.elapsedMs) / 1_000, 0.001)
  return `${data?.inputCount ?? 0} images in ${seconds.toFixed(2)}s; ${((data?.inputCount ?? 0) / seconds).toFixed(2)} images/s; average CPU ${evidence.cpu.averageActiveCores} core(s); peak private ${evidence.processTree.peakPrivateMiB ?? "n/a"} MiB; Bun heap ${evidence.bunProcess.heapPeakMiB} MiB`
}

async function exists(path: string): Promise<boolean> {
  return await access(path).then(() => true).catch(() => false)
}
