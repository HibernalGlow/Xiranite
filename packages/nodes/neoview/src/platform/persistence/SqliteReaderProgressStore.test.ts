import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { SqliteReaderProgressStore } from "./SqliteReaderProgressStore.js"
import { inspectLegacyThumbnailDatabase } from "../thumbnails/LegacyThumbnailDatabaseInspector.js"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("SqliteReaderProgressStore", () => {
  it("[neoview.progress.sqlite] persists progress in the existing NeoView database", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-reader-progress-"))
    directories.push(directory)
    const path = join(directory, "thumbnails.db")
    const fixture = await openFixtureDatabase(path)
    fixture.exec(CURRENT_SCHEMA_SQL)
    fixture.exec("PRAGMA user_version = 7; INSERT INTO thumbs (key, category, value, emm_json) VALUES ('D:/cover.jpg', 'file', X'00', 'legacy');")
    fixture.close()
    const first = await SqliteReaderProgressStore.open(path)
    await first.save({
      bookId: "book-1",
      source: { kind: "archive", path: "D:/books/demo.cbz", entryPaths: ["nested.cbz"] },
      displayName: "demo.cbz",
      pageIndex: 17,
      pageCount: 100,
      updatedAt: 1234,
    })
    await first.close()

    const reopened = await SqliteReaderProgressStore.open(path)
    await expect(reopened.get("book-1")).resolves.toEqual({
      bookId: "book-1",
      source: { kind: "archive", path: "D:/books/demo.cbz", entryPaths: ["nested.cbz"] },
      displayName: "demo.cbz",
      pageIndex: 17,
      pageCount: 100,
      updatedAt: 1234,
    })
    await reopened.save({
      bookId: "book-1",
      source: { kind: "archive", path: "D:/books/demo.cbz", entryPaths: ["nested.cbz"] },
      displayName: "demo.cbz",
      pageIndex: 18,
      pageCount: 100,
      updatedAt: 2345,
    })
    expect((await reopened.get("book-1"))?.pageIndex).toBe(18)
    await reopened.close()

    const report = await inspectLegacyThumbnailDatabase(path)
    expect(report).toMatchObject({ compatibility: "current", metadataVersion: "2.4", userVersion: 7 })
    const verified = await openFixtureDatabase(path)
    expect(verified.get("SELECT category, value, emm_json FROM thumbs WHERE key = 'D:/cover.jpg'"))
      .toEqual({ category: "file", value: Uint8Array.of(0), emm_json: "legacy" })
    expect(verified.get("SELECT COUNT(*) AS count FROM xr_reader_progress")).toEqual({ count: 1 })
    verified.close()
  })
})

const CURRENT_SCHEMA_SQL = `
  PRAGMA journal_mode = WAL;
  CREATE TABLE thumbs (
    key TEXT NOT NULL PRIMARY KEY, size INTEGER, date TEXT, ghash INTEGER,
    category TEXT DEFAULT 'file', value BLOB, emm_json TEXT, rating_data TEXT,
    ai_translation TEXT, manual_tags TEXT
  );
  CREATE INDEX idx_thumbs_key ON thumbs(key);
  CREATE INDEX idx_thumbs_category ON thumbs(category);
  CREATE INDEX idx_thumbs_date ON thumbs(date);
  CREATE TABLE failed_thumbnails (
    key TEXT NOT NULL PRIMARY KEY, reason TEXT NOT NULL, retry_count INTEGER DEFAULT 0,
    last_attempt TEXT, error_message TEXT
  );
  CREATE INDEX idx_failed_reason ON failed_thumbnails(reason);
  CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT);
  INSERT INTO metadata VALUES ('version', '2.4');
`

interface FixtureDatabase {
  exec(sql: string): void
  get(sql: string): Record<string, unknown> | undefined
  close(): void
}

async function openFixtureDatabase(path: string): Promise<FixtureDatabase> {
  if (process.versions.bun) {
    const moduleName = "bun:sqlite"
    const sqlite = await import(moduleName) as unknown as {
      Database: new (path: string, options: { create: boolean; strict: boolean }) => {
        exec(sql: string): void
        query(sql: string): { get(): Record<string, unknown> | null }
        close(): void
      }
    }
    const database = new sqlite.Database(path, { create: true, strict: true })
    return { exec: (sql) => database.exec(sql), get: (sql) => database.query(sql).get() ?? undefined, close: () => database.close() }
  }
  const moduleName = "node:sqlite"
  const sqlite = await import(moduleName) as typeof import("node:sqlite")
  const database = new sqlite.DatabaseSync(path)
  return {
    exec: (sql) => database.exec(sql),
    get: (sql) => database.prepare(sql).get() as Record<string, unknown> | undefined,
    close: () => database.close(),
  }
}
