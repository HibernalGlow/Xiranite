import {
  DEFAULT_READER_SESSION_OPTIONS,
  type OpenViewSourceOptions,
  type ReaderBook,
  type ReaderGeneration,
  type ReaderService,
  type ReaderSession,
  type ReaderSessionEvent,
  type ReaderSessionId,
  type ReaderSessionOptions,
  type ViewSource,
} from "./core.js"
import { buildFrameSnapshot, type FrameSnapshot } from "./frame.js"

export type ReaderBookLoader = (source: ViewSource, signal?: AbortSignal) => Promise<ReaderBook>

export class CoreReaderSession implements ReaderSession {
  readonly id: ReaderSessionId
  readonly book: ReaderBook
  #generation: ReaderGeneration = 0
  #anchorPageIndex = 0
  #options: ReaderSessionOptions
  #listeners = new Set<(event: ReaderSessionEvent) => void>()
  #closed = false
  #onClose?: (sessionId: ReaderSessionId) => void

  constructor(
    id: ReaderSessionId,
    book: ReaderBook,
    options: Partial<ReaderSessionOptions> = {},
    onClose?: (sessionId: ReaderSessionId) => void,
  ) {
    assertBook(book)
    this.id = id
    this.book = book
    this.#options = mergeOptions(DEFAULT_READER_SESSION_OPTIONS, options)
    this.#onClose = onClose
  }

  get generation(): ReaderGeneration {
    return this.#generation
  }

  snapshot(): FrameSnapshot {
    this.#assertOpen()
    return buildFrameSnapshot({
      pages: this.book.pages,
      anchorPageIndex: this.#anchorPageIndex,
      generation: this.#generation,
      direction: this.#options.direction,
      layout: this.#options.layout,
    })
  }

  async goTo(pageIndex: number, signal?: AbortSignal): Promise<FrameSnapshot> {
    this.#assertOpen()
    signal?.throwIfAborted()
    this.#anchorPageIndex = clamp(pageIndex, this.book.pages.length)
    this.#generation += 1
    signal?.throwIfAborted()
    return this.#publishFrame()
  }

  async next(signal?: AbortSignal): Promise<FrameSnapshot> {
    const current = this.snapshot()
    if (current.atEnd) {
      if (this.#options.tailOverflow === "loop" || this.#options.tailOverflow === "seamless-loop") {
        return this.goTo(0, signal)
      }
      if (this.#options.tailOverflow === "next-book") {
        this.#emit({ type: "error", code: "NEXT_BOOK_REQUIRED", message: "The next book must be resolved by ReaderService.", recoverable: true })
      }
      signal?.throwIfAborted()
      return current
    }
    const nextIndex = Math.max(...current.pages.map((page) => page.pageIndex)) + 1
    return this.goTo(nextIndex, signal)
  }

  async previous(signal?: AbortSignal): Promise<FrameSnapshot> {
    const current = this.snapshot()
    signal?.throwIfAborted()
    if (current.atStart) return current
    return this.goTo(current.anchorPageIndex - Math.max(current.pages.length, 1), signal)
  }

  updateOptions(options: Partial<ReaderSessionOptions>): FrameSnapshot {
    this.#assertOpen()
    this.#options = mergeOptions(this.#options, options)
    this.#generation += 1
    return this.#publishFrame()
  }

  subscribe(listener: (event: ReaderSessionEvent) => void): () => void {
    this.#assertOpen()
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    this.#emit({ type: "closed", sessionId: this.id })
    this.#listeners.clear()
    this.#onClose?.(this.id)
    this.#onClose = undefined
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }

  #publishFrame(): FrameSnapshot {
    const snapshot = this.snapshot()
    this.#emit({ type: "frame", snapshot })
    return snapshot
  }

  #emit(event: ReaderSessionEvent): void {
    for (const listener of [...this.#listeners]) listener(event)
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error(`Reader session ${this.id} is closed.`)
  }
}

export class CoreReaderService implements ReaderService {
  #sessions = new Map<ReaderSessionId, CoreReaderSession>()
  #nextSessionId = 1
  #closed = false

  constructor(private readonly loadBook: ReaderBookLoader) {}

  async openViewSource(source: ViewSource, options: OpenViewSourceOptions = {}): Promise<ReaderSession> {
    this.#assertOpen()
    options.signal?.throwIfAborted()
    const book = await this.loadBook(source, options.signal)
    options.signal?.throwIfAborted()
    const id = `reader-${this.#nextSessionId++}`
    const session = new CoreReaderSession(id, book, options, (sessionId) => this.#sessions.delete(sessionId))
    this.#sessions.set(id, session)
    if (options.initialPage !== undefined && options.initialPage !== 0) await session.goTo(options.initialPage, options.signal)
    return session
  }

  getSession(sessionId: ReaderSessionId): ReaderSession | undefined {
    return this.#sessions.get(sessionId)
  }

  async closeSession(sessionId: ReaderSessionId): Promise<void> {
    await this.#sessions.get(sessionId)?.close()
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    const sessions = [...this.#sessions.values()]
    await Promise.all(sessions.map((session) => session.close()))
    this.#sessions.clear()
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Reader service is closed.")
  }
}

function mergeOptions(current: ReaderSessionOptions, update: Partial<ReaderSessionOptions>): ReaderSessionOptions {
  return {
    direction: update.direction ?? current.direction,
    tailOverflow: update.tailOverflow ?? current.tailOverflow,
    layout: { ...current.layout, ...update.layout },
  }
}

function clamp(index: number, pageCount: number): number {
  if (!pageCount || !Number.isFinite(index)) return 0
  return Math.min(Math.max(Math.trunc(index), 0), pageCount - 1)
}

function assertBook(book: ReaderBook): void {
  const ids = new Set<string>()
  for (let index = 0; index < book.pages.length; index += 1) {
    const page = book.pages[index]!
    if (page.index !== index) throw new Error(`Reader page ${page.id} has index ${page.index}; expected ${index}.`)
    if (ids.has(page.id)) throw new Error(`Duplicate reader page id: ${page.id}`)
    ids.add(page.id)
  }
}
