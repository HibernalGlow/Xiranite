import { stat } from "node:fs/promises"
import { openReadonlySqlite, type ReadonlySqliteConnection } from "../sqlite/openReadonlySqlite.js"

export const LEGACY_THUMBNAIL_DATABASE_VERSION = "2.4"

export type LegacyThumbnailDatabaseCompatibility =
  | "missing"
  | "current"
  | "legacy-upgrade-required"
  | "newer-read-only"
  | "incompatible"

export interface LegacyThumbnailSidecars {
  wal: { path: string; exists: boolean; bytes?: number }
  shm: { path: string; exists: boolean; bytes?: number }
}

export interface LegacyThumbnailDatabaseReport {
  path: string
  exists: boolean
  bytes?: number
  compatibility: LegacyThumbnailDatabaseCompatibility
  metadataVersion?: string
  userVersion?: number
  journalMode?: string
  tables: Record<string, string[]>
  indexes: string[]
  sidecars: LegacyThumbnailSidecars
  issues: string[]
}

const CURRENT_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  thumbs: ["key", "size", "date", "ghash", "category", "value", "emm_json", "rating_data", "ai_translation", "manual_tags"],
  failed_thumbnails: ["key", "reason", "retry_count", "last_attempt", "error_message"],
  metadata: ["key", "value"],
}

const BASE_THUMB_COLUMNS = ["key", "size", "date", "ghash", "category", "value"] as const
const CURRENT_INDEXES = ["idx_thumbs_key", "idx_thumbs_category", "idx_thumbs_date", "idx_failed_reason"] as const

export async function inspectLegacyThumbnailDatabase(path: string): Promise<LegacyThumbnailDatabaseReport> {
  const walPath = `${path}-wal`
  const shmPath = `${path}-shm`
  const [databaseInfo, walInfo, shmInfo] = await Promise.all([fileInfo(path), fileInfo(walPath), fileInfo(shmPath)])
  const sidecars: LegacyThumbnailSidecars = {
    wal: { path: walPath, exists: Boolean(walInfo), bytes: walInfo?.size },
    shm: { path: shmPath, exists: Boolean(shmInfo), bytes: shmInfo?.size },
  }
  if (!databaseInfo) {
    return { path, exists: false, compatibility: "missing", tables: {}, indexes: [], sidecars, issues: [] }
  }

  let database: ReadonlySqliteConnection | undefined
  try {
    database = await openReadonlySqlite(path)
    database.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 1000;")
    const userVersion = numericCell(database.get("PRAGMA user_version"), "user_version")
    const journalMode = stringCell(database.get("PRAGMA journal_mode"), "journal_mode")
    const tableNames = database.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .map((row) => stringCell(row, "name"))
      .filter((name): name is string => Boolean(name))
    const tables: Record<string, string[]> = {}
    for (const table of tableNames) {
      tables[table] = database.all(`PRAGMA table_info(${quoteIdentifier(table)})`)
        .map((row) => stringCell(row, "name"))
        .filter((name): name is string => Boolean(name))
    }
    const indexes = database.all("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .map((row) => stringCell(row, "name"))
      .filter((name): name is string => Boolean(name))
    const metadataVersion = tables.metadata
      ? stringCell(database.get("SELECT value FROM metadata WHERE key = 'version' LIMIT 1"), "value")
      : undefined
    const assessed = assessCompatibility(tables, indexes, metadataVersion)
    return {
      path,
      exists: true,
      bytes: databaseInfo.size,
      metadataVersion,
      userVersion,
      journalMode,
      tables,
      indexes,
      sidecars,
      ...assessed,
    }
  } catch (error) {
    return {
      path,
      exists: true,
      bytes: databaseInfo.size,
      compatibility: "incompatible",
      tables: {},
      indexes: [],
      sidecars,
      issues: [`SQLite read-only inspection failed: ${error instanceof Error ? error.message : String(error)}`],
    }
  } finally {
    database?.close()
  }
}

function assessCompatibility(
  tables: Readonly<Record<string, readonly string[]>>,
  indexes: readonly string[],
  metadataVersion: string | undefined,
): Pick<LegacyThumbnailDatabaseReport, "compatibility" | "issues"> {
  const issues: string[] = []
  const thumbs = new Set(tables.thumbs ?? [])
  const missingBase = BASE_THUMB_COLUMNS.filter((column) => !thumbs.has(column))
  if (missingBase.length) {
    issues.push(`thumbs is missing required columns: ${missingBase.join(", ")}`)
    return { compatibility: "incompatible", issues }
  }

  for (const [table, expectedColumns] of Object.entries(CURRENT_COLUMNS)) {
    const actual = new Set(tables[table] ?? [])
    const missing = expectedColumns.filter((column) => !actual.has(column))
    if (missing.length) issues.push(`${table} is missing current columns: ${missing.join(", ")}`)
  }
  const missingIndexes = CURRENT_INDEXES.filter((index) => !indexes.includes(index))
  if (missingIndexes.length) issues.push(`missing indexes: ${missingIndexes.join(", ")}`)

  const versionOrder = compareVersions(metadataVersion, LEGACY_THUMBNAIL_DATABASE_VERSION)
  if (versionOrder === "newer-or-unknown") {
    issues.push(`database metadata version ${metadataVersion ?? "(missing)"} is newer or unknown; writes are disabled`)
    return { compatibility: "newer-read-only", issues }
  }
  if (metadataVersion !== LEGACY_THUMBNAIL_DATABASE_VERSION || issues.length) {
    if (!metadataVersion) issues.push("metadata.version is missing")
    else if (versionOrder === "older") issues.push(`metadata.version ${metadataVersion} requires an explicit backed-up migration`)
    return { compatibility: "legacy-upgrade-required", issues }
  }
  return { compatibility: "current", issues }
}

function compareVersions(value: string | undefined, target: string): "older" | "equal" | "newer-or-unknown" {
  if (value === target) return "equal"
  if (!value) return "older"
  if (!/^\d+(?:\.\d+)*$/.test(value)) return "newer-or-unknown"
  const left = value.split(".").map(Number)
  const right = target.split(".").map(Number)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference < 0) return "older"
    if (difference > 0) return "newer-or-unknown"
  }
  return "equal"
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function numericCell(row: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = row?.[key]
  return typeof value === "number" ? value : typeof value === "bigint" ? Number(value) : undefined
}

function stringCell(row: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = row?.[key]
  return typeof value === "string" ? value : undefined
}

async function fileInfo(path: string): Promise<{ size: number } | undefined> {
  try {
    const info = await stat(path)
    return info.isFile() ? { size: info.size } : undefined
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "ENOTDIR") return undefined
    throw error
  }
}
