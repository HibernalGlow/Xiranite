import type { ReaderLibraryService, SaveReaderBookmarkListInput, UpdateReaderBookmarkInput } from "../library/ReaderLibraryService.js"
import type { ViewSource } from "../../domain/book/book.js"
import type { ReaderLibraryCleanupRequest, ReaderLibraryCleanupService } from "../library/ReaderLibraryCleanupService.js"
import type { ReaderDirectoryFilter } from "../../domain/browser/ReaderDirectoryFilter.js"

export interface ReaderLibrarySourceIdentity {
  source: Exclude<ViewSource, { kind: "path" }>
  displayName: string
}

export interface SavePathBookmarkInput {
  path: string
  name?: string
  starred?: boolean
  listIds?: readonly string[]
}

/** Presentation-neutral library facade shared by CLI and TUI. */
export class ReaderLibraryHeadlessController implements AsyncDisposable {
  #closed = false

  constructor(
    private readonly library: ReaderLibraryService,
    private readonly resolveSource: (path: string) => Promise<ReaderLibrarySourceIdentity>,
    private readonly cleanup?: ReaderLibraryCleanupService,
  ) {}

  listRecent(limit = 100, offset = 0, filter?: ReaderDirectoryFilter) {
    this.#assertOpen()
    return this.library.listRecent({ limit, offset, filter })
  }

  removeRecent(bookId: string) {
    this.#assertOpen()
    return this.library.removeRecent(bookId)
  }

  clearRecentBefore(before: number, limit = 500) {
    this.#assertOpen()
    return this.library.clearRecentBefore(before, limit)
  }

  removeOldestRecents(limit: number, signal?: AbortSignal) {
    this.#assertOpen()
    return this.library.removeOldestRecents(limit, signal)
  }

  clearByFolder(collection: "recents" | "bookmarks", folderPath: string) {
    this.#assertOpen()
    return this.library.clearByFolder(collection, folderPath)
  }

  clearAll(collection: "recents" | "bookmarks") {
    this.#assertOpen()
    return this.library.clearAll(collection)
  }

  clearBookmarksBefore(before: number, limit = 500) {
    this.#assertOpen()
    return this.library.clearBookmarksBefore(before, limit)
  }

  removeOldestBookmarks(limit: number, signal?: AbortSignal) {
    this.#assertOpen()
    return this.library.removeOldestBookmarks(limit, signal)
  }

  listBookmarks(listId?: string, limit = 100, offset = 0, filter?: ReaderDirectoryFilter) {
    this.#assertOpen()
    return this.library.listBookmarks({ listId, limit, offset, filter })
  }

  async savePathBookmark(input: SavePathBookmarkInput) {
    this.#assertOpen()
    const path = input.path.trim()
    if (!path) throw new Error("Reader bookmark path must not be empty.")
    const identity = await this.resolveSource(path)
    this.#assertOpen()
    return this.library.saveBookmark({
      source: identity.source,
      name: input.name?.trim() || identity.displayName,
      starred: input.starred,
      listIds: input.listIds,
    })
  }

  removeBookmark(id: string) {
    this.#assertOpen()
    return this.library.removeBookmark(id)
  }

  updateBookmark(id: string, update: UpdateReaderBookmarkInput, signal?: AbortSignal) {
    this.#assertOpen()
    return this.library.updateBookmark(id, update, signal)
  }

  listBookmarkLists() {
    this.#assertOpen()
    return this.library.listBookmarkLists()
  }

  saveBookmarkList(input: SaveReaderBookmarkListInput) {
    this.#assertOpen()
    return this.library.saveBookmarkList(input)
  }

  removeBookmarkList(id: string) {
    this.#assertOpen()
    return this.library.removeBookmarkList(id)
  }

  cleanupInvalid(request: ReaderLibraryCleanupRequest = {}) {
    this.#assertOpen()
    if (!this.cleanup) throw new Error("Reader library invalid-path cleanup is unavailable.")
    return this.cleanup.cleanupInvalid(request)
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    await this.library.close()
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close()
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Headless Reader library is closed.")
  }
}
