import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { openReadonlySqlite } from "../sqlite/openReadonlySqlite.js"
import { openWritableSqlite } from "../sqlite/openWritableSqlite.js"
import { inspectLegacyThumbnailDatabase } from "./LegacyThumbnailDatabaseInspector.js"
import { LegacyThumbnailDatabaseMergeService } from "./LegacyThumbnailDatabaseMergeService.js"
import { WritableLegacyThumbnailStore } from "./WritableLegacyThumbnailStore.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("LegacyThumbnailDatabaseMergeService", () => {
  it("[neoview.thumbnail.secondary-merge] atomically merges a secondary snapshot and preserves a verified canonical rollback backup", async () => {
    const root = await temporaryRoot()
    const canonical = join(root, "canonical.db")
    const secondary = join(root, "secondary.db")
    const backup = join(root, "canonical.before-merge.db")
    await seed(canonical, [
      ["D:/books/conflict.jpg", "2026-07-01 00:00:00", "canonical", null, "canonical-rating", null, null],
      ["D:/books/canonical.jpg", "2026-07-03 00:00:00", "canonical-only", null, null, null, null],
    ], [["D:/books/failure", "old", 1, "2026-07-01 00:00:00", "canonical-error"]])
    await seed(secondary, [
      ["D:/books/conflict.jpg", "2026-07-02 00:00:00", "secondary", "secondary-emm", null, "secondary-translation", "secondary-tags"],
      ["D:/books/secondary.jpg", "2026-07-04 00:00:00", "secondary-only", null, null, null, null],
    ], [["D:/books/failure", "new", 3, "2026-07-02 00:00:00", "secondary-error"]])
    const sourceBefore = await thumbnailValue(secondary, "D:/books/conflict.jpg")

    const result = await new LegacyThumbnailDatabaseMergeService().merge({ canonicalPath: canonical, secondaryPath: secondary, backupPath: backup })

    expect(result).toMatchObject({
      backup: { destinationPath: backup, quickCheck: "ok", compatibility: "current" },
      canonical: { metadataVersion: "2.4", journalMode: "wal" },
      source: { metadataVersion: "2.4", journalMode: "wal" },
    })
    expect(await thumbnailValue(canonical, "D:/books/conflict.jpg")).toBe("secondary")
    expect(await thumbnailValue(canonical, "D:/books/secondary.jpg")).toBe("secondary-only")
    expect(await thumbnailValue(backup, "D:/books/conflict.jpg")).toBe("canonical")
    expect(await thumbnailValue(secondary, "D:/books/conflict.jpg")).toBe(sourceBefore)
    const database = await openReadonlySqlite(canonical)
    try {
      expect(database.get("SELECT emm_json, rating_data, ai_translation, manual_tags FROM thumbs WHERE key = ?1", "D:/books/conflict.jpg"))
        .toEqual({ emm_json: "secondary-emm", rating_data: "canonical-rating", ai_translation: "secondary-translation", manual_tags: "secondary-tags" })
      expect(database.get("SELECT reason, retry_count, last_attempt, error_message FROM failed_thumbnails WHERE key = ?1", "D:/books/failure"))
        .toEqual({ reason: "new", retry_count: 3, last_attempt: "2026-07-02 00:00:00", error_message: "secondary-error" })
    } finally {
      database.close()
    }
    await expect(inspectLegacyThumbnailDatabase(canonical)).resolves.toMatchObject({ compatibility: "current", journalMode: "wal" })
  })

  it("[neoview.thumbnail.secondary-merge-lock] refuses an active canonical writer before creating a backup", async () => {
    const root = await temporaryRoot()
    const canonical = join(root, "canonical.db")
    const secondary = join(root, "secondary.db")
    const backup = join(root, "canonical.backup.db")
    await seed(canonical, [], [])
    await seed(secondary, [], [])
    const writer = await WritableLegacyThumbnailStore.open(canonical)
    try {
      await expect(new LegacyThumbnailDatabaseMergeService().merge({ canonicalPath: canonical, secondaryPath: secondary, backupPath: backup }))
        .rejects.toThrow("already in use")
      await expect(stat(backup)).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await writer.close()
    }
  })
})

async function thumbnailValue(path: string, key: string): Promise<string | undefined> {
  const database = await openReadonlySqlite(path)
  try {
    const row = database.get("SELECT value FROM thumbs WHERE key = ?1", key)
    return row ? new TextDecoder().decode(row.value as Uint8Array) : undefined
  } finally {
    database.close()
  }
}

async function seed(
  path: string,
  thumbs: readonly [string, string, string, string | null, string | null, string | null, string | null][],
  failures: readonly [string, string, number, string, string][],
): Promise<void> {
  const database = await openWritableSqlite(path, { create: true })
  try {
    database.exec(CURRENT_SCHEMA_SQL)
    for (const [key, date, value, emmJson, ratingData, aiTranslation, manualTags] of thumbs) {
      database.run(
        "INSERT INTO thumbs (key, date, category, value, emm_json, rating_data, ai_translation, manual_tags) VALUES (?1, ?2, 'file', ?3, ?4, ?5, ?6, ?7)",
        key, date, new TextEncoder().encode(value), emmJson, ratingData, aiTranslation, manualTags,
      )
    }
    for (const [key, reason, retryCount, lastAttempt, errorMessage] of failures) {
      database.run(
        "INSERT INTO failed_thumbnails (key, reason, retry_count, last_attempt, error_message) VALUES (?1, ?2, ?3, ?4, ?5)",
        key, reason, retryCount, lastAttempt, errorMessage,
      )
    }
  } finally {
    database.close()
  }
}

const CURRENT_SCHEMA_SQL = `
  PRAGMA journal_mode = WAL;
  CREATE TABLE thumbs (key TEXT PRIMARY KEY,size INTEGER,date TEXT,ghash INTEGER,category TEXT DEFAULT 'file',value BLOB,emm_json TEXT,rating_data TEXT,ai_translation TEXT,manual_tags TEXT);
  CREATE INDEX idx_thumbs_key ON thumbs(key);
  CREATE INDEX idx_thumbs_category ON thumbs(category);
  CREATE INDEX idx_thumbs_date ON thumbs(date);
  CREATE TABLE failed_thumbnails (key TEXT PRIMARY KEY,reason TEXT NOT NULL,retry_count INTEGER DEFAULT 0,last_attempt TEXT,error_message TEXT);
  CREATE INDEX idx_failed_reason ON failed_thumbnails(reason);
  CREATE TABLE metadata (key TEXT PRIMARY KEY,value TEXT);
  INSERT INTO metadata VALUES ('version','2.4');
`

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-thumbnail-merge-"))
  roots.push(root)
  return root
}
