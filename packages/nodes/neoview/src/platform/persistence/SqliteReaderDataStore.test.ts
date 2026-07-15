import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { inspectLegacyThumbnailDatabase } from "../thumbnails/LegacyThumbnailDatabaseInspector.js"
import { SqliteReaderDataStore } from "./SqliteReaderDataStore.js"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("SqliteReaderDataStore", () => {
  it("[neoview.progress.sqlite] [neoview.library.sqlite] reuses progress for recents and preserves the legacy database", async () => {
    const { path } = await fixture()
    const store = await SqliteReaderDataStore.open(path)
    await store.save({
      bookId: "older",
      source: { kind: "directory", path: "D:/old" },
      displayName: "Old",
      pageIndex: 1,
      pageCount: 10,
      updatedAt: 100,
    })
    await store.save({
      bookId: "newer",
      source: { kind: "archive", path: "D:/new.cbz" },
      displayName: "New",
      pageIndex: 2,
      pageCount: 20,
      updatedAt: 200,
    })

    await expect(store.get("newer")).resolves.toEqual({
      bookId: "newer",
      source: { kind: "archive", path: "D:/new.cbz" },
      displayName: "New",
      pageIndex: 2,
      pageCount: 20,
      updatedAt: 200,
    })
    await expect(store.listRecent({ limit: 1, offset: 0 })).resolves.toEqual([
      expect.objectContaining({ bookId: "newer", displayName: "New", pageIndex: 2 }),
    ])
    await expect(store.clearRecentBefore(150, 10)).resolves.toBe(1)
    await expect(store.deleteRecent("newer")).resolves.toBe(true)
    await store.close()
    await store.close()

    const report = await inspectLegacyThumbnailDatabase(path)
    expect(report).toMatchObject({ compatibility: "current", metadataVersion: "2.4", userVersion: 7 })
    const verified = await openFixtureDatabase(path)
    expect(verified.get("SELECT category, value, emm_json FROM thumbs WHERE key = 'D:/cover.jpg'"))
      .toEqual({ category: "file", value: Uint8Array.of(0), emm_json: "legacy" })
    verified.close()
  })

  it("[neoview.library.bookmarks] stores normalized lists and filters synthetic views", async () => {
    const { path } = await fixture()
    const store = await SqliteReaderDataStore.open(path)
    await store.upsertBookmarkList({ id: "reading", name: "Reading", isFavorite: true, createdAt: 1, updatedAt: 1 })
    await store.upsertBookmark(bookmark("one", false, ["default"]))
    await store.upsertBookmark(bookmark("two", false, ["reading", "missing"]))

    await expect(store.listBookmarkLists()).resolves.toEqual([
      { id: "reading", name: "Reading", isFavorite: true, createdAt: 1, updatedAt: 1 },
    ])
    await expect(store.listBookmarks({ listId: "default", limit: 10, offset: 0 })).resolves.toEqual([
      expect.objectContaining({ id: "one", listIds: ["default"] }),
    ])
    await expect(store.listBookmarks({ listId: "favorites", limit: 10, offset: 0 })).resolves.toEqual([
      expect.objectContaining({ id: "two", starred: false, listIds: ["reading"] }),
    ])
    await expect(store.listBookmarks({ listId: "reading", limit: 10, offset: 0 })).resolves.toHaveLength(1)
    await expect(store.deleteBookmarkList("reading")).resolves.toBe(true)
    await expect(store.listBookmarks({ listId: "default", limit: 10, offset: 0 })).resolves.toHaveLength(2)
    await expect(store.deleteBookmark("one")).resolves.toBe(true)
    await store.close()
  })

  it("[neoview.reader-data.sqlite-import] atomically merges newer rows and preserves migration-only data", async () => {
    const { path } = await fixture()
    const store = await SqliteReaderDataStore.open(path)
    const batch = {
      progress: [{
        bookId: "book-import",
        source: { kind: "archive", path: "D:/outer.cbz", entryPaths: ["nested.cbz"] } as const,
        displayName: "Nested",
        pageIndex: 4,
        pageCount: 10,
        updatedAt: 200,
      }],
      bookmarkLists: [{ id: "reading", name: "Reading", isFavorite: true, createdAt: 100, updatedAt: 100 }],
      bookmarks: [{
        id: "bookmark-import",
        source: { kind: "path", path: "D:/outer.cbz" } as const,
        name: "Outer",
        kind: "file" as const,
        starred: false,
        createdAt: 100,
        updatedAt: 100,
        listIds: ["default", "reading"],
      }],
      pathStacks: [{
        bookId: "book-import",
        pathStack: [{ path: "D:/outer.cbz" }, { path: "D:/outer.cbz", innerPath: "nested.cbz" }],
        updatedAt: 200,
      }],
      mediaProgress: [{ bookId: "book-import", position: 12, duration: 30, completed: false, updatedAt: 200 }],
    }
    await expect(store.importData(batch, "merge")).resolves.toEqual({
      progress: 1, bookmarks: 1, bookmarkLists: 1, pathStacks: 1, mediaProgress: 1,
    })
    await expect(store.importData(batch, "merge")).resolves.toEqual({
      progress: 0, bookmarks: 0, bookmarkLists: 0, pathStacks: 0, mediaProgress: 0,
    })
    await store.close()

    const database = await openFixtureDatabase(path)
    expect(database.get("SELECT page_index, updated_at FROM xr_reader_progress WHERE book_id = 'book-import'"))
      .toEqual({ page_index: 4, updated_at: 200 })
    expect(database.get("SELECT path_stack_json FROM xr_reader_path_stacks WHERE book_id = 'book-import'"))
      .toEqual({ path_stack_json: JSON.stringify(batch.pathStacks[0]!.pathStack) })
    expect(database.get("SELECT position, duration, completed FROM xr_reader_media_progress WHERE book_id = 'book-import'"))
      .toEqual({ position: 12, duration: 30, completed: 0 })
    expect(database.get("SELECT COUNT(*) AS count FROM xr_reader_bookmark_memberships WHERE bookmark_id = 'bookmark-import'"))
      .toEqual({ count: 2 })
    database.close()
  })
})

function bookmark(id: string, starred: boolean, listIds: readonly string[]) {
  return {
    id,
    source: { kind: "image", path: `D:/${id}.jpg` } as const,
    name: id,
    kind: "file" as const,
    starred,
    createdAt: 100,
    updatedAt: id === "one" ? 100 : 200,
    listIds,
  }
}

async function fixture(): Promise<{ path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "xiranite-reader-library-"))
  directories.push(directory)
  const path = join(directory, "thumbnails.db")
  const database = await openFixtureDatabase(path)
  database.exec(CURRENT_SCHEMA_SQL)
  database.close()
  return { path }
}

const CURRENT_SCHEMA_SQL = `
  PRAGMA journal_mode = WAL;
  PRAGMA user_version = 7;
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
  INSERT INTO thumbs (key, category, value, emm_json) VALUES ('D:/cover.jpg', 'file', X'00', 'legacy');
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
