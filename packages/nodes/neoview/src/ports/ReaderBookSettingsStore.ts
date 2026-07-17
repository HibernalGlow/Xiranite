import type { ReaderLayout } from "../domain/frame/frame.js"
import type { ReadingDirection } from "../domain/navigation/navigation.js"

export interface ReaderBookSettingsOverrides {
  favorite?: boolean
  rating?: number
  direction?: ReadingDirection
  pageMode?: ReaderLayout["pageMode"]
  horizontalBook?: boolean
}

export interface ReaderBookSettingsRecord {
  bookId: string
  overrides: ReaderBookSettingsOverrides
  revision: number
  updatedAt: number
}

export interface ReaderBookSettingsStore {
  getBookSettings(bookId: string): Promise<ReaderBookSettingsRecord | undefined>
  saveBookSettings(
    bookId: string,
    overrides: ReaderBookSettingsOverrides,
    expectedRevision: number,
    updatedAt: number,
  ): Promise<ReaderBookSettingsRecord | undefined>
}
