import { performance } from "node:perf_hooks"

import { WeightedLruPresentationCache } from "../packages/nodes/neoview/src/platform/cache/WeightedLruPresentationCache.js"

const mib = 1024 * 1024
const budgetMiB = positiveInteger(Number(process.env.NEOVIEW_CACHE_BENCH_MIB ?? 32), "NEOVIEW_CACHE_BENCH_MIB")
const entryMiB = 1
const writeCount = budgetMiB * 2
const hotSetSize = Math.max(1, Math.floor(budgetMiB / 2))
const readCount = 20_000
const cache = new WeightedLruPresentationCache({
  maxBytes: budgetMiB * mib,
  maxEntryBytes: 4 * mib,
  trimRatio: 0.8,
})

const writeStart = performance.now()
for (let index = 0; index < writeCount; index += 1) {
  const bytes = new Uint8Array(entryMiB * mib)
  bytes.fill(index & 0xff)
  if (!cache.set(`page-${index}`, { bytes, contentType: "image/webp" })) {
    throw new Error(`Cache rejected benchmark entry ${index}`)
  }
}
const writeMs = performance.now() - writeStart
const afterWrites = cache.snapshot()
if (afterWrites.bytes > afterWrites.maxBytes) throw new Error("Cache exceeded its hard byte budget")

const hotKeys = Array.from({ length: hotSetSize }, (_, offset) => `page-${writeCount - 1 - offset}`)
const readStart = performance.now()
for (let index = 0; index < readCount; index += 1) {
  const key = hotKeys[index % hotKeys.length]!
  if (!cache.get(key)) throw new Error(`Expected hot cache entry was evicted: ${key}`)
}
const readMs = performance.now() - readStart
const final = cache.snapshot()
const retentionCount = Math.min(8, Math.max(1, Math.floor(budgetMiB / 4)))
const retainedKeys = hotKeys.slice(0, retentionCount)
const retainedLeases = retainedKeys.map((key) => {
  const lease = cache.pin(key)
  if (!lease) throw new Error(`Expected retention candidate was unavailable: ${key}`)
  return lease
})
const retainedBeforeFlood = cache.snapshot()
for (let index = 0; index < budgetMiB; index += 1) {
  const bytes = new Uint8Array(entryMiB * mib)
  bytes.fill((writeCount + index) & 0xff)
  if (!cache.set(`retention-flood-${index}`, { bytes, contentType: "image/webp" })) {
    throw new Error(`Cache rejected retention flood entry ${index}`)
  }
}
const retainedAfterFlood = cache.snapshot()
if (retainedAfterFlood.bytes > retainedAfterFlood.maxBytes) throw new Error("Retention scenario exceeded the hard byte budget")
if (retainedAfterFlood.pinnedEntries !== retentionCount || retainedAfterFlood.activeLeases !== retentionCount) {
  throw new Error("Retention leases were lost during eviction pressure")
}
const retentionReadStart = performance.now()
for (let index = 0; index < readCount; index += 1) {
  const key = retainedKeys[index % retainedKeys.length]!
  if (!cache.get(key)) throw new Error(`Retained presentation was evicted: ${key}`)
}
const retentionReadMs = performance.now() - retentionReadStart
for (const lease of retainedLeases) lease.release()
const afterRetentionRelease = cache.snapshot()
if (afterRetentionRelease.activeLeases !== 0 || afterRetentionRelease.pinnedEntries !== 0) {
  throw new Error("Retention leases did not return to zero")
}

process.stdout.write(`${JSON.stringify({
  benchmark: "cache-memory-budget",
  benchmarkIds: ["cache-memory-budget", "presentation-retention"],
  runtime: `Bun ${Bun.version}`,
  platform: `${process.platform}-${process.arch}`,
  configuration: {
    budgetMiB,
    maxEntryMiB: 4,
    trimRatio: 0.8,
    entryMiB,
    writeCount,
    readCount,
    hotSetSize,
    retentionFloodCount: budgetMiB,
  },
  writes: {
    milliseconds: round(writeMs),
    entriesPerSecond: round(writeCount / (writeMs / 1000)),
    inputMiBPerSecond: round(writeCount * entryMiB / (writeMs / 1000)),
  },
  hotReads: {
    milliseconds: round(readMs),
    operationsPerSecond: round(readCount / (readMs / 1000)),
    averageMicroseconds: round(readMs * 1000 / readCount),
  },
  retention: {
    desiredEntries: retentionCount,
    retainedMiBBeforeFlood: round((retainedBeforeFlood.pinnedBytes ?? 0) / mib),
    retainedMiBAfterFlood: round((retainedAfterFlood.pinnedBytes ?? 0) / mib),
    totalMiBAfterFlood: round(retainedAfterFlood.bytes / mib),
    hardBudgetMiB: round(retainedAfterFlood.maxBytes / mib),
    activeLeasesDuringFlood: retainedAfterFlood.activeLeases ?? 0,
    survivedBudgetFlood: true,
    hotReadAverageMicroseconds: round(retentionReadMs * 1000 / readCount),
    activeLeasesAfterRelease: afterRetentionRelease.activeLeases ?? 0,
  },
  cache: {
    entries: final.entries,
    retainedMiB: round(final.bytes / mib),
    hardBudgetMiB: round(final.maxBytes / mib),
    hits: final.hits,
    misses: final.misses,
    evictions: final.evictions,
  },
}, null, 2)}\n`)

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 2) throw new RangeError(`${name} must be an integer >= 2`)
  return value
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
