import type {
  ReaderThumbnailFailure,
  ReaderThumbnailStore,
  ReaderThumbnailWrite,
} from "../../ports/ReaderThumbnailStore.js"
import { openWritableSqlite, type WritableSqliteConnection } from "../sqlite/openWritableSqlite.js"
import { inspectLegacyThumbnailDatabase, type LegacyThumbnailDatabaseReport } from "./LegacyThumbnailDatabaseInspector.js"
import { decodeLegacyThumbnailBlob, detectImageContentType, DEFAULT_MAX_THUMBNAIL_BYTES } from "./ThumbnailBlobCodec.js"
import type { LegacyThumbnailCategory, LegacyThumbnailRecord } from "./ReadonlyLegacyThumbnailStore.js"

export interface WritableLegacyThumbnailStoreOptions {
  maxThumbnailBytes?: number
  decodeConcurrency?: number
  flushIntervalMs?: number
  maxBatchSize?: number
}

type PendingWrite =
  | { kind: "thumbnail"; value: ReaderThumbnailWrite; resolve(): void; reject(reason: unknown): void }
  | { kind: "failure"; value: Omit<ReaderThumbnailFailure, "retryCount">; resolve(): void; reject(reason: unknown): void }

export class WritableLegacyThumbnailStore implements ReaderThumbnailStore, AsyncDisposable {
  readonly report: LegacyThumbnailDatabaseReport
  readonly #database: WritableSqliteConnection
  readonly #maxThumbnailBytes: number
  readonly #flushIntervalMs: number
  readonly #maxBatchSize: number
  readonly #decodeConcurrency: number
  #pending: PendingWrite[] = []
  #flushTimer?: ReturnType<typeof setTimeout>
  #flushing?: Promise<void>
  #closed = false

  private constructor(database: WritableSqliteConnection, report: LegacyThumbnailDatabaseReport, options: WritableLegacyThumbnailStoreOptions) {
    this.#database = database
    this.report = report
    this.#maxThumbnailBytes = options.maxThumbnailBytes ?? DEFAULT_MAX_THUMBNAIL_BYTES
    this.#flushIntervalMs = options.flushIntervalMs ?? 50
    this.#maxBatchSize = options.maxBatchSize ?? 32
    this.#decodeConcurrency = options.decodeConcurrency ?? 8
    assertInteger(this.#maxThumbnailBytes, "maxThumbnailBytes", 1, 256 * 1024 * 1024)
    assertInteger(this.#flushIntervalMs, "flushIntervalMs", 0, 60_000)
    assertInteger(this.#maxBatchSize, "maxBatchSize", 1, 512)
    assertInteger(this.#decodeConcurrency, "decodeConcurrency", 1, 64)
  }

  static async open(path: string, options: WritableLegacyThumbnailStoreOptions = {}): Promise<WritableLegacyThumbnailStore> {
    const report = await inspectLegacyThumbnailDatabase(path)
    if (report.compatibility !== "current") throw new Error(`NeoView thumbnail database is not writable (${report.compatibility}): ${path}`)
    const database = await openWritableSqlite(path)
    try {
      database.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;")
      return new WritableLegacyThumbnailStore(database, report, options)
    } catch (error) {
      database.close()
      throw error
    }
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
    try {
      await this.flush()
    } finally {
      this.#database.close()
    }
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
      this.#database.exec("BEGIN IMMEDIATE")
      for (const item of batch) {
        if (item.kind === "thumbnail") this.#writeThumbnail(item.value)
        else this.#writeFailure(item.value)
      }
      this.#database.exec("COMMIT")
      for (const item of batch) item.resolve()
    } catch (error) {
      try { this.#database.exec("ROLLBACK") } catch { /* transaction did not start */ }
      for (const item of batch) item.reject(error)
    }
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
