import type { ViewSource } from "../../domain/book/book.js"
import type {
  ReaderBookmarkListRecord,
  ReaderBookmarkQuery,
  ReaderBookmarkRecord,
  ReaderLibraryStore,
  ReaderRecentQuery,
} from "../../ports/ReaderLibraryStore.js"
import type { ReaderProgressRecord } from "../../ports/ReaderProgressStore.js"
import { assertReaderDirectoryFilter } from "../../domain/browser/ReaderDirectoryFilter.js"

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

export interface UpdateReaderBookmarkInput {
  starred?: boolean
  listIds?: readonly string[]
}

export interface ReaderBookmarkBatchUpdate {
  id: string
  starred?: boolean
  listIds?: readonly string[]
}

export interface ReaderBookmarkBatchResult {
  items: readonly ReaderBookmarkRecord[]
  missingIds: readonly string[]
}

export interface ReaderBookmarkBatchRemoveResult {
  deleted: number
  missingIds: readonly string[]
}

export interface ReaderRecentBatchRemoveResult {
  deleted: number
  missingIds: readonly string[]
}

export interface ReaderOldestRecentCleanupResult extends ReaderRecentBatchRemoveResult {
  selectedIds: readonly string[]
}

export interface ReaderOldestBookmarkCleanupResult extends ReaderBookmarkBatchRemoveResult {
  selectedIds: readonly string[]
}

export class ReaderLibraryService implements AsyncDisposable {
  #closed = false
  #activeOperations = 0
  #drainPromise?: Promise<void>
  #resolveDrain?: () => void
  #closePromise?: Promise<void>

  constructor(
    private readonly store: ReaderLibraryStore,
    private readonly clock: () => number = Date.now,
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {}

  listRecent(query: Partial<ReaderRecentQuery> = {}): Promise<readonly ReaderProgressRecord[]> {
    this.#assertOpen()
    const normalized = normalizeLibraryQuery(query)
    return this.#track(() => this.store.listRecent(normalized))
  }

  async removeRecent(bookId: string, signal?: AbortSignal): Promise<boolean> {
    this.#assertOpen()
    assertId(bookId, "bookId")
    signal?.throwIfAborted()
    const removed = await this.#track(() => this.store.deleteRecent(bookId))
    signal?.throwIfAborted()
    return removed
  }

  async removeRecents(ids: readonly string[], signal?: AbortSignal): Promise<ReaderRecentBatchRemoveResult> {
    this.#assertOpen()
    const normalized = normalizeBatchIds(ids, "recent")
    signal?.throwIfAborted()
    const result = await this.#track(() => this.store.deleteRecentBatch(normalized))
    signal?.throwIfAborted()
    return result
  }

  async removeOldestRecents(limit: number, signal?: AbortSignal): Promise<ReaderOldestRecentCleanupResult> {
    this.#assertOpen()
    const normalizedLimit = normalizeCleanupLimit(limit)
    signal?.throwIfAborted()
    const result = await this.#track(() => this.store.deleteOldestRecent(normalizedLimit))
    signal?.throwIfAborted()
    return { ...result, missingIds: [] }
  }

  clearRecentBefore(timestamp: number, limit = 500): Promise<number> {
    this.#assertOpen()
    assertTimestamp(timestamp, "timestamp")
    const normalizedLimit = normalizeLimit(limit, 500)
    return this.#track(() => this.store.clearRecentBefore(timestamp, normalizedLimit))
  }

  clearByFolder(collection: "recents" | "bookmarks", folderPath: string): Promise<number> {
    this.#assertOpen()
    if (collection !== "recents" && collection !== "bookmarks") {
      throw new Error("Reader library collection is invalid.")
    }
    const normalizedPath = normalizeFolderCleanupPath(folderPath)
    return this.#track(() => this.store.clearByPathPrefix(collection, normalizedPath))
  }

  clearAll(collection: "recents" | "bookmarks"): Promise<number> {
    this.#assertOpen()
    if (collection !== "recents" && collection !== "bookmarks") {
      throw new Error("Reader library collection is invalid.")
    }
    return this.#track(() => this.store.clearAll(collection))
  }

  listBookmarks(query: Partial<ReaderBookmarkQuery> = {}): Promise<readonly ReaderBookmarkRecord[]> {
    this.#assertOpen()
    const listId = query.listId?.trim()
    const normalized = { ...normalizeLibraryQuery(query), ...(listId ? { listId } : {}) }
    return this.#track(() => this.store.listBookmarks(normalized))
  }

  findBookmarkByPath(path: string): Promise<ReaderBookmarkRecord | undefined> {
    this.#assertOpen()
    const normalized = path.trim()
    if (!normalized || normalized.includes("\0")) throw new Error("Reader bookmark path must not be empty.")
    return this.#track(() => this.store.findBookmarkByPath(normalized))
  }

  async saveBookmark(input: SaveReaderBookmarkInput): Promise<ReaderBookmarkRecord> {
    this.#assertOpen()
    return this.#track(async () => {
      const now = this.clock()
      assertTimestamp(now, "clock")
      const existing = input.id ? undefined : await this.store.findBookmarkByPath(input.source.path)
      const id = input.id?.trim() || existing?.id || this.createId()
      const name = input.name.trim()
      assertId(id, "bookmark id")
      if (!name) throw new Error("Reader bookmark name must not be empty.")
      const createdAt = input.createdAt ?? existing?.createdAt ?? now
      assertTimestamp(createdAt, "createdAt")
      const bookmark: ReaderBookmarkRecord = {
        id,
        source: input.source,
        name,
        kind: input.kind ?? (input.source.kind === "directory" ? "folder" : "file"),
        starred: existing?.starred === true || input.starred === true || input.listIds?.includes("favorites") === true,
        createdAt,
        updatedAt: now,
        listIds: normalizeStoredListIds([...(existing?.listIds ?? []), ...(input.listIds ?? ["default"])]),
      }
      await this.store.upsertBookmark(bookmark)
      return bookmark
    })
  }

  async updateBookmark(
    id: string,
    input: UpdateReaderBookmarkInput,
    signal?: AbortSignal,
  ): Promise<ReaderBookmarkRecord | undefined> {
    this.#assertOpen()
    assertId(id, "bookmark id")
    if (input.starred === undefined && input.listIds === undefined) {
      throw new Error("Reader bookmark update must change starred or listIds.")
    }
    if (input.starred !== undefined && typeof input.starred !== "boolean") {
      throw new Error("Reader bookmark starred update must be a boolean.")
    }
    signal?.throwIfAborted()
    return this.#track(async () => {
      const listIds = input.listIds === undefined
        ? undefined
        : await this.#replacementBookmarkListIds(input.listIds, signal)
      const updatedAt = this.clock()
      assertTimestamp(updatedAt, "clock")
      signal?.throwIfAborted()
      const updated = await this.store.updateBookmark(id.trim(), {
        ...(input.starred !== undefined ? { starred: input.starred } : {}),
        ...(listIds ? { listIds } : {}),
        updatedAt,
      })
      signal?.throwIfAborted()
      return updated
    })
  }

  async updateBookmarks(
    updates: readonly ReaderBookmarkBatchUpdate[],
    signal?: AbortSignal,
  ): Promise<ReaderBookmarkBatchResult> {
    this.#assertOpen()
    if (!Array.isArray(updates) || updates.length === 0 || updates.length > 500) {
      throw new Error("Reader bookmark batch update must contain from 1 to 500 items.")
    }
    const ids = new Set<string>()
    const requestedLists = new Map<string, string[]>()
    const customListIds = new Set<string>()
    for (const update of updates) {
      assertId(update.id, "bookmark id")
      const id = update.id.trim()
      if (ids.has(id)) throw new Error(`Reader bookmark batch update contains duplicate id '${id}'.`)
      ids.add(id)
      assertBookmarkUpdate(update)
      if (update.listIds !== undefined) {
        const listIds = normalizeRequestedListIds(update.listIds)
        requestedLists.set(id, listIds)
        for (const listId of listIds) if (listId !== "default") customListIds.add(listId)
      }
    }
    signal?.throwIfAborted()
    return this.#track(async () => {
      if (customListIds.size) {
        const known = new Set((await this.store.listBookmarkLists()).map((list) => list.id))
        const unknown = [...customListIds].filter((listId) => !known.has(listId))
        if (unknown.length) throw new Error(`Reader bookmark update references unknown lists: ${unknown.join(", ")}.`)
      }
      const updatedAt = this.clock()
      assertTimestamp(updatedAt, "clock")
      signal?.throwIfAborted()
      const result = await this.store.updateBookmarkBatch(updates.map((update) => {
        const id = update.id.trim()
        return {
          id,
          ...(update.starred !== undefined ? { starred: update.starred } : {}),
          ...(requestedLists.has(id) ? { listIds: requestedLists.get(id)! } : {}),
        }
      }), updatedAt)
      signal?.throwIfAborted()
      return result
    })
  }

  async removeBookmark(id: string, signal?: AbortSignal): Promise<boolean> {
    this.#assertOpen()
    assertId(id, "bookmark id")
    signal?.throwIfAborted()
    const removed = await this.#track(() => this.store.deleteBookmark(id))
    signal?.throwIfAborted()
    return removed
  }

  async removeBookmarks(ids: readonly string[], signal?: AbortSignal): Promise<ReaderBookmarkBatchRemoveResult> {
    this.#assertOpen()
    const normalized = normalizeBatchIds(ids, "bookmark")
    signal?.throwIfAborted()
    const result = await this.#track(() => this.store.deleteBookmarkBatch(normalized))
    signal?.throwIfAborted()
    return result
  }

  async removeOldestBookmarks(limit: number, signal?: AbortSignal): Promise<ReaderOldestBookmarkCleanupResult> {
    this.#assertOpen()
    const normalizedLimit = normalizeCleanupLimit(limit)
    signal?.throwIfAborted()
    const result = await this.#track(() => this.store.deleteOldestBookmark(normalizedLimit))
    signal?.throwIfAborted()
    return { ...result, missingIds: [] }
  }

  clearBookmarksBefore(timestamp: number, limit = 500): Promise<number> {
    this.#assertOpen()
    assertTimestamp(timestamp, "timestamp")
    const normalizedLimit = normalizeLimit(limit, 500)
    return this.#track(() => this.store.clearBookmarkBefore(timestamp, normalizedLimit))
  }

  async listBookmarkLists(): Promise<readonly (ReaderBookmarkListRecord & { system?: boolean })[]> {
    this.#assertOpen()
    const custom = await this.#track(() => this.store.listBookmarkLists())
    return [...SYSTEM_BOOKMARK_LISTS, ...custom]
  }

  async saveBookmarkList(input: SaveReaderBookmarkListInput): Promise<ReaderBookmarkListRecord> {
    this.#assertOpen()
    return this.#track(async () => {
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
    })
  }

  removeBookmarkList(id: string): Promise<boolean> {
    this.#assertOpen()
    assertId(id, "bookmark list id")
    if (isSystemListId(id)) throw new Error(`Reader bookmark list id '${id}' is reserved.`)
    return this.#track(() => this.store.deleteBookmarkList(id))
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise
    this.#closed = true
    this.#closePromise = (async () => {
      if (this.#activeOperations > 0) {
        await (this.#drainPromise ??= new Promise<void>((resolve) => {
          this.#resolveDrain = resolve
        }))
      }
      await this.store.close()
    })()
    return this.#closePromise
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close()
  }

  async #replacementBookmarkListIds(listIds: readonly string[], signal?: AbortSignal): Promise<string[]> {
    const replacement = normalizeRequestedListIds(listIds)
    const customIds = replacement.filter((listId) => listId !== "default")
    if (!customIds.length) return replacement
    signal?.throwIfAborted()
    const known = new Set((await this.store.listBookmarkLists()).map((list) => list.id))
    signal?.throwIfAborted()
    const unknown = customIds.filter((listId) => !known.has(listId))
    if (unknown.length) throw new Error(`Reader bookmark update references unknown lists: ${unknown.join(", ")}.`)
    return replacement
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Reader library service is closed.")
  }

  #track<T>(operation: () => Promise<T>): Promise<T> {
    this.#assertOpen()
    this.#activeOperations += 1
    let result: Promise<T>
    try {
      result = Promise.resolve(operation())
    } catch (error) {
      this.#finishOperation()
      return Promise.reject(error)
    }
    return result.finally(() => this.#finishOperation())
  }

  #finishOperation(): void {
    this.#activeOperations -= 1
    if (this.#closed && this.#activeOperations === 0) {
      const resolve = this.#resolveDrain
      this.#resolveDrain = undefined
      resolve?.()
    }
  }
}

function assertBookmarkUpdate(input: UpdateReaderBookmarkInput): void {
  if (input.starred === undefined && input.listIds === undefined) {
    throw new Error("Reader bookmark update must change starred or listIds.")
  }
  if (input.starred !== undefined && typeof input.starred !== "boolean") {
    throw new Error("Reader bookmark starred update must be a boolean.")
  }
}

function normalizeRequestedListIds(listIds: readonly string[]): string[] {
  if (!Array.isArray(listIds) || listIds.length > 128) {
    throw new Error("Reader bookmark listIds update must contain at most 128 list ids.")
  }
  const normalized = [...new Set(listIds.map((value) => {
    if (typeof value !== "string") throw new Error("Reader bookmark listIds update must contain strings.")
    const id = value.trim()
    assertId(id, "bookmark list id")
    if (id === "all" || id === "favorites") {
      throw new Error(`Reader bookmark synthetic list '${id}' cannot be persisted as a membership.`)
    }
    return id
  }))].sort()
  return normalized.length ? normalized : ["default"]
}

function normalizeBatchIds(ids: readonly string[], kind: "bookmark" | "recent"): string[] {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500) {
    throw new Error(`Reader ${kind} batch delete must contain from 1 to 500 ids.`)
  }
  const normalized = ids.map((id) => {
    if (typeof id !== "string") throw new Error(`Reader ${kind} batch delete ids must be strings.`)
    assertId(id, `${kind} id`)
    return id.trim()
  })
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`Reader ${kind} batch delete contains duplicate ids.`)
  }
  return normalized
}

const SYSTEM_BOOKMARK_LISTS = [
  { id: "all", name: "全部", isFavorite: false, createdAt: 0, updatedAt: 0, system: true },
  { id: "default", name: "默认", isFavorite: false, createdAt: 0, updatedAt: 0, system: true },
  { id: "favorites", name: "收藏", isFavorite: true, createdAt: 0, updatedAt: 0, system: true },
] as const

function normalizeLibraryQuery(query: Partial<ReaderRecentQuery>): ReaderRecentQuery {
  const offset = query.offset ?? 0
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Reader library offset is invalid.")
  if (query.filter !== undefined) assertReaderDirectoryFilter(query.filter)
  return {
    limit: normalizeLimit(query.limit ?? 100, 100),
    offset,
    ...(query.filter !== undefined ? { filter: query.filter } : {}),
  }
}

function normalizeCleanupLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 500) {
    throw new Error("Reader recent cleanup limit must be an integer from 1 to 500.")
  }
  return limit
}

function normalizeFolderCleanupPath(path: string): string {
  if (typeof path !== "string") throw new Error("Reader library cleanup folder path is invalid.")
  const normalized = path.trim().replaceAll("\\", "/").toLocaleLowerCase("en-US")
  if (!normalized || normalized.length > 32_768 || normalized.includes("\0")) {
    throw new Error("Reader library cleanup folder path is invalid.")
  }
  return normalized
}

function normalizeLimit(limit: number, fallback: number): number {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("Reader library limit is invalid.")
  return Math.min(limit || fallback, 500)
}

function normalizeStoredListIds(listIds: readonly string[]): string[] {
  const normalized = [...new Set(listIds.map((id) => id.trim()).filter((id) => id && id !== "all" && id !== "favorites"))].sort()
  return normalized.length ? normalized : ["default"]
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
