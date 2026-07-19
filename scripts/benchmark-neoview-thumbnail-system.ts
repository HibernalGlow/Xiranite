import { mkdir, mkdtemp, link, rename, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { parseArgs } from "node:util"
import pMap from "p-map"

import { ResourceSchedulerService } from "../packages/services/src/resourceScheduler.js"
import type { ReaderBook } from "../packages/nodes/neoview/src/domain/book/book.js"
import type { ReaderPage } from "../packages/nodes/neoview/src/domain/page/page.js"
import { ReaderFileTreeService } from "../packages/nodes/neoview/src/application/browser/ReaderFileTreeService.js"
import { createPlatformReaderBookLoader } from "../packages/nodes/neoview/src/platform/books/PlatformReaderBookLoader.js"
import { PlatformDirectoryListingProvider } from "../packages/nodes/neoview/src/platform/filesystem/PlatformDirectoryListingProvider.js"
import { SharpImageTransformer } from "../packages/nodes/neoview/src/platform/images/sharp/SharpImageTransformer.js"
import { PlatformThumbnailPipeline } from "../packages/nodes/neoview/src/platform/thumbnails/PlatformThumbnailPipeline.js"
import { deterministicBytes } from "../packages/nodes/neoview/test/fixture-builders/create-zip-fixture.js"

const MIB = 1024 * 1024
const parsed = parseArgs({
  options: {
    "page-source": { type: "string" },
    "directory-source": { type: "string" },
    "storage-label": { type: "string" },
    "work-root": { type: "string" },
    report: { type: "string" },
    pages: { type: "string" },
    files: { type: "string" },
    window: { type: "string", default: "32" },
    quick: { type: "boolean", default: false },
    assert: { type: "boolean", default: false },
    keep: { type: "boolean", default: false },
  },
})

const quick = parsed.values.quick
const pageCount = positiveInteger(parsed.values.pages ?? (quick ? "128" : "1000"), "pages", 100_000)
const directoryCount = positiveInteger(parsed.values.files ?? (quick ? "1000" : "10000"), "files", 100_000)
const windowSize = positiveInteger(parsed.values.window, "window", 512)
const assertBudgets = parsed.values.assert
const storageLabel = parsed.values["storage-label"]?.trim() || "unspecified"
const reportPath = parsed.values.report ? await assertReportDestinationAvailable(parsed.values.report) : undefined
const hasRealPageCorpus = Boolean(parsed.values["page-source"])
const hasRealDirectoryCorpus = Boolean(parsed.values["directory-source"])
const realCorpus = hasRealPageCorpus && hasRealDirectoryCorpus
const corpusKind = realCorpus ? "real" : hasRealPageCorpus || hasRealDirectoryCorpus ? "mixed-smoke" : "synthetic-smoke"
const acceptanceEligible = realCorpus && pageCount >= 1_000 && directoryCount >= 10_000 && storageLabel !== "unspecified"
if (assertBudgets && !acceptanceEligible) {
  throw new Error("--assert requires real --page-source and --directory-source corpora, at least 1000 pages/10000 entries, and --storage-label.")
}

const budgets = {
  directoryReadMs: positiveNumber(process.env.NEOVIEW_THUMBNAIL_MAX_DIRECTORY_READ_MS ?? "2000", "NEOVIEW_THUMBNAIL_MAX_DIRECTORY_READ_MS"),
  browserOpenMs: positiveNumber(process.env.NEOVIEW_THUMBNAIL_MAX_BROWSER_OPEN_MS ?? "2500", "NEOVIEW_THUMBNAIL_MAX_BROWSER_OPEN_MS"),
  coldGenerationMs: positiveNumber(process.env.NEOVIEW_THUMBNAIL_MAX_COLD_GENERATION_MS ?? "250", "NEOVIEW_THUMBNAIL_MAX_COLD_GENERATION_MS"),
  warmGenerationMs: positiveNumber(process.env.NEOVIEW_THUMBNAIL_MAX_WARM_GENERATION_MS ?? "250", "NEOVIEW_THUMBNAIL_MAX_WARM_GENERATION_MS"),
  visibleReadyP95Ms: positiveNumber(process.env.NEOVIEW_THUMBNAIL_MAX_VISIBLE_READY_P95_MS ?? "4000", "NEOVIEW_THUMBNAIL_MAX_VISIBLE_READY_P95_MS"),
  l1HitP95Ms: positiveNumber(process.env.NEOVIEW_THUMBNAIL_MAX_L1_HIT_P95_MS ?? "15", "NEOVIEW_THUMBNAIL_MAX_L1_HIT_P95_MS"),
  staleCancelP95Ms: positiveNumber(process.env.NEOVIEW_THUMBNAIL_MAX_STALE_CANCEL_P95_MS ?? "1000", "NEOVIEW_THUMBNAIL_MAX_STALE_CANCEL_P95_MS"),
  staleCancelMaxMs: positiveNumber(process.env.NEOVIEW_THUMBNAIL_MAX_STALE_CANCEL_MAX_MS ?? "2000", "NEOVIEW_THUMBNAIL_MAX_STALE_CANCEL_MAX_MS"),
  rssDeltaMiB: positiveNumber(process.env.NEOVIEW_THUMBNAIL_MAX_RSS_DELTA_MIB ?? "256", "NEOVIEW_THUMBNAIL_MAX_RSS_DELTA_MIB"),
}

let fixture: SyntheticFixture | undefined
let book: ReaderBook | undefined
let pipeline: PlatformThumbnailPipeline | undefined
const resourceScheduler = new ResourceSchedulerService()
const flightEvents: ThumbnailFlightEvent[] = []
try {
  const setupStarted = performance.now()
  if (!realCorpus) fixture = await createSyntheticFixture(
    hasRealPageCorpus ? 0 : pageCount,
    hasRealDirectoryCorpus ? 0 : directoryCount,
    parsed.values["work-root"],
  )
  const pageSource = resolve(parsed.values["page-source"] ?? fixture!.pageDirectory)
  const directorySource = resolve(parsed.values["directory-source"] ?? fixture!.browserDirectory)
  const setupMs = performance.now() - setupStarted

  const directory = await benchmarkDirectory(directorySource, directoryCount)
  const openStarted = performance.now()
  book = await createPlatformReaderBookLoader()({ kind: "path", path: pageSource })
  const openBookMs = performance.now() - openStarted
  const pages = book.pages.filter((page) => page.mediaKind === "image" || page.mediaKind === "animated-image")
  if (pages.length < pageCount) throw new Error(`Page corpus contains ${pages.length} image pages; ${pageCount} required.`)

  pipeline = new PlatformThumbnailPipeline({
    loadImageTransformer: async () => new SharpImageTransformer(resourceScheduler),
    resourceScheduler,
    maxMemoryBytes: 64 * MIB,
    maxEntryBytes: 2 * MIB,
    onCoordinatorFlightEvent: (event) => {
      flightEvents.push({
        flightId: event.flightId,
        state: event.state,
        contextId: event.demand.contextId,
        generation: event.demand.generation,
        atMs: event.atMs,
        outcome: event.outcome,
      })
    },
  })
  const rssBefore = process.memoryUsage().rss
  let peakRss = rssBefore
  const sample = pages.slice(0, pageCount)
  const benchmarkPage = sample[0]!
  const coldGenerationMs = await measureGeneration(pipeline, benchmarkPage, "benchmark:cold")
  pipeline.hibernateReader()
  const warmGenerationMs = await measureGeneration(pipeline, benchmarkPage, "benchmark:warm")
  pipeline.hibernateReader()
  peakRss = Math.max(peakRss, process.memoryUsage().rss)

  const scroll = await benchmarkScroll(pipeline, sample, windowSize, flightEvents, () => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss)
  })
  const beforeDispose = pipeline.snapshot()
  await pipeline.dispose()
  const afterDispose = pipeline.snapshot()
  pipeline = undefined
  peakRss = Math.max(peakRss, process.memoryUsage().rss)

  const report = {
    benchmark: "neoview-thumbnail-system",
    runtime: `Bun ${Bun.version}`,
    platform: `${process.platform}-${process.arch}`,
    corpus: {
      kind: corpusKind,
      acceptanceEligible,
      pageCount,
      directoryCount,
      windowSize,
      storageLabel,
      syntheticSetupMs: realCorpus ? undefined : round(setupMs),
    },
    directory,
    pages: {
      available: pages.length,
      openBookMs: round(openBookMs),
      sample: pageDescriptor(benchmarkPage),
      coldGenerationMs: round(coldGenerationMs),
      warmGenerationMs: round(warmGenerationMs),
    },
    scroll,
    lifecycle: { beforeDispose, afterDispose, resourcesAfterDispose: resourceScheduler.snapshot() },
    memory: {
      rssBeforeMiB: round(rssBefore / MIB),
      peakRssMiB: round(peakRss / MIB),
      deltaMiB: round((peakRss - rssBefore) / MIB),
    },
    budgets,
  }
  if (assertBudgets) assertReport(report)
  const serializedReport = `${JSON.stringify(report, null, 2)}\n`
  if (reportPath) await writeReport(reportPath, serializedReport)
  process.stdout.write(serializedReport)
} finally {
  await pipeline?.dispose().catch(() => undefined)
  await book?.close().catch(() => undefined)
  if (fixture && !parsed.values.keep) await rm(fixture.root, { recursive: true, force: true })
}

async function benchmarkDirectory(path: string, requiredEntries: number) {
  const provider = new PlatformDirectoryListingProvider()
  const readStarted = performance.now()
  const listing = await provider.read(path)
  const readMs = performance.now() - readStarted
  if (listing.entries.length < requiredEntries) {
    throw new Error(`Directory corpus contains ${listing.entries.length} entries; ${requiredEntries} required.`)
  }
  const browser = new ReaderFileTreeService(provider)
  try {
    const openStarted = performance.now()
    const first = await browser.open(path)
    const openMs = performance.now() - openStarted
    const paginationStarted = performance.now()
    let pages = 1
    for (let cursor = first.entries.length; cursor < first.total; cursor += 512) {
      await browser.list(first.sessionId, cursor, Math.min(512, first.total - cursor))
      pages += 1
    }
    const paginationMs = performance.now() - paginationStarted
    return {
      entries: listing.entries.length,
      supportedEntries: listing.entries.filter((entry) => entry.readerSupported).length,
      providerReadMs: round(readMs),
      browserOpenAndSortMs: round(openMs),
      paginationMs: round(paginationMs),
      pages,
    }
  } finally {
    await browser[Symbol.asyncDispose]()
  }
}

async function measureGeneration(pipeline: PlatformThumbnailPipeline, page: ReaderPage, contextId: string): Promise<number> {
  if (!pipeline.supportsPage(page)) throw new Error(`Thumbnail pipeline does not support benchmark page: ${page.name}`)
  const started = performance.now()
  const lease = pipeline.acquirePage(page, { contextId })
  try {
    await lease.ready
    return performance.now() - started
  } finally {
    lease.release()
    pipeline.releaseContext(contextId)
  }
}

async function benchmarkScroll(
  pipeline: PlatformThumbnailPipeline,
  pages: readonly ReaderPage[],
  windowSize: number,
  flightEvents: readonly ThumbnailFlightEvent[],
  sampleMemory: () => void,
) {
  const contextId = "benchmark:scroll"
  let generation = 0
  let active: ScrollDemand[] = []
  let finalPages: readonly ReaderPage[] = []
  let finalRequestedAt = 0
  const demands: ScrollDemand[] = []
  let peakActiveFlights = 0
  let peakQueuedFlights = 0
  let peakRunningFlights = 0
  const dispatchStarted = performance.now()
  const windowStarts = scrollWindowStarts(pages.length, windowSize)
  for (const cursor of windowStarts) {
    generation += 1
    pipeline.advanceContext(contextId, generation)
    for (const demand of active) demand.lease.release()
    finalPages = pages.slice(cursor, Math.min(pages.length, cursor + windowSize))
    finalRequestedAt = performance.now()
    active = finalPages.map((page) => trackScrollDemand(
      pipeline.acquirePage(page, { contextId, generation }),
      generation,
    ))
    demands.push(...active)
    await yieldToRuntime()
    const snapshot = pipeline.snapshot()
    peakActiveFlights = Math.max(peakActiveFlights, snapshot.activeFlights)
    peakQueuedFlights = Math.max(peakQueuedFlights, snapshot.queuedFlights)
    peakRunningFlights = Math.max(peakRunningFlights, snapshot.runningFlights)
    sampleMemory()
  }
  const dispatchMs = performance.now() - dispatchStarted
  const visibleReadyMs = await Promise.all(active.map(async (demand) => {
    await demand.lease.ready
    return performance.now() - finalRequestedAt
  }))
  const finalVisibleSnapshot = pipeline.snapshot()
  const settled = await Promise.all(demands.map((demand) => demand.settlement))
  await pipeline.whenIdle()
  for (const demand of active) demand.lease.release()

  const staleCancellationRequests = flightEvents.filter((event) => (
    event.state === "cancellation-requested"
    && event.contextId === contextId
    && event.generation < generation
  ))
  const settlementsByFlight = new Map(flightEvents
    .filter((event) => event.state === "settled")
    .map((event) => [event.flightId, event]))
  const staleSettlements = staleCancellationRequests
    .map((request) => ({ request, settled: settlementsByFlight.get(request.flightId) }))
    .filter((value): value is { request: ThumbnailFlightEvent; settled: ThumbnailFlightEvent } => value.settled !== undefined)
  const staleCancelLatencyMs = staleSettlements.map(({ request, settled: settledEvent }) => settledEvent.atMs - request.atMs)

  const l1HitMs: number[] = []
  for (const page of finalPages) {
    const started = performance.now()
    const lease = pipeline.acquirePage(page, { contextId: "benchmark:l1" })
    await lease.ready
    l1HitMs.push(performance.now() - started)
    lease.release()
  }
  pipeline.releaseContext(contextId)
  pipeline.releaseContext("benchmark:l1")
  sampleMemory()
  return {
    generations: generation,
    demands: demands.length,
    finalVisible: finalPages.length,
    dispatchMs: round(dispatchMs),
    ready: settled.filter((settlement) => settlement.outcome === "ready").length,
    cancelled: settled.filter((settlement) => settlement.outcome === "cancelled").length,
    failed: settled.filter((settlement) => settlement.outcome === "failed").length,
    stale: {
      demands: demands.filter((demand) => demand.generation < generation).length,
      cancellationRequests: staleCancellationRequests.length,
      settledAfterSupersession: staleSettlements.length,
      completedAfterSupersession: staleSettlements.filter(({ settled: settledEvent }) => settledEvent.outcome === "completed").length,
      failedAfterSupersession: staleSettlements.filter(({ settled: settledEvent }) => settledEvent.outcome === "failed").length,
      flightsAfterFinalVisible: finalVisibleSnapshot.queuedFlights + finalVisibleSnapshot.runningFlights,
      cancelLatencyMs: staleCancelLatencyMs.length ? summarize(staleCancelLatencyMs) : undefined,
    },
    peakActiveFlights,
    peakQueuedFlights,
    peakRunningFlights,
    finalVisibleReadyMs: summarize(visibleReadyMs),
    l1HitMs: summarize(l1HitMs),
    afterRelease: pipeline.snapshot(),
  }
}

interface ScrollSettlement {
  outcome: "ready" | "cancelled" | "failed"
}

interface ScrollDemand {
  readonly lease: ReturnType<PlatformThumbnailPipeline["acquirePage"]>
  readonly generation: number
  settlement: Promise<ScrollSettlement>
}

interface ThumbnailFlightEvent {
  flightId: string
  state: "started" | "cancellation-requested" | "settled"
  contextId: string
  generation: number
  atMs: number
  outcome?: "completed" | "cancelled" | "failed"
}

function trackScrollDemand(
  lease: ReturnType<PlatformThumbnailPipeline["acquirePage"]>,
  generation: number,
): ScrollDemand {
  const demand = {
    lease,
    generation,
    settlement: undefined as unknown as Promise<ScrollSettlement>,
  } satisfies ScrollDemand
  demand.settlement = lease.ready.then(
    () => ({ outcome: "ready" }),
    (error) => ({ outcome: isAbortError(error) ? "cancelled" : "failed" }),
  )
  return demand
}

async function createSyntheticFixture(pages: number, files: number, workRoot?: string): Promise<SyntheticFixture> {
  const parent = resolve(workRoot ?? tmpdir())
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, "xiranite-neoview-thumbnail-benchmark-"))
  try {
    const pageDirectory = join(root, "pages")
    const browserDirectory = join(root, "browser")
    await Promise.all([mkdir(pageDirectory), mkdir(browserDirectory)])
    if (pages) {
      const sharpModule = await import("sharp")
      type SharpFactory = (typeof import("sharp"))["default"]
      const sharp = ((sharpModule as unknown as { default?: SharpFactory }).default ?? sharpModule) as SharpFactory
      const raw = deterministicBytes(3_840 * 2_160 * 3)
      const jpeg = await sharp(raw, { raw: { width: 3_840, height: 2_160, channels: 3 } }).jpeg({ quality: 88 }).toBuffer()
      const seed = join(root, "seed.jpg")
      await writeFile(seed, jpeg)
      await pMap(Array.from({ length: pages }, (_, index) => index), async (index) => {
        await link(seed, join(pageDirectory, `${String(index + 1).padStart(6, "0")}.jpg`))
      }, { concurrency: 64 })
    }
    if (files) {
      await pMap(Array.from({ length: files }, (_, index) => index), async (index) => {
        await writeFile(join(browserDirectory, `${String(index + 1).padStart(6, "0")}.cbz`), new Uint8Array())
      }, { concurrency: 64 })
    }
    return { root, pageDirectory, browserDirectory }
  } catch (error) {
    await rm(root, { recursive: true, force: true })
    throw error
  }
}

/** Publishes an immutable evidence report without leaving a partial target on failure. */
async function writeReport(destination: string, contents: string): Promise<void> {
  const path = resolve(destination)
  await mkdir(dirname(path), { recursive: true })
  try {
    await stat(path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error
    const staging = `${path}.tmp-${process.pid}-${Date.now()}`
    try {
      await writeFile(staging, contents, { encoding: "utf8", flag: "wx" })
      await rename(staging, path)
      return
    } catch (writeError) {
      await rm(staging, { force: true }).catch(() => undefined)
      throw writeError
    }
  }
  throw new Error(`Thumbnail benchmark report already exists: ${path}`)
}

async function assertReportDestinationAvailable(destination: string): Promise<string> {
  const path = resolve(destination)
  try {
    await stat(path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "ENOTDIR") return path
    throw error
  }
  throw new Error(`Thumbnail benchmark report already exists: ${path}`)
}

interface SyntheticFixture {
  root: string
  pageDirectory: string
  browserDirectory: string
}

interface Summary {
  min: number
  p50: number
  p95: number
  max: number
  average: number
}

function summarize(values: readonly number[]): Summary {
  if (!values.length) throw new Error("Benchmark summary requires at least one value.")
  const sorted = values.toSorted((left, right) => left - right)
  return {
    min: round(sorted[0]!),
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    max: round(sorted.at(-1)!),
    average: round(values.reduce((sum, value) => sum + value, 0) / values.length),
  }
}

function percentile(sorted: readonly number[], percentileValue: number): number {
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1))]!
}

function assertReport(report: {
  corpus: { acceptanceEligible: boolean }
  directory: { providerReadMs: number; browserOpenAndSortMs: number }
  pages: { coldGenerationMs: number; warmGenerationMs: number }
  scroll: {
    ready: number
    failed: number
    finalVisible: number
    peakActiveFlights: number
    peakRunningFlights: number
    finalVisibleReadyMs: Summary
    l1HitMs: Summary
    stale: {
      completedAfterSupersession: number
      flightsAfterFinalVisible: number
      cancelLatencyMs?: Summary
    }
    afterRelease: { demands: number; activeFlights: number; queuedFlights: number; runningFlights: number }
  }
  lifecycle: {
    afterDispose: { demands: number; activeFlights: number; queuedFlights: number; runningFlights: number; cachedEntries: number; cachedBytes: number }
    resourcesAfterDispose: ReturnType<ResourceSchedulerService["snapshot"]>
  }
  memory: { deltaMiB: number }
}): void {
  const failures: string[] = []
  if (!report.corpus.acceptanceEligible) failures.push("corpus is not acceptance eligible")
  if (report.directory.providerReadMs > budgets.directoryReadMs) failures.push(`directory read ${report.directory.providerReadMs}ms > ${budgets.directoryReadMs}ms`)
  if (report.directory.browserOpenAndSortMs > budgets.browserOpenMs) failures.push(`browser open ${report.directory.browserOpenAndSortMs}ms > ${budgets.browserOpenMs}ms`)
  if (report.pages.coldGenerationMs > budgets.coldGenerationMs) failures.push(`cold generation ${report.pages.coldGenerationMs}ms > ${budgets.coldGenerationMs}ms`)
  if (report.pages.warmGenerationMs > budgets.warmGenerationMs) failures.push(`warm generation ${report.pages.warmGenerationMs}ms > ${budgets.warmGenerationMs}ms`)
  if (report.scroll.finalVisibleReadyMs.p95 > budgets.visibleReadyP95Ms) failures.push(`visible ready p95 ${report.scroll.finalVisibleReadyMs.p95}ms > ${budgets.visibleReadyP95Ms}ms`)
  if (report.scroll.l1HitMs.p95 > budgets.l1HitP95Ms) failures.push(`L1 hit p95 ${report.scroll.l1HitMs.p95}ms > ${budgets.l1HitP95Ms}ms`)
  if (report.scroll.failed) failures.push(`${report.scroll.failed} thumbnail demands failed`)
  if (report.scroll.ready < report.scroll.finalVisible) failures.push(`only ${report.scroll.ready}/${report.scroll.finalVisible} final visible demands completed`)
  if (report.scroll.peakActiveFlights > windowSize) failures.push(`peak active flights ${report.scroll.peakActiveFlights} > window ${windowSize}`)
  if (report.scroll.peakRunningFlights > 8) failures.push(`peak running flights ${report.scroll.peakRunningFlights} > 8`)
  if (report.scroll.stale.completedAfterSupersession) {
    failures.push(`${report.scroll.stale.completedAfterSupersession} stale thumbnail demand(s) completed after supersession`)
  }
  if (report.scroll.stale.flightsAfterFinalVisible) {
    failures.push(`${report.scroll.stale.flightsAfterFinalVisible} stale thumbnail flight(s) remained after the final visible window was ready`)
  }
  if (report.scroll.stale.cancelLatencyMs?.p95 && report.scroll.stale.cancelLatencyMs.p95 > budgets.staleCancelP95Ms) {
    failures.push(`stale cancellation p95 ${report.scroll.stale.cancelLatencyMs.p95}ms > ${budgets.staleCancelP95Ms}ms`)
  }
  if (report.scroll.stale.cancelLatencyMs?.max && report.scroll.stale.cancelLatencyMs.max > budgets.staleCancelMaxMs) {
    failures.push(`stale cancellation max ${report.scroll.stale.cancelLatencyMs.max}ms > ${budgets.staleCancelMaxMs}ms`)
  }
  if (!workStateIsZero(report.scroll.afterRelease)) failures.push("scroll demands/flights did not return to zero")
  if (!disposedStateIsZero(report.lifecycle.afterDispose)) failures.push("coordinator state did not return to zero after dispose")
  for (const [resource, state] of Object.entries(report.lifecycle.resourcesAfterDispose)) {
    if (state.active || state.queued) failures.push(`${resource} scheduler did not return to zero after dispose`)
  }
  if (report.memory.deltaMiB > budgets.rssDeltaMiB) failures.push(`RSS delta ${report.memory.deltaMiB}MiB > ${budgets.rssDeltaMiB}MiB`)
  if (failures.length) throw new Error(`NeoView thumbnail system performance budget failed:\n- ${failures.join("\n- ")}`)
}

function scrollWindowStarts(pageCountValue: number, windowSizeValue: number): number[] {
  if (pageCountValue <= windowSizeValue) return [0]
  const starts: number[] = []
  for (let cursor = 0; cursor + windowSizeValue < pageCountValue; cursor += windowSizeValue) starts.push(cursor)
  const finalStart = pageCountValue - windowSizeValue
  if (starts.at(-1) !== finalStart) starts.push(finalStart)
  return starts
}

function workStateIsZero(snapshot: { demands: number; activeFlights: number; queuedFlights: number; runningFlights: number }): boolean {
  return snapshot.demands === 0 && snapshot.activeFlights === 0 && snapshot.queuedFlights === 0 && snapshot.runningFlights === 0
}

function disposedStateIsZero(snapshot: { demands: number; activeFlights: number; queuedFlights: number; runningFlights: number; cachedEntries: number; cachedBytes: number }): boolean {
  return workStateIsZero(snapshot) && snapshot.cachedEntries === 0 && snapshot.cachedBytes === 0
}

function pageDescriptor(page: ReaderPage) {
  return { mediaKind: page.mediaKind, mimeType: page.mimeType, byteLength: page.byteLength, archived: Boolean(page.entryPath) }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

function yieldToRuntime(): Promise<void> {
  return new Promise((resolvePromise) => setImmediate(resolvePromise))
}

function positiveInteger(value: string | undefined, name: string, maximum: number): number {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 2 || number > maximum) {
    throw new RangeError(`--${name} must be an integer from 2 to ${maximum}.`)
  }
  return number
}

function positiveNumber(value: string, name: string): number {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) throw new RangeError(`${name} must be positive.`)
  return number
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
