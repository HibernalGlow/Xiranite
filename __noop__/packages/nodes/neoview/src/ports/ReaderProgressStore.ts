import type { ViewSource } from "../domain/book/book.js"

export interface ReaderProgressRecord {
  bookId: string
  source: ViewSource
  displayName: string
  pageIndex: number
  pageCount: number
  updatedAt: number
}

export interface ReaderProgressStore extends AsyncDisposable {
  get(bookId: string): Promise<ReaderProgressRecord | undefined>
  save(progress: ReaderProgressRecord): Promise<void>
  close(): Promise<void>
}
