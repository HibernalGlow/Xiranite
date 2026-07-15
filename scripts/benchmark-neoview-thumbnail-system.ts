import { mkdir, mkdtemp, link, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import pMap from "p-map"

import type { ReaderBook } from "../packages/nodes/neoview/src/domain/book/book.js"
import type { ReaderPage } from "../packages/nodes/neoview/src/domain/page/page.js"
import { CoreReaderDirectoryBrowser } from "../packages/nodes/neoview/src/application/browser/ReaderDirectoryBrowser.js"
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
const realCorpus = Boolean(parsed.values["page-source"] && parsed.values["directory-source"])
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
  rssDeltaMiB: positiveNumber(process.env.NEOVIEW_THUMBNAIL_MAX_RSS_DELTA_MIB ?? "256", "NEOVIEW_THUMBNAIL_MAX_RSS_DELTA_MIB"),
}

let fixture: SyntheticFixture | undefined
let book: ReaderBook | undefined
let pipeline: PlatformThumbnailPipeline | undefined
try {
  const setupStarted = performance.now()
  if (!realCorpus) fixture = await createSyntheticFixture(pageCount, directoryCount, parsed.values["work-root"])
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
    loadImageTransformer: async () => new SharpImageTransformer(),
    maxMemoryBytes: 64 * MIB,
    maxEntryBytes: 2 * MIB,
  })
  const rssBefore = process.memoryUsage().rss
  let peakRss = rssBefore
  const sample = pages.slice(0, pageCount)
  const coldGenerationMs = await measureGeneration(pipeline, sample[0]!, "benchmark:cold")
  pipeline.hibernateReader()
  const warmGenerationMs = await measureGeneration(pipeline, sample[1]!, "benchmark:warm")
  pipeline.hibernateReader()
  peakRss = Math.max(peakRss, process.memoryUsage().rss)

  const scroll = await benchmarkScroll(pipeline, sample, windowSize, () => {
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
      kind: realCorpus ? "real" : "synthetic-smoke",
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
      firstSample: pageDescriptor(sample[0]!),
      secondSample: pageDescriptor(sample[1]!),
      coldGenerationMs: round(coldGenerationMs),
      warmGenerationMs: round(warmGenerationMs),
    },
    scroll,
    lifecycle: { beforeDispose, afterDispose },
    memory: {
      rssBeforeMiB: round(rssBefore / MIB),
      peakRssMiB: round(peakRss / MIB),
      deltaMiB: round((peakRss - rssBefore) / MIB),
    },
    budgets,
  }
  if (assertBudgets) assertReport(report)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
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
  const browser = new CoreReaderDirectoryBrowser(provider)
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
  sampleMemory: () => void,
) {
  const contextId = "benchmark:scroll"
  let generation = 0
  let active: Array<ReturnType<PlatformThumbnailPipeline["acquirePage"]>> = []
  let finalPages: readonly ReaderPage[] = []
  let finalRequestedAt = 0
  const settlements: Array<Promise<"ready" | "cancelled" | "failed">> = []
  let peakActiveFlights = 0
  let peakQueuedFlights = 0
  let peakRunningFlights = 0
  const dispatchStarted = performance.now()
  const windowStarts = scrollWindowStarts(pages.length, windowSize)
  for (const cursor of windowStarts) {
    generation += 1
    pipeline.advanceContext(contextId, generation)
    for (const lease of active) lease.release()
    finalPages = pages.slice(cursor, Math.min(pages.length, cursor + windowSize))
    finalRequestedAt = performance.now()
    active = finalPages.map((page) => pipeline.acquirePage(page, { contextId, generation }))
    for (const lease of active) {
      settlements.push(lease.ready.then(() => "ready", (error) => isAbortError(error) ? "cancelled" : "failed"))
    }
    await yieldToRuntime()
    const snapshot = pipeline.snapshot()
    peakActiveFlights = Math.max(peakActiveFlights, snapshot.activeFlights)
    peakQueuedFlights = Math.max(peakQueuedFlights, snapshot.queuedFlights)
    peakRunningFlights = Math.max(peakRunningFlights, snapshot.runningFlights)
    sampleMemory()
  }
  const dispatchMs = performance.now() - dispatchStarted
  const visibleReadyMs = await Promise.all(active.map(async (lease) => {
    await lease.ready
    return performance.now() - finalRequestedAt
  }))
  const settled = await Promise.all(settlements)
  for (const lease of active) lease.release()

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
    demands: settlements.length,
    finalVisible: finalPages.length,
    dispatchMs: round(dispatchMs),
    ready: settled.filter((value) => value === "ready").length,
    cancelled: settled.filter((value) => value === "cancelled").length,
    failed: settled.filter((value) => value === "failed").length,
    peakActiveFlights,
    peakQueuedFlights,
    peakRunningFlights,
    finalVisibleReadyMs: summarize(visibleReadyMs),
    l1HitMs: summarize(l1HitMs),
    afterRelease: pipeline.snapshot(),
  }
}

async function createSyntheticFixture(pages: number, files: number, workRoot?: string): Promise<SyntheticFixture> {
  const parent = resolve(workRoot ?? tmpdir())
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, "xiranite-neoview-thumbnail-benchmark-"))
  try {
    const pageDirectory = join(root, "pages")
    const browserDirectory = join(root, "browser")
    await Promise.all([mkdir(pageDirectory), mkdir(browserDirectory)])
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
    await pMap(Array.from({ length: files }, (_, index) => index), async (index) => {
      await writeFile(join(browserDirectory, `${String(index + 1).padStart(6, "0")}.cbz`), new Uint8Array())
    }, { concurrency: 64 })
    return { root, pageDirectory, browserDirectory }
  } catch (error) {
    await rm(root, { recursive: true, force: true })
    throw error
  }
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
    afterRelease: { demands: number; activeFlights: number; queuedFlights: number; runningFlights: number }
  }
  lifecycle: { afterDispose: { demands: number; activeFlights: number; queuedFlights: number; runningFlights: number; cachedEntries: number; cachedBytes: number } }
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
  if (!workStateIsZero(report.scroll.afterRelease)) failures.push("scroll demands/flights did not return to zero")
  if (!disposedStateIsZero(report.lifecycle.afterDispose)) failures.push("coordinator state did not return to zero after dispose")
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
