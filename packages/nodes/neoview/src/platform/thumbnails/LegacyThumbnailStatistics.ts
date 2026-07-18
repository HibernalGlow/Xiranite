import { scheduler as timersScheduler } from "node:timers/promises"

import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"
import { openReadonlySqlite, type ReadonlySqliteConnection } from "../sqlite/openReadonlySqlite.js"

const DEFAULT_CHUNK_SIZE = 256

export interface LegacyThumbnailStatistics {
  totalRows: number
  fileRows: number
  folderRows: number
  blobBytes: number
  emptyBlobs: number
  failedRows: number
  failuresByReason: Readonly<Record<string, number>>
}

export interface LegacyThumbnailStatisticsOptions {
  chunkSize?: number
  resourceScheduler?: ResourceScheduler
  signal?: AbortSignal
  yieldBetweenChunks?: () => Promise<void>
}

export async function readLegacyThumbnailStatistics(
  databasePath: string,
  options: LegacyThumbnailStatisticsOptions = {},
): Promise<LegacyThumbnailStatistics> {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > 2_048) {
    throw new RangeError("Legacy thumbnail statistics chunkSize must be an integer from 1 to 2048.")
  }
  options.signal?.throwIfAborted()
  const database = await openReadonlySqlite(databasePath)
  let transaction = false
  try {
    database.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 1000; BEGIN")
    transaction = true
    const indexed = await withIoLease(
      options.resourceScheduler,
      "neoview.thumbnail.database-statistics-index",
      options.signal,
      () => readIndexedStatistics(database),
    )
    let cursor = 0
    let totalRows = 0
    let blobBytes = 0
    let emptyBlobs = 0
    const yieldBetweenChunks = options.yieldBetweenChunks ?? (() => timersScheduler.yield())
    for (;;) {
      options.signal?.throwIfAborted()
      const rows = await withIoLease(
        options.resourceScheduler,
        "neoview.thumbnail.database-statistics-scan",
        options.signal,
        () => database.all(
          "SELECT rowid, length(value) AS blob_bytes FROM thumbs WHERE rowid > ?1 ORDER BY rowid LIMIT ?2",
          cursor,
          chunkSize + 1,
        ),
      )
      const hasMore = rows.length > chunkSize
      const current = hasMore ? rows.slice(0, chunkSize) : rows
      for (const row of current) {
        cursor = integer(row.rowid, "thumbs.rowid")
        const bytes = optionalInteger(row.blob_bytes) ?? 0
        blobBytes += bytes
        if (!bytes) emptyBlobs += 1
      }
      totalRows += current.length
      if (!hasMore) break
      await yieldBetweenChunks()
    }
    options.signal?.throwIfAborted()
    database.exec("COMMIT")
    transaction = false
    return { totalRows, blobBytes, emptyBlobs, ...indexed }
  } finally {
    if (transaction) {
      try { database.exec("ROLLBACK") } catch { /* preserve the original scan failure */ }
    }
    database.close()
  }
}

function readIndexedStatistics(database: ReadonlySqliteConnection): Omit<LegacyThumbnailStatistics, "totalRows" | "blobBytes" | "emptyBlobs"> {
  const fileRows = scalarCount(database, "SELECT COUNT(*) AS count FROM thumbs WHERE category = 'file'")
  const folderRows = scalarCount(database, "SELECT COUNT(*) AS count FROM thumbs WHERE category = 'folder'")
  const failures = database.all("SELECT reason, COUNT(*) AS count FROM failed_thumbnails GROUP BY reason ORDER BY reason")
  const failuresByReason: Record<string, number> = {}
  let failedRows = 0
  for (const row of failures) {
    if (typeof row.reason !== "string") throw new Error("failed_thumbnails.reason must be text.")
    const count = integer(row.count, "failed_thumbnails.count")
    failuresByReason[row.reason] = count
    failedRows += count
  }
  return { fileRows, folderRows, failedRows, failuresByReason }
}

function scalarCount(database: ReadonlySqliteConnection, sql: string): number {
  const row = database.get(sql) ?? {}
  return integer(row.count, "SQLite count")
}

async function withIoLease<T>(
  scheduler: ResourceScheduler | undefined,
  kind: string,
  signal: AbortSignal | undefined,
  operation: () => T,
): Promise<T> {
  const lease = await scheduler?.acquire({ resource: "io", kind, priority: "view" }, signal)
  try {
    signal?.throwIfAborted()
    return operation()
  } finally {
    lease?.release()
  }
}

function integer(value: unknown, label: string): number {
  if (typeof value === "bigint") {
    const result = Number(value)
    if (Number.isSafeInteger(result) && result >= 0) return result
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value
  throw new Error(`${label} must be a non-negative safe integer.`)
}

function optionalInteger(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined
  return integer(value, "SQLite integer")
}
