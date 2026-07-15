import { mkdir, realpath, rm, stat } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import type {
  ReaderThumbnailDatabaseBackupResult,
  ReaderThumbnailDatabaseMaintenance,
  ReaderThumbnailDatabaseOptimizeResult,
} from "../../ports/ReaderThumbnailDatabaseMaintenance.js"
import { openReadonlySqlite } from "../sqlite/openReadonlySqlite.js"
import { openWritableSqlite } from "../sqlite/openWritableSqlite.js"
import {
  inspectLegacyThumbnailDatabase,
  type LegacyThumbnailDatabaseReport,
} from "./LegacyThumbnailDatabaseInspector.js"

export interface SqliteLegacyThumbnailDatabaseMaintenanceOptions {
  busyTimeoutMs?: number
}

export class SqliteLegacyThumbnailDatabaseMaintenance implements ReaderThumbnailDatabaseMaintenance {
  readonly #busyTimeoutMs: number

  constructor(options: SqliteLegacyThumbnailDatabaseMaintenanceOptions = {}) {
    this.#busyTimeoutMs = options.busyTimeoutMs ?? 5_000
    if (!Number.isSafeInteger(this.#busyTimeoutMs) || this.#busyTimeoutMs < 0 || this.#busyTimeoutMs > 60_000) {
      throw new RangeError("busyTimeoutMs must be an integer from 0 to 60000.")
    }
  }

  async backup(
    sourcePath: string,
    destinationPath: string,
    signal?: AbortSignal,
  ): Promise<ReaderThumbnailDatabaseBackupResult> {
    signal?.throwIfAborted()
    const source = await realpath(sourcePath)
    const destination = resolve(destinationPath)
    if (samePath(source, destination)) throw new Error("Thumbnail database backup destination must differ from the source.")
    const report = await requireBackupCompatible(source)
    await assertMissing(destination)
    await mkdir(dirname(destination), { recursive: true })
    signal?.throwIfAborted()

    const database = await openWritableSqlite(source)
    try {
      database.exec(`PRAGMA busy_timeout = ${this.#busyTimeoutMs};`)
      signal?.throwIfAborted()
      database.run("VACUUM INTO ?1", destination)
    } catch (error) {
      await rm(destination, { force: true }).catch(() => undefined)
      throw error
    } finally {
      database.close()
    }

    try {
      signal?.throwIfAborted()
      const verified = await verifyBackup(destination)
      return {
        sourcePath: source,
        destinationPath: destination,
        bytes: (await stat(destination)).size,
        compatibility: verified.compatibility,
        metadataVersion: verified.metadataVersion,
        userVersion: verified.userVersion,
        journalMode: verified.journalMode,
        quickCheck: "ok",
      }
    } catch (error) {
      await rm(destination, { force: true }).catch(() => undefined)
      throw error
    }
  }

  async optimize(
    sourcePath: string,
    options: { backupPath: string; vacuum: boolean },
    signal?: AbortSignal,
  ): Promise<ReaderThumbnailDatabaseOptimizeResult> {
    signal?.throwIfAborted()
    const source = await realpath(sourcePath)
    const before = await requireCurrent(source)
    const backup = await this.backup(source, options.backupPath, signal)
    signal?.throwIfAborted()

    const database = await openWritableSqlite(source)
    let checkpoint: ReaderThumbnailDatabaseOptimizeResult["checkpoint"]
    try {
      database.exec(`PRAGMA busy_timeout = ${this.#busyTimeoutMs};`)
      if (before.journalMode?.toLowerCase() === "wal") {
        const row = database.get("PRAGMA wal_checkpoint(TRUNCATE)")
        checkpoint = {
          busy: integerCell(row, "busy"),
          logFrames: integerCell(row, "log"),
          checkpointedFrames: integerCell(row, "checkpointed"),
        }
        if (checkpoint.busy !== 0) throw new Error("Thumbnail database checkpoint is busy; close other writers and retry.")
      }
      signal?.throwIfAborted()
      database.exec("PRAGMA optimize;")
      if (options.vacuum) {
        signal?.throwIfAborted()
        database.exec("VACUUM;")
      }
      requireQuickCheck(database.get("PRAGMA quick_check"))
    } finally {
      database.close()
    }

    const after = await requireCurrent(source)
    if (after.metadataVersion !== before.metadataVersion || after.userVersion !== before.userVersion) {
      throw new Error("Thumbnail database metadata changed during maintenance.")
    }
    if (after.journalMode !== before.journalMode) throw new Error("Thumbnail database journal mode changed during maintenance.")
    return {
      backup,
      checkpoint,
      optimized: true,
      vacuumed: options.vacuum,
      journalModeBefore: before.journalMode,
      journalModeAfter: after.journalMode,
    }
  }
}

async function requireBackupCompatible(path: string): Promise<LegacyThumbnailDatabaseReport> {
  const report = await inspectLegacyThumbnailDatabase(path)
  if (!report.exists || report.compatibility === "missing" || report.compatibility === "incompatible") {
    throw new Error(`NeoView thumbnail database cannot be backed up (${report.compatibility}): ${path}`)
  }
  return report
}

async function requireCurrent(path: string): Promise<LegacyThumbnailDatabaseReport> {
  const report = await inspectLegacyThumbnailDatabase(path)
  if (report.compatibility !== "current") {
    throw new Error(`NeoView thumbnail database cannot be maintained (${report.compatibility}): ${path}`)
  }
  return report
}

async function verifyBackup(path: string): Promise<LegacyThumbnailDatabaseReport> {
  const report = await requireBackupCompatible(path)
  const database = await openReadonlySqlite(path)
  try {
    database.exec("PRAGMA query_only = ON;")
    requireQuickCheck(database.get("PRAGMA quick_check"))
  } finally {
    database.close()
  }
  return report
}

function requireQuickCheck(row: Record<string, unknown> | undefined): void {
  const value = row?.quick_check ?? (row ? Object.values(row)[0] : undefined)
  if (value !== "ok") throw new Error(`Thumbnail database quick_check failed: ${String(value ?? "missing result")}`)
}

function integerCell(row: Record<string, unknown> | undefined, key: string): number {
  const value = row?.[key]
  const number = typeof value === "bigint" ? Number(value) : value
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 0) {
    throw new Error(`Invalid SQLite checkpoint field ${key}.`)
  }
  return number
}

async function assertMissing(path: string): Promise<void> {
  try {
    await stat(path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "ENOTDIR") return
    throw error
  }
  throw new Error(`Thumbnail database backup already exists: ${path}`)
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right
}
