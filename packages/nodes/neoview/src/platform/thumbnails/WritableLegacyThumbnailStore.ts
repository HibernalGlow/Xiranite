import type {
  ReaderFolderRepresentativeManifest,
  ReaderFolderRepresentativeSource,
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
import pMap from "p-map"
import { openWritableSqlite, type WritableSqliteConnection } from "../sqlite/openWritableSqlite.js"
import { SqliteDataVersionTracker } from "../sqlite/SqliteDataVersionTracker.js"
import { inspectLegacyThumbnailDatabase, type LegacyThumbnailDatabaseReport } from "./LegacyThumbnailDatabaseInspector.js"
import { decodeLegacyThumbnailBlob, detectImageContentType, DEFAULT_MAX_THUMBNAIL_BYTES } from "./ThumbnailBlobCodec.js"
import {
  acquireThumbnailDatabaseAccessLock,
  type ThumbnailDatabaseAccessLock,
} from "./ThumbnailDatabaseAccessLock.js"
import type { LegacyThumbnailCategory, LegacyThumbnailRecord } from "./ReadonlyLegacyThumbnailStore.js"
import type { ResourcePriority, ResourceScheduler } from "../../ports/ResourceScheduler.js"
import type { ReaderAiTranslationCacheEntry, ReaderAiTranslationPersistentCache } from "../../ports/ReaderAiTranslation.js"
import { readLegacyThumbnailStatistics } from "./LegacyThumbnailStatistics.js"

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
  resourceScheduler?: ResourceScheduler
  statisticsChunkSize?: number
}

export type ThumbnailPathState = "exists" | "missing" | "unavailable"

type PendingWrite =
  | { kind: "thumbnail"; value: ReaderThumbnailWrite; resolve(): void; reject(reason: unknown): void }
  | { kind: "failure"; value: Omit<ReaderThumbnailFailure, "retryCount">; resolve(): void; reject(reason: unknown): void }

export class WritableLegacyThumbnailStore implements ReaderThumbnailStore, ReaderAiTranslationPersistentCache, AsyncDisposable {
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
  readonly #resourceScheduler?: ResourceScheduler
  readonly #statisticsChunkSize?: number
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
  #folderManifestSchemaReady = false
  #folderManifestSchemaFlight?: Promise<void>

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
    this.#resourceScheduler = options.resourceScheduler
    this.#statisticsChunkSize = options.statisticsChunkSize
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
    const records = await pMap(rows, async (row): Promise<LegacyThumbnailRecord> => {
      const bytes = requireBytes(row.value, "thumbs.value")
      return {
        key: requireString(row.key, "thumbs.key"),
        category: requireCategory(row.category),
        sourceSize: optionalInteger(row.size),
        date: optionalString(row.date),
        generationHash: optionalInteger(row.ghash),
        ...await decodeLegacyThumbnailBlob(bytes, this.#maxThumbnailBytes),
      }
    }, { concurrency: this.#decodeConcurrency, stopOnError: true })
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

  async getFolderRepresentativeManifest(
    path: string,
    previewCount: number,
    mediaRevision: number,
  ): Promise<ReaderFolderRepresentativeManifest | undefined> {
    this.#assertOpen()
    validateFolderManifestIdentity(path, previewCount, mediaRevision)
    await this.#ensureFolderManifestSchema()
    this.#assertOpen()
    const row = this.#database.get(
      `SELECT directory_modified_at_ms, sources_json
       FROM xr_thumbnail_folder_manifests
       WHERE path_key = ?1 AND preview_count = ?2 AND media_revision = ?3
       LIMIT 1`,
      path,
      previewCount,
      mediaRevision,
    )
    if (!row) return undefined
    return {
      directoryModifiedAtMs: requireNonNegativeInteger(row.directory_modified_at_ms, "xr_thumbnail_folder_manifests.directory_modified_at_ms"),
      sources: parseFolderRepresentativeSources(row.sources_json),
    }
  }

  async putFolderRepresentativeManifest(
    path: string,
    previewCount: number,
    mediaRevision: number,
    manifest: ReaderFolderRepresentativeManifest,
  ): Promise<void> {
    this.#assertOpen()
    validateFolderManifestIdentity(path, previewCount, mediaRevision)
    const directoryModifiedAtMs = requireNonNegativeInteger(
      manifest.directoryModifiedAtMs,
      "folder representative directoryModifiedAtMs",
    )
    const sources = validateFolderRepresentativeSources(manifest.sources)
    await this.#ensureFolderManifestSchema()
    this.#assertOpen()
    await this.#runTransaction(() => {
      this.#database.run(
        `INSERT INTO xr_thumbnail_folder_manifests (
           path_key, preview_count, media_revision, directory_modified_at_ms, sources_json, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(path_key, preview_count, media_revision) DO UPDATE SET
           directory_modified_at_ms = excluded.directory_modified_at_ms,
           sources_json = excluded.sources_json,
           updated_at = excluded.updated_at`,
        path,
        previewCount,
        mediaRevision,
        directoryModifiedAtMs,
        JSON.stringify(sources),
        sqliteTimestamp(new Date()),
      )
    }, "neoview.thumbnail.folder-manifest-write")
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
    const statistics = await readLegacyThumbnailStatistics(this.report.path, {
      chunkSize: this.#statisticsChunkSize,
      resourceScheduler: this.#resourceScheduler,
      signal,
    })
    const [databaseBytes, walBytes, shmBytes] = await Promise.all([
      fileSize(this.report.path),
      fileSize(`${this.report.path}-wal`),
      fileSize(`${this.report.path}-shm`),
    ])
    return {
      ...statistics,
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
        ).changes, "neoview.thumbnail.database-maintenance-write", signal)
  }

  async cleanup(request: ReaderThumbnailCleanupRequest, signal?: AbortSignal): Promise<number> {
    this.#assertOpen()
    signal?.throwIfAborted()
    validateMaintenanceLimit(request.limit)
    if (request.kind === "path-prefix") {
      const prefix = normalizePathPrefix(request.prefix)
      const windowsPrefix = isWindowsPathPrefix(prefix)
      // Legacy Windows keys preserve their original separator and casing.
      const keyExpression = windowsPrefix ? "lower(replace(key, '\\', '/'))" : "key"
      await this.flush()
      signal?.throwIfAborted()
      return this.#runTransaction(() => {
        const rootPrefix = prefix === "/" || prefix === "\\"
        const where = rootPrefix
          ? `substr(${keyExpression}, 1, length(?1)) = ?1`
          : windowsPrefix
            ? `${keyExpression} = ?1 OR (substr(${keyExpression}, 1, length(?1)) = ?1 AND (substr(${keyExpression}, length(?1) + 1, 1) = '/' OR substr(${keyExpression}, length(?1) + 1, 2) = '::'))`
            : `${keyExpression} = ?1 OR (substr(${keyExpression}, 1, length(?1)) = ?1 AND (substr(${keyExpression}, length(?1) + 1, 1) IN ('/', '\\') OR substr(${keyExpression}, length(?1) + 1, 2) = '::'))`
        return this.#database.run(
          `DELETE FROM thumbs WHERE key IN (SELECT key FROM thumbs WHERE ${where} ORDER BY key LIMIT ?2)`,
          prefix,
          request.limit,
        ).changes
      }, "neoview.thumbnail.database-maintenance-write", signal)
    }
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
        ).changes, "neoview.thumbnail.database-maintenance-write", signal)
  }

  async clearFolderRepresentativeManifests(
    options: { prefix: string; limit: number },
    signal?: AbortSignal,
  ): Promise<number> {
    this.#assertOpen()
    signal?.throwIfAborted()
    validateMaintenanceLimit(options.limit)
    const prefix = normalizePathPrefix(options.prefix)
    const windowsPrefix = isWindowsPathPrefix(prefix)
    const pathExpression = windowsPrefix ? "lower(replace(path_key, '\\', '/'))" : "path_key"
    await this.#ensureFolderManifestSchema()
    this.#assertOpen()
    signal?.throwIfAborted()
    return this.#runTransaction(() => {
      const rootPrefix = prefix === "/" || prefix === "\\"
      const where = rootPrefix
        ? `substr(${pathExpression}, 1, length(?1)) = ?1`
        : `${pathExpression} = ?1 OR (substr(${pathExpression}, 1, length(?1)) = ?1 AND substr(${pathExpression}, length(?1) + 1, 1) IN ('/', '\\'))`
      return this.#database.run(
        `DELETE FROM xr_thumbnail_folder_manifests
         WHERE rowid IN (
           SELECT rowid FROM xr_thumbnail_folder_manifests WHERE ${where} ORDER BY path_key LIMIT ?2
         )`,
        prefix,
        options.limit,
      ).changes
    }, "neoview.thumbnail.folder-manifest-maintenance-write", signal)
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
    let rows = await this.#withIoLease(
      "neoview.thumbnail.database-maintenance-scan",
      "background",
      signal,
      () => this.#database.all(
        "SELECT key FROM thumbs WHERE key > ?1 ORDER BY key LIMIT ?2",
        previousCursor,
        options.scanLimit,
      ),
    )
    if (!rows.length && previousCursor) {
      wrapped = true
      rows = await this.#withIoLease(
        "neoview.thumbnail.database-maintenance-scan",
        "background",
        signal,
        () => this.#database.all("SELECT key FROM thumbs ORDER BY key LIMIT ?1", options.scanLimit),
      )
    }
    const keys = rows.map((row) => requireString(row.key, "thumbs.key"))
    const nextCursor = keys.at(-1) ?? (wrapped ? "" : previousCursor)
    const invalid: string[] = []
    const roots = new Map<string, ThumbnailPathState>()
    let unavailableVolumeRowsPreserved = 0
    await pMap(keys, async (key) => {
      signal?.throwIfAborted()
      const source = thumbnailSourcePath(key)
      if (!source) {
        invalid.push(key)
        return
      }
      const root = parse(source).root
      let rootState = roots.get(root)
      if (!rootState) {
        rootState = await this.#withIoLease(
          "neoview.thumbnail.path-state",
          "background",
          signal,
          () => this.#pathState(root),
        )
        signal?.throwIfAborted()
        roots.set(root, rootState)
      }
      if (rootState !== "exists") {
        unavailableVolumeRowsPreserved += 1
        return
      }
      const sourceState = await this.#withIoLease(
        "neoview.thumbnail.path-state",
        "background",
        signal,
        () => this.#pathState(source),
      )
      signal?.throwIfAborted()
      if (sourceState === "missing") invalid.push(key)
      else if (sourceState === "unavailable") unavailableVolumeRowsPreserved += 1
    }, { concurrency: 32, stopOnError: true })
    signal?.throwIfAborted()
    const deleteKeys = invalid.slice(0, options.deleteLimit)
    const deleted = deleteKeys.length ? await this.#runTransaction(() => {
      const placeholders = deleteKeys.map((_, index) => `?${index + 1}`).join(", ")
      return this.#database.run(`DELETE FROM thumbs WHERE key IN (${placeholders})`, ...deleteKeys).changes
    }, "neoview.thumbnail.database-maintenance-write", signal) : 0
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

  async load(key: string, model?: string): Promise<ReaderAiTranslationCacheEntry | undefined> {
    this.#assertOpen()
    assertKey(key)
    assertAiTranslationModel(model)
    const row = this.#database.get("SELECT ai_translation FROM thumbs WHERE key = ?1 LIMIT 1", key)
    return parseAiTranslation(row?.ai_translation, model)
  }

  async save(key: string, entry: ReaderAiTranslationCacheEntry): Promise<void> {
    this.#assertOpen()
    assertKey(key)
    const value = normalizeAiTranslation(entry)
    this.#database.run(
      `INSERT INTO thumbs (key, date, category, ai_translation)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(key) DO UPDATE SET ai_translation=excluded.ai_translation`,
      key,
      sqliteTimestamp(new Date()),
      legacyAiTranslationCategory(key),
      JSON.stringify(value),
    )
  }

  async count(): Promise<number> {
    this.#assertOpen()
    const row = this.#database.get("SELECT COUNT(*) AS count FROM thumbs WHERE ai_translation IS NOT NULL")
    const value = row?.count
    if (typeof value === "bigint") return Number(value)
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value
    throw new Error("Legacy AI translation count is invalid.")
  }

  async clearAiTranslations(): Promise<number> {
    this.#assertOpen()
    // Keep the row identity for thumbs that still store other columns; only drop the AI payload.
    const result = this.#database.run("UPDATE thumbs SET ai_translation = NULL WHERE ai_translation IS NOT NULL")
    return result.changes
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
      }, "neoview.thumbnail.database-write")
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

  async #runTransaction<T>(
    operation: () => T,
    resourceKind: string,
    signal?: AbortSignal,
  ): Promise<T> {
    let lastError: unknown
    for (let attempt = 0; attempt <= this.#writeBusyRetries; attempt += 1) {
      let lease: Awaited<ReturnType<ResourceScheduler["acquire"]>> | undefined
      try {
        signal?.throwIfAborted()
        lease = await this.#resourceScheduler?.acquire({
          resource: "io",
          kind: resourceKind,
          priority: "background",
        }, signal)
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
      } finally {
        lease?.release()
      }
      signal?.throwIfAborted()
      if (attempt < this.#writeBusyRetries) {
        await delay(Math.min(5_000, this.#writeBusyBaseDelayMs * 2 ** attempt))
      }
    }
    throw lastError
  }

  async #withIoLease<T>(
    kind: string,
    priority: ResourcePriority,
    signal: AbortSignal | undefined,
    operation: () => T | Promise<T>,
  ): Promise<T> {
    const lease = await this.#resourceScheduler?.acquire({ resource: "io", kind, priority }, signal)
    try {
      signal?.throwIfAborted()
      return await operation()
    } finally {
      lease?.release()
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

  async #ensureFolderManifestSchema(): Promise<void> {
    if (this.#folderManifestSchemaReady) return
    if (!this.#folderManifestSchemaFlight) {
      const flight = this.#runTransaction(() => {
        ensureFolderRepresentativeManifestSchema(this.#database)
      }, "neoview.thumbnail.folder-manifest-schema")
        .then(() => { this.#folderManifestSchemaReady = true })
        .finally(() => {
          if (this.#folderManifestSchemaFlight === flight) this.#folderManifestSchemaFlight = undefined
        })
      this.#folderManifestSchemaFlight = flight
    }
    await this.#folderManifestSchemaFlight
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

function ensureFolderRepresentativeManifestSchema(database: WritableSqliteConnection): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS xr_thumbnail_folder_manifests (
      path_key TEXT NOT NULL,
      preview_count INTEGER NOT NULL,
      media_revision INTEGER NOT NULL,
      directory_modified_at_ms INTEGER NOT NULL,
      sources_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (path_key, preview_count, media_revision)
    );
    CREATE INDEX IF NOT EXISTS xr_thumbnail_folder_manifests_updated_idx
      ON xr_thumbnail_folder_manifests(updated_at);
  `)
}

function validateFolderManifestIdentity(path: string, previewCount: number, mediaRevision: number): void {
  assertKey(path)
  if (previewCount !== 1 && previewCount !== 4 && previewCount !== 9 && previewCount !== 16) {
    throw new RangeError("Folder representative previewCount must be 1, 4, 9 or 16.")
  }
  assertInteger(mediaRevision, "folder representative mediaRevision", 0, Number.MAX_SAFE_INTEGER)
}

function validateFolderRepresentativeSources(
  value: readonly ReaderFolderRepresentativeSource[],
): ReaderFolderRepresentativeSource[] {
  if (!Array.isArray(value) || value.length > 16) throw new RangeError("Folder representative sources cannot exceed 16 entries.")
  return value.map((source) => {
    if (!source || typeof source !== "object") throw new TypeError("Folder representative source must be an object.")
    if (!source.name || source.name.length > 32_768 || source.name.includes("\0")) {
      throw new RangeError("Folder representative source name must be 1..32768 characters without NUL.")
    }
    return {
      name: source.name,
      size: requireNonNegativeInteger(source.size, "folder representative source size"),
      modifiedAtMs: requireNonNegativeInteger(source.modifiedAtMs, "folder representative source modifiedAtMs"),
    }
  })
}

function parseFolderRepresentativeSources(value: unknown): ReaderFolderRepresentativeSource[] {
  if (typeof value !== "string") throw new Error("xr_thumbnail_folder_manifests.sources_json must be text.")
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error("xr_thumbnail_folder_manifests.sources_json must be valid JSON.")
  }
  return validateFolderRepresentativeSources(parsed as readonly ReaderFolderRepresentativeSource[])
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  const integer = optionalInteger(value)
  if (integer === undefined || integer < 0) throw new Error(`${label} must be a non-negative integer.`)
  return integer
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

function assertAiTranslationModel(value: string | undefined): void {
  if (value !== undefined && (!value.trim() || value.length > 256 || value.includes("\0"))) {
    throw new RangeError("AI translation model must be 1..256 characters without NUL.")
  }
}

function parseAiTranslation(value: unknown, model: string | undefined): ReaderAiTranslationCacheEntry | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
    const entry = parsed as Record<string, unknown>
    if (typeof entry.title !== "string" || !entry.title.trim() || entry.title.length > 16_384) return undefined
    if (entry.service !== "libre" && entry.service !== "ollama") return undefined
    const storedModel = typeof entry.model === "string" && entry.model.trim() ? entry.model.trim() : undefined
    if (entry.service === "ollama" && (!storedModel || (model !== undefined && storedModel !== model))) return undefined
    if (typeof entry.timestamp !== "number" || !Number.isSafeInteger(entry.timestamp) || entry.timestamp < 0) return undefined
    return { title: entry.title.trim(), service: entry.service, ...(storedModel ? { model: storedModel } : {}), timestamp: entry.timestamp }
  } catch {
    return undefined
  }
}

function normalizeAiTranslation(value: ReaderAiTranslationCacheEntry): ReaderAiTranslationCacheEntry {
  const title = value.title.trim()
  if (!title || title.length > 16_384) throw new RangeError("AI translation title must be 1..16384 characters.")
  if (value.service !== "libre" && value.service !== "ollama") throw new TypeError("Unsupported AI translation service.")
  assertAiTranslationModel(value.model)
  if (value.service === "ollama" && !value.model) throw new RangeError("Ollama translation cache entries require a model.")
  if (!Number.isSafeInteger(value.timestamp) || value.timestamp < 0) throw new RangeError("AI translation timestamp must be a non-negative integer.")
  return { title, service: value.service, ...(value.model ? { model: value.model.trim() } : {}), timestamp: value.timestamp }
}

function legacyAiTranslationCategory(key: string): LegacyThumbnailCategory {
  return !key.includes("::") && !key.includes(".") ? "folder" : "file"
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

function normalizePathPrefix(value: string): string {
  if (typeof value !== "string") throw new TypeError("Thumbnail path prefix must be a string.")
  const prefix = value.trim()
  if (!prefix || prefix.length > 4_096 || prefix.includes("\0")) {
    throw new RangeError("Thumbnail path prefix must be 1..4096 characters without NUL.")
  }

  if (prefix === "/" || prefix === "\\") return prefix
  if (isWindowsPathPrefix(prefix)) {
    const portable = prefix.replaceAll("\\", "/")
    const normalized = portable.replace(/(?:\/|::)+$/u, "")
    return (normalized || portable).toLowerCase()
  }
  const normalized = prefix.replace(/(?:[/\\]|::)+$/u, "")
  return normalized || prefix
}

function isWindowsPathPrefix(value: string): boolean {
  return /^[a-z]:($|[/\\])/iu.test(value) || value.startsWith("//") || value.startsWith("\\\\")
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
