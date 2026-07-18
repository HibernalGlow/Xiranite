import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { parseArgs } from "node:util"
import { resolve } from "node:path"
import { stat } from "node:fs/promises"
import { LegacyNeoViewDataLocator } from "../packages/nodes/neoview/src/application/data/LegacyNeoViewDataLocator.js"
import { openReadonlySqlite } from "../packages/nodes/neoview/src/platform/sqlite/openReadonlySqlite.js"
import { ReadonlyLegacyThumbnailStore } from "../packages/nodes/neoview/src/platform/thumbnails/ReadonlyLegacyThumbnailStore.js"
import { readThumbnailStoreBatch } from "../packages/nodes/neoview/src/platform/thumbnails/ThumbnailStoreBatchReader.js"
import { ResourceSchedulerService } from "../packages/services/src/resourceScheduler.js"
import { readLegacyThumbnailStatistics } from "../packages/nodes/neoview/src/platform/thumbnails/LegacyThumbnailStatistics.js"

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
const databaseFile = await stat(databasePath)
const databaseSha256 = await sha256File(databasePath)

const database = await openReadonlySqlite(databasePath)
let keys: string[]
let compressedSamples = 0
let compressedKeys: string[] = []
let aggregate: Record<string, unknown> = {}
try {
  aggregate = database.get(
    `SELECT COUNT(*) AS total_records,
            SUM(category = 'file') AS file_records,
            SUM(category = 'folder') AS folder_records,
            SUM(value IS NULL OR length(value) = 0) AS empty_records,
            SUM(hex(substr(value, 1, 4)) = '4C5A3400') AS compressed_records,
            ROUND(AVG(length(value)), 1) AS average_blob_bytes,
            MAX(length(value)) AS maximum_blob_bytes
       FROM thumbs`,
  ) ?? {}
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
  const statisticsScheduler = new ResourceSchedulerService()
  const statisticsStarted = performance.now()
  const statistics = await readLegacyThumbnailStatistics(databasePath, { resourceScheduler: statisticsScheduler })
  const statisticsTotalMs = performance.now() - statisticsStarted
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
  const scheduler = new ResourceSchedulerService()
  started = performance.now()
  for (let index = 0; index < batchIterations; index += 1) {
    await readThumbnailStoreBatch(store, keys, "file", { resourceScheduler: scheduler, priority: "background" })
  }
  const cooperativeBatchTotalMs = performance.now() - started
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
    databaseSha256,
    databaseMtimeMs: databaseFile.mtimeMs,
    metadataVersion: store.report.metadataVersion,
    compatibility: store.report.compatibility,
    journalMode: store.report.journalMode,
    sidecars: {
      wal: store.report.sidecars.wal.exists ? store.report.sidecars.wal.bytes ?? 0 : 0,
      shm: store.report.sidecars.shm.exists ? store.report.sidecars.shm.bytes ?? 0 : 0,
    },
    environment: {
      runtime: process.versions.bun ? `Bun ${process.versions.bun}` : process.version,
      platform: `${process.platform}-${process.arch}`,
      cacheState: "unspecified",
    },
    parameters: { iterations, batchSize },
    records: {
      total: integer(aggregate.total_records),
      file: integer(aggregate.file_records),
      folder: integer(aggregate.folder_records),
      empty: integer(aggregate.empty_records),
      compressed: integer(aggregate.compressed_records),
      averageBlobBytes: numberValue(aggregate.average_blob_bytes),
      maximumBlobBytes: integer(aggregate.maximum_blob_bytes),
    },
    maintenanceStatistics: {
      totalMs: statisticsTotalMs,
      ...statistics,
      scheduler: statisticsScheduler.snapshot().io,
    },
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
    cooperativeBatch: {
      chunkSize: 64,
      iterations: batchIterations,
      recordsPerBatch: keys.length,
      totalMs: cooperativeBatchTotalMs,
      averageBatchMs: cooperativeBatchTotalMs / batchIterations,
      averageRecordMs: cooperativeBatchTotalMs / (batchIterations * keys.length),
      scheduler: scheduler.snapshot().io,
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

function integer(value: unknown): number {
  if (typeof value === "bigint") return Number(value)
  return typeof value === "number" && Number.isSafeInteger(value) ? value : 0
}

function numberValue(value: unknown): number {
  if (typeof value === "bigint") return Number(value)
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(path, { highWaterMark: 1024 * 1024 })) hash.update(chunk)
  return hash.digest("hex")
}
