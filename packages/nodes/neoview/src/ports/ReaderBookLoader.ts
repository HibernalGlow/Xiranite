import type { ReaderBook, ViewSource } from "../domain/book/book.js"

export type ReaderBookLoader = (source: ViewSource, signal?: AbortSignal) => Promise<ReaderBook>
