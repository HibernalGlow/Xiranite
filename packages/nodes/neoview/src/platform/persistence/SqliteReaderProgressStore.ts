import type { ViewSource } from "../../domain/book/book.js"
import type { ReaderProgressRecord, ReaderProgressStore } from "../../ports/ReaderProgressStore.js"
import { openWritableSqlite, type WritableSqliteConnection } from "../sqlite/openWritableSqlite.js"

export class SqliteReaderProgressStore implements ReaderProgressStore {
  readonly #database: WritableSqliteConnection
  #closed = false

  private constructor(database: WritableSqliteConnection) {
    this.#database = database
  }

  static async open(path: string): Promise<SqliteReaderProgressStore> {
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
        PRAGMA busy_timeout = 50;
      `)
      return new SqliteReaderProgressStore(database)
    } catch (error) {
      database.close()
      throw error
    }
  }

  async get(bookId: string): Promise<ReaderProgressRecord | undefined> {
    this.#assertOpen()
    const row = this.#database.get(
      `SELECT book_id, source_json, display_name, page_index, page_count, updated_at
       FROM xr_reader_progress WHERE book_id = ?1`,
      bookId,
    )
    return row ? parseRecord(row) : undefined
  }

  async save(progress: ReaderProgressRecord): Promise<void> {
    this.#assertOpen()
    assertProgress(progress)
    const bindings = [
      progress.bookId,
      JSON.stringify(progress.source),
      progress.displayName,
      progress.pageIndex,
      progress.pageCount,
      progress.updatedAt,
    ] as const
    for (let attempt = 0; ; attempt += 1) {
      try {
        this.#database.run(
          `INSERT INTO xr_reader_progress (
         book_id, source_json, display_name, page_index, page_count, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(book_id) DO UPDATE SET
         source_json = excluded.source_json,
         display_name = excluded.display_name,
         page_index = excluded.page_index,
         page_count = excluded.page_count,
         updated_at = excluded.updated_at`,
          ...bindings,
        )
        return
      } catch (error) {
        if (!isBusyError(error) || attempt >= 3) throw error
        await delay(25 * (attempt + 1))
      }
    }
  }

  close(): Promise<void> {
    if (this.#closed) return Promise.resolve()
    this.#closed = true
    this.#database.close()
    return Promise.resolve()
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Reader progress store is closed.")
  }
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

function parseRecord(row: Record<string, unknown>): ReaderProgressRecord {
  const source = JSON.parse(requireString(row.source_json, "source_json")) as unknown
  if (!isViewSource(source)) throw new Error("Stored reader progress has an invalid source.")
  const progress = {
    bookId: requireString(row.book_id, "book_id"),
    source,
    displayName: requireString(row.display_name, "display_name"),
    pageIndex: requireInteger(row.page_index, "page_index"),
    pageCount: requireInteger(row.page_count, "page_count"),
    updatedAt: requireInteger(row.updated_at, "updated_at"),
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

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) throw new Error(`Stored reader progress ${name} is invalid.`)
  return value
}

function requireInteger(value: unknown, name: string): number {
  if (typeof value === "bigint") value = Number(value)
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`Stored reader progress ${name} is invalid.`)
  return value
}

function isViewSource(value: unknown): value is ViewSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const source = value as Record<string, unknown>
  if (typeof source.path !== "string" || !source.path) return false
  if (source.kind === "path" || source.kind === "directory" || source.kind === "image" || source.kind === "media") return true
  if (source.kind === "document") return source.format === "pdf" || source.format === "epub"
  if (source.kind !== "archive") return false
  return (source.entryPath === undefined || typeof source.entryPath === "string")
    && (source.entryPaths === undefined || (Array.isArray(source.entryPaths) && source.entryPaths.every((entry) => typeof entry === "string")))
}
