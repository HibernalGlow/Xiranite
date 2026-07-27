import { openWritableSqlite, type WritableSqliteConnection } from "../sqlite/openWritableSqlite.js"
import type { ReaderStartupFolderState, ReaderStartupStateStore } from "../../ports/ReaderStartupStateStore.js"

const LAST_FOLDER_STATE_KEY = "last-folder"

export class SqliteReaderStartupStateStore implements ReaderStartupStateStore {
  #closed = false

  private constructor(
    private readonly database: WritableSqliteConnection,
    private readonly clock: () => number,
  ) {}

  static async open(path: string, options: { clock?: () => number } = {}): Promise<SqliteReaderStartupStateStore> {
    const database = await openWritableSqlite(path, { create: true })
    try {
      database.exec(`
        PRAGMA busy_timeout = 250;
        CREATE TABLE IF NOT EXISTS xr_reader_startup_state (
          state_key TEXT PRIMARY KEY NOT NULL,
          path TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `)
      return new SqliteReaderStartupStateStore(database, options.clock ?? Date.now)
    } catch (error) {
      database.close()
      throw error
    }
  }

  async getLastFolder(): Promise<ReaderStartupFolderState | undefined> {
    this.#assertOpen()
    const row = this.database.get(
      "SELECT path, updated_at FROM xr_reader_startup_state WHERE state_key = ?1",
      LAST_FOLDER_STATE_KEY,
    )
    if (!row) return undefined
    return parseFolderState(row)
  }

  async saveLastFolder(path: string): Promise<ReaderStartupFolderState> {
    this.#assertOpen()
    const state = { path: normalizePath(path), updatedAt: this.clock() }
    if (!Number.isSafeInteger(state.updatedAt) || state.updatedAt < 0) throw new Error("Reader startup state clock is invalid.")
    this.database.run(
      `INSERT INTO xr_reader_startup_state (state_key, path, updated_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(state_key) DO UPDATE SET path = excluded.path, updated_at = excluded.updated_at`,
      LAST_FOLDER_STATE_KEY,
      state.path,
      state.updatedAt,
    )
    return state
  }

  async clearLastFolder(): Promise<void> {
    this.#assertOpen()
    this.database.run("DELETE FROM xr_reader_startup_state WHERE state_key = ?1", LAST_FOLDER_STATE_KEY)
  }

  close(): Promise<void> {
    if (!this.#closed) {
      this.#closed = true
      this.database.close()
    }
    return Promise.resolve()
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close()
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Reader startup state store is closed.")
  }
}

function parseFolderState(row: Record<string, unknown>): ReaderStartupFolderState {
  if (typeof row.path !== "string" || !Number.isSafeInteger(row.updated_at) || row.updated_at < 0) {
    throw new Error("Reader startup folder state is invalid.")
  }
  return { path: normalizePath(row.path), updatedAt: row.updated_at }
}

function normalizePath(path: string): string {
  const normalized = path.trim()
  if (!normalized || normalized.length > 32_767 || normalized.includes("\0")) {
    throw new Error("Reader startup folder path must be 1 to 32767 characters without NUL.")
  }
  return normalized
}
