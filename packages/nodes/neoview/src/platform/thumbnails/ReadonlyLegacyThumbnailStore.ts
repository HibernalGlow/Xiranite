import { openReadonlySqlite, type ReadonlySqliteConnection, type SqliteBinding } from "../sqlite/openReadonlySqlite.js"
import {
  inspectLegacyThumbnailDatabase,
  type LegacyThumbnailDatabaseReport,
} from "./LegacyThumbnailDatabaseInspector.js"
import { decodeLegacyThumbnailBlob, DEFAULT_MAX_THUMBNAIL_BYTES } from "./ThumbnailBlobCodec.js"
import type { ReaderThumbnailStore } from "../../ports/ReaderThumbnailStore.js"
import { SqliteDataVersionTracker } from "../sqlite/SqliteDataVersionTracker.js"

export type LegacyThumbnailCategory = "file" | "folder"

export interface LegacyThumbnailRecord {
  key: string
  category: LegacyThumbnailCategory
  sourceSize?: number
  date?: string
  generationHash?: number
  bytes: Uint8Array
  compressed: boolean
  contentType?: string
}

export interface ReadonlyLegacyThumbnailStoreOptions {
  maxThumbnailBytes?: number
  decodeConcurrency?: number
  dataVersionPollIntervalMs?: number
}

export class ReadonlyLegacyThumbnailStore implements ReaderThumbnailStore, AsyncDisposable {
  readonly report: LegacyThumbnailDatabaseReport
  readonly #database: ReadonlySqliteConnection
  readonly #maxThumbnailBytes: number
  readonly #decodeConcurrency: number
  readonly #dataVersion: SqliteDataVersionTracker
  #closed = false

  private constructor(
    database: ReadonlySqliteConnection,
    report: LegacyThumbnailDatabaseReport,
    options: ReadonlyLegacyThumbnailStoreOptions,
  ) {
    this.#database = database
    this.report = report
    this.#maxThumbnailBytes = options.maxThumbnailBytes ?? DEFAULT_MAX_THUMBNAIL_BYTES
    this.#decodeConcurrency = options.decodeConcurrency ?? 8
    this.#dataVersion = new SqliteDataVersionTracker(database, {
      pollIntervalMs: options.dataVersionPollIntervalMs,
    })
    assertPositiveInteger(this.#maxThumbnailBytes, "maxThumbnailBytes", 256 * 1024 * 1024)
    assertPositiveInteger(this.#decodeConcurrency, "decodeConcurrency", 64)
  }

  static async open(
    path: string,
    options: ReadonlyLegacyThumbnailStoreOptions = {},
  ): Promise<ReadonlyLegacyThumbnailStore> {
    const report = await inspectLegacyThumbnailDatabase(path)
    if (report.compatibility === "missing" || report.compatibility === "incompatible") {
      throw new Error(`NeoView thumbnail database is ${report.compatibility}: ${path}${report.issues.length ? ` (${report.issues.join("; ")})` : ""}`)
    }
    const database = await openReadonlySqlite(path)
    try {
      database.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 1000;")
      return new ReadonlyLegacyThumbnailStore(database, report, options)
    } catch (error) {
      database.close()
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
    const row = this.#database.get(
      "SELECT key, size, date, ghash, category, value FROM thumbs WHERE key = ?1 AND category = ?2 AND value IS NOT NULL LIMIT 1",
      key,
      category,
    )
    return row ? this.#decodeRow(row) : undefined
  }

  async getMany(
    keys: readonly string[],
    category: LegacyThumbnailCategory,
  ): Promise<ReadonlyMap<string, LegacyThumbnailRecord>> {
    this.#assertOpen()
    assertCategory(category)
    if (keys.length > 512) throw new RangeError("Thumbnail batch cannot exceed 512 keys.")
    const unique = [...new Set(keys)]
    for (const key of unique) assertKey(key)
    if (!unique.length) return new Map()
    const placeholders = unique.map((_, index) => `?${index + 2}`).join(", ")
    const bindings: SqliteBinding[] = [category, ...unique]
    const rows = this.#database.all(
      `SELECT key, size, date, ghash, category, value FROM thumbs WHERE category = ?1 AND value IS NOT NULL AND key IN (${placeholders})`,
      ...bindings,
    )
    const records = await mapConcurrent(rows, this.#decodeConcurrency, (row) => this.#decodeRow(row))
    return new Map(records.map((record) => [record.key, record]))
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#database.close()
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.close()
  }

  async #decodeRow(row: Record<string, unknown>): Promise<LegacyThumbnailRecord> {
    const key = requireString(row.key, "thumbs.key")
    const category = requireCategory(row.category)
    const blob = requireBytes(row.value, "thumbs.value")
    const decoded = await decodeLegacyThumbnailBlob(blob, this.#maxThumbnailBytes)
    return {
      key,
      category,
      sourceSize: optionalInteger(row.size),
      date: optionalString(row.date),
      generationHash: optionalInteger(row.ghash),
      ...decoded,
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Legacy thumbnail store is closed.")
  }
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  map: (value: T) => Promise<R>,
): Promise<R[]> {
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
  if (typeof value === "bigint") {
    const number = Number(value)
    return Number.isSafeInteger(number) ? number : undefined
  }
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined
}

function assertPositiveInteger(value: number, name: string, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${name} must be an integer from 1 to ${maximum}.`)
  }
}
