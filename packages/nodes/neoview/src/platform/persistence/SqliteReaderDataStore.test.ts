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

  it("[neoview.media-progress.sqlite] persists runtime playback state without modifying legacy schema metadata", async () => {
    const { path } = await fixture()
    const store = await SqliteReaderDataStore.open(path)
    await store.saveMediaProgress({
      bookId: "video-book",
      position: 12.5,
      duration: 100,
      completed: false,
      updatedAt: 200,
    })
    await store.saveMediaProgress({
      bookId: "video-book",
      position: 1,
      duration: 100,
      completed: false,
      updatedAt: 100,
    })
    await expect(store.getMediaProgress("video-book")).resolves.toEqual({
      bookId: "video-book",
      position: 12.5,
      duration: 100,
      completed: false,
      updatedAt: 200,
    })
    await expect(store.saveMediaProgress({
      bookId: "video-book",
      position: 101,
      duration: 100,
      completed: false,
      updatedAt: 300,
    })).rejects.toThrow("position/duration")
    await store.close()

    const report = await inspectLegacyThumbnailDatabase(path)
    expect(report).toMatchObject({ compatibility: "current", metadataVersion: "2.4", userVersion: 7 })
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

  it("[neoview.folder.sort-sqlite] persists global, tab and normalized folder rules without touching legacy rows", async () => {
    const { path } = await fixture()
    const store = await SqliteReaderDataStore.open(path)
    const globalSort = { field: "date" as const, order: "desc" as const, directoriesFirst: true }
    const tabSort = { field: "size" as const, order: "desc" as const, directoriesFirst: true }
    const folderSort = { field: "type" as const, order: "asc" as const, directoriesFirst: true }
    await store.setGlobalDefault(globalSort)
    await store.setTabDefault("tab-1", tabSort)
    await store.setFolderRule("d:/books", "D:/Books", folderSort, 100)
    await expect(store.getGlobalDefault()).resolves.toEqual(globalSort)
    await expect(store.getTabDefault("tab-1")).resolves.toEqual(tabSort)
    await expect(store.getFolderRule("d:/books")).resolves.toEqual(folderSort)
    await expect(store.clearFolderRules("d:/books")).resolves.toBe(1)
    await expect(store.getFolderRule("d:/books")).resolves.toBeUndefined()
    await store.close()

    const verified = await openFixtureDatabase(path)
    expect(verified.get("SELECT COUNT(*) AS count FROM thumbs WHERE key = 'D:/cover.jpg'")).toEqual({ count: 1 })
    expect(verified.get("SELECT COUNT(*) AS count FROM xr_reader_folder_sort_defaults")).toEqual({ count: 2 })
    verified.close()
  })

  it("[neoview.folder.search-history-sqlite] deduplicates, bounds and removes scoped history without changing legacy schema", async () => {
    const { path } = await fixture()
    const before = await openFixtureDatabase(path)
    const legacyObjects = before.all("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
    const journalMode = before.get("PRAGMA journal_mode")
    before.close()

    const store = await SqliteReaderDataStore.open(path)
    await store.recordSearchHistory({ scope: "folder", query: "a", usedAt: 100 }, 20)
    await store.recordSearchHistory({ scope: "folder", query: "b", usedAt: 200 }, 20)
    await expect(store.recordSearchHistory({ scope: "folder", query: "a", usedAt: 300 }, 20)).resolves.toEqual({
      scope: "folder", query: "a", usedAt: 300, useCount: 2,
    })
    await expect(store.listSearchHistory("folder", 20)).resolves.toEqual([
      { scope: "folder", query: "a", usedAt: 300, useCount: 2 },
      { scope: "folder", query: "b", usedAt: 200, useCount: 1 },
    ])
    for (let index = 0; index < 25; index += 1) {
      await store.recordSearchHistory({ scope: "file", query: `query-${index}`, usedAt: 1_000 + index }, 20)
    }
    const bounded = await store.listSearchHistory("file", 100)
    expect(bounded).toHaveLength(20)
    expect(bounded[0]?.query).toBe("query-24")
    expect(bounded.at(-1)?.query).toBe("query-5")
    await expect(store.deleteSearchHistory("folder", "b")).resolves.toBe(true)
    await expect(store.clearSearchHistory("file")).resolves.toBe(20)
    await expect(store.listSearchHistory("file", 20)).resolves.toEqual([])
    await store.close()

    const verified = await openFixtureDatabase(path)
    expect(verified.get("SELECT category, hex(value) AS value, emm_json FROM thumbs WHERE key = 'D:/cover.jpg'"))
      .toEqual({ category: "file", value: "00", emm_json: "legacy" })
    expect(verified.get("SELECT value FROM metadata WHERE key = 'version'")).toEqual({ value: "2.4" })
    expect(verified.get("PRAGMA user_version")).toEqual({ user_version: 7 })
    expect(verified.get("PRAGMA journal_mode")).toEqual(journalMode)
    const afterObjects = verified.all("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE 'xr_%' ORDER BY type, name")
    expect(afterObjects).toEqual(legacyObjects)
    expect(verified.all("SELECT type, name FROM sqlite_master WHERE name IN ('xr_reader_search_history', 'xr_reader_search_history_scope_used_idx') ORDER BY type, name"))
      .toEqual([
        { type: "index", name: "xr_reader_search_history_scope_used_idx" },
        { type: "table", name: "xr_reader_search_history" },
      ])
    verified.close()
  })

  it("[neoview.folder.emm-sqlite-batch] reads legacy EMM business columns without decoding thumbnail blobs", async () => {
    const { path } = await fixture()
    const seeded = await openFixtureDatabase(path)
    seeded.exec(`
      UPDATE thumbs SET rating_data = '{"value":4.7}', emm_json = '{"rating":3.0,"tags":[]}', manual_tags = '[{"namespace":"manual","tag":"keep","timestamp":1}]' WHERE key = 'D:/cover.jpg';
      INSERT INTO thumbs (key, category, value, emm_json) VALUES ('D:/other.cbz', 'file', X'00', '{"rating":2.5,"tags":[]}');
    `)
    seeded.close()
    const store = await SqliteReaderDataStore.open(path)
    expect(store.directoryEmmAvailable).toBe(true)
    await expect(store.readDirectoryEmmRecords(["D:/cover.jpg", "D:/other.cbz", "D:/missing.cbz"])).resolves.toEqual(new Map([
      ["D:/cover.jpg", { ratingData: '{"value":4.7}', emmJson: '{"rating":3.0,"tags":[]}', manualTags: '[{"namespace":"manual","tag":"keep","timestamp":1}]' }],
      ["D:/other.cbz", { ratingData: undefined, emmJson: '{"rating":2.5,"tags":[]}', manualTags: undefined }],
    ]))
    await store.close()
  })

  it("[neoview.folder.emm-legacy-columns] reads older EMM rows without adding manual_tags", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-reader-emm-legacy-"))
    directories.push(directory)
    const path = join(directory, "thumbnails.db")
    const database = await openFixtureDatabase(path)
    database.exec(`
      CREATE TABLE thumbs (key TEXT PRIMARY KEY, rating_data TEXT, emm_json TEXT);
      INSERT INTO thumbs (key, rating_data, emm_json) VALUES ('D:/old.cbz', '{"value":4.1}', '{"tags":[]}');
    `)
    database.close()
    const store = await SqliteReaderDataStore.open(path)
    await expect(store.readDirectoryEmmRecords(["D:/old.cbz"])).resolves.toEqual(new Map([
      ["D:/old.cbz", { ratingData: '{"value":4.1}', emmJson: '{"tags":[]}', manualTags: undefined }],
    ]))
    await store.close()
    const verified = await openFixtureDatabase(path)
    expect(verified.get("SELECT COUNT(*) AS count FROM pragma_table_info('thumbs') WHERE name = 'manual_tags'")).toEqual({ count: 0 })
    verified.close()
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
  all(sql: string): Record<string, unknown>[]
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
    return {
      exec: (sql) => database.exec(sql),
      get: (sql) => database.query(sql).get() ?? undefined,
      all: (sql) => database.query(sql).all() as Record<string, unknown>[],
      close: () => database.close(),
    }
  }
  const moduleName = "node:sqlite"
  const sqlite = await import(moduleName) as typeof import("node:sqlite")
  const database = new sqlite.DatabaseSync(path)
  return {
    exec: (sql) => database.exec(sql),
    get: (sql) => database.prepare(sql).get() as Record<string, unknown> | undefined,
    all: (sql) => database.prepare(sql).all() as Record<string, unknown>[],
    close: () => database.close(),
  }
}
