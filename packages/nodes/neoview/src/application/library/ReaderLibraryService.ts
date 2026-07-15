import type { ViewSource } from "../../domain/book/book.js"
import type {
  ReaderBookmarkListRecord,
  ReaderBookmarkQuery,
  ReaderBookmarkRecord,
  ReaderLibraryStore,
  ReaderRecentQuery,
} from "../../ports/ReaderLibraryStore.js"
import type { ReaderProgressRecord } from "../../ports/ReaderProgressStore.js"

export const READER_SYSTEM_BOOKMARK_LIST_IDS = ["all", "default", "favorites"] as const

export interface SaveReaderBookmarkInput {
  id?: string
  source: ViewSource
  name: string
  kind?: "file" | "folder"
  starred?: boolean
  createdAt?: number
  listIds?: readonly string[]
}

export interface SaveReaderBookmarkListInput {
  id?: string
  name: string
  isFavorite?: boolean
  createdAt?: number
}

export class ReaderLibraryService implements AsyncDisposable {
  #closed = false

  constructor(
    private readonly store: ReaderLibraryStore,
    private readonly clock: () => number = Date.now,
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {}

  listRecent(query: Partial<ReaderRecentQuery> = {}): Promise<readonly ReaderProgressRecord[]> {
    this.#assertOpen()
    return this.store.listRecent(normalizePage(query))
  }

  removeRecent(bookId: string): Promise<boolean> {
    this.#assertOpen()
    assertId(bookId, "bookId")
    return this.store.deleteRecent(bookId)
  }

  clearRecentBefore(timestamp: number, limit = 500): Promise<number> {
    this.#assertOpen()
    assertTimestamp(timestamp, "timestamp")
    return this.store.clearRecentBefore(timestamp, normalizeLimit(limit, 500))
  }

  listBookmarks(query: Partial<ReaderBookmarkQuery> = {}): Promise<readonly ReaderBookmarkRecord[]> {
    this.#assertOpen()
    const listId = query.listId?.trim()
    return this.store.listBookmarks({ ...normalizePage(query), ...(listId ? { listId } : {}) })
  }

  async saveBookmark(input: SaveReaderBookmarkInput): Promise<ReaderBookmarkRecord> {
    this.#assertOpen()
    const now = this.clock()
    assertTimestamp(now, "clock")
    const id = input.id?.trim() || this.createId()
    const name = input.name.trim()
    assertId(id, "bookmark id")
    if (!name) throw new Error("Reader bookmark name must not be empty.")
    const createdAt = input.createdAt ?? now
    assertTimestamp(createdAt, "createdAt")
    const bookmark: ReaderBookmarkRecord = {
      id,
      source: input.source,
      name,
      kind: input.kind ?? (input.source.kind === "directory" ? "folder" : "file"),
      starred: input.starred ?? false,
      createdAt,
      updatedAt: now,
      listIds: normalizeCustomListIds(input.listIds ?? []),
    }
    await this.store.upsertBookmark(bookmark)
    return bookmark
  }

  removeBookmark(id: string): Promise<boolean> {
    this.#assertOpen()
    assertId(id, "bookmark id")
    return this.store.deleteBookmark(id)
  }

  async listBookmarkLists(): Promise<readonly (ReaderBookmarkListRecord & { system?: boolean })[]> {
    this.#assertOpen()
    const custom = await this.store.listBookmarkLists()
    return [...SYSTEM_BOOKMARK_LISTS, ...custom]
  }

  async saveBookmarkList(input: SaveReaderBookmarkListInput): Promise<ReaderBookmarkListRecord> {
    this.#assertOpen()
    const now = this.clock()
    assertTimestamp(now, "clock")
    const id = input.id?.trim() || this.createId()
    const name = input.name.trim()
    assertId(id, "bookmark list id")
    if (isSystemListId(id)) throw new Error(`Reader bookmark list id '${id}' is reserved.`)
    if (!name) throw new Error("Reader bookmark list name must not be empty.")
    const list = {
      id,
      name,
      isFavorite: input.isFavorite ?? false,
      createdAt: input.createdAt ?? now,
      updatedAt: now,
    }
    assertTimestamp(list.createdAt, "createdAt")
    await this.store.upsertBookmarkList(list)
    return list
  }

  removeBookmarkList(id: string): Promise<boolean> {
    this.#assertOpen()
    assertId(id, "bookmark list id")
    if (isSystemListId(id)) throw new Error(`Reader bookmark list id '${id}' is reserved.`)
    return this.store.deleteBookmarkList(id)
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    await this.store.close()
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close()
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Reader library service is closed.")
  }
}

const SYSTEM_BOOKMARK_LISTS = [
  { id: "all", name: "全部", isFavorite: false, createdAt: 0, updatedAt: 0, system: true },
  { id: "default", name: "默认", isFavorite: false, createdAt: 0, updatedAt: 0, system: true },
  { id: "favorites", name: "收藏", isFavorite: true, createdAt: 0, updatedAt: 0, system: true },
] as const

function normalizePage(query: Partial<ReaderRecentQuery>): ReaderRecentQuery {
  const offset = query.offset ?? 0
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Reader library offset is invalid.")
  return { limit: normalizeLimit(query.limit ?? 100, 100), offset }
}

function normalizeLimit(limit: number, fallback: number): number {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("Reader library limit is invalid.")
  return Math.min(limit || fallback, 500)
}

function normalizeCustomListIds(listIds: readonly string[]): string[] {
  return [...new Set(listIds.map((id) => id.trim()).filter((id) => id && !isSystemListId(id)))].sort()
}

function isSystemListId(id: string): id is typeof READER_SYSTEM_BOOKMARK_LIST_IDS[number] {
  return (READER_SYSTEM_BOOKMARK_LIST_IDS as readonly string[]).includes(id)
}

function assertId(id: string, name: string): void {
  if (!id.trim()) throw new Error(`Reader ${name} must not be empty.`)
}

function assertTimestamp(timestamp: number, name: string): void {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error(`Reader library ${name} is invalid.`)
}
