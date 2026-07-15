import { randomUUID } from "node:crypto"
import { mkdir, realpath, rename, rm, stat } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import type {
  ReaderThumbnailDatabaseBackupResult,
  ReaderThumbnailDatabaseMaintenance,
  ReaderThumbnailDatabaseOptimizeResult,
  ReaderThumbnailDatabaseRecoveryResult,
} from "../../ports/ReaderThumbnailDatabaseMaintenance.js"
import { openReadonlySqlite } from "../sqlite/openReadonlySqlite.js"
import { openWritableSqlite } from "../sqlite/openWritableSqlite.js"
import {
  inspectLegacyThumbnailDatabase,
  type LegacyThumbnailDatabaseReport,
} from "./LegacyThumbnailDatabaseInspector.js"
import { acquireThumbnailDatabaseAccessLock } from "./ThumbnailDatabaseAccessLock.js"

export interface SqliteLegacyThumbnailDatabaseMaintenanceOptions {
  busyTimeoutMs?: number
  renamePath?: (source: string, destination: string) => Promise<void>
}

export class SqliteLegacyThumbnailDatabaseMaintenance implements ReaderThumbnailDatabaseMaintenance {
  readonly #busyTimeoutMs: number
  readonly #renamePath: (source: string, destination: string) => Promise<void>

  constructor(options: SqliteLegacyThumbnailDatabaseMaintenanceOptions = {}) {
    this.#busyTimeoutMs = options.busyTimeoutMs ?? 5_000
    this.#renamePath = options.renamePath ?? rename
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
    const accessLock = await acquireThumbnailDatabaseAccessLock(source, signal)
    try {
      const before = await requireCurrent(source)
      const backup = await this.backup(source, options.backupPath, signal)
      signal?.throwIfAborted()
      accessLock.assertHeld()

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
        accessLock.assertHeld()
        database.exec("PRAGMA optimize;")
        if (options.vacuum) {
          signal?.throwIfAborted()
          accessLock.assertHeld()
          database.exec("VACUUM;")
        }
        requireQuickCheck(database.get("PRAGMA quick_check"))
      } finally {
        database.close()
      }

      accessLock.assertHeld()
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
    } finally {
      await accessLock.release()
    }
  }

  async recover(
    sourcePath: string,
    options: { backupPath: string; quarantinePath: string },
    signal?: AbortSignal,
  ): Promise<ReaderThumbnailDatabaseRecoveryResult> {
    signal?.throwIfAborted()
    const source = await realpath(sourcePath)
    const backup = await realpath(options.backupPath)
    const quarantine = resolve(options.quarantinePath)
    validateRecoveryPaths(source, backup, quarantine)
    const backupReport = await verifyCurrentBackup(backup)
    const accessLock = await acquireThumbnailDatabaseAccessLock(source, signal)
    const staging = `${source}.xr-recovery-${randomUUID()}.db`
    const moved: Array<{ source: string; quarantine: string }> = []
    try {
      const original = await inspectLegacyThumbnailDatabase(source)
      await assertRecoveryDestinationsMissing(quarantine)
      await this.backup(backup, staging, signal)
      signal?.throwIfAborted()
      accessLock.assertHeld()

      let installed = false
      try {
        await this.#moveRecoveryComponent(source, quarantine, true, moved)
        await this.#moveRecoveryComponent(`${source}-wal`, `${quarantine}-wal`, false, moved)
        await this.#moveRecoveryComponent(`${source}-shm`, `${quarantine}-shm`, false, moved)
        await this.#renamePath(staging, source)
        installed = true
        accessLock.assertHeld()
        const restored = await verifyCurrentBackup(source)
        return {
          recovered: true,
          sourcePath: source,
          backupPath: backup,
          quarantinedDatabasePath: quarantine,
          quarantinedWalPath: moved.some((item) => item.quarantine === `${quarantine}-wal`) ? `${quarantine}-wal` : undefined,
          quarantinedShmPath: moved.some((item) => item.quarantine === `${quarantine}-shm`) ? `${quarantine}-shm` : undefined,
          originalCompatibility: original.compatibility,
          restoredBytes: (await stat(source)).size,
          metadataVersion: restored.metadataVersion ?? backupReport.metadataVersion,
          userVersion: restored.userVersion ?? backupReport.userVersion,
          journalMode: restored.journalMode,
          quickCheck: "ok",
        }
      } catch (error) {
        const rollbackErrors = await this.#rollbackRecovery(source, moved, installed)
        if (rollbackErrors.length) {
          throw new AggregateError([error, ...rollbackErrors], "Thumbnail database recovery failed and rollback was incomplete.")
        }
        throw error
      }
    } finally {
      await rm(staging, { force: true }).catch(() => undefined)
      await accessLock.release()
    }
  }

  async #moveRecoveryComponent(
    source: string,
    quarantine: string,
    required: boolean,
    moved: Array<{ source: string; quarantine: string }>,
  ): Promise<void> {
    if (!required && !(await pathExists(source))) return
    await this.#renamePath(source, quarantine)
    moved.push({ source, quarantine })
  }

  async #rollbackRecovery(
    source: string,
    moved: Array<{ source: string; quarantine: string }>,
    installed: boolean,
  ): Promise<unknown[]> {
    const errors: unknown[] = []
    if (installed) {
      for (const path of [source, `${source}-wal`, `${source}-shm`]) {
        try { await rm(path, { force: true }) } catch (error) { errors.push(error) }
      }
    }
    for (const item of [...moved].reverse()) {
      try { await this.#renamePath(item.quarantine, item.source) } catch (error) { errors.push(error) }
    }
    return errors
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

async function verifyCurrentBackup(path: string): Promise<LegacyThumbnailDatabaseReport> {
  const report = await verifyBackup(path)
  if (report.compatibility !== "current") {
    throw new Error(`NeoView thumbnail recovery requires a current 2.4 backup (${report.compatibility}): ${path}`)
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

async function assertRecoveryDestinationsMissing(quarantine: string): Promise<void> {
  await assertMissing(quarantine)
  await assertMissing(`${quarantine}-wal`)
  await assertMissing(`${quarantine}-shm`)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "ENOTDIR") return false
    throw error
  }
}

function validateRecoveryPaths(source: string, backup: string, quarantine: string): void {
  if (samePath(source, backup)) throw new Error("Thumbnail database recovery backup must differ from the source.")
  if (samePath(source, quarantine) || samePath(backup, quarantine)) {
    throw new Error("Thumbnail database recovery quarantine path must differ from source and backup.")
  }
  if (!samePath(dirname(source), dirname(quarantine))) {
    throw new Error("Thumbnail database recovery quarantine path must be in the source database directory.")
  }
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right
}
