import type { ViewSource } from "../domain/book/book.js"
import type { ReaderProgressRecord } from "./ReaderProgressStore.js"

export interface ReaderRecentQuery {
  limit: number
  offset: number
}

export interface ReaderBookmarkQuery extends ReaderRecentQuery {
  listId?: string
}

export interface ReaderBookmarkRecord {
  id: string
  source: ViewSource
  name: string
  kind: "file" | "folder"
  starred: boolean
  createdAt: number
  updatedAt: number
  listIds: readonly string[]
}

export interface ReaderBookmarkListRecord {
  id: string
  name: string
  isFavorite: boolean
  createdAt: number
  updatedAt: number
}

export interface ReaderBookmarkUpdate {
  starred?: boolean
  listIds?: readonly string[]
  updatedAt: number
}

export interface ReaderOldestRecentDeleteResult {
  selectedIds: readonly string[]
  deleted: number
}

export interface ReaderLibraryBatchDeleteResult {
  deleted: number
  missingIds: readonly string[]
}

export interface ReaderBookmarkBatchStoreUpdate {
  id: string
  starred?: boolean
  listIds?: readonly string[]
}

export interface ReaderBookmarkBatchStoreResult {
  items: readonly ReaderBookmarkRecord[]
  missingIds: readonly string[]
}

export interface ReaderLibraryStore extends AsyncDisposable {
  listRecent(query: ReaderRecentQuery): Promise<readonly ReaderProgressRecord[]>
  deleteRecent(bookId: string): Promise<boolean>
  deleteRecentBatch(bookIds: readonly string[]): Promise<ReaderLibraryBatchDeleteResult>
  deleteOldestRecent(limit: number): Promise<ReaderOldestRecentDeleteResult>
  clearRecentBefore(timestamp: number, limit: number): Promise<number>
  listBookmarks(query: ReaderBookmarkQuery): Promise<readonly ReaderBookmarkRecord[]>
  findBookmarkByPath(path: string): Promise<ReaderBookmarkRecord | undefined>
  upsertBookmark(bookmark: ReaderBookmarkRecord): Promise<void>
  updateBookmark(id: string, update: ReaderBookmarkUpdate): Promise<ReaderBookmarkRecord | undefined>
  updateBookmarkBatch(updates: readonly ReaderBookmarkBatchStoreUpdate[], updatedAt: number): Promise<ReaderBookmarkBatchStoreResult>
  deleteBookmark(id: string): Promise<boolean>
  deleteBookmarkBatch(ids: readonly string[]): Promise<ReaderLibraryBatchDeleteResult>
  listBookmarkLists(): Promise<readonly ReaderBookmarkListRecord[]>
  upsertBookmarkList(list: ReaderBookmarkListRecord): Promise<void>
  deleteBookmarkList(id: string): Promise<boolean>
  close(): Promise<void>
}
