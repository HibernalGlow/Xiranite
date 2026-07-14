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

process.stdout.write(`${JSON.stringify({
  benchmark: "cache-memory-budget",
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
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer`)
  return value
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
