import { parseArgs } from "node:util"
import { resolve } from "node:path"
import { LegacyNeoViewDataLocator } from "../packages/nodes/neoview/src/application/data/LegacyNeoViewDataLocator.js"
import { openReadonlySqlite } from "../packages/nodes/neoview/src/platform/sqlite/openReadonlySqlite.js"
import { ReadonlyLegacyThumbnailStore } from "../packages/nodes/neoview/src/platform/thumbnails/ReadonlyLegacyThumbnailStore.js"

const parsed = parseArgs({
  options: {
    database: { type: "string" },
    iterations: { type: "string", default: "1000" },
    batch: { type: "string", default: "100" },
  },
})
const iterations = positiveInteger(parsed.values.iterations, "iterations", 1_000_000)
const batchSize = positiveInteger(parsed.values.batch, "batch", 512)
const databasePath = parsed.values.database
  ? resolve(parsed.values.database)
  : new LegacyNeoViewDataLocator().locate().thumbnailDatabasePath

const database = await openReadonlySqlite(databasePath)
let keys: string[]
let compressedSamples = 0
let compressedKeys: string[] = []
try {
  const rows = database.all(
    `SELECT key, hex(substr(value, 1, 4)) AS prefix FROM thumbs WHERE category = 'file' AND value IS NOT NULL LIMIT ${batchSize}`,
  )
  keys = rows.map((row) => row.key).filter((key): key is string => typeof key === "string")
  compressedSamples = rows.filter((row) => row.prefix === "4C5A3400").length
  compressedKeys = database.all(
    `SELECT key FROM thumbs WHERE category = 'file' AND value IS NOT NULL AND hex(substr(value, 1, 4)) = '4C5A3400' LIMIT ${batchSize}`,
  ).map((row) => row.key).filter((key): key is string => typeof key === "string")
} finally {
  database.close()
}
if (!keys.length) throw new Error("Thumbnail benchmark requires at least one file record.")

const store = await ReadonlyLegacyThumbnailStore.open(databasePath)
try {
  await store.get(keys[0]!, "file")
  await store.getMany(keys, "file")
  let started = performance.now()
  for (let index = 0; index < iterations; index += 1) {
    await store.get(keys[index % keys.length]!, "file")
  }
  const singleTotalMs = performance.now() - started

  const batchIterations = Math.max(50, Math.ceil(iterations / keys.length))
  started = performance.now()
  for (let index = 0; index < batchIterations; index += 1) await store.getMany(keys, "file")
  const batchTotalMs = performance.now() - started
  let compressed: Record<string, number> | undefined
  if (compressedKeys.length) {
    await store.get(compressedKeys[0]!, "file")
    started = performance.now()
    for (let index = 0; index < iterations; index += 1) {
      await store.get(compressedKeys[index % compressedKeys.length]!, "file")
    }
    const compressedSingleTotalMs = performance.now() - started
    const compressedBatchIterations = Math.max(50, Math.ceil(iterations / compressedKeys.length))
    started = performance.now()
    for (let index = 0; index < compressedBatchIterations; index += 1) await store.getMany(compressedKeys, "file")
    const compressedBatchTotalMs = performance.now() - started
    compressed = {
      sampledRecords: compressedKeys.length,
      singleAverageMs: compressedSingleTotalMs / iterations,
      averageBatchMs: compressedBatchTotalMs / compressedBatchIterations,
      averageRecordMs: compressedBatchTotalMs / (compressedBatchIterations * compressedKeys.length),
    }
  }

  process.stdout.write(`${JSON.stringify({
    databaseBytes: store.report.bytes,
    metadataVersion: store.report.metadataVersion,
    compatibility: store.report.compatibility,
    sampledRecords: keys.length,
    compressedSamples,
    compressed,
    single: {
      iterations,
      totalMs: singleTotalMs,
      averageMs: singleTotalMs / iterations,
    },
    batch: {
      iterations: batchIterations,
      recordsPerBatch: keys.length,
      totalMs: batchTotalMs,
      averageBatchMs: batchTotalMs / batchIterations,
      averageRecordMs: batchTotalMs / (batchIterations * keys.length),
    },
  }, null, 2)}\n`)
} finally {
  store.close()
}

function positiveInteger(value: string | undefined, label: string, maximum: number): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`--${label} must be an integer from 1 to ${maximum}.`)
  }
  return parsed
}
