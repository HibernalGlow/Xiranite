import type { ViewSource } from "../../domain/book/book.js"
import type { ReaderBookLoader } from "../../ports/ReaderBookLoader.js"
import { CoreReaderSession } from "./ReaderSession.js"
import type { OpenViewSourceOptions, ReaderService, ReaderSession, ReaderSessionId } from "./contracts.js"

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
