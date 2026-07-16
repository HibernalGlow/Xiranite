import type { ReaderRuntimeResourceSnapshot, ViewSource } from "../../domain/book/book.js"
import type { ReaderBookLoader } from "../../ports/ReaderBookLoader.js"
import type { ImageMetadataProbe } from "../../ports/ImageMetadataProbe.js"
import type { ReaderProgressRecord, ReaderProgressStore } from "../../ports/ReaderProgressStore.js"
import { LatestRecordWriteCoordinator } from "../persistence/LatestRecordWriteCoordinator.js"
import { CoreReaderSession } from "./ReaderSession.js"
import { aggregateReaderPreloadTelemetry, type ReaderPreloadDiagnostics } from "../preloading/PreloadTelemetry.js"
import type { OpenViewSourceOptions, ReaderService, ReaderSession, ReaderSessionId, ReaderSessionOptions } from "./contracts.js"

export class CoreReaderService implements ReaderService {
  #sessions = new Map<ReaderSessionId, CoreReaderSession>()
  #nextSessionId = 1
  #closed = false
  #disposing: Promise<void> | undefined
  readonly #progress: ReaderProgressCoordinator | undefined

  constructor(
    private readonly loadBook: ReaderBookLoader,
    private readonly metadataProbe?: ImageMetadataProbe,
    private sessionDefaults: Partial<ReaderSessionOptions> = {},
    progressStore?: ReaderProgressStore,
  ) {
    this.#progress = progressStore ? new ReaderProgressCoordinator(progressStore) : undefined
  }

  updateSessionDefaults(options: Partial<ReaderSessionOptions>): void {
    this.sessionDefaults = {
      ...this.sessionDefaults,
      ...options,
      layout: options.layout ?? this.sessionDefaults.layout,
    }
  }

  get sessionCount(): number {
    return this.#sessions.size
  }

  preloadDiagnostics(): ReaderPreloadDiagnostics {
    return aggregateReaderPreloadTelemetry([...this.#sessions.values()].map((session) => session.preloadTelemetry()))
  }

  runtimeResourceDiagnostics(): ReaderRuntimeResourceSnapshot {
    const output: ReaderRuntimeResourceSnapshot = {
      archiveProviders: 0,
      archiveIndexEntries: 0,
      archiveIndexPayloadBytes: 0,
      archiveActiveExtractions: 0,
    }
    for (const session of this.#sessions.values()) {
      const snapshot = session.book.runtimeResources?.()
      if (!snapshot) continue
      output.archiveProviders += snapshot.archiveProviders
      output.archiveIndexEntries += snapshot.archiveIndexEntries
      output.archiveIndexPayloadBytes += snapshot.archiveIndexPayloadBytes
      output.archiveActiveExtractions += snapshot.archiveActiveExtractions
    }
    return output
  }

  async openViewSource(source: ViewSource, options: OpenViewSourceOptions = {}): Promise<ReaderSession> {
    this.#assertOpen()
    options.signal?.throwIfAborted()
    const book = await this.loadBook(source, {
      signal: options.signal,
      archivePasswords: options.archivePasswords,
    })
    try {
      options.signal?.throwIfAborted()
      this.#assertOpen()
    } catch (error) {
      await book.close()
      throw error
    }
    const id = `reader-${this.#nextSessionId++}`
    const restoredPage = options.initialPage === undefined
      ? await this.#progress?.restore(book.id)
      : undefined
    let unsubscribe: () => void = () => undefined
    let trackProgress = false
    const session = new CoreReaderSession(
      id,
      book,
      {
        direction: options.direction ?? this.sessionDefaults.direction,
        layout: options.layout ?? this.sessionDefaults.layout,
        tailOverflow: options.tailOverflow ?? this.sessionDefaults.tailOverflow,
      },
      async (sessionId, snapshot) => {
        unsubscribe()
        try {
          if (trackProgress) {
            this.#progress?.record(progressOf(book, snapshot.anchorPageIndex))
            await this.#progress?.flush(book.id)
          }
        } finally {
          this.#sessions.delete(sessionId)
        }
      },
      this.metadataProbe,
    )
    try {
      await session.initialize(options.initialPage ?? restoredPage ?? 0, options.signal)
      options.signal?.throwIfAborted()
      this.#assertOpen()
      unsubscribe = session.subscribe((event) => {
        if (event.type === "frame") this.#progress?.record(progressOf(book, event.snapshot.anchorPageIndex))
      })
      trackProgress = true
      this.#sessions.set(id, session)
      this.#progress?.record(progressOf(book, session.snapshot().anchorPageIndex))
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
      if (this.#progress) results.push(await settle(this.#progress.close()))
      const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : [])
      if (errors.length) throw new AggregateError(errors, "Failed to close one or more reader sessions.")
    })
    return this.#disposing
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Reader service is closed.")
  }
}

class ReaderProgressCoordinator {
  readonly #writes: LatestRecordWriteCoordinator<string, ReaderProgressRecord>
  #closed = false

  constructor(private readonly store: ReaderProgressStore) {
    this.#writes = new LatestRecordWriteCoordinator(
      (record) => record.bookId,
      (record) => this.store.save(record),
      250,
    )
  }

  async restore(bookId: string): Promise<number | undefined> {
    if (this.#closed) return undefined
    try {
      return (await this.store.get(bookId))?.pageIndex
    } catch {
      return undefined
    }
  }

  record(progress: ReaderProgressRecord): void {
    if (this.#closed) return
    this.#writes.record(progress)
  }

  flush(bookId: string): Promise<void> {
    return this.#writes.flush(bookId)
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    const writes = await Promise.allSettled([this.#writes.close()])
    await this.store.close()
    const errors = writes.flatMap((result) => result.status === "rejected" ? [result.reason] : [])
    if (errors.length) throw new AggregateError(errors, "Failed to persist reader progress.")
  }
}

function progressOf(book: CoreReaderSession["book"], pageIndex: number): ReaderProgressRecord {
  return {
    bookId: book.id,
    source: book.source,
    displayName: book.displayName,
    pageIndex,
    pageCount: book.pages.length,
    updatedAt: Date.now(),
  }
}

async function settle(operation: Promise<void>): Promise<PromiseSettledResult<void>> {
  try {
    await operation
    return { status: "fulfilled", value: undefined }
  } catch (reason) {
    return { status: "rejected", reason }
  }
}
