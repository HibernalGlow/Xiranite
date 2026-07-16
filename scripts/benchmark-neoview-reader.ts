import { createHash } from "node:crypto"
import { join } from "node:path"
import { performance } from "node:perf_hooks"

import { createMemoryWorkspaceRepository } from "@xiranite/repository"
import { startBackend } from "../packages/backend/src/index.js"
import {
  createZipFixture,
  deterministicBytes,
} from "../packages/nodes/neoview/test/fixture-builders/create-zip-fixture.js"

const MIB = 1024 * 1024
const PAGE_COUNT = positiveInteger(Number(process.env.NEOVIEW_READER_BENCH_PAGES ?? 8), "NEOVIEW_READER_BENCH_PAGES")
const ASSERT = process.argv.includes("--assert")
const budgets = {
  openMs: positiveNumber(Number(process.env.NEOVIEW_READER_MAX_OPEN_MS ?? 500), "NEOVIEW_READER_MAX_OPEN_MS"),
  navigationP95Ms: positiveNumber(Number(process.env.NEOVIEW_READER_MAX_NAV_P95_MS ?? 150), "NEOVIEW_READER_MAX_NAV_P95_MS"),
  responseP95Ms: positiveNumber(Number(process.env.NEOVIEW_READER_MAX_RESPONSE_P95_MS ?? 150), "NEOVIEW_READER_MAX_RESPONSE_P95_MS"),
  firstByteP95Ms: positiveNumber(Number(process.env.NEOVIEW_READER_MAX_FIRST_BYTE_P95_MS ?? 200), "NEOVIEW_READER_MAX_FIRST_BYTE_P95_MS"),
  throughputP50MiBps: positiveNumber(Number(process.env.NEOVIEW_READER_MIN_THROUGHPUT_MIBPS ?? 50), "NEOVIEW_READER_MIN_THROUGHPUT_MIBPS"),
  rssDeltaMiB: positiveNumber(Number(process.env.NEOVIEW_READER_MAX_RSS_DELTA_MIB ?? 256), "NEOVIEW_READER_MAX_RSS_DELTA_MIB"),
}

const sharpModule = await import("sharp")
const sharp = (sharpModule as unknown as { default?: typeof import("sharp") }).default ?? sharpModule
const raw = deterministicBytes(1600 * 2400 * 3)
const jpeg = await sharp(raw, { raw: { width: 1600, height: 2400, channels: 3 } })
  .jpeg({ quality: 88 })
  .toBuffer()
const fixture = await createZipFixture({
  name: "reader-pipeline-benchmark.cbz",
  entries: Array.from({ length: PAGE_COUNT }, (_, index) => ({
    path: `pages/${String(index + 1).padStart(3, "0")}.jpg`,
    bytes: jpeg,
    level: index % 2 === 0 ? 0 : 6,
  })),
})

const rssBefore = process.memoryUsage().rss
let peakRss = rssBefore
let backend: Awaited<ReturnType<typeof startBackend>> | undefined
try {
  const backendStart = performance.now()
  backend = await startBackend({
    token: "neoview-reader-benchmark",
    repository: createMemoryWorkspaceRepository(),
    configPath: join(fixture.directory, "missing.config.toml"),
    legacyThumbnailDatabasePath: false,
  })
  const backendStartMs = performance.now() - backendStart
  const headers = { "content-type": "application/json", "x-xiranite-token": backend.token }
  const openStart = performance.now()
  const openResponse = await fetch(`${backend.url}/reader/sessions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ path: fixture.path }),
  })
  if (!openResponse.ok) throw new Error(`Reader benchmark open failed: ${openResponse.status} ${await openResponse.text()}`)
  const opened = await openResponse.json() as ReaderSessionDto
  const openMs = performance.now() - openStart
  const measurements: PageMeasurement[] = []

  for (let pageIndex = 1; pageIndex < PAGE_COUNT; pageIndex += 1) {
    const navigationStart = performance.now()
    const navigationResponse = await fetch(`${backend.url}/reader/s/${opened.sessionId}/navigate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "goTo", pageIndex }),
    })
    if (!navigationResponse.ok) throw new Error(`Reader benchmark navigation failed: ${navigationResponse.status}`)
    const navigation = await navigationResponse.json() as { visiblePages: ReaderPageDto[] }
    const navigationMs = performance.now() - navigationStart
    const page = navigation.visiblePages[0]
    if (!page) throw new Error(`Reader benchmark page ${pageIndex} has no visible DTO.`)
    const asset = new URL(page.assetUrl)
    if (asset.searchParams.has("width") || asset.searchParams.has("format")) {
      throw new Error(`Default reader asset unexpectedly requested a transform: ${asset.pathname}`)
    }

    const responseStart = performance.now()
    const response = await fetch(page.assetUrl)
    const responseMs = performance.now() - responseStart
    if (!response.ok || !response.body) throw new Error(`Reader benchmark asset failed: ${response.status}`)
    if (response.headers.get("content-type") !== "image/jpeg") {
      throw new Error(`Reader benchmark expected image/jpeg, got ${response.headers.get("content-type")}.`)
    }
    const reader = response.body.getReader()
    const first = await reader.read()
    const firstByteMs = performance.now() - responseStart
    let bytes = first.value?.byteLength ?? 0
    while (!first.done) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
    }
    const totalMs = performance.now() - responseStart
    if (bytes !== jpeg.byteLength) throw new Error(`Reader benchmark streamed ${bytes} bytes; expected ${jpeg.byteLength}.`)
    peakRss = Math.max(peakRss, process.memoryUsage().rss)
    measurements.push({
      pageIndex,
      navigationMs,
      responseMs,
      firstByteMs,
      totalMs,
      throughputMiBps: bytes / MIB / (totalMs / 1000),
    })
  }

  const retentionPage = await navigatePage(backend.url, opened.sessionId, 0, headers)
  const transformedUrl = new URL(retentionPage.assetUrl)
  transformedUrl.searchParams.set("width", "800")
  transformedUrl.searchParams.set("format", "webp")
  const beforeRetention = await diagnostics(backend.url, backend.token)
  const coldTransformStart = performance.now()
  const coldTransformResponse = await fetch(transformedUrl)
  const coldTransformBytes = new Uint8Array(await coldTransformResponse.arrayBuffer())
  const coldTransformMs = performance.now() - coldTransformStart
  assertWebpResponse(coldTransformResponse, coldTransformBytes, "cold")
  const afterColdTransform = await diagnostics(backend.url, backend.token)
  if (afterColdTransform.assets.presentationRetention?.retainedPresentations !== 1
    || afterColdTransform.cache?.leases.presentationMemory !== 1) {
    throw new Error("Reader benchmark did not retain the active transformed presentation")
  }

  const warmPinnedStart = performance.now()
  const warmPinnedResponse = await fetch(transformedUrl)
  const warmPinnedBytes = new Uint8Array(await warmPinnedResponse.arrayBuffer())
  const warmPinnedMs = performance.now() - warmPinnedStart
  assertWebpResponse(warmPinnedResponse, warmPinnedBytes, "warm-pinned")
  if (!equalBytes(coldTransformBytes, warmPinnedBytes)) throw new Error("Pinned L2 response changed transformed bytes")
  if (warmPinnedResponse.headers.get("content-length") !== String(coldTransformBytes.byteLength)) {
    throw new Error("Pinned L2 response did not expose the cached content length")
  }
  const afterWarmPinned = await diagnostics(backend.url, backend.token)
  if ((afterWarmPinned.assets.presentation?.hits ?? 0) <= (afterColdTransform.assets.presentation?.hits ?? 0)) {
    throw new Error("Pinned transformed presentation did not register an L2 hit")
  }

  await navigatePage(backend.url, opened.sessionId, PAGE_COUNT - 1, headers)
  const afterNavigationRelease = await diagnostics(backend.url, backend.token)
  if (afterNavigationRelease.assets.presentationRetention?.retainedPresentations !== 0
    || afterNavigationRelease.cache?.leases.presentationMemory !== 0) {
    throw new Error("Navigation did not release the previous presentation retention lease")
  }

  await navigatePage(backend.url, opened.sessionId, 0, headers)
  const warmRevisitStart = performance.now()
  const warmRevisitResponse = await fetch(transformedUrl)
  const warmRevisitBytes = new Uint8Array(await warmRevisitResponse.arrayBuffer())
  const warmRevisitMs = performance.now() - warmRevisitStart
  assertWebpResponse(warmRevisitResponse, warmRevisitBytes, "warm-revisit")
  if (!equalBytes(coldTransformBytes, warmRevisitBytes)) throw new Error("Revisited L2 response changed transformed bytes")
  const afterWarmRevisit = await diagnostics(backend.url, backend.token)
  if (afterWarmRevisit.assets.presentationRetention?.retainedPresentations !== 1
    || afterWarmRevisit.cache?.leases.presentationMemory !== 1) {
    throw new Error("Revisited transformed presentation was not retained")
  }
  peakRss = Math.max(peakRss, process.memoryUsage().rss)

  const closeResponse = await fetch(`${backend.url}/reader/s/${opened.sessionId}`, {
    method: "DELETE",
    headers: { "x-xiranite-token": backend.token },
  })
  if (!closeResponse.ok) throw new Error(`Reader benchmark close failed: ${closeResponse.status}`)
  const afterClose = await diagnostics(backend.url, backend.token)
  if (afterClose.cache?.leases.total !== 0 || afterClose.cache?.memory.totalBytes !== 0) {
    throw new Error("Reader benchmark close did not release presentation cache memory and leases")
  }
  const report = {
    benchmark: "reader-loopback-pipeline",
    benchmarkIds: ["reader-loopback-pipeline", "presentation-retention-real-image"],
    runtime: `Bun ${Bun.version}`,
    platform: `${process.platform}-${process.arch}`,
    cacheState: "single backend/session; stream-loop page ids cold; retention scenario has explicit cold/warm phases; OS file cache unspecified",
    sample: {
      pages: PAGE_COUNT,
      width: 1600,
      height: 2400,
      jpegMiB: round(jpeg.byteLength / MIB),
      sha256: createHash("sha256").update(jpeg).digest("hex"),
      archiveSha256: createHash("sha256").update(fixture.bytes).digest("hex"),
    },
    startup: { backendMs: round(backendStartMs), openSessionMs: round(openMs) },
    navigation: summarize(measurements.map((item) => item.navigationMs)),
    responseHeaders: summarize(measurements.map((item) => item.responseMs)),
    firstByte: summarize(measurements.map((item) => item.firstByteMs)),
    fullStream: summarize(measurements.map((item) => item.totalMs)),
    throughputMiBps: summarize(measurements.map((item) => item.throughputMiBps)),
    presentationRetention: {
      source: "sharp-generated deterministic 1600x2400 JPEG through loopback Reader HTTP",
      outputWidth: 800,
      outputFormat: "webp",
      outputMiB: round(coldTransformBytes.byteLength / MIB),
      outputSha256: createHash("sha256").update(coldTransformBytes).digest("hex"),
      coldTransformMs: round(coldTransformMs),
      warmPinnedMs: round(warmPinnedMs),
      warmRevisitMs: round(warmRevisitMs),
      l2HitsBefore: beforeRetention.assets.presentation?.hits ?? 0,
      l2HitsAfterPinned: afterWarmPinned.assets.presentation?.hits ?? 0,
      l2HitsAfterRevisit: afterWarmRevisit.assets.presentation?.hits ?? 0,
      retainedBytes: afterColdTransform.assets.presentation?.pinnedBytes ?? 0,
      releasedOnNavigation: true,
      releasedOnClose: true,
    },
    memory: {
      rssBeforeMiB: round(rssBefore / MIB),
      peakRssMiB: round(peakRss / MIB),
      deltaMiB: round((peakRss - rssBefore) / MIB),
    },
    budgets,
  }
  if (ASSERT) assertReport(report)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} finally {
  await backend?.close()
  await fixture.cleanup()
}

interface ReaderPageDto {
  assetUrl: string
}

interface ReaderSessionDto {
  sessionId: string
}

interface ReaderDiagnosticsDto {
  assets: {
    presentation: { hits: number; pinnedBytes?: number } | null
    presentationRetention?: { retainedPresentations: number }
  }
  cache?: {
    memory: { totalBytes: number }
    leases: { presentationMemory: number; total: number }
  }
}

interface PageMeasurement {
  pageIndex: number
  navigationMs: number
  responseMs: number
  firstByteMs: number
  totalMs: number
  throughputMiBps: number
}

interface Summary {
  min: number
  p50: number
  p95: number
  max: number
  average: number
}

function summarize(values: number[]): Summary {
  if (!values.length) throw new Error("Reader benchmark needs at least two pages.")
  const sorted = values.toSorted((left, right) => left - right)
  return {
    min: round(sorted[0]!),
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    max: round(sorted.at(-1)!),
    average: round(values.reduce((sum, value) => sum + value, 0) / values.length),
  }
}

function percentile(sorted: readonly number[], value: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)
  return sorted[Math.max(0, index)]!
}

function assertReport(report: {
  startup: { openSessionMs: number }
  navigation: Summary
  responseHeaders: Summary
  firstByte: Summary
  throughputMiBps: Summary
  memory: { deltaMiB: number }
}): void {
  const failures: string[] = []
  if (report.startup.openSessionMs > budgets.openMs) failures.push(`open ${report.startup.openSessionMs}ms > ${budgets.openMs}ms`)
  if (report.navigation.p95 > budgets.navigationP95Ms) failures.push(`navigation p95 ${report.navigation.p95}ms > ${budgets.navigationP95Ms}ms`)
  if (report.responseHeaders.p95 > budgets.responseP95Ms) failures.push(`response p95 ${report.responseHeaders.p95}ms > ${budgets.responseP95Ms}ms`)
  if (report.firstByte.p95 > budgets.firstByteP95Ms) failures.push(`first-byte p95 ${report.firstByte.p95}ms > ${budgets.firstByteP95Ms}ms`)
  if (report.throughputMiBps.p50 < budgets.throughputP50MiBps) failures.push(`throughput p50 ${report.throughputMiBps.p50}MiB/s < ${budgets.throughputP50MiBps}MiB/s`)
  if (report.memory.deltaMiB > budgets.rssDeltaMiB) failures.push(`RSS delta ${report.memory.deltaMiB}MiB > ${budgets.rssDeltaMiB}MiB`)
  if (failures.length) throw new Error(`NeoView reader performance budget failed:\n- ${failures.join("\n- ")}`)
}

async function navigatePage(
  backendUrl: string,
  sessionId: string,
  pageIndex: number,
  headers: Record<string, string>,
): Promise<ReaderPageDto> {
  const response = await fetch(`${backendUrl}/reader/s/${sessionId}/navigate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "goTo", pageIndex }),
  })
  if (!response.ok) throw new Error(`Reader benchmark navigation failed: ${response.status}`)
  const result = await response.json() as { visiblePages: ReaderPageDto[] }
  const page = result.visiblePages[0]
  if (!page) throw new Error(`Reader benchmark page ${pageIndex} has no visible DTO.`)
  return page
}

async function diagnostics(backendUrl: string, token: string): Promise<ReaderDiagnosticsDto> {
  const response = await fetch(`${backendUrl}/reader/diagnostics`, { headers: { "x-xiranite-token": token } })
  if (!response.ok) throw new Error(`Reader benchmark diagnostics failed: ${response.status}`)
  return response.json() as Promise<ReaderDiagnosticsDto>
}

function assertWebpResponse(response: Response, bytes: Uint8Array, stage: string): void {
  if (!response.ok) throw new Error(`Reader benchmark ${stage} transform failed: ${response.status}`)
  if (response.headers.get("content-type") !== "image/webp") {
    throw new Error(`Reader benchmark ${stage} expected image/webp, got ${response.headers.get("content-type")}.`)
  }
  if (bytes.byteLength < 12 || Buffer.from(bytes.subarray(0, 4)).toString("ascii") !== "RIFF"
    || Buffer.from(bytes.subarray(8, 12)).toString("ascii") !== "WEBP") {
    throw new Error(`Reader benchmark ${stage} returned invalid WebP bytes`)
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index])
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 2) throw new RangeError(`${name} must be an integer >= 2.`)
  return value
}

function positiveNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive.`)
  return value
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
