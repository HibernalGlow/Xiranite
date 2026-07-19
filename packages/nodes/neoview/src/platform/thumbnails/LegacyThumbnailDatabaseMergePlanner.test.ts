import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { openReadonlySqlite } from "../sqlite/openReadonlySqlite.js"
import { openWritableSqlite } from "../sqlite/openWritableSqlite.js"
import { LegacyThumbnailDatabaseMergePlanner } from "./LegacyThumbnailDatabaseMergePlanner.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("LegacyThumbnailDatabaseMergePlanner", () => {
  it("[neoview.thumbnail.secondary-merge-plan] reports conflict winners and field-safe secondary metadata fills without mutation", async () => {
    const root = await temporaryRoot()
    const canonical = join(root, "canonical.db")
    const secondary = join(root, "secondary.db")
    await seed(canonical, [
      ["D:/books/conflict.jpg", "2026-07-01 00:00:00", "canonical", null, "canonical-rating", null, null],
      ["D:/books/canonical.jpg", "2026-07-03 00:00:00", "canonical-only", null, null, null, null],
    ], [["D:/books/failure", "old", 1, "2026-07-01 00:00:00", "canonical-error"]])
    await seed(secondary, [
      ["D:/books/conflict.jpg", "2026-07-02 00:00:00", "secondary", "secondary-emm", null, "secondary-translation", "secondary-tags"],
      ["D:/books/secondary.jpg", "2026-07-04 00:00:00", "secondary-only", null, null, null, null],
    ], [["D:/books/failure", "new", 3, "2026-07-02 00:00:00", "secondary-error"]])

    const plan = await new LegacyThumbnailDatabaseMergePlanner().plan(canonical, secondary)

    expect(plan).toMatchObject({
      eligible: true,
      statistics: {
        thumbnails: {
          canonicalRows: 2,
          secondaryRows: 2,
          canonicalOnly: 1,
          secondaryOnly: 1,
          conflicts: 1,
          secondaryThumbnailWins: 1,
          canonicalThumbnailWins: 0,
          fieldsFilledFromSecondary: { emmJson: 1, ratingData: 0, aiTranslation: 1, manualTags: 1 },
        },
        failures: {
          canonicalRows: 1,
          secondaryRows: 1,
          conflicts: 1,
          secondaryFailureWins: 1,
          canonicalFailureWins: 0,
        },
      },
    })
    const database = await openReadonlySqlite(canonical)
    try {
      const row = database.get("SELECT value, emm_json FROM thumbs WHERE key = ?1", "D:/books/conflict.jpg")
      expect(row?.emm_json).toBeNull()
      expect(new TextDecoder().decode(row?.value as Uint8Array)).toBe("canonical")
    } finally {
      database.close()
    }
  })

  it("[neoview.thumbnail.secondary-merge-plan-validation] refuses same-path and non-current databases before querying", async () => {
    const root = await temporaryRoot()
    const current = join(root, "current.db")
    const incompatible = join(root, "incompatible.db")
    await seed(current, [], [])
    const unrelated = await openWritableSqlite(incompatible, { create: true })
    unrelated.exec("CREATE TABLE unrelated (id INTEGER)")
    unrelated.close()

    await expect(new LegacyThumbnailDatabaseMergePlanner().plan(current, current)).resolves.toMatchObject({
      eligible: false,
      reasons: [expect.stringContaining("same file")],
    })
    await expect(new LegacyThumbnailDatabaseMergePlanner().plan(current, incompatible)).resolves.toMatchObject({
      eligible: false,
      reasons: [expect.stringContaining("not current")],
    })
  })
})

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
        key,
        date,
        Buffer.from(value),
        emmJson,
        ratingData,
        aiTranslation,
        manualTags,
      )
    }
    for (const [key, reason, retryCount, lastAttempt, errorMessage] of failures) {
      database.run(
        "INSERT INTO failed_thumbnails (key, reason, retry_count, last_attempt, error_message) VALUES (?1, ?2, ?3, ?4, ?5)",
        key,
        reason,
        retryCount,
        lastAttempt,
        errorMessage,
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
  const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-thumbnail-merge-plan-"))
  roots.push(root)
  return root
}
