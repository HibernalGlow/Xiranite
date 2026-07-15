import type { ReaderBook } from "../../domain/book/book.js"
import { buildFrameSnapshot } from "../../domain/frame/frame-builder.js"
import type { FrameSnapshot, ReaderGeneration } from "../../domain/frame/frame.js"
import type { PageId, ReaderPage } from "../../domain/page/page.js"
import type { ImageMetadataProbe } from "../../ports/ImageMetadataProbe.js"
import { ReaderPreloadCoordinator, type ReaderNavigationIntent, type ReaderPreloadPlan } from "../preloading/PreloadCoordinator.js"
import {
  DEFAULT_READER_SESSION_OPTIONS,
  type ReaderSession,
  type ReaderSessionEvent,
  type ReaderSessionId,
  type ReaderSessionOptions,
} from "./contracts.js"

export class CoreReaderSession implements ReaderSession {
  readonly id: ReaderSessionId
  readonly book: ReaderBook
  #generation: ReaderGeneration = 0
  readonly #pagesById: ReadonlyMap<PageId, ReaderPage>
  #anchorPageIndex = 0
  #options: ReaderSessionOptions
  #listeners = new Set<(event: ReaderSessionEvent) => void>()
  #closed = false
  #closing: Promise<void> | undefined
  #metadataResolved = new Set<PageId>()
  #metadataProbes = new Map<PageId, Promise<void>>()
  #onClose?: (sessionId: ReaderSessionId, snapshot: FrameSnapshot) => void | Promise<void>
  readonly #metadataProbe?: ImageMetadataProbe
  readonly #preload: ReaderPreloadCoordinator
  #preloadPlan?: ReaderPreloadPlan

  constructor(
    id: ReaderSessionId,
    book: ReaderBook,
    options: Partial<ReaderSessionOptions> = {},
    onClose?: (sessionId: ReaderSessionId, snapshot: FrameSnapshot) => void | Promise<void>,
    metadataProbe?: ImageMetadataProbe,
  ) {
    assertBook(book)
    this.id = id
    this.book = book
    this.#pagesById = new Map(book.pages.map((page) => [page.id, page]))
    this.#options = mergeOptions(DEFAULT_READER_SESSION_OPTIONS, options)
    this.#onClose = onClose
    this.#metadataProbe = metadataProbe
    this.#preload = new ReaderPreloadCoordinator(book.pages)
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

  getPage(pageId: PageId): ReaderPage | undefined {
    this.#assertOpen()
    return this.#pagesById.get(pageId)
  }

  preloadPlan(): ReaderPreloadPlan | undefined {
    return this.#preloadPlan
  }

  async initialize(pageIndex = 0, signal?: AbortSignal): Promise<FrameSnapshot> {
    this.#assertOpen()
    signal?.throwIfAborted()
    const target = clamp(pageIndex, this.book.pages.length)
    await this.#prepareFrameMetadata(target, this.#options, signal)
    signal?.throwIfAborted()
    this.#anchorPageIndex = target
    const frame = this.snapshot()
    this.#refreshPreload(frame, "initial")
    return frame
  }

  async goTo(pageIndex: number, signal?: AbortSignal): Promise<FrameSnapshot> {
    return this.#goTo(pageIndex, "go-to", signal)
  }

  async #goTo(pageIndex: number, intent: ReaderNavigationIntent, signal?: AbortSignal): Promise<FrameSnapshot> {
    this.#assertOpen()
    signal?.throwIfAborted()
    const target = clamp(pageIndex, this.book.pages.length)
    await this.#prepareFrameMetadata(target, this.#options, signal)
    signal?.throwIfAborted()
    this.#anchorPageIndex = target
    this.#generation += 1
    return this.#publishFrame(intent)
  }

  async next(signal?: AbortSignal): Promise<FrameSnapshot> {
    const current = this.snapshot()
    if (current.atEnd) {
      if (this.#options.tailOverflow === "loop" || this.#options.tailOverflow === "seamless-loop") {
        return this.#goTo(0, "next", signal)
      }
      if (this.#options.tailOverflow === "next-book") {
        this.#emit({ type: "error", code: "NEXT_BOOK_REQUIRED", message: "The next book must be resolved by ReaderService.", recoverable: true })
      }
      signal?.throwIfAborted()
      return current
    }
    const nextIndex = Math.max(...current.pages.map((page) => page.pageIndex)) + 1
    return this.#goTo(nextIndex, "next", signal)
  }

  async previous(signal?: AbortSignal): Promise<FrameSnapshot> {
    const current = this.snapshot()
    signal?.throwIfAborted()
    if (current.atStart) return current
    return this.#goTo(current.anchorPageIndex - Math.max(current.pages.length, 1), "previous", signal)
  }

  async updateOptions(options: Partial<ReaderSessionOptions>, signal?: AbortSignal): Promise<FrameSnapshot> {
    this.#assertOpen()
    signal?.throwIfAborted()
    const nextOptions = mergeOptions(this.#options, options)
    await this.#prepareFrameMetadata(this.#anchorPageIndex, nextOptions, signal)
    signal?.throwIfAborted()
    this.#options = nextOptions
    this.#generation += 1
    return this.#publishFrame("layout")
  }

  subscribe(listener: (event: ReaderSessionEvent) => void): () => void {
    this.#assertOpen()
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing
    const finalSnapshot = this.snapshot()
    this.#closed = true
    this.#closing = Promise.resolve().then(async () => {
      this.#emit({ type: "closed", sessionId: this.id })
      this.#listeners.clear()
      const onClose = this.#onClose
      this.#onClose = undefined
      const results = await Promise.allSettled([
        Promise.resolve(onClose?.(this.id, finalSnapshot)),
        this.book.close(),
      ])
      const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : [])
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1) throw new AggregateError(errors, `Failed to close reader session ${this.id}.`)
    })
    return this.#closing
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }

  #publishFrame(intent: ReaderNavigationIntent): FrameSnapshot {
    const snapshot = this.snapshot()
    this.#refreshPreload(snapshot, intent)
    this.#emit({ type: "frame", snapshot })
    return snapshot
  }

  #refreshPreload(frame: FrameSnapshot, intent: ReaderNavigationIntent): void {
    this.#preloadPlan = this.#preload.update(frame, intent)
  }

  async #prepareFrameMetadata(
    anchorPageIndex: number,
    options: ReaderSessionOptions,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!this.#metadataProbe) return
    const pages = [this.book.pages[anchorPageIndex]]
    if (options.layout.pageMode === "double") pages.push(this.book.pages[anchorPageIndex + 1])
    await Promise.all(pages.filter((page): page is ReaderPage => Boolean(page)).map((page) => this.#probePage(page, signal)))
  }

  async #probePage(page: ReaderPage, signal?: AbortSignal): Promise<void> {
    if (
      page.dimensions
      || this.#metadataResolved.has(page.id)
      || (page.mediaKind !== "image" && page.mediaKind !== "animated-image")
    ) return
    const active = this.#metadataProbes.get(page.id)
    if (active) return active
    const probe = (async () => {
      try {
        const metadata = await this.#metadataProbe!.probe(page.content, page.mimeType, signal)
        if (metadata) page.dimensions = metadata.dimensions
        this.#metadataResolved.add(page.id)
      } catch (error) {
        if (signal?.aborted) throw error
        this.#metadataResolved.add(page.id)
        this.#emit({
          type: "error",
          code: "IMAGE_METADATA_PROBE_FAILED",
          message: error instanceof Error ? error.message : String(error),
          recoverable: true,
        })
      } finally {
        this.#metadataProbes.delete(page.id)
      }
    })()
    this.#metadataProbes.set(page.id, probe)
    return probe
  }

  #emit(event: ReaderSessionEvent): void {
    for (const listener of Array.from(this.#listeners)) listener(event)
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error(`Reader session ${this.id} is closed.`)
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
