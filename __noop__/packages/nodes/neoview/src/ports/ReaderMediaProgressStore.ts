export interface ReaderMediaProgressRecord {
  bookId: string
  position: number
  duration: number
  completed: boolean
  updatedAt: number
}

export interface ReaderMediaProgressStore {
  getMediaProgress(bookId: string): Promise<ReaderMediaProgressRecord | undefined>
  saveMediaProgress(progress: ReaderMediaProgressRecord): Promise<void>
}
