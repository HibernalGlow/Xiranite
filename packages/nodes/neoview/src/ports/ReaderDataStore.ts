import type { ReaderLibraryStore, ReaderBookmarkListRecord, ReaderBookmarkRecord } from "./ReaderLibraryStore.js"
import type { ReaderProgressRecord, ReaderProgressStore } from "./ReaderProgressStore.js"
import type { ReaderMediaProgressStore } from "./ReaderMediaProgressStore.js"

export interface ReaderDataImportBatch {
  progress: readonly ReaderProgressRecord[]
  bookmarks: readonly ReaderBookmarkRecord[]
  bookmarkLists: readonly ReaderBookmarkListRecord[]
  pathStacks: readonly {
    bookId: string
    pathStack: readonly { path: string; innerPath?: string }[]
    updatedAt: number
  }[]
  mediaProgress: readonly {
    bookId: string
    position: number
    duration: number
    completed: boolean
    updatedAt: number
  }[]
}

export interface ReaderDataImportResult {
  progress: number
  bookmarks: number
  bookmarkLists: number
  pathStacks: number
  mediaProgress: number
}

export interface ReaderDataStore extends ReaderProgressStore, ReaderLibraryStore, ReaderMediaProgressStore {
  importData(batch: ReaderDataImportBatch, strategy: "merge" | "overwrite"): Promise<ReaderDataImportResult>
}
