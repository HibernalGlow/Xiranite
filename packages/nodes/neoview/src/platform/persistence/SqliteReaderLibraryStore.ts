import type { ViewSource } from "../../domain/book/book.js"
import type {
  ReaderBookmarkListRecord,
  ReaderBookmarkQuery,
  ReaderBookmarkRecord,
  ReaderLibraryStore,
  ReaderRecentQuery,
} from "../../ports/ReaderLibraryStore.js"
import type { ReaderProgressRecord } from "../../ports/ReaderProgressStore.js"
import { openWritableSqlite, type WritableSqliteConnection } from "../sqlite/openWritableSqlite.js"

export class SqliteReaderLibraryStore implements ReaderLibraryStore {
  #closed = false

  private constructor(private readonly database: WritableSqliteConnection) {}

  static async open(path: string): Promise<SqliteReaderLibraryStore> {
    const database = await openWritableSqlite(path, { create: true })
    try {
      database.exec(`
        PRAGMA busy_timeout = 250;
        CREATE TABLE IF NOT EXISTS xr_reader_progress (
          book_id TEXT PRIMARY KEY NOT NULL,
          source_json TEXT NOT NULL,
          display_name TEXT NOT NULL,
          page_index INTEGER NOT NULL,
          page_count INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS xr_reader_progress_updated_at_idx
          ON xr_reader_progress (updated_at DESC);
        CREATE TABLE IF NOT EXISTS xr_reader_bookmarks (
          id TEXT PRIMARY KEY NOT NULL,
          source_json TEXT NOT NULL,
          name TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('file', 'folder')),
          starred INTEGER NOT NULL DEFAULT 0 CHECK (starred IN (0, 1)),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS xr_reader_bookmarks_updated_at_idx
          ON xr_reader_bookmarks (updated_at DESC);
        CREATE TABLE IF NOT EXISTS xr_reader_bookmark_lists (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS xr_reader_bookmark_memberships (
          bookmark_id TEXT NOT NULL,
          list_id TEXT NOT NULL,
          PRIMARY KEY (bookmark_id, list_id)
        );
        CREATE INDEX IF NOT EXISTS xr_reader_bookmark_memberships_list_idx
          ON xr_reader_bookmark_memberships (list_id, bookmark_id);
        PRAGMA busy_timeout = 50;
      `)
      return new SqliteReaderLibraryStore(database)
    } catch (error) {
      database.close()
      throw error
    }
  }

  async listRecent(query: ReaderRecentQuery): Promise<readonly ReaderProgressRecord[]> {
    this.#assertOpen()
    return this.database.all(
      `SELECT book_id, source_json, display_name, page_index, page_count, updated_at
       FROM xr_reader_progress ORDER BY updated_at DESC, book_id ASC LIMIT ?1 OFFSET ?2`,
      query.limit,
      query.offset,
    ).map(parseProgress)
  }

  async deleteRecent(bookId: string): Promise<boolean> {
    this.#assertOpen()
    return this.#write(() => this.database.run("DELETE FROM xr_reader_progress WHERE book_id = ?1", bookId).changes > 0)
  }

  async clearRecentBefore(timestamp: number, limit: number): Promise<number> {
    this.#assertOpen()
    return this.#write(() => this.database.run(
      `DELETE FROM xr_reader_progress WHERE book_id IN (
         SELECT book_id FROM xr_reader_progress
         WHERE updated_at < ?1 ORDER BY updated_at ASC, book_id ASC LIMIT ?2
       )`,
      timestamp,
      limit,
    ).changes)
  }

  async listBookmarks(query: ReaderBookmarkQuery): Promise<readonly ReaderBookmarkRecord[]> {
    this.#assertOpen()
    const condition = bookmarkListCondition(query.listId)
    const rows = this.database.all(
      `SELECT id, source_json, name, kind, starred, created_at, updated_at
       FROM xr_reader_bookmarks b ${condition.sql}
       ORDER BY updated_at DESC, id ASC LIMIT ?${condition.bindings.length + 1} OFFSET ?${condition.bindings.length + 2}`,
      ...condition.bindings,
      query.limit,
      query.offset,
    )
    if (!rows.length) return []
    const ids = rows.map((row) => requireString(row.id, "bookmark id"))
    const placeholders = ids.map((_, index) => `?${index + 1}`).join(", ")
    const memberships = this.database.all(
      `SELECT bookmark_id, list_id FROM xr_reader_bookmark_memberships
       WHERE bookmark_id IN (${placeholders}) ORDER BY list_id ASC`,
      ...ids,
    )
    const listsByBookmark = new Map<string, string[]>()
    for (const row of memberships) {
      const bookmarkId = requireString(row.bookmark_id, "membership bookmark id")
      const listId = requireString(row.list_id, "membership list id")
      const list = listsByBookmark.get(bookmarkId) ?? []
      list.push(listId)
      listsByBookmark.set(bookmarkId, list)
    }
    return rows.map((row) => parseBookmark(row, listsByBookmark.get(requireString(row.id, "bookmark id")) ?? []))
  }

  async upsertBookmark(bookmark: ReaderBookmarkRecord): Promise<void> {
    this.#assertOpen()
    await this.#transaction(() => {
      this.database.run(
        `INSERT INTO xr_reader_bookmarks (id, source_json, name, kind, starred, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET source_json = excluded.source_json, name = excluded.name,
           kind = excluded.kind, starred = excluded.starred, updated_at = excluded.updated_at`,
        bookmark.id,
        JSON.stringify(bookmark.source),
        bookmark.name,
        bookmark.kind,
        bookmark.starred ? 1 : 0,
        bookmark.createdAt,
        bookmark.updatedAt,
      )
      this.database.run("DELETE FROM xr_reader_bookmark_memberships WHERE bookmark_id = ?1", bookmark.id)
      for (const listId of bookmark.listIds) {
        this.database.run(
          `INSERT OR IGNORE INTO xr_reader_bookmark_memberships (bookmark_id, list_id)
           SELECT ?1, id FROM xr_reader_bookmark_lists WHERE id = ?2`,
          bookmark.id,
          listId,
        )
      }
    })
  }

  async deleteBookmark(id: string): Promise<boolean> {
    this.#assertOpen()
    let deleted = false
    await this.#transaction(() => {
      this.database.run("DELETE FROM xr_reader_bookmark_memberships WHERE bookmark_id = ?1", id)
      deleted = this.database.run("DELETE FROM xr_reader_bookmarks WHERE id = ?1", id).changes > 0
    })
    return deleted
  }

  async listBookmarkLists(): Promise<readonly ReaderBookmarkListRecord[]> {
    this.#assertOpen()
    return this.database.all(
      `SELECT id, name, is_favorite, created_at, updated_at FROM xr_reader_bookmark_lists
       ORDER BY is_favorite DESC, created_at ASC, id ASC`,
    ).map(parseBookmarkList)
  }

  async upsertBookmarkList(list: ReaderBookmarkListRecord): Promise<void> {
    this.#assertOpen()
    await this.#write(() => {
      this.database.run(
        `INSERT INTO xr_reader_bookmark_lists (id, name, is_favorite, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name,
           is_favorite = excluded.is_favorite, updated_at = excluded.updated_at`,
        list.id,
        list.name,
        list.isFavorite ? 1 : 0,
        list.createdAt,
        list.updatedAt,
      )
    })
  }

  async deleteBookmarkList(id: string): Promise<boolean> {
    this.#assertOpen()
    let deleted = false
    await this.#transaction(() => {
      this.database.run("DELETE FROM xr_reader_bookmark_memberships WHERE list_id = ?1", id)
      deleted = this.database.run("DELETE FROM xr_reader_bookmark_lists WHERE id = ?1", id).changes > 0
    })
    return deleted
  }

  close(): Promise<void> {
    if (this.#closed) return Promise.resolve()
    this.#closed = true
    this.database.close()
    return Promise.resolve()
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }

  async #transaction(operation: () => void): Promise<void> {
    await this.#write(() => {
      this.database.exec("BEGIN IMMEDIATE")
      try {
        operation()
        this.database.exec("COMMIT")
      } catch (error) {
        try { this.database.exec("ROLLBACK") } catch { /* The original write error is authoritative. */ }
        throw error
      }
    })
  }

  async #write<T>(operation: () => T): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return operation()
      } catch (error) {
        if (!isBusyError(error) || attempt >= 3) throw error
        await delay(25 * (attempt + 1))
      }
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Reader library store is closed.")
  }
}

function bookmarkListCondition(listId: string | undefined): { sql: string; bindings: string[] } {
  if (!listId || listId === "all") return { sql: "", bindings: [] }
  if (listId === "favorites") return { sql: "WHERE b.starred = 1", bindings: [] }
  if (listId === "default") {
    return { sql: "WHERE NOT EXISTS (SELECT 1 FROM xr_reader_bookmark_memberships m WHERE m.bookmark_id = b.id)", bindings: [] }
  }
  return {
    sql: "WHERE EXISTS (SELECT 1 FROM xr_reader_bookmark_memberships m WHERE m.bookmark_id = b.id AND m.list_id = ?1)",
    bindings: [listId],
  }
}

function parseProgress(row: Record<string, unknown>): ReaderProgressRecord {
  return {
    bookId: requireString(row.book_id, "progress book id"),
    source: parseSource(row.source_json),
    displayName: requireString(row.display_name, "progress display name"),
    pageIndex: requireInteger(row.page_index, "progress page index"),
    pageCount: requireInteger(row.page_count, "progress page count"),
    updatedAt: requireInteger(row.updated_at, "progress updated time"),
  }
}

function parseBookmark(row: Record<string, unknown>, listIds: readonly string[]): ReaderBookmarkRecord {
  const kind = requireString(row.kind, "bookmark kind")
  if (kind !== "file" && kind !== "folder") throw new Error("Stored reader bookmark kind is invalid.")
  return {
    id: requireString(row.id, "bookmark id"),
    source: parseSource(row.source_json),
    name: requireString(row.name, "bookmark name"),
    kind,
    starred: requireBooleanInteger(row.starred, "bookmark starred"),
    createdAt: requireInteger(row.created_at, "bookmark created time"),
    updatedAt: requireInteger(row.updated_at, "bookmark updated time"),
    listIds,
  }
}

function parseBookmarkList(row: Record<string, unknown>): ReaderBookmarkListRecord {
  return {
    id: requireString(row.id, "bookmark list id"),
    name: requireString(row.name, "bookmark list name"),
    isFavorite: requireBooleanInteger(row.is_favorite, "bookmark list favorite"),
    createdAt: requireInteger(row.created_at, "bookmark list created time"),
    updatedAt: requireInteger(row.updated_at, "bookmark list updated time"),
  }
}

function parseSource(value: unknown): ViewSource {
  const source = JSON.parse(requireString(value, "source json")) as unknown
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("Stored reader source is invalid.")
  const candidate = source as Record<string, unknown>
  if (typeof candidate.path !== "string" || !candidate.path) throw new Error("Stored reader source path is invalid.")
  if (candidate.kind === "path" || candidate.kind === "directory" || candidate.kind === "image" || candidate.kind === "media") return candidate as unknown as ViewSource
  if (candidate.kind === "document" && (candidate.format === "pdf" || candidate.format === "epub")) return candidate as unknown as ViewSource
  if (candidate.kind === "archive"
    && (candidate.entryPath === undefined || typeof candidate.entryPath === "string")
    && (candidate.entryPaths === undefined || (Array.isArray(candidate.entryPaths) && candidate.entryPaths.every((entry) => typeof entry === "string")))) {
    return candidate as unknown as ViewSource
  }
  throw new Error("Stored reader source is invalid.")
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) throw new Error(`Stored reader ${name} is invalid.`)
  return value
}

function requireInteger(value: unknown, name: string): number {
  if (typeof value === "bigint") value = Number(value)
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`Stored reader ${name} is invalid.`)
  return value
}

function requireBooleanInteger(value: unknown, name: string): boolean {
  const integer = requireInteger(value, name)
  if (integer !== 0 && integer !== 1) throw new Error(`Stored reader ${name} is invalid.`)
  return integer === 1
}

function isBusyError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const code = "code" in error ? String(error.code) : ""
  const message = "message" in error ? String(error.message) : ""
  return code === "SQLITE_BUSY" || code === "SQLITE_LOCKED" || /database (?:is )?(?:busy|locked)/i.test(message)
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
