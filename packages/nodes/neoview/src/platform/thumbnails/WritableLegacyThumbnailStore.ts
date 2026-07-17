import type {
  ReaderThumbnailCleanupRequest,
  ReaderThumbnailFailure,
  ReaderThumbnailInvalidCleanupResult,
  ReaderThumbnailMaintenanceSnapshot,
  ReaderThumbnailStore,
  ReaderThumbnailWrite,
  ReaderThumbnailWriterSnapshot,
} from "../../ports/ReaderThumbnailStore.js"
import { stat } from "node:fs/promises"
import { isAbsolute, parse, resolve } from "node:path"
import { openWritableSqlite, type WritableSqliteConnection } from "../sqlite/openWritableSqlite.js"
import { SqliteDataVersionTracker } from "../sqlite/SqliteDataVersionTracker.js"
import { inspectLegacyThumbnailDatabase, type LegacyThumbnailDatabaseReport } from "./LegacyThumbnailDatabaseInspector.js"
import { decodeLegacyThumbnailBlob, detectImageContentType, DEFAULT_MAX_THUMBNAIL_BYTES } from "./ThumbnailBlobCodec.js"
import {
  acquireThumbnailDatabaseAccessLock,
  type ThumbnailDatabaseAccessLock,
} from "./ThumbnailDatabaseAccessLock.js"
import type { LegacyThumbnailCategory, LegacyThumbnailRecord } from "./ReadonlyLegacyThumbnailStore.js"

export interface WritableLegacyThumbnailStoreOptions {
  maxThumbnailBytes?: number
  decodeConcurrency?: number
  flushIntervalMs?: number
  maxBatchSize?: number
  busyTimeoutMs?: number
  writeBusyRetries?: number
  writeBusyBaseDelayMs?: number
  pathState?: (path: string) => Promise<ThumbnailPathState>
  dataVersionPollIntervalMs?: number
}

export type ThumbnailPathState = "exists" | "missing" | "unavailable"

type PendingWrite =
  | { kind: "thumbnail"; value: ReaderThumbnailWrite; resolve(): void; reject(reason: unknown): void }
  | { kind: "failure"; value: Omit<ReaderThumbnailFailure, "retryCount">; resolve(): void; reject(reason: unknown): void }

export class WritableLegacyThumbnailStore implements ReaderThumbnailStore, AsyncDisposable {
  readonly report: LegacyThumbnailDatabaseReport
  readonly #database: WritableSqliteConnection
  readonly #accessLock: ThumbnailDatabaseAccessLock
  readonly #maxThumbnailBytes: number
  readonly #flushIntervalMs: number
  readonly #maxBatchSize: number
  readonly #decodeConcurrency: number
  readonly #writeBusyRetries: number
  readonly #writeBusyBaseDelayMs: number
  readonly #pathState: (path: string) => Promise<ThumbnailPathState>
  readonly #dataVersion: SqliteDataVersionTracker
  #pending: PendingWrite[] = []
  #flushTimer?: ReturnType<typeof setTimeout>
  #flushing?: Promise<void>
  #closed = false
  #committedBatches = 0
  #committedWrites = 0
  #busyRetries = 0
  #failedBatches = 0
  #lastError?: string
  #invalidScanCursor = ""

  private constructor(
    database: WritableSqliteConnection,
    accessLock: ThumbnailDatabaseAccessLock,
    report: LegacyThumbnailDatabaseReport,
    options: WritableLegacyThumbnailStoreOptions,
  ) {
    this.#database = database
    this.#accessLock = accessLock
    this.report = report
    this.#maxThumbnailBytes = options.maxThumbnailBytes ?? DEFAULT_MAX_THUMBNAIL_BYTES
    this.#flushIntervalMs = options.flushIntervalMs ?? 50
    this.#maxBatchSize = options.maxBatchSize ?? 32
    this.#decodeConcurrency = options.decodeConcurrency ?? 8
    this.#writeBusyRetries = options.writeBusyRetries ?? 3
    this.#writeBusyBaseDelayMs = options.writeBusyBaseDelayMs ?? 25
    this.#pathState = options.pathState ?? filesystemPathState
    this.#dataVersion = new SqliteDataVersionTracker(database, {
      pollIntervalMs: options.dataVersionPollIntervalMs,
    })
    assertInteger(this.#maxThumbnailBytes, "maxThumbnailBytes", 1, 256 * 1024 * 1024)
    assertInteger(this.#flushIntervalMs, "flushIntervalMs", 0, 60_000)
    assertInteger(this.#maxBatchSize, "maxBatchSize", 1, 512)
    assertInteger(this.#decodeConcurrency, "decodeConcurrency", 1, 64)
    assertInteger(this.#writeBusyRetries, "writeBusyRetries", 0, 10)
    assertInteger(this.#writeBusyBaseDelayMs, "writeBusyBaseDelayMs", 1, 5_000)
  }

  static async open(path: string, options: WritableLegacyThumbnailStoreOptions = {}): Promise<WritableLegacyThumbnailStore> {
    const report = await inspectLegacyThumbnailDatabase(path)
    if (report.compatibility !== "current") throw new Error(`NeoView thumbnail database is not writable (${report.compatibility}): ${path}`)
    const accessLock = await acquireThumbnailDatabaseAccessLock(path)
    let database: WritableSqliteConnection | undefined
    try {
      database = await openWritableSqlite(path)
      const busyTimeoutMs = options.busyTimeoutMs ?? 5_000
      assertInteger(busyTimeoutMs, "busyTimeoutMs", 0, 60_000)
      database.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}; PRAGMA synchronous = NORMAL;`)
      return new WritableLegacyThumbnailStore(database, accessLock, report, options)
    } catch (error) {
      try { database?.close() } catch { /* preserve the original open failure */ }
      await accessLock.release().catch(() => undefined)
      throw error
    }
  }

  revision(): number {
    this.#assertOpen()
    return this.#dataVersion.revision()
  }

  async get(key: string, category: LegacyThumbnailCategory): Promise<LegacyThumbnailRecord | undefined> {
    this.#assertOpen()
    assertKey(key)
    assertCategory(category)
    const pending = this.#findPendingThumbnail(key, category)
    if (pending) return toRecord(pending)
    const row = this.#database.get(
      "SELECT key, size, date, ghash, category, value FROM thumbs WHERE key = ?1 AND category = ?2 AND value IS NOT NULL LIMIT 1",
      key,
      category,
    )
    if (!row) return undefined
    const bytes = requireBytes(row.value, "thumbs.value")
    const decoded = await decodeLegacyThumbnailBlob(bytes, this.#maxThumbnailBytes)
    return {
      key: requireString(row.key, "thumbs.key"),
      category: requireCategory(row.category),
      sourceSize: optionalInteger(row.size),
      date: optionalString(row.date),
      generationHash: optionalInteger(row.ghash),
      ...decoded,
    }
  }

  async getMany(keys: readonly string[], category: LegacyThumbnailCategory): Promise<ReadonlyMap<string, LegacyThumbnailRecord>> {
    this.#assertOpen()
    assertCategory(category)
    if (keys.length > 512) throw new RangeError("Thumbnail batch cannot exceed 512 keys.")
    const unique = [...new Set(keys)]
    for (const key of unique) assertKey(key)
    if (!unique.length) return new Map()
    const placeholders = unique.map((_, index) => `?${index + 2}`).join(", ")
    const rows = this.#database.all(
      `SELECT key, size, date, ghash, category, value FROM thumbs WHERE category = ?1 AND value IS NOT NULL AND key IN (${placeholders})`,
      category,
      ...unique,
    )
    const records = await mapConcurrent(rows, this.#decodeConcurrency, async (row): Promise<LegacyThumbnailRecord> => {
      const bytes = requireBytes(row.value, "thumbs.value")
      return {
        key: requireString(row.key, "thumbs.key"),
        category: requireCategory(row.category),
        sourceSize: optionalInteger(row.size),
        date: optionalString(row.date),
        generationHash: optionalInteger(row.ghash),
        ...await decodeLegacyThumbnailBlob(bytes, this.#maxThumbnailBytes),
      }
    })
    const output = new Map(records.map((record) => [record.key, record]))
    const requested = new Set(unique)
    for (const item of this.#pending) {
      if (item.kind === "thumbnail" && item.value.category === category && requested.has(item.value.key)) {
        output.set(item.value.key, toRecord(item.value))
      }
    }
    return output
  }

  put(thumbnail: ReaderThumbnailWrite): Promise<void> {
    this.#assertOpen()
    validateThumbnail(thumbnail, this.#maxThumbnailBytes)
    return this.#enqueue({ kind: "thumbnail", value: { ...thumbnail, bytes: thumbnail.bytes.slice() } })
  }

  async getFailure(key: string): Promise<ReaderThumbnailFailure | undefined> {
    this.#assertOpen()
    assertKey(key)
    const row = this.#database.get(
      "SELECT key, reason, retry_count, last_attempt, error_message FROM failed_thumbnails WHERE key = ?1 LIMIT 1",
      key,
    )
    if (!row) return undefined
    return {
      key: requireString(row.key, "failed_thumbnails.key"),
      reason: requireString(row.reason, "failed_thumbnails.reason"),
      retryCount: optionalInteger(row.retry_count) ?? 0,
      lastAttempt: requireString(row.last_attempt, "failed_thumbnails.last_attempt"),
      errorMessage: optionalString(row.error_message),
    }
  }

  recordFailure(failure: Omit<ReaderThumbnailFailure, "retryCount">): Promise<void> {
    this.#assertOpen()
    assertKey(failure.key)
    if (!failure.reason || failure.reason.length > 128) throw new Error("Thumbnail failure reason must be 1..128 characters.")
    if (!failure.lastAttempt || failure.lastAttempt.length > 64) throw new Error("Thumbnail failure timestamp is invalid.")
    return this.#enqueue({
      kind: "failure",
      value: { ...failure, errorMessage: sanitizeErrorMessage(failure.errorMessage) },
    })
  }

  snapshot(): ReaderThumbnailWriterSnapshot {
    return {
      pendingWrites: this.#pending.length,
      flushing: Boolean(this.#flushing),
      committedBatches: this.#committedBatches,
      committedWrites: this.#committedWrites,
      busyRetries: this.#busyRetries,
      failedBatches: this.#failedBatches,
      lastError: this.#lastError,
    }
  }

  async maintenanceSnapshot(signal?: AbortSignal): Promise<ReaderThumbnailMaintenanceSnapshot> {
    this.#assertOpen()
    signal?.throwIfAborted()
    await this.flush()
    const thumbs = this.#database.get(
      `SELECT COUNT(*) AS total_rows,
              SUM(category = 'file') AS file_rows,
              SUM(category = 'folder') AS folder_rows,
              COALESCE(SUM(length(value)), 0) AS blob_bytes,
              SUM(value IS NULL OR length(value) = 0) AS empty_blobs
       FROM thumbs`,
    ) ?? {}
    const failures = this.#database.all(
      "SELECT reason, COUNT(*) AS count FROM failed_thumbnails GROUP BY reason ORDER BY reason",
    )
    const failuresByReason: Record<string, number> = {}
    let failedRows = 0
    for (const row of failures) {
      const reason = requireString(row.reason, "failed_thumbnails.reason")
      const count = optionalInteger(row.count) ?? 0
      failuresByReason[reason] = count
      failedRows += count
    }
    const [databaseBytes, walBytes, shmBytes] = await Promise.all([
      fileSize(this.report.path),
      fileSize(`${this.report.path}-wal`),
      fileSize(`${this.report.path}-shm`),
    ])
    return {
      totalRows: optionalInteger(thumbs.total_rows) ?? 0,
      fileRows: optionalInteger(thumbs.file_rows) ?? 0,
      folderRows: optionalInteger(thumbs.folder_rows) ?? 0,
      blobBytes: optionalInteger(thumbs.blob_bytes) ?? 0,
      emptyBlobs: optionalInteger(thumbs.empty_blobs) ?? 0,
      failedRows,
      failuresByReason,
      databaseBytes,
      walBytes,
      shmBytes,
      writer: this.snapshot(),
    }
  }

  async clearFailures(options: { reason?: string; limit: number }, signal?: AbortSignal): Promise<number> {
    this.#assertOpen()
    signal?.throwIfAborted()
    validateMaintenanceLimit(options.limit)
    if (options.reason !== undefined && (!options.reason || options.reason.length > 128)) {
      throw new Error("Thumbnail failure reason must be 1..128 characters.")
    }
    await this.flush()
    signal?.throwIfAborted()
    return this.#runTransaction(() => options.reason === undefined
      ? this.#database.run(
          "DELETE FROM failed_thumbnails WHERE key IN (SELECT key FROM failed_thumbnails ORDER BY last_attempt LIMIT ?1)",
          options.limit,
        ).changes
      : this.#database.run(
          "DELETE FROM failed_thumbnails WHERE key IN (SELECT key FROM failed_thumbnails WHERE reason = ?1 ORDER BY last_attempt LIMIT ?2)",
          options.reason,
          options.limit,
        ).changes)
  }

  async cleanup(request: ReaderThumbnailCleanupRequest, signal?: AbortSignal): Promise<number> {
    this.#assertOpen()
    signal?.throwIfAborted()
    validateMaintenanceLimit(request.limit)
    if (request.kind === "expired" && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(request.cutoff)) {
      throw new Error("Thumbnail cleanup cutoff must be a SQLite UTC timestamp.")
    }
    if (request.kind === "expired" && request.preserveFolders !== true) {
      throw new Error("Online thumbnail cleanup must preserve folder thumbnails.")
    }
    await this.flush()
    signal?.throwIfAborted()
    return this.#runTransaction(() => request.kind === "empty"
      ? this.#database.run(
          "DELETE FROM thumbs WHERE key IN (SELECT key FROM thumbs WHERE value IS NULL OR length(value) = 0 LIMIT ?1)",
          request.limit,
        ).changes
      : this.#database.run(
          "DELETE FROM thumbs WHERE key IN (SELECT key FROM thumbs WHERE category = 'file' AND date IS NOT NULL AND date < ?1 ORDER BY date LIMIT ?2)",
          request.cutoff,
          request.limit,
        ).changes)
  }

  async cleanupInvalid(options: { scanLimit: number; deleteLimit: number }, signal?: AbortSignal): Promise<ReaderThumbnailInvalidCleanupResult> {
    this.#assertOpen()
    signal?.throwIfAborted()
    assertInteger(options.scanLimit, "invalid path scanLimit", 1, 2_000)
    assertInteger(options.deleteLimit, "invalid path deleteLimit", 1, 500)
    await this.flush()
    signal?.throwIfAborted()
    let wrapped = false
    const previousCursor = this.#invalidScanCursor
    let rows = this.#database.all(
      "SELECT key FROM thumbs WHERE key > ?1 ORDER BY key LIMIT ?2",
      previousCursor,
      options.scanLimit,
    )
    if (!rows.length && previousCursor) {
      wrapped = true
      rows = this.#database.all("SELECT key FROM thumbs ORDER BY key LIMIT ?1", options.scanLimit)
    }
    const keys = rows.map((row) => requireString(row.key, "thumbs.key"))
    const nextCursor = keys.at(-1) ?? (wrapped ? "" : previousCursor)
    const invalid: string[] = []
    const roots = new Map<string, ThumbnailPathState>()
    let unavailableVolumeRowsPreserved = 0
    await mapConcurrent(keys, 32, async (key) => {
      signal?.throwIfAborted()
      const source = thumbnailSourcePath(key)
      if (!source) {
        invalid.push(key)
        return
      }
      const root = parse(source).root
      let rootState = roots.get(root)
      if (!rootState) {
        rootState = await this.#pathState(root)
        signal?.throwIfAborted()
        roots.set(root, rootState)
      }
      if (rootState !== "exists") {
        unavailableVolumeRowsPreserved += 1
        return
      }
      const sourceState = await this.#pathState(source)
      signal?.throwIfAborted()
      if (sourceState === "missing") invalid.push(key)
      else if (sourceState === "unavailable") unavailableVolumeRowsPreserved += 1
    })
    signal?.throwIfAborted()
    const deleteKeys = invalid.slice(0, options.deleteLimit)
    const deleted = deleteKeys.length ? await this.#runTransaction(() => {
      const placeholders = deleteKeys.map((_, index) => `?${index + 1}`).join(", ")
      return this.#database.run(`DELETE FROM thumbs WHERE key IN (${placeholders})`, ...deleteKeys).changes
    }) : 0
    this.#invalidScanCursor = nextCursor
    return { scanned: keys.length, deleted, unavailableVolumeRowsPreserved, wrapped }
  }

  async flush(): Promise<void> {
    this.#clearTimer()
    while (this.#flushing) await this.#flushing
    if (!this.#pending.length) return
    const batch = this.#pending.splice(0, this.#maxBatchSize)
    const flushing = this.#writeBatch(batch)
    this.#flushing = flushing
    try {
      await flushing
    } finally {
      if (this.#flushing === flushing) this.#flushing = undefined
    }
    if (this.#pending.length) await this.flush()
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    this.#clearTimer()
    const errors: unknown[] = []
    try { await this.flush() } catch (error) { errors.push(error) }
    try { this.#database.close() } catch (error) { errors.push(error) }
    try { await this.#accessLock.release() } catch (error) { errors.push(error) }
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) throw new AggregateError(errors, "Failed to close the thumbnail writer and access lock.")
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }

  #enqueue(value: Omit<PendingWrite, "resolve" | "reject">): Promise<void> {
    const promise = new Promise<void>((resolve, reject) => this.#pending.push({ ...value, resolve, reject } as PendingWrite))
    if (this.#pending.length >= this.#maxBatchSize || this.#flushIntervalMs === 0) queueMicrotask(() => void this.flush())
    else this.#flushTimer ??= setTimeout(() => void this.flush(), this.#flushIntervalMs)
    return promise
  }

  async #writeBatch(batch: PendingWrite[]): Promise<void> {
    try {
      await this.#runTransaction(() => {
        for (const item of batch) {
          if (item.kind === "thumbnail") this.#writeThumbnail(item.value)
          else this.#writeFailure(item.value)
        }
      })
      this.#committedBatches += 1
      this.#committedWrites += batch.length
      this.#lastError = undefined
      for (const item of batch) item.resolve()
    } catch (error) {
      this.#failedBatches += 1
      this.#lastError = sanitizeOperationalError(error)
      for (const item of batch) item.reject(error)
    }
  }

  async #runTransaction<T>(operation: () => T): Promise<T> {
    let lastError: unknown
    for (let attempt = 0; attempt <= this.#writeBusyRetries; attempt += 1) {
      try {
        this.#accessLock.assertHeld()
        this.#database.exec("BEGIN IMMEDIATE")
        const result = operation()
        this.#accessLock.assertHeld()
        this.#database.exec("COMMIT")
        return result
      } catch (error) {
        lastError = error
        try { this.#database.exec("ROLLBACK") } catch { /* transaction did not start */ }
        if (!isSqliteBusy(error) || attempt >= this.#writeBusyRetries) break
        this.#busyRetries += 1
        await delay(Math.min(5_000, this.#writeBusyBaseDelayMs * 2 ** attempt))
      }
    }
    throw lastError
  }

  #writeThumbnail(value: ReaderThumbnailWrite): void {
    this.#database.run(
      `INSERT INTO thumbs (key, size, date, ghash, category, value)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(key) DO UPDATE SET size=excluded.size, date=excluded.date, ghash=excluded.ghash, category=excluded.category, value=excluded.value`,
      value.key,
      value.sourceSize ?? null,
      value.date ?? sqliteTimestamp(new Date()),
      value.generationHash ?? null,
      value.category,
      value.bytes,
    )
    this.#database.run("DELETE FROM failed_thumbnails WHERE key = ?1", value.key)
  }

  #writeFailure(value: Omit<ReaderThumbnailFailure, "retryCount">): void {
    this.#database.run(
      `INSERT INTO failed_thumbnails (key, reason, retry_count, last_attempt, error_message)
       VALUES (?1, ?2, 1, ?3, ?4)
       ON CONFLICT(key) DO UPDATE SET reason=excluded.reason, retry_count=MIN(failed_thumbnails.retry_count + 1, 30),
         last_attempt=excluded.last_attempt, error_message=excluded.error_message`,
      value.key,
      value.reason,
      value.lastAttempt,
      value.errorMessage ?? null,
    )
  }

  #findPendingThumbnail(key: string, category: LegacyThumbnailCategory): ReaderThumbnailWrite | undefined {
    for (let index = this.#pending.length - 1; index >= 0; index -= 1) {
      const item = this.#pending[index]
      if (item?.kind === "thumbnail" && item.value.key === key && item.value.category === category) return item.value
    }
    return undefined
  }

  #clearTimer(): void {
    if (this.#flushTimer) clearTimeout(this.#flushTimer)
    this.#flushTimer = undefined
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Legacy thumbnail store is closed.")
    this.#accessLock.assertHeld()
  }
}

function toRecord(value: ReaderThumbnailWrite): LegacyThumbnailRecord {
  return {
    key: value.key,
    category: value.category,
    sourceSize: value.sourceSize,
    date: value.date,
    generationHash: value.generationHash,
    bytes: value.bytes,
    compressed: false,
    contentType: detectImageContentType(value.bytes),
  }
}

function validateThumbnail(value: ReaderThumbnailWrite, maxBytes: number): void {
  assertKey(value.key)
  assertCategory(value.category)
  if (!(value.bytes instanceof Uint8Array) || !value.bytes.byteLength || value.bytes.byteLength > maxBytes) throw new Error(`Thumbnail bytes must be 1..${maxBytes} bytes.`)
  if (detectImageContentType(value.bytes) !== "image/webp") throw new Error("Writable thumbnail blobs must be WebP.")
}

function sqliteTimestamp(value: Date): string {
  return value.toISOString().replace("T", " ").slice(0, 19)
}

function sanitizeErrorMessage(value: string | undefined): string | undefined {
  if (!value) return undefined
  return value
    .replaceAll(/(?:[a-zA-Z]:[\\/]|\\\\)[^\r\n]*/g, "<path>")
    .replaceAll(/file:\/\/\/[^\s]+/gi, "<file-url>")
    .slice(0, 2048)
}

function sanitizeOperationalError(error: unknown): string {
  return sanitizeErrorMessage(error instanceof Error ? error.message : String(error)) ?? "Unknown SQLite write error"
}

function isSqliteBusy(error: unknown): boolean {
  const record = error && typeof error === "object" ? error as { code?: unknown; message?: unknown } : undefined
  const code = typeof record?.code === "string" ? record.code.toUpperCase() : ""
  const message = typeof record?.message === "string" ? record.message.toLowerCase() : String(error).toLowerCase()
  return code.includes("SQLITE_BUSY") || code.includes("SQLITE_LOCKED") || message.includes("database is locked") || message.includes("database is busy")
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function assertKey(value: string): void {
  if (!value || value.length > 32_768 || value.includes("\0")) throw new Error("Thumbnail key must be 1..32768 characters without NUL.")
}

function assertCategory(value: string): asserts value is LegacyThumbnailCategory {
  if (value !== "file" && value !== "folder") throw new Error(`Unsupported thumbnail category: ${value}`)
}

function requireCategory(value: unknown): LegacyThumbnailCategory {
  if (typeof value !== "string") throw new Error("thumbs.category must be text.")
  assertCategory(value)
  return value
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be text.`)
  return value
}

function requireBytes(value: unknown, label: string): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new Error(`${label} must be a blob.`)
  return value
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function optionalInteger(value: unknown): number | undefined {
  if (typeof value === "bigint") return Number.isSafeInteger(Number(value)) ? Number(value) : undefined
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined
}

function assertInteger(value: number, name: string, minimum: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}.`)
}

function validateMaintenanceLimit(value: number): void {
  assertInteger(value, "maintenance limit", 1, 10_000)
}

async function fileSize(path: string): Promise<number | undefined> {
  try {
    const info = await stat(path)
    return info.isFile() ? info.size : undefined
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "ENOTDIR") return undefined
    throw error
  }
}

async function filesystemPathState(path: string): Promise<ThumbnailPathState> {
  try {
    await stat(path)
    return "exists"
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "ENOTDIR") return "missing"
    return "unavailable"
  }
}

function thumbnailSourcePath(key: string): string | undefined {
  const trimmed = key.trim()
  if (!trimmed) return undefined
  const separator = trimmed.indexOf("::")
  const source = separator >= 0 ? trimmed.slice(0, separator) : trimmed
  return isAbsolute(source) ? resolve(source) : undefined
}

async function mapConcurrent<T, R>(values: readonly T[], concurrency: number, map: (value: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(values.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++
      output[index] = await map(values[index]!)
    }
  }))
  return output
}
