import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { inspectLegacyThumbnailDatabase } from "./LegacyThumbnailDatabaseInspector.js"

describe("inspectLegacyThumbnailDatabase", () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it("[neoview.thumbnail.schema] reports a missing database without creating it", async () => {
    const root = await temporaryRoot(roots)
    const path = join(root, "NeoView", "thumbnails.db")
    expect(await inspectLegacyThumbnailDatabase(path)).toMatchObject({
      path,
      exists: false,
      compatibility: "missing",
      tables: {},
    })
  })

  it("[neoview.thumbnail.schema] recognizes the frozen 2.4 schema and live WAL sidecars", async () => {
    const root = await temporaryRoot(roots)
    const path = join(root, "thumbnails.db")
    const database = await openFixtureDatabase(path)
    try {
      database.exec(CURRENT_SCHEMA_SQL)
      database.exec("PRAGMA user_version = 7; INSERT INTO thumbs (key, category, value) VALUES ('D:/book.cbz', 'file', X'89504E47');")
      const report = await inspectLegacyThumbnailDatabase(path)
      expect(report).toMatchObject({
        exists: true,
        compatibility: "current",
        metadataVersion: "2.4",
        userVersion: 7,
        journalMode: "wal",
        sidecars: { wal: { exists: true }, shm: { exists: true } },
      })
      expect(report.tables.thumbs).toEqual(expect.arrayContaining(["key", "category", "value", "emm_json", "rating_data", "ai_translation", "manual_tags"]))
      expect(report.indexes).toEqual(expect.arrayContaining(["idx_thumbs_category", "idx_thumbs_date", "idx_failed_reason"]))
    } finally {
      database.close()
    }
  })

  it("classifies an older intact schema as requiring an explicit backed-up migration", async () => {
    const root = await temporaryRoot(roots)
    const path = join(root, "legacy.db")
    const database = await openFixtureDatabase(path)
    database.exec(`
      CREATE TABLE thumbs (key TEXT PRIMARY KEY, size INTEGER, date TEXT, ghash INTEGER, category TEXT, value BLOB, emm_json TEXT, rating_data TEXT);
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO metadata VALUES ('version', '2.2');
    `)
    database.close()
    const report = await inspectLegacyThumbnailDatabase(path)
    expect(report.compatibility).toBe("legacy-upgrade-required")
    expect(report.issues.join("\n")).toContain("ai_translation")
    expect(report.issues.join("\n")).toContain("explicit backed-up migration")
  })

  it("keeps newer schemas read-only and rejects unrelated SQLite/files", async () => {
    const root = await temporaryRoot(roots)
    const newerPath = join(root, "newer.db")
    const newer = await openFixtureDatabase(newerPath)
    newer.exec(CURRENT_SCHEMA_SQL.replace("'2.4'", "'3.0'"))
    newer.close()
    expect((await inspectLegacyThumbnailDatabase(newerPath)).compatibility).toBe("newer-read-only")

    const unrelatedPath = join(root, "unrelated.db")
    const unrelated = await openFixtureDatabase(unrelatedPath)
    unrelated.exec("CREATE TABLE other (id INTEGER PRIMARY KEY)")
    unrelated.close()
    expect((await inspectLegacyThumbnailDatabase(unrelatedPath)).compatibility).toBe("incompatible")

    const corruptPath = join(root, "corrupt.db")
    await writeFile(corruptPath, "not sqlite", "utf8")
    const corrupt = await inspectLegacyThumbnailDatabase(corruptPath)
    expect(corrupt.compatibility).toBe("incompatible")
    expect(corrupt.issues[0]).toContain("read-only inspection failed")
  })
})

const CURRENT_SCHEMA_SQL = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  CREATE TABLE thumbs (
    key TEXT NOT NULL PRIMARY KEY,
    size INTEGER,
    date TEXT,
    ghash INTEGER,
    category TEXT DEFAULT 'file',
    value BLOB,
    emm_json TEXT,
    rating_data TEXT,
    ai_translation TEXT,
    manual_tags TEXT
  );
  CREATE INDEX idx_thumbs_key ON thumbs(key);
  CREATE INDEX idx_thumbs_category ON thumbs(category);
  CREATE INDEX idx_thumbs_date ON thumbs(date);
  CREATE TABLE failed_thumbnails (
    key TEXT NOT NULL PRIMARY KEY,
    reason TEXT NOT NULL,
    retry_count INTEGER DEFAULT 0,
    last_attempt TEXT,
    error_message TEXT
  );
  CREATE INDEX idx_failed_reason ON failed_thumbnails(reason);
  CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT);
  INSERT INTO metadata VALUES ('version', '2.4');
`

interface FixtureDatabase {
  exec(sql: string): void
  close(): void
}

async function openFixtureDatabase(path: string): Promise<FixtureDatabase> {
  if (process.versions.bun) {
    const moduleName = "bun:sqlite"
    const sqlite = await import(moduleName) as unknown as {
      Database: new (path: string, options: { create: boolean; strict: boolean }) => FixtureDatabase
    }
    return new sqlite.Database(path, { create: true, strict: true })
  }
  const moduleName = "node:sqlite"
  const sqlite = await import(moduleName) as typeof import("node:sqlite")
  return new sqlite.DatabaseSync(path)
}

async function temporaryRoot(roots: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-thumbnail-db-"))
  roots.push(root)
  return root
}
