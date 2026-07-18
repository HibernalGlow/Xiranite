import type { ReaderBook, ViewSource } from "../domain/book/book.js"

export interface ArchivePasswordInput {
  entryPaths?: readonly string[]
  password?: string
  rawPassword?: Uint8Array
}

export interface ReaderBookLoadOptions {
  signal?: AbortSignal
  archivePasswords?: readonly ArchivePasswordInput[]
}

export type ReaderBookLoader = (source: ViewSource, options?: ReaderBookLoadOptions) => Promise<ReaderBook>
