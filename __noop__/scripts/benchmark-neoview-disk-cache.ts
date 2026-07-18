import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { performance } from "node:perf_hooks"

import { CacachePresentationDiskCache } from "../packages/nodes/neoview/src/platform/cache/CacachePresentationDiskCache.js"
import { buildPresentationCacheKey } from "../packages/nodes/neoview/src/platform/cache/PresentationCacheKey.js"

const mib = 1024 * 1024
const budgetMiB = positiveInteger(Number(process.env.NEOVIEW_DISK_CACHE_BENCH_MIB ?? 64), "NEOVIEW_DISK_CACHE_BENCH_MIB")
const writeCount = budgetMiB
const readCount = 128
const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-l3-bench-"))
const cache = new CacachePresentationDiskCache({
  root,
  maxBytes: budgetMiB * mib,
  maxEntryBytes: 4 * mib,
  minFreeBytes: 0,
  minimumRetentionMs: 0,
})

try {
  const writeStart = performance.now()
  let firstWriteMs = 0
  for (let index = 0; index < writeCount; index += 1) {
    const bytes = new Uint8Array(mib)
    new DataView(bytes.buffer).setUint32(0, index)
    const entryStart = performance.now()
    if (!await cache.put(key(`page-${index}`), { bytes, contentType: "image/webp" })) {
      throw new Error(`Disk cache rejected benchmark entry ${index}`)
    }
    if (index === 0) firstWriteMs = performance.now() - entryStart
  }
  const writeMs = performance.now() - writeStart

  const readStart = performance.now()
  for (let index = 0; index < readCount; index += 1) {
    const lease = await cache.acquire(key(`page-${index % writeCount}`))
    if (!lease || lease.bytes.byteLength !== mib) throw new Error(`Disk cache missed benchmark entry ${index % writeCount}`)
    lease.release()
  }
  const readMs = performance.now() - readStart

  const sameKeyStart = performance.now()
  const sameKeyResults = await Promise.all(Array.from({ length: 16 }, () => cache.put(
    key("same-key"),
    { bytes: new Uint8Array(256 * 1024).fill(0x5a), contentType: "image/webp" },
  )))
  const sameKeyMs = performance.now() - sameKeyStart
  if (sameKeyResults.some((value) => !value)) throw new Error("Concurrent same-key benchmark write was rejected")

  const snapshot = await cache.snapshot()
  process.stdout.write(`${JSON.stringify({
    benchmark: "cacache-presentation-l3",
    runtime: `Bun ${Bun.version}`,
    platform: `${process.platform}-${process.arch}`,
    configuration: { budgetMiB, maxEntryMiB: 4, writeCount, readCount, integrity: "sha256" },
    writes: {
      firstWriteMilliseconds: round(firstWriteMs),
      milliseconds: round(writeMs),
      entriesPerSecond: round(writeCount / (writeMs / 1000)),
      inputMiBPerSecond: round(writeCount / (writeMs / 1000)),
    },
    verifiedReads: {
      milliseconds: round(readMs),
      operationsPerSecond: round(readCount / (readMs / 1000)),
      inputMiBPerSecond: round(readCount / (readMs / 1000)),
    },
    sameKey: { writers: 16, milliseconds: round(sameKeyMs) },
    cache: snapshot,
  }, null, 2)}\n`)
} finally {
  await cache.close()
  await rm(root, { recursive: true, force: true })
}

function key(entryIdentity: string): string {
  return buildPresentationCacheKey({
    cacheKind: "presentation-transform",
    sourceIdentity: "benchmark-source",
    sourceRevision: "benchmark-v1",
    entryIdentity,
    producerVersion: "benchmark-producer-v1",
    transformProfile: "1920:auto:1:inside:webp:82",
  })
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer`)
  return value
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
