import { realpath } from "node:fs/promises"
import { resolve } from "node:path"

import { openWritableSqlite } from "../sqlite/openWritableSqlite.js"
import {
  inspectLegacyThumbnailDatabase,
  type LegacyThumbnailDatabaseReport,
} from "./LegacyThumbnailDatabaseInspector.js"

export interface LegacyThumbnailDatabaseMergePlan {
  canonical: LegacyThumbnailDatabaseReport
  secondary: LegacyThumbnailDatabaseReport
  eligible: boolean
  reasons: readonly string[]
  statistics?: LegacyThumbnailDatabaseMergeStatistics
}

export interface LegacyThumbnailDatabaseMergeStatistics {
  thumbnails: {
    canonicalRows: number
    secondaryRows: number
    canonicalBytes: number
    secondaryBytes: number
    canonicalOnly: number
    secondaryOnly: number
    conflicts: number
    secondaryThumbnailWins: number
    canonicalThumbnailWins: number
    fieldsFilledFromSecondary: Readonly<Record<"emmJson" | "ratingData" | "aiTranslation" | "manualTags", number>>
  }
  failures: {
    canonicalRows: number
    secondaryRows: number
    canonicalOnly: number
    secondaryOnly: number
    conflicts: number
    secondaryFailureWins: number
    canonicalFailureWins: number
  }
}

/**
 * Produces a read-only merge plan for a historical custom thumbnails.db.
 * The plan deliberately does not acquire the writer lock or create a snapshot.
 */
export class LegacyThumbnailDatabaseMergePlanner {
  async plan(canonicalPath: string, secondaryPath: string): Promise<LegacyThumbnailDatabaseMergePlan> {
    const [canonical, secondary] = await Promise.all([
      inspectLegacyThumbnailDatabase(canonicalPath),
      inspectLegacyThumbnailDatabase(secondaryPath),
    ])
    const reasons = mergeIneligibilityReasons(canonical, secondary, await sameDatabase(canonicalPath, secondaryPath))
    if (reasons.length) return { canonical, secondary, eligible: false, reasons }
    return {
      canonical,
      secondary,
      eligible: true,
      reasons: [],
      statistics: await readMergeStatistics(canonicalPath, secondaryPath),
    }
  }
}

async function readMergeStatistics(canonicalPath: string, secondaryPath: string): Promise<LegacyThumbnailDatabaseMergeStatistics> {
  const database = await openWritableSqlite(canonicalPath)
  try {
    database.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 1000;")
    database.run("ATTACH DATABASE ?1 AS secondary", secondaryPath)
    try {
      const [canonicalThumbs, secondaryThumbs, thumbnailConflicts, canonicalFailures, secondaryFailures, failureConflicts] = [
        aggregateThumbs(database.get("SELECT count(*) AS rows, coalesce(sum(length(value)), 0) AS bytes FROM thumbs")),
        aggregateThumbs(database.get("SELECT count(*) AS rows, coalesce(sum(length(value)), 0) AS bytes FROM secondary.thumbs")),
        aggregateThumbnailConflicts(database.get(`
          SELECT
            count(*) AS conflicts,
            sum(CASE WHEN s.date IS NOT NULL AND (c.date IS NULL OR s.date > c.date) THEN 1 ELSE 0 END) AS secondary_wins,
            sum(CASE WHEN c.emm_json IS NULL AND s.emm_json IS NOT NULL THEN 1 ELSE 0 END) AS fill_emm_json,
            sum(CASE WHEN c.rating_data IS NULL AND s.rating_data IS NOT NULL THEN 1 ELSE 0 END) AS fill_rating_data,
            sum(CASE WHEN c.ai_translation IS NULL AND s.ai_translation IS NOT NULL THEN 1 ELSE 0 END) AS fill_ai_translation,
            sum(CASE WHEN c.manual_tags IS NULL AND s.manual_tags IS NOT NULL THEN 1 ELSE 0 END) AS fill_manual_tags
          FROM thumbs AS c
          INNER JOIN secondary.thumbs AS s ON s.key = c.key
        `)),
        aggregateRows(database.get("SELECT count(*) AS rows FROM failed_thumbnails")),
        aggregateRows(database.get("SELECT count(*) AS rows FROM secondary.failed_thumbnails")),
        aggregateFailureConflicts(database.get(`
          SELECT
            count(*) AS conflicts,
            sum(CASE WHEN s.last_attempt IS NOT NULL AND (c.last_attempt IS NULL OR s.last_attempt > c.last_attempt) THEN 1 ELSE 0 END) AS secondary_wins
          FROM failed_thumbnails AS c
          INNER JOIN secondary.failed_thumbnails AS s ON s.key = c.key
        `)),
      ]
      return {
        thumbnails: {
          canonicalRows: canonicalThumbs.rows,
          secondaryRows: secondaryThumbs.rows,
          canonicalBytes: canonicalThumbs.bytes,
          secondaryBytes: secondaryThumbs.bytes,
          canonicalOnly: canonicalThumbs.rows - thumbnailConflicts.conflicts,
          secondaryOnly: secondaryThumbs.rows - thumbnailConflicts.conflicts,
          conflicts: thumbnailConflicts.conflicts,
          secondaryThumbnailWins: thumbnailConflicts.secondaryWins,
          canonicalThumbnailWins: thumbnailConflicts.conflicts - thumbnailConflicts.secondaryWins,
          fieldsFilledFromSecondary: {
            emmJson: thumbnailConflicts.fillEmmJson,
            ratingData: thumbnailConflicts.fillRatingData,
            aiTranslation: thumbnailConflicts.fillAiTranslation,
            manualTags: thumbnailConflicts.fillManualTags,
          },
        },
        failures: {
          canonicalRows: canonicalFailures,
          secondaryRows: secondaryFailures,
          canonicalOnly: canonicalFailures - failureConflicts.conflicts,
          secondaryOnly: secondaryFailures - failureConflicts.conflicts,
          conflicts: failureConflicts.conflicts,
          secondaryFailureWins: failureConflicts.secondaryWins,
          canonicalFailureWins: failureConflicts.conflicts - failureConflicts.secondaryWins,
        },
      }
    } finally {
      database.exec("DETACH DATABASE secondary")
    }
  } finally {
    database.close()
  }
}

function mergeIneligibilityReasons(
  canonical: LegacyThumbnailDatabaseReport,
  secondary: LegacyThumbnailDatabaseReport,
  same: boolean,
): string[] {
  const reasons: string[] = []
  if (same) reasons.push("The canonical and secondary thumbnail databases resolve to the same file.")
  if (canonical.compatibility !== "current") reasons.push(`The canonical thumbnail database is not current (${canonical.compatibility}).`)
  if (secondary.compatibility !== "current") reasons.push(`The secondary thumbnail database is not current (${secondary.compatibility}).`)
  return reasons
}

async function sameDatabase(left: string, right: string): Promise<boolean> {
  const [canonicalLeft, canonicalRight] = await Promise.all([canonicalPath(left), canonicalPath(right)])
  return process.platform === "win32"
    ? canonicalLeft.toLowerCase() === canonicalRight.toLowerCase()
    : canonicalLeft === canonicalRight
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "ENOTDIR") return resolve(path)
    throw error
  }
}

function aggregateRows(row: Record<string, unknown> | undefined): number {
  return integer(row?.rows, "rows")
}

function aggregateThumbs(row: Record<string, unknown> | undefined): { rows: number; bytes: number } {
  return { rows: integer(row?.rows, "rows"), bytes: integer(row?.bytes, "bytes") }
}

function aggregateThumbnailConflicts(row: Record<string, unknown> | undefined) {
  return {
    conflicts: integer(row?.conflicts, "conflicts"),
    secondaryWins: integer(row?.secondary_wins, "secondary_wins"),
    fillEmmJson: integer(row?.fill_emm_json, "fill_emm_json"),
    fillRatingData: integer(row?.fill_rating_data, "fill_rating_data"),
    fillAiTranslation: integer(row?.fill_ai_translation, "fill_ai_translation"),
    fillManualTags: integer(row?.fill_manual_tags, "fill_manual_tags"),
  }
}

function aggregateFailureConflicts(row: Record<string, unknown> | undefined) {
  return {
    conflicts: integer(row?.conflicts, "conflicts"),
    secondaryWins: integer(row?.secondary_wins, "secondary_wins"),
  }
}

function integer(value: unknown, field: string): number {
  const number = typeof value === "bigint" ? Number(value) : value
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 0) {
    throw new Error(`Invalid thumbnail merge plan ${field}.`)
  }
  return number
}
