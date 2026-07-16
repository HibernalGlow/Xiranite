import { scheduler } from "node:timers/promises"
import { z } from "zod"

import type { ViewSource } from "../../domain/book/book.js"
import type {
  ReaderBookmarkListRecord,
  ReaderBookmarkQuery,
  ReaderBookmarkRecord,
  ReaderRecentQuery,
} from "../../ports/ReaderLibraryStore.js"
import type { ReaderDataImportBatch, ReaderDataImportResult, ReaderDataStore } from "../../ports/ReaderDataStore.js"
import type { ReaderProgressRecord } from "../../ports/ReaderProgressStore.js"
import type { ReaderMediaProgressRecord } from "../../ports/ReaderMediaProgressStore.js"
import type { ReaderSearchHistoryRecord } from "../../ports/ReaderSearchHistoryStore.js"
import type { ReaderFileUndoJournalRecord } from "../../ports/ReaderFileUndoJournalStore.js"
import {
  isReaderDirectorySortField,
  type ReaderDirectorySortRule,
} from "../../application/browser/ReaderDirectorySort.js"
import type { ReaderDirectorySortPreferenceStore } from "../../application/browser/ReaderDirectorySortPreferences.js"
import type {
  ReaderDirectoryEmmRecord,
  ReaderDirectoryEmmRecordStore,
} from "../../ports/ReaderDirectoryEmmRecordStore.js"
import { openWritableSqlite, type WritableSqliteConnection } from "../sqlite/openWritableSqlite.js"

const GLOBAL_SORT_SCOPE = "__global__"
const MAX_FOLDER_SORT_RULES = 1_000

export class SqliteReaderDataStore implements ReaderDataStore, ReaderDirectorySortPreferenceStore, ReaderDirectoryEmmRecordStore {
  readonly directoryEmmAvailable: boolean
  readonly #directoryRatingDataAvailable: boolean
  readonly #directoryManualTagsAvailable: boolean
  #closed = false

  private constructor(private readonly database: WritableSqliteConnection) {
    const columns = new Set(database.all("PRAGMA table_info(thumbs)").flatMap((row) => typeof row.name === "string" ? [row.name] : []))
    this.directoryEmmAvailable = columns.has("key") && columns.has("emm_json")
    this.#directoryRatingDataAvailable = columns.has("rating_data")
    this.#directoryManualTagsAvailable = columns.has("manual_tags")
  }

  static async open(path: string): Promise<SqliteReaderDataStore> {
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
        CREATE TABLE IF NOT EXISTS xr_reader_path_stacks (
          book_id TEXT PRIMARY KEY NOT NULL,
          path_stack_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS xr_reader_media_progress (
          book_id TEXT PRIMARY KEY NOT NULL,
          position REAL NOT NULL,
          duration REAL NOT NULL,
          completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS xr_reader_folder_sort_defaults (
          scope_id TEXT PRIMARY KEY NOT NULL,
          sort_field TEXT NOT NULL,
          sort_order TEXT NOT NULL CHECK (sort_order IN ('asc', 'desc')),
          directories_first INTEGER NOT NULL DEFAULT 1 CHECK (directories_first IN (0, 1)),
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS xr_reader_folder_sort_rules (
          path_key TEXT PRIMARY KEY NOT NULL,
          display_path TEXT NOT NULL,
          sort_field TEXT NOT NULL,
          sort_order TEXT NOT NULL CHECK (sort_order IN ('asc', 'desc')),
          directories_first INTEGER NOT NULL DEFAULT 1 CHECK (directories_first IN (0, 1)),
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS xr_reader_folder_sort_rules_updated_idx
          ON xr_reader_folder_sort_rules (updated_at DESC, path_key ASC);
        CREATE TABLE IF NOT EXISTS xr_reader_search_history (
          scope_id TEXT NOT NULL,
          query TEXT NOT NULL,
          used_at INTEGER NOT NULL,
          use_count INTEGER NOT NULL DEFAULT 1 CHECK (use_count >= 1),
          PRIMARY KEY (scope_id, query)
        );
        CREATE INDEX IF NOT EXISTS xr_reader_search_history_scope_used_idx
          ON xr_reader_search_history (scope_id, used_at DESC, query ASC);
        CREATE TABLE IF NOT EXISTS xr_reader_file_undo_transactions (
          id TEXT PRIMARY KEY NOT NULL,
          created_at INTEGER NOT NULL,
          entries_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS xr_reader_file_undo_created_idx
          ON xr_reader_file_undo_transactions (created_at DESC, id DESC);
        PRAGMA busy_timeout = 50;
      `)
      return new SqliteReaderDataStore(database)
    } catch (error) {
      database.close()
      throw error
    }
  }

  async get(bookId: string): Promise<ReaderProgressRecord | undefined> {
    this.#assertOpen()
    const row = this.database.get(
      `SELECT book_id, source_json, display_name, page_index, page_count, updated_at
       FROM xr_reader_progress WHERE book_id = ?1`,
      bookId,
    )
    return row ? parseProgress(row) : undefined
  }

  async save(progress: ReaderProgressRecord): Promise<void> {
    this.#assertOpen()
    assertProgress(progress)
    await this.#write(() => {
      this.database.run(
        `INSERT INTO xr_reader_progress (
           book_id, source_json, display_name, page_index, page_count, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(book_id) DO UPDATE SET
           source_json = excluded.source_json,
           display_name = excluded.display_name,
           page_index = excluded.page_index,
           page_count = excluded.page_count,
           updated_at = excluded.updated_at`,
        progress.bookId,
        JSON.stringify(progress.source),
        progress.displayName,
        progress.pageIndex,
        progress.pageCount,
        progress.updatedAt,
      )
    })
  }

  async getMediaProgress(bookId: string): Promise<ReaderMediaProgressRecord | undefined> {
    this.#assertOpen()
    assertText(bookId, "media progress bookId")
    const row = this.database.get(
      `SELECT book_id, position, duration, completed, updated_at
       FROM xr_reader_media_progress WHERE book_id = ?1`,
      bookId,
    )
    return row ? parseMediaProgress(row) : undefined
  }

  async saveMediaProgress(progress: ReaderMediaProgressRecord): Promise<void> {
    this.#assertOpen()
    assertMediaProgress(progress)
    await this.#write(() => {
      this.database.run(
        `INSERT INTO xr_reader_media_progress (book_id, position, duration, completed, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(book_id) DO UPDATE SET position = excluded.position, duration = excluded.duration,
           completed = excluded.completed, updated_at = excluded.updated_at
         WHERE excluded.updated_at >= xr_reader_media_progress.updated_at`,
        progress.bookId,
        progress.position,
        progress.duration,
        progress.completed ? 1 : 0,
        progress.updatedAt,
      )
    })
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

  async findBookmarkByPath(path: string): Promise<ReaderBookmarkRecord | undefined> {
    this.#assertOpen()
    const normalizedPath = normalizeBookmarkPath(path)
    const row = this.database.get(
      `SELECT id, source_json, name, kind, starred, created_at, updated_at
       FROM xr_reader_bookmarks
       WHERE lower(replace(json_extract(source_json, '$.path'), char(92), '/')) = ?1
       ORDER BY updated_at DESC, id ASC LIMIT 1`,
      normalizedPath,
    )
    if (!row) return undefined
    const id = requireString(row.id, "bookmark id")
    const memberships = this.database.all(
      "SELECT list_id FROM xr_reader_bookmark_memberships WHERE bookmark_id = ?1 ORDER BY list_id ASC",
      id,
    ).map((entry) => requireString(entry.list_id, "membership list id"))
    return parseBookmark(row, memberships)
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
        if (listId === "default") {
          this.database.run(
            "INSERT OR IGNORE INTO xr_reader_bookmark_memberships (bookmark_id, list_id) VALUES (?1, 'default')",
            bookmark.id,
          )
        } else {
          this.database.run(
            `INSERT OR IGNORE INTO xr_reader_bookmark_memberships (bookmark_id, list_id)
             SELECT ?1, id FROM xr_reader_bookmark_lists WHERE id = ?2`,
            bookmark.id,
            listId,
          )
        }
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

  async getGlobalDefault(): Promise<ReaderDirectorySortRule | undefined> {
    this.#assertOpen()
    return parseDirectorySort(this.database.get(
      `SELECT sort_field, sort_order, directories_first
       FROM xr_reader_folder_sort_defaults WHERE scope_id = ?1`,
      GLOBAL_SORT_SCOPE,
    ))
  }

  async setGlobalDefault(sort: ReaderDirectorySortRule): Promise<void> {
    await this.#setSortDefault(GLOBAL_SORT_SCOPE, sort)
  }

  async getTabDefault(scopeId: string): Promise<ReaderDirectorySortRule | undefined> {
    this.#assertOpen()
    return parseDirectorySort(this.database.get(
      `SELECT sort_field, sort_order, directories_first
       FROM xr_reader_folder_sort_defaults WHERE scope_id = ?1`,
      requireSortIdentity(scopeId, "sort scope"),
    ))
  }

  async setTabDefault(scopeId: string, sort: ReaderDirectorySortRule): Promise<void> {
    await this.#setSortDefault(requireSortIdentity(scopeId, "sort scope"), sort)
  }

  async getFolderRule(pathKey: string): Promise<ReaderDirectorySortRule | undefined> {
    this.#assertOpen()
    return parseDirectorySort(this.database.get(
      `SELECT sort_field, sort_order, directories_first
       FROM xr_reader_folder_sort_rules WHERE path_key = ?1`,
      requireSortIdentity(pathKey, "folder sort path key"),
    ))
  }

  async setFolderRule(
    pathKey: string,
    path: string,
    sort: ReaderDirectorySortRule,
    updatedAt: number,
  ): Promise<void> {
    this.#assertOpen()
    assertDirectorySort(sort)
    if (!Number.isSafeInteger(updatedAt) || updatedAt < 0) throw new Error("Folder sort updatedAt is invalid.")
    await this.#transaction(() => {
      this.database.run(
        `INSERT INTO xr_reader_folder_sort_rules (
           path_key, display_path, sort_field, sort_order, directories_first, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(path_key) DO UPDATE SET display_path = excluded.display_path,
           sort_field = excluded.sort_field, sort_order = excluded.sort_order,
           directories_first = excluded.directories_first, updated_at = excluded.updated_at`,
        requireSortIdentity(pathKey, "folder sort path key"),
        requireSortIdentity(path, "folder sort display path"),
        sort.field,
        sort.order,
        sort.directoriesFirst ? 1 : 0,
        updatedAt,
      )
      this.database.run(
        `DELETE FROM xr_reader_folder_sort_rules WHERE path_key IN (
           SELECT path_key FROM xr_reader_folder_sort_rules
           ORDER BY updated_at DESC, path_key ASC LIMIT -1 OFFSET ?1
         )`,
        MAX_FOLDER_SORT_RULES,
      )
    })
  }

  async clearFolderRules(pathKey?: string): Promise<number> {
    this.#assertOpen()
    return this.#write(() => pathKey
      ? this.database.run(
          "DELETE FROM xr_reader_folder_sort_rules WHERE path_key = ?1",
          requireSortIdentity(pathKey, "folder sort path key"),
        ).changes
      : this.database.run("DELETE FROM xr_reader_folder_sort_rules").changes)
  }

  async importData(batch: ReaderDataImportBatch, strategy: "merge" | "overwrite"): Promise<ReaderDataImportResult> {
    this.#assertOpen()
    const result: ReaderDataImportResult = { progress: 0, bookmarks: 0, bookmarkLists: 0, pathStacks: 0, mediaProgress: 0 }
    await this.#transaction(() => {
      if (strategy === "overwrite") {
        this.database.run("DELETE FROM xr_reader_bookmark_memberships")
        this.database.run("DELETE FROM xr_reader_bookmarks")
        this.database.run("DELETE FROM xr_reader_bookmark_lists")
        this.database.run("DELETE FROM xr_reader_path_stacks")
        this.database.run("DELETE FROM xr_reader_media_progress")
        this.database.run("DELETE FROM xr_reader_progress")
      }
      for (const list of batch.bookmarkLists) {
        result.bookmarkLists += this.database.run(
          `INSERT INTO xr_reader_bookmark_lists (id, name, is_favorite, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, is_favorite = excluded.is_favorite,
             updated_at = excluded.updated_at WHERE excluded.updated_at > xr_reader_bookmark_lists.updated_at`,
          list.id, list.name, list.isFavorite ? 1 : 0, list.createdAt, list.updatedAt,
        ).changes
      }
      for (const progress of batch.progress) {
        assertProgress(progress)
        result.progress += this.database.run(
          `INSERT INTO xr_reader_progress (book_id, source_json, display_name, page_index, page_count, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)
           ON CONFLICT(book_id) DO UPDATE SET source_json = excluded.source_json,
             display_name = excluded.display_name, page_index = excluded.page_index,
             page_count = excluded.page_count, updated_at = excluded.updated_at
           WHERE excluded.updated_at > xr_reader_progress.updated_at`,
          progress.bookId, JSON.stringify(progress.source), progress.displayName,
          progress.pageIndex, progress.pageCount, progress.updatedAt,
        ).changes
      }
      for (const bookmark of batch.bookmarks) {
        const bookmarkChanged = this.database.run(
          `INSERT INTO xr_reader_bookmarks (id, source_json, name, kind, starred, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
           ON CONFLICT(id) DO UPDATE SET source_json = excluded.source_json, name = excluded.name,
             kind = excluded.kind, starred = excluded.starred, updated_at = excluded.updated_at
           WHERE excluded.updated_at > xr_reader_bookmarks.updated_at`,
          bookmark.id, JSON.stringify(bookmark.source), bookmark.name, bookmark.kind,
          bookmark.starred ? 1 : 0, bookmark.createdAt, bookmark.updatedAt,
        ).changes
        result.bookmarks += bookmarkChanged
        if (!bookmarkChanged) continue
        this.database.run("DELETE FROM xr_reader_bookmark_memberships WHERE bookmark_id = ?1", bookmark.id)
        for (const listId of bookmark.listIds) {
          if (listId === "default") {
            this.database.run(
              "INSERT OR IGNORE INTO xr_reader_bookmark_memberships (bookmark_id, list_id) VALUES (?1, 'default')",
              bookmark.id,
            )
          } else {
            this.database.run(
              `INSERT OR IGNORE INTO xr_reader_bookmark_memberships (bookmark_id, list_id)
               SELECT ?1, id FROM xr_reader_bookmark_lists WHERE id = ?2`,
              bookmark.id, listId,
            )
          }
        }
      }
      for (const item of batch.pathStacks) {
        result.pathStacks += this.database.run(
          `INSERT INTO xr_reader_path_stacks (book_id, path_stack_json, updated_at) VALUES (?1, ?2, ?3)
           ON CONFLICT(book_id) DO UPDATE SET path_stack_json = excluded.path_stack_json,
             updated_at = excluded.updated_at WHERE excluded.updated_at > xr_reader_path_stacks.updated_at`,
          item.bookId, JSON.stringify(item.pathStack), item.updatedAt,
        ).changes
      }
      for (const item of batch.mediaProgress) {
        result.mediaProgress += this.database.run(
          `INSERT INTO xr_reader_media_progress (book_id, position, duration, completed, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT(book_id) DO UPDATE SET position = excluded.position, duration = excluded.duration,
             completed = excluded.completed, updated_at = excluded.updated_at
           WHERE excluded.updated_at > xr_reader_media_progress.updated_at`,
          item.bookId, item.position, item.duration, item.completed ? 1 : 0, item.updatedAt,
        ).changes
      }
    })
    return result
  }

  async readDirectoryEmmRecords(
    paths: readonly string[],
    signal?: AbortSignal,
  ): Promise<ReadonlyMap<string, ReaderDirectoryEmmRecord>> {
    this.#assertOpen()
    if (!this.directoryEmmAvailable || !paths.length) return new Map()
    if (paths.length > 100_000) throw new RangeError("Directory EMM metadata batch cannot exceed 100000 paths.")
    const output = new Map<string, ReaderDirectoryEmmRecord>()
    const unique = [...new Set(paths)]
    for (let cursor = 0; cursor < unique.length; cursor += 256) {
      signal?.throwIfAborted()
      const batch = unique.slice(cursor, cursor + 256)
      const placeholders = batch.map((_, index) => `?${index + 1}`).join(", ")
      const rows = this.database.all(
        `SELECT key, ${this.#directoryRatingDataAvailable ? "rating_data" : "NULL AS rating_data"}, emm_json, ${this.#directoryManualTagsAvailable ? "manual_tags" : "NULL AS manual_tags"}
         FROM thumbs WHERE key IN (${placeholders})`,
        ...batch,
      )
      for (const row of rows) {
        const key = requireString(row.key, "EMM path")
        output.set(key, {
          ratingData: optionalText(row.rating_data),
          emmJson: optionalText(row.emm_json),
          manualTags: optionalText(row.manual_tags),
        })
      }
      if (cursor && cursor % 2_048 === 0) await scheduler.yield()
    }
    signal?.throwIfAborted()
    return output
  }

  async listSearchHistory(scope: string, limit: number): Promise<readonly ReaderSearchHistoryRecord[]> {
    this.#assertOpen()
    assertSearchHistoryScope(scope)
    assertSearchHistoryLimit(limit)
    return this.database.all(
      `SELECT scope_id, query, used_at, use_count FROM xr_reader_search_history
       WHERE scope_id = ?1 ORDER BY used_at DESC, query ASC LIMIT ?2`,
      scope,
      limit,
    ).map(parseSearchHistory)
  }

  async recordSearchHistory(
    record: Omit<ReaderSearchHistoryRecord, "useCount">,
    maximumEntries: number,
  ): Promise<ReaderSearchHistoryRecord> {
    this.#assertOpen()
    assertSearchHistoryIdentity(record.scope, record.query)
    assertSearchHistoryTimestamp(record.usedAt)
    assertSearchHistoryLimit(maximumEntries)
    return this.#transaction(() => {
      this.database.run(
        `INSERT INTO xr_reader_search_history (scope_id, query, used_at, use_count)
         VALUES (?1, ?2, ?3, 1)
         ON CONFLICT(scope_id, query) DO UPDATE SET
           used_at = excluded.used_at,
           use_count = xr_reader_search_history.use_count + 1`,
        record.scope,
        record.query,
        record.usedAt,
      )
      this.database.run(
        `DELETE FROM xr_reader_search_history WHERE rowid IN (
           SELECT rowid FROM xr_reader_search_history WHERE scope_id = ?1
           ORDER BY used_at DESC, query ASC LIMIT -1 OFFSET ?2
         )`,
        record.scope,
        maximumEntries,
      )
      return parseSearchHistory(this.database.get(
        `SELECT scope_id, query, used_at, use_count FROM xr_reader_search_history
         WHERE scope_id = ?1 AND query = ?2`,
        record.scope,
        record.query,
      )!)
    })
  }

  deleteSearchHistory(scope: string, query: string): Promise<boolean> {
    this.#assertOpen()
    assertSearchHistoryIdentity(scope, query)
    return this.#write(() => this.database.run(
      "DELETE FROM xr_reader_search_history WHERE scope_id = ?1 AND query = ?2",
      scope,
      query,
    ).changes > 0)
  }

  clearSearchHistory(scope: string): Promise<number> {
    this.#assertOpen()
    assertSearchHistoryScope(scope)
    return this.#write(() => this.database.run(
      "DELETE FROM xr_reader_search_history WHERE scope_id = ?1",
      scope,
    ).changes)
  }

  async loadFileUndoTransactions(limit: number): Promise<ReaderFileUndoJournalRecord[]> {
    this.#assertOpen()
    assertUndoLimit(limit)
    return this.database.all(
      `SELECT id, created_at, entries_json FROM xr_reader_file_undo_transactions
       ORDER BY created_at DESC, id DESC LIMIT ?1`,
      limit,
    ).map(parseUndoTransaction).reverse()
  }

  async saveFileUndoTransaction(record: ReaderFileUndoJournalRecord, limit: number): Promise<void> {
    this.#assertOpen()
    const value = UndoTransactionSchema.parse(record)
    assertUndoLimit(limit)
    await this.#transaction(() => {
      this.database.run(
        `INSERT INTO xr_reader_file_undo_transactions (id, created_at, entries_json)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET created_at = excluded.created_at, entries_json = excluded.entries_json`,
        value.id,
        value.createdAt,
        JSON.stringify(value.entries),
      )
      this.database.run(
        `DELETE FROM xr_reader_file_undo_transactions WHERE id NOT IN (
           SELECT id FROM xr_reader_file_undo_transactions ORDER BY created_at DESC, id DESC LIMIT ?1
         )`,
        limit,
      )
    })
  }

  removeFileUndoTransaction(id: string): Promise<boolean> {
    this.#assertOpen()
    if (!id || id.length > 128 || id.includes("\0")) throw new Error("Reader file undo transaction id is invalid.")
    return this.#write(() => this.database.run(
      "DELETE FROM xr_reader_file_undo_transactions WHERE id = ?1",
      id,
    ).changes > 0)
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

  async #transaction<T>(operation: () => T): Promise<T> {
    return this.#write(() => {
      this.database.exec("BEGIN IMMEDIATE")
      try {
        const result = operation()
        this.database.exec("COMMIT")
        return result
      } catch (error) {
        try { this.database.exec("ROLLBACK") } catch { /* The original write error is authoritative. */ }
        throw error
      }
    })
  }

  async #setSortDefault(scopeId: string, sort: ReaderDirectorySortRule): Promise<void> {
    this.#assertOpen()
    assertDirectorySort(sort)
    await this.#write(() => {
      this.database.run(
        `INSERT INTO xr_reader_folder_sort_defaults (
           scope_id, sort_field, sort_order, directories_first, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(scope_id) DO UPDATE SET sort_field = excluded.sort_field,
           sort_order = excluded.sort_order, directories_first = excluded.directories_first,
           updated_at = excluded.updated_at`,
        scopeId,
        sort.field,
        sort.order,
        sort.directoriesFirst ? 1 : 0,
        Date.now(),
      )
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
  if (listId === "favorites") {
    return {
      sql: `WHERE b.starred = 1 OR EXISTS (
        SELECT 1 FROM xr_reader_bookmark_memberships m
        JOIN xr_reader_bookmark_lists l ON l.id = m.list_id
        WHERE m.bookmark_id = b.id AND l.is_favorite = 1
      )`,
      bindings: [],
    }
  }
  if (listId === "default") {
    return {
      sql: `WHERE NOT EXISTS (SELECT 1 FROM xr_reader_bookmark_memberships m WHERE m.bookmark_id = b.id)
        OR EXISTS (SELECT 1 FROM xr_reader_bookmark_memberships m WHERE m.bookmark_id = b.id AND m.list_id = 'default')`,
      bindings: [],
    }
  }
  return {
    sql: "WHERE EXISTS (SELECT 1 FROM xr_reader_bookmark_memberships m WHERE m.bookmark_id = b.id AND m.list_id = ?1)",
    bindings: [listId],
  }
}

function parseProgress(row: Record<string, unknown>): ReaderProgressRecord {
  const progress = {
    bookId: requireString(row.book_id, "progress book id"),
    source: parseSource(row.source_json),
    displayName: requireString(row.display_name, "progress display name"),
    pageIndex: requireInteger(row.page_index, "progress page index"),
    pageCount: requireInteger(row.page_count, "progress page count"),
    updatedAt: requireInteger(row.updated_at, "progress updated time"),
  }
  assertProgress(progress)
  return progress
}

function assertProgress(progress: ReaderProgressRecord): void {
  if (!progress.bookId || !progress.displayName) throw new Error("Reader progress identity must not be empty.")
  if (!Number.isSafeInteger(progress.pageCount) || progress.pageCount < 0) throw new Error("Reader progress pageCount is invalid.")
  if (!Number.isSafeInteger(progress.pageIndex) || progress.pageIndex < 0 || (progress.pageCount > 0 && progress.pageIndex >= progress.pageCount)) {
    throw new Error("Reader progress pageIndex is invalid.")
  }
  if (!Number.isSafeInteger(progress.updatedAt) || progress.updatedAt < 0) throw new Error("Reader progress updatedAt is invalid.")
}

function parseMediaProgress(row: Record<string, unknown>): ReaderMediaProgressRecord {
  const progress = {
    bookId: requireString(row.book_id, "media progress book id"),
    position: requireFiniteNumber(row.position, "media progress position"),
    duration: requireFiniteNumber(row.duration, "media progress duration"),
    completed: requireBooleanInteger(row.completed, "media progress completed"),
    updatedAt: requireInteger(row.updated_at, "media progress updated time"),
  }
  assertMediaProgress(progress)
  return progress
}

function assertMediaProgress(progress: ReaderMediaProgressRecord): void {
  assertText(progress.bookId, "media progress bookId")
  if (progress.position < 0 || progress.duration < 0 || progress.position > progress.duration) {
    throw new Error("Reader media progress position/duration is invalid.")
  }
  if (!Number.isSafeInteger(progress.updatedAt) || progress.updatedAt < 0) {
    throw new Error("Reader media progress updatedAt is invalid.")
  }
}

function parseDirectorySort(row: Record<string, unknown> | undefined): ReaderDirectorySortRule | undefined {
  if (!row) return undefined
  const field = row.sort_field
  const order = row.sort_order
  const directoriesFirst = row.directories_first
  if (!isReaderDirectorySortField(field) || (order !== "asc" && order !== "desc")) {
    throw new Error("Stored folder sort rule is invalid.")
  }
  if (directoriesFirst !== 0 && directoriesFirst !== 1 && directoriesFirst !== 0n && directoriesFirst !== 1n) {
    throw new Error("Stored folder sort directory priority is invalid.")
  }
  return { field, order, directoriesFirst: directoriesFirst === 1 || directoriesFirst === 1n }
}

function assertDirectorySort(sort: ReaderDirectorySortRule): void {
  if (!isReaderDirectorySortField(sort.field) || (sort.order !== "asc" && sort.order !== "desc")) {
    throw new Error("Folder sort rule is invalid.")
  }
}

function requireSortIdentity(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 4_096) throw new Error(`${label} is invalid.`)
  return normalized
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

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined
}

function requireInteger(value: unknown, name: string): number {
  if (typeof value === "bigint") value = Number(value)
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`Stored reader ${name} is invalid.`)
  return value
}

function requireFiniteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Stored reader ${name} is invalid.`)
  return value
}

function assertText(value: string, name: string): void {
  if (!value.trim() || value.length > 512) throw new Error(`Reader ${name} is invalid.`)
}

function normalizeBookmarkPath(path: string): string {
  const normalized = path.trim().replaceAll("\\", "/").toLocaleLowerCase("en-US")
  if (!normalized || normalized.length > 32_768 || normalized.includes("\0")) throw new Error("Reader bookmark path is invalid.")
  return normalized
}

function parseSearchHistory(row: Record<string, unknown>): ReaderSearchHistoryRecord {
  const record = {
    scope: requireString(row.scope_id, "search history scope"),
    query: requireString(row.query, "search history query"),
    usedAt: requireInteger(row.used_at, "search history used time"),
    useCount: requireInteger(row.use_count, "search history use count"),
  }
  assertSearchHistoryIdentity(record.scope, record.query)
  assertSearchHistoryTimestamp(record.usedAt)
  if (record.useCount < 1) throw new Error("Stored Reader search history use count is invalid.")
  return record
}

const PathSchema = z.string().min(1).max(32_768).refine((value) => !value.includes("\0"))
const PairMutationSchema = z.object({
  kind: z.enum(["copy", "move", "rename"]),
  sourcePath: PathSchema,
  destinationPath: PathSchema,
  overwrite: z.boolean().optional(),
}).strict()
const SourceMutationSchema = z.object({ kind: z.enum(["delete", "trash"]), sourcePath: PathSchema }).strict()
const DirectoryMutationSchema = z.object({ kind: z.literal("create-directory"), destinationPath: PathSchema }).strict()
const MutationSchema = z.union([PairMutationSchema, SourceMutationSchema, DirectoryMutationSchema])
const UndoReceiptSchema = z.object({
  original: MutationSchema,
  inverse: MutationSchema,
  guard: z.object({
    path: PathSchema,
    kind: z.enum(["file", "directory", "symbolic-link", "other"]),
    size: z.number().finite().nonnegative(),
    mtimeMs: z.number().finite(),
    ctimeMs: z.number().finite(),
    device: z.number().finite().nonnegative(),
    inode: z.number().finite().nonnegative(),
  }).strict(),
}).strict()
const UndoTransactionSchema = z.object({
  id: z.string().min(1).max(128).refine((value) => !value.includes("\0")),
  createdAt: z.number().int().nonnegative(),
  entries: z.array(z.object({ index: z.number().int().nonnegative(), receipt: UndoReceiptSchema }).strict()).min(1).max(256),
}).strict()

function parseUndoTransaction(row: Record<string, unknown>): ReaderFileUndoJournalRecord {
  const entries = JSON.parse(requireString(row.entries_json, "file undo entries")) as unknown
  return UndoTransactionSchema.parse({
    id: requireString(row.id, "file undo id"),
    createdAt: requireInteger(row.created_at, "file undo created time"),
    entries,
  })
}

function assertUndoLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) throw new Error("Reader file undo limit is invalid.")
}

function assertSearchHistoryIdentity(scope: string, query: string): void {
  assertSearchHistoryScope(scope)
  if (!query.trim() || query.length > 512 || query.includes("\0")) throw new Error("Reader search history query is invalid.")
}

function assertSearchHistoryScope(scope: string): void {
  if (!scope.trim() || scope.length > 64 || scope.includes("\0")) throw new Error("Reader search history scope is invalid.")
}

function assertSearchHistoryTimestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Reader search history timestamp is invalid.")
}

function assertSearchHistoryLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) throw new Error("Reader search history limit is invalid.")
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
