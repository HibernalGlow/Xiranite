import type { ViewSource } from "../../domain/book/book.js"
import type { FrameSnapshot } from "../../domain/frame/frame.js"
import type { PageSource } from "../../domain/page/page-content.js"
import type { ReaderPage } from "../../domain/page/page.js"
import type { ArchivePasswordInput } from "../../ports/ReaderBookLoader.js"
import type { ReaderService, ReaderSession } from "../reader/contracts.js"

export interface OpenHeadlessReaderInput {
  path: string
  entryPaths?: readonly string[]
  archivePasswords?: readonly ArchivePasswordInput[]
  initialPage?: number
  signal?: AbortSignal
}

export interface HeadlessReaderBookSnapshot {
  displayName: string
  pageCount: number
}

export interface HeadlessReaderPageSnapshot {
  id: string
  index: number
  name: string
  mediaKind: ReaderPage["mediaKind"]
  mimeType?: string
  byteLength?: number
  dimensions?: ReaderPage["dimensions"]
  contentVersion: string
}

export interface HeadlessReaderSnapshot {
  book: HeadlessReaderBookSnapshot
  frame: FrameSnapshot
  visiblePages: readonly HeadlessReaderPageSnapshot[]
}

export interface HeadlessPageStream extends AsyncDisposable {
  readonly page: HeadlessReaderPageSnapshot
  readonly stream: ReadableStream<Uint8Array>
  readonly byteLength?: number
  readonly contentType?: string
  close(): Promise<void>
}

/** Application-level Reader facade shared by CLI and TUI. */
export class ReaderHeadlessController implements AsyncDisposable {
  readonly #service: ReaderService
  readonly #disposeDependencies?: () => Promise<void>
  #session: ReaderSession | undefined
  #closed = false
  #disposing: Promise<void> | undefined

  constructor(service: ReaderService, disposeDependencies?: () => Promise<void>) {
    this.#service = service
    this.#disposeDependencies = disposeDependencies
  }

  get isOpen(): boolean {
    return this.#session !== undefined
  }

  async open(input: OpenHeadlessReaderInput): Promise<HeadlessReaderSnapshot> {
    this.#assertOpen()
    const path = input.path.trim()
    if (!path) throw new Error("Reader path must be a non-empty string.")
    assertInitialPage(input.initialPage)
    assertEntryPaths(input.entryPaths)
    input.signal?.throwIfAborted()

    const source: ViewSource = input.entryPaths?.length
      ? { kind: "archive", path, entryPaths: [...input.entryPaths] }
      : { kind: "path", path }
    const next = await this.#service.openViewSource(source, {
      initialPage: input.initialPage,
      archivePasswords: input.archivePasswords,
      signal: input.signal,
    })
    let adopted = false
    try {
      input.signal?.throwIfAborted()
      this.#assertOpen()
      const previous = this.#session
      this.#session = next
      adopted = true
      await previous?.close()
      return snapshotOf(next)
    } catch (error) {
      if (!adopted) await next.close()
      throw error
    }
  }

  inspect(): HeadlessReaderSnapshot {
    return snapshotOf(this.#requireSession())
  }

  listPages(cursor = 0, limit = 100): readonly HeadlessReaderPageSnapshot[] {
    const session = this.#requireSession()
    assertSlice(cursor, limit, session.book.pages.length)
    return session.book.pages.slice(cursor, cursor + limit).map(pageSnapshot)
  }

  async next(signal?: AbortSignal): Promise<HeadlessReaderSnapshot> {
    const session = this.#requireSession()
    await session.next(signal)
    return snapshotOf(session)
  }

  async previous(signal?: AbortSignal): Promise<HeadlessReaderSnapshot> {
    const session = this.#requireSession()
    await session.previous(signal)
    return snapshotOf(session)
  }

  async goTo(pageIndex: number, signal?: AbortSignal): Promise<HeadlessReaderSnapshot> {
    assertPageIndex(pageIndex)
    const session = this.#requireSession()
    await session.goTo(pageIndex, signal)
    return snapshotOf(session)
  }

  async openPageStream(pageIndex: number, signal?: AbortSignal): Promise<HeadlessPageStream> {
    assertPageIndex(pageIndex)
    const session = this.#requireSession()
    const page = session.book.pages[pageIndex]
    if (!page) throw new RangeError(`Reader page index is out of range: ${pageIndex}`)
    signal?.throwIfAborted()
    const source = await page.content.load(signal)
    try {
      const stream = await source.open(signal)
      return new OwnedHeadlessPageStream(pageSnapshot(page), source, stream)
    } catch (error) {
      await source.close().catch(() => undefined)
      throw error
    }
  }

  async closeBook(): Promise<void> {
    const session = this.#session
    this.#session = undefined
    await session?.close()
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (this.#disposing) return this.#disposing
    this.#closed = true
    this.#disposing = Promise.resolve().then(async () => {
      const session = this.#session
      this.#session = undefined
      const errors: unknown[] = []
      for (const dispose of [
        session ? () => session.close() : undefined,
        () => this.#service[Symbol.asyncDispose](),
        this.#disposeDependencies,
      ]) {
        if (!dispose) continue
        try {
          await dispose()
        } catch (error) {
          errors.push(error)
        }
      }
      if (errors.length) throw new AggregateError(errors, "Failed to close the headless reader.")
    })
    return this.#disposing
  }

  #requireSession(): ReaderSession {
    this.#assertOpen()
    if (!this.#session) throw new Error("No reader book is open.")
    return this.#session
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Headless reader is closed.")
  }
}

class OwnedHeadlessPageStream implements HeadlessPageStream {
  readonly page: HeadlessReaderPageSnapshot
  readonly stream: ReadableStream<Uint8Array>
  readonly byteLength?: number
  readonly contentType?: string
  readonly #source: PageSource
  #closing: Promise<void> | undefined

  constructor(page: HeadlessReaderPageSnapshot, source: PageSource, stream: ReadableStream<Uint8Array>) {
    this.page = page
    this.#source = source
    this.stream = stream
    this.byteLength = source.byteLength
    this.contentType = source.contentType
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing
    this.#closing = Promise.resolve().then(async () => {
      await this.stream.cancel("headless page stream closed").catch(() => undefined)
      await this.#source.close()
    })
    return this.#closing
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }
}

function snapshotOf(session: ReaderSession): HeadlessReaderSnapshot {
  const frame = session.snapshot()
  return {
    book: {
      displayName: session.book.displayName,
      pageCount: session.book.pages.length,
    },
    frame,
    visiblePages: frame.pages.flatMap(({ pageId }) => {
      const page = session.getPage(pageId)
      return page ? [pageSnapshot(page)] : []
    }),
  }
}

function pageSnapshot(page: ReaderPage): HeadlessReaderPageSnapshot {
  return {
    id: page.id,
    index: page.index,
    name: page.name,
    mediaKind: page.mediaKind,
    mimeType: page.mimeType,
    byteLength: page.byteLength,
    dimensions: page.dimensions ? { ...page.dimensions } : undefined,
    contentVersion: page.contentVersion,
  }
}

function assertEntryPaths(entryPaths: readonly string[] | undefined): void {
  if (entryPaths === undefined) return
  if (!entryPaths.length || entryPaths.length > 16 || entryPaths.some((entry) => !entry.trim())) {
    throw new Error("Archive entry paths must contain between 1 and 16 non-empty paths.")
  }
}

function assertInitialPage(value: number | undefined): void {
  if (value !== undefined) assertPageIndex(value)
}

function assertPageIndex(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Invalid reader page index: ${value}`)
}

function assertSlice(cursor: number, limit: number, pageCount: number): void {
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > pageCount) {
    throw new RangeError(`Invalid reader page cursor: ${cursor}`)
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new RangeError(`Invalid reader page limit: ${limit}`)
  }
}
