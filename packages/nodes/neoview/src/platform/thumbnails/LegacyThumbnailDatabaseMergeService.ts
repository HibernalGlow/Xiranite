import { randomUUID } from "node:crypto"
import { mkdir, realpath, rm, stat } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import type { ReaderThumbnailDatabaseBackupResult } from "../../ports/ReaderThumbnailDatabaseMaintenance.js"
import { openWritableSqlite, type WritableSqliteConnection } from "../sqlite/openWritableSqlite.js"
import { inspectLegacyThumbnailDatabase, type LegacyThumbnailDatabaseReport } from "./LegacyThumbnailDatabaseInspector.js"
import { acquireThumbnailDatabaseAccessLock, type ThumbnailDatabaseAccessLock } from "./ThumbnailDatabaseAccessLock.js"
import { LegacyThumbnailDatabaseMergePlanner, type LegacyThumbnailDatabaseMergePlan } from "./LegacyThumbnailDatabaseMergePlanner.js"

export interface LegacyThumbnailDatabaseMergeRequest {
  canonicalPath: string
  secondaryPath: string
  backupPath: string
}

export interface LegacyThumbnailDatabaseMergeResult {
  plan: LegacyThumbnailDatabaseMergePlan
  backup: ReaderThumbnailDatabaseBackupResult
  canonical: Pick<LegacyThumbnailDatabaseReport, "metadataVersion" | "userVersion" | "journalMode">
  source: Pick<LegacyThumbnailDatabaseReport, "metadataVersion" | "userVersion" | "journalMode">
}

/**
 * Performs one explicit offline merge into the canonical NeoView thumbnail database.
 * The secondary database remains untouched; its temporary consistent snapshot is deleted.
 */
export class LegacyThumbnailDatabaseMergeService {
  constructor(
    private readonly options: { busyTimeoutMs?: number; planner?: LegacyThumbnailDatabaseMergePlanner } = {},
  ) {}

  async merge(request: LegacyThumbnailDatabaseMergeRequest, signal?: AbortSignal): Promise<LegacyThumbnailDatabaseMergeResult> {
    signal?.throwIfAborted()
    const canonical = await realpath(request.canonicalPath)
    const secondary = await realpath(request.secondaryPath)
    const backupPath = resolve(request.backupPath)
    assertDistinctPaths(canonical, secondary, backupPath)
    await assertMissing(backupPath)

    const locks = await acquireLocks(canonical, secondary, signal)
    // Keep the secondary database and its WAL sidecars untouched. The transient
    // snapshot is staged beside the canonical database, which is the only one
    // this operation ever changes.
    const sourceSnapshot = `${canonical}.xr-merge-source-${randomUUID()}.db`
    try {
      const planner = this.options.planner ?? new LegacyThumbnailDatabaseMergePlanner()
      const plan = await planner.plan(canonical, secondary)
      if (!plan.eligible) throw new Error(`Thumbnail database merge is not eligible: ${plan.reasons.join(" ")}`)
      locks.forEach((lock) => lock.assertHeld())
      const [canonicalBefore, sourceBefore] = [plan.canonical, plan.secondary]
      await checkpointOffline(canonical, this.busyTimeoutMs)
      signal?.throwIfAborted()
      locks.forEach((lock) => lock.assertHeld())

      const backup = await snapshotDatabase(canonical, backupPath, this.busyTimeoutMs)
      await snapshotDatabase(secondary, sourceSnapshot, this.busyTimeoutMs)
      signal?.throwIfAborted()
      locks.forEach((lock) => lock.assertHeld())
      await mergeSnapshotIntoCanonical(canonical, sourceSnapshot, this.busyTimeoutMs, locks)

      const [canonicalAfter, sourceAfter] = await Promise.all([
        inspectLegacyThumbnailDatabase(canonical),
        inspectLegacyThumbnailDatabase(secondary),
      ])
      assertUnchangedSchema(canonicalBefore, canonicalAfter, "canonical")
      assertUnchangedSchema(sourceBefore, sourceAfter, "secondary")
      return {
        plan,
        backup,
        canonical: schemaSummary(canonicalAfter),
        source: schemaSummary(sourceAfter),
      }
    } finally {
      await rm(sourceSnapshot, { force: true }).catch(() => undefined)
      await releaseLocks(locks)
    }
  }

  private get busyTimeoutMs(): number {
    const value = this.options.busyTimeoutMs ?? 5_000
    if (!Number.isSafeInteger(value) || value < 0 || value > 60_000) {
      throw new RangeError("busyTimeoutMs must be an integer from 0 to 60000.")
    }
    return value
  }
}

async function acquireLocks(canonical: string, secondary: string, signal?: AbortSignal): Promise<ThumbnailDatabaseAccessLock[]> {
  const paths = [canonical, secondary].sort((left, right) => pathOrder(left, right))
  const locks: ThumbnailDatabaseAccessLock[] = []
  try {
    for (const path of paths) locks.push(await acquireThumbnailDatabaseAccessLock(path, signal))
    return locks
  } catch (error) {
    await releaseLocks(locks)
    throw error
  }
}

async function releaseLocks(locks: readonly ThumbnailDatabaseAccessLock[]): Promise<void> {
  await Promise.all([...locks].reverse().map((lock) => lock.release().catch(() => undefined)))
}

async function checkpointOffline(path: string, busyTimeoutMs: number): Promise<void> {
  const database = await openWritableSqlite(path)
  try {
    database.exec(`PRAGMA busy_timeout = ${busyTimeoutMs};`)
    const journal = stringCell(database.get("PRAGMA journal_mode"))
    if (journal?.toLowerCase() !== "wal") return
    const checkpoint = database.get("PRAGMA wal_checkpoint(TRUNCATE)")
    if (integerCell(checkpoint?.busy, "checkpoint busy") !== 0) {
      throw new Error(`Thumbnail database checkpoint is busy; close NeoView and Xiranite database users: ${path}`)
    }
  } finally {
    database.close()
  }
}

async function snapshotDatabase(source: string, destination: string, busyTimeoutMs: number): Promise<ReaderThumbnailDatabaseBackupResult> {
  await assertMissing(destination)
  await mkdir(dirname(destination), { recursive: true })
  const database = await openWritableSqlite(source)
  try {
    database.exec(`PRAGMA busy_timeout = ${busyTimeoutMs};`)
    database.run("VACUUM INTO ?1", destination)
  } catch (error) {
    await rm(destination, { force: true }).catch(() => undefined)
    throw error
  } finally {
    database.close()
  }
  try {
    const report = await requireCurrent(destination)
    const verification = await openWritableSqlite(destination)
    try {
      verification.exec("PRAGMA query_only = ON;")
      requireQuickCheck(verification.get("PRAGMA quick_check"))
    } finally {
      verification.close()
    }
    return {
      sourcePath: source,
      destinationPath: destination,
      bytes: (await stat(destination)).size,
      compatibility: "current",
      metadataVersion: report.metadataVersion,
      userVersion: report.userVersion,
      journalMode: report.journalMode,
      quickCheck: "ok",
    }
  } catch (error) {
    await rm(destination, { force: true }).catch(() => undefined)
    throw error
  }
}

async function mergeSnapshotIntoCanonical(
  canonical: string,
  sourceSnapshot: string,
  busyTimeoutMs: number,
  locks: readonly ThumbnailDatabaseAccessLock[],
): Promise<void> {
  const database = await openWritableSqlite(canonical)
  let attached = false
  let transaction = false
  try {
    database.exec(`PRAGMA busy_timeout = ${busyTimeoutMs};`)
    database.run("ATTACH DATABASE ?1 AS secondary", sourceSnapshot)
    attached = true
    locks.forEach((lock) => lock.assertHeld())
    database.exec("BEGIN IMMEDIATE")
    transaction = true
    mergeThumbs(database)
    mergeFailures(database)
    requireQuickCheck(database.get("PRAGMA quick_check"))
    locks.forEach((lock) => lock.assertHeld())
    database.exec("COMMIT")
    transaction = false
  } catch (error) {
    if (transaction) {
      try { database.exec("ROLLBACK") } catch { /* preserve the initial merge failure */ }
    }
    throw error
  } finally {
    if (attached) {
      try { database.exec("DETACH DATABASE secondary") } catch { /* connection close releases the attachment */ }
    }
    database.close()
  }
}

function mergeThumbs(database: WritableSqliteConnection): void {
  database.run(`
    INSERT INTO thumbs (key, size, date, ghash, category, value, emm_json, rating_data, ai_translation, manual_tags)
    SELECT key, size, date, ghash, category, value, emm_json, rating_data, ai_translation, manual_tags
    FROM secondary.thumbs
    WHERE true
    ON CONFLICT(key) DO UPDATE SET
      size = CASE WHEN excluded.date IS NOT NULL AND (thumbs.date IS NULL OR excluded.date > thumbs.date) THEN excluded.size ELSE thumbs.size END,
      date = CASE WHEN excluded.date IS NOT NULL AND (thumbs.date IS NULL OR excluded.date > thumbs.date) THEN excluded.date ELSE thumbs.date END,
      ghash = CASE WHEN excluded.date IS NOT NULL AND (thumbs.date IS NULL OR excluded.date > thumbs.date) THEN excluded.ghash ELSE thumbs.ghash END,
      category = CASE WHEN excluded.date IS NOT NULL AND (thumbs.date IS NULL OR excluded.date > thumbs.date) THEN excluded.category ELSE thumbs.category END,
      value = CASE WHEN excluded.date IS NOT NULL AND (thumbs.date IS NULL OR excluded.date > thumbs.date) THEN excluded.value ELSE thumbs.value END,
      emm_json = coalesce(thumbs.emm_json, excluded.emm_json),
      rating_data = coalesce(thumbs.rating_data, excluded.rating_data),
      ai_translation = coalesce(thumbs.ai_translation, excluded.ai_translation),
      manual_tags = coalesce(thumbs.manual_tags, excluded.manual_tags)
  `)
}

function mergeFailures(database: WritableSqliteConnection): void {
  database.run(`
    INSERT INTO failed_thumbnails (key, reason, retry_count, last_attempt, error_message)
    SELECT key, reason, retry_count, last_attempt, error_message
    FROM secondary.failed_thumbnails
    WHERE true
    ON CONFLICT(key) DO UPDATE SET
      reason = CASE WHEN excluded.last_attempt IS NOT NULL AND (failed_thumbnails.last_attempt IS NULL OR excluded.last_attempt > failed_thumbnails.last_attempt) THEN excluded.reason ELSE failed_thumbnails.reason END,
      retry_count = max(coalesce(failed_thumbnails.retry_count, 0), coalesce(excluded.retry_count, 0)),
      last_attempt = CASE WHEN excluded.last_attempt IS NOT NULL AND (failed_thumbnails.last_attempt IS NULL OR excluded.last_attempt > failed_thumbnails.last_attempt) THEN excluded.last_attempt ELSE failed_thumbnails.last_attempt END,
      error_message = CASE WHEN excluded.last_attempt IS NOT NULL AND (failed_thumbnails.last_attempt IS NULL OR excluded.last_attempt > failed_thumbnails.last_attempt) THEN excluded.error_message ELSE failed_thumbnails.error_message END
  `)
}

async function requireCurrent(path: string): Promise<LegacyThumbnailDatabaseReport> {
  const report = await inspectLegacyThumbnailDatabase(path)
  if (report.compatibility !== "current") throw new Error(`Thumbnail database is not current: ${path}`)
  return report
}

function assertUnchangedSchema(before: LegacyThumbnailDatabaseReport, after: LegacyThumbnailDatabaseReport, label: string): void {
  if (after.compatibility !== "current") throw new Error(`Merged ${label} thumbnail database is no longer current.`)
  if (after.metadataVersion !== before.metadataVersion || after.userVersion !== before.userVersion || after.journalMode !== before.journalMode) {
    throw new Error(`Merged ${label} thumbnail database changed protected schema metadata.`)
  }
}

function schemaSummary(report: LegacyThumbnailDatabaseReport): Pick<LegacyThumbnailDatabaseReport, "metadataVersion" | "userVersion" | "journalMode"> {
  return { metadataVersion: report.metadataVersion, userVersion: report.userVersion, journalMode: report.journalMode }
}

function requireQuickCheck(row: Record<string, unknown> | undefined): void {
  const value = row?.quick_check ?? (row ? Object.values(row)[0] : undefined)
  if (value !== "ok") throw new Error(`Thumbnail database quick_check failed: ${String(value ?? "missing result")}`)
}

function stringCell(row: Record<string, unknown> | undefined): string | undefined {
  const value = row ? Object.values(row)[0] : undefined
  return typeof value === "string" ? value : undefined
}

function integerCell(value: unknown, label: string): number {
  const number = typeof value === "bigint" ? Number(value) : value
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 0) throw new Error(`Invalid ${label} value.`)
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
  throw new Error(`Thumbnail database merge backup already exists: ${path}`)
}

function assertDistinctPaths(canonical: string, secondary: string, backup: string): void {
  if (samePath(canonical, secondary)) throw new Error("Thumbnail database merge source must differ from canonical database.")
  if (samePath(canonical, backup) || samePath(secondary, backup)) throw new Error("Thumbnail database merge backup must differ from both databases.")
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right
}

function pathOrder(left: string, right: string): number {
  return process.platform === "win32" ? left.localeCompare(right, undefined, { sensitivity: "accent" }) : left.localeCompare(right)
}
