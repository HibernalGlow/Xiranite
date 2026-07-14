import type { ViewSource } from "../../domain/book/book.js"
import type { ReaderBookLoader } from "../../ports/ReaderBookLoader.js"
import { CoreReaderSession } from "./ReaderSession.js"
import type { OpenViewSourceOptions, ReaderService, ReaderSession, ReaderSessionId } from "./contracts.js"

export class CoreReaderService implements ReaderService {
  #sessions = new Map<ReaderSessionId, CoreReaderSession>()
  #nextSessionId = 1
  #closed = false
  #disposing: Promise<void> | undefined

  constructor(private readonly loadBook: ReaderBookLoader) {}

  async openViewSource(source: ViewSource, options: OpenViewSourceOptions = {}): Promise<ReaderSession> {
    this.#assertOpen()
    options.signal?.throwIfAborted()
    const book = await this.loadBook(source, options.signal)
    try {
      options.signal?.throwIfAborted()
      this.#assertOpen()
    } catch (error) {
      await book.close()
      throw error
    }
    const id = `reader-${this.#nextSessionId++}`
    const session = new CoreReaderSession(id, book, options, (sessionId) => this.#sessions.delete(sessionId))
    this.#sessions.set(id, session)
    try {
      if (options.initialPage !== undefined && options.initialPage !== 0) await session.goTo(options.initialPage, options.signal)
      return session
    } catch (error) {
      await session.close()
      throw error
    }
  }

  getSession(sessionId: ReaderSessionId): ReaderSession | undefined {
    return this.#sessions.get(sessionId)
  }

  async closeSession(sessionId: ReaderSessionId): Promise<void> {
    await this.#sessions.get(sessionId)?.close()
  }

  [Symbol.asyncDispose](): Promise<void> {
    if (this.#disposing) return this.#disposing
    this.#closed = true
    this.#disposing = Promise.resolve().then(async () => {
      const sessions = [...this.#sessions.values()]
      const results = await Promise.allSettled(sessions.map((session) => session.close()))
      this.#sessions.clear()
      const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : [])
      if (errors.length) throw new AggregateError(errors, "Failed to close one or more reader sessions.")
    })
    return this.#disposing
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Reader service is closed.")
  }
}
