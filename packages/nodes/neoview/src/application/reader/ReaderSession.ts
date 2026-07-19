import type { ReaderBook } from "../../domain/book/book.js"
import { buildFrameSnapshot, firstReaderPagePart, isSplitWidePage, secondReaderPagePart } from "../../domain/frame/frame-builder.js"
import { LRUCache } from "lru-cache"
import type { FrameSnapshot, ReaderGeneration, ReaderPagePart } from "../../domain/frame/frame.js"
import type { PageId, ReaderPage } from "../../domain/page/page.js"
import type { ImageMetadataProbe } from "../../ports/ImageMetadataProbe.js"
import { ReaderPreloadCoordinator, type ReaderNavigationIntent, type ReaderPreloadContext, type ReaderPreloadPlan } from "../preloading/PreloadCoordinator.js"
import { ReaderPreloadTelemetry, type ReaderPreloadReport, type ReaderPreloadReportResult, type ReaderPreloadTelemetrySnapshot } from "../preloading/PreloadTelemetry.js"
import {
  DEFAULT_READER_SESSION_OPTIONS,
  type ReaderSession,
  type ReaderSessionEvent,
  type ReaderSessionId,
  type ReaderSessionOptions,
} from "./contracts.js"
import {
  DEFAULT_READER_PAGE_ORDER,
  normalizeReaderPageOrder,
  orderReaderPages,
  type ReaderPageOrder,
  type ReaderPageOrderPatch,
} from "./ReaderPageOrder.js"

export class CoreReaderSession implements ReaderSession {
  readonly id: ReaderSessionId
  readonly book: ReaderBook
  #generation: ReaderGeneration = 0
  readonly #pagesById: ReadonlyMap<PageId, ReaderPage>
  #pageIndexById: ReadonlyMap<PageId, number>
  #pages: readonly ReaderPage[]
  #pageOrder: ReaderPageOrder = DEFAULT_READER_PAGE_ORDER
  #anchorPageIndex = 0
  #anchorPart: ReaderPagePart | undefined
  #options: ReaderSessionOptions
  #listeners = new Set<(event: ReaderSessionEvent) => void>()
  #closed = false
  #closing: Promise<void> | undefined
  #metadataResolved = new Set<PageId>()
  #metadataProbes = new Map<PageId, Promise<void>>()
  #onClose?: (sessionId: ReaderSessionId, snapshot: FrameSnapshot) => void | Promise<void>
  readonly #metadataProbe?: ImageMetadataProbe
  #preload: ReaderPreloadCoordinator
  readonly #preloadTelemetry = new ReaderPreloadTelemetry()
  #preloadPlan?: ReaderPreloadPlan
  #preloadContext: ReaderPreloadContext = {}
  readonly #frameWindowCache = new LRUCache<string, readonly FrameSnapshot[]>({ max: 32, ttl: 2_000 })
  readonly #frameWindowPending = new Map<string, Promise<readonly FrameSnapshot[]>>()

  constructor(
    id: ReaderSessionId,
    book: ReaderBook,
    options: Partial<ReaderSessionOptions> = {},
    onClose?: (sessionId: ReaderSessionId, snapshot: FrameSnapshot) => void | Promise<void>,
    metadataProbe?: ImageMetadataProbe,
    initialPageOrder?: ReaderPageOrderPatch,
  ) {
    assertBook(book)
    this.id = id
    this.book = book
    this.#pagesById = new Map(book.pages.map((page) => [page.id, page]))
    this.#pageOrder = initialPageOrder === undefined
      ? DEFAULT_READER_PAGE_ORDER
      : normalizeReaderPageOrder(initialPageOrder)
    this.#pages = initialPageOrder === undefined ? book.pages : orderReaderPages(book.pages, this.#pageOrder)
    this.#pageIndexById = pageIndexMap(this.#pages)
    this.#options = mergeOptions(DEFAULT_READER_SESSION_OPTIONS, options)
    this.#onClose = onClose
    this.#metadataProbe = metadataProbe
    this.#preload = new ReaderPreloadCoordinator(this.#pages)
  }

  get pages(): readonly ReaderPage[] {
    return this.#pages
  }

  get pageOrder(): ReaderPageOrder {
    return this.#pageOrder
  }

  get generation(): ReaderGeneration {
    return this.#generation
  }

  snapshot(): FrameSnapshot {
    this.#assertOpen()
    return buildFrameSnapshot({
      pages: this.#pages,
      anchorPageIndex: this.#anchorPageIndex,
      anchorPart: this.#anchorPart,
      generation: this.#generation,
      direction: this.#options.direction,
      layout: this.#options.layout,
    })
  }

  getPage(pageId: PageId): ReaderPage | undefined {
    this.#assertOpen()
    return this.#pagesById.get(pageId)
  }

  pageIndex(pageId: PageId): number | undefined {
    this.#assertOpen()
    return this.#pageIndexById.get(pageId)
  }

  async frameWindow(centerPageIndex: number, radius: number, signal?: AbortSignal): Promise<readonly FrameSnapshot[]> {
    this.#assertOpen()
    const boundedRadius = Math.min(Math.max(Math.trunc(radius), 0), 8)
    const center = clamp(centerPageIndex, this.#pages.length)
    const centerPart = center === this.#anchorPageIndex ? this.#anchorPart : undefined
    const cacheKey = `${this.#generation}:${center}:${centerPart ?? "full"}:${boundedRadius}:${this.#options.direction}:${JSON.stringify(this.#options.layout)}`
    const cached = this.#frameWindowCache.get(cacheKey)
    if (cached) return cached
    const pending = this.#frameWindowPending.get(cacheKey)
    if (pending) return pending

    const operation = this.#buildFrameWindow(center, centerPart, boundedRadius, signal)
    this.#frameWindowPending.set(cacheKey, operation)
    void operation.then((frames) => this.#frameWindowCache.set(cacheKey, frames)).catch(() => undefined).finally(() => {
      if (this.#frameWindowPending.get(cacheKey) === operation) this.#frameWindowPending.delete(cacheKey)
    })
    return operation
  }

  async #buildFrameWindow(centerPageIndex: number, centerPart: ReaderPagePart | undefined, boundedRadius: number, signal?: AbortSignal): Promise<readonly FrameSnapshot[]> {
    const center = await this.#snapshotAt(centerPageIndex, centerPart, signal)
    const before: FrameSnapshot[] = []
    const after: FrameSnapshot[] = []
    let first = center
    let last = center

    for (let offset = 0; offset < boundedRadius && !first.atStart; offset += 1) {
      const previous = await this.#adjacentSnapshot(first, "previous", signal)
      if (!previous) break
      before.unshift(previous)
      first = previous
    }
    for (let offset = 0; offset < boundedRadius && !last.atEnd; offset += 1) {
      const next = await this.#adjacentSnapshot(last, "next", signal)
      if (!next) break
      after.push(next)
      last = next
    }
    return [...before, center, ...after]
  }

  preloadPlan(): ReaderPreloadPlan | undefined {
    return this.#preloadPlan
  }

  cancelSpeculativePreload(): ReaderPreloadPlan {
    this.#assertOpen()
    const plan = this.#preload.update(this.snapshot(), "layout", {
      ...this.#preloadContext,
      focused: false,
    })
    this.#preloadPlan = plan
    this.#preloadTelemetry.updatePlan(plan)
    return plan
  }

  updatePreloadContext(context: ReaderPreloadContext): ReaderPreloadPlan {
    this.#assertOpen()
    const plan = this.#preload.update(this.snapshot(), "layout", context)
    this.#preloadContext = { ...context }
    this.#preloadPlan = plan
    this.#preloadTelemetry.updatePlan(plan)
    return plan
  }

  preloadTelemetry(): ReaderPreloadTelemetrySnapshot {
    return this.#preloadTelemetry.snapshot()
  }

  reportPreload(report: ReaderPreloadReport): ReaderPreloadReportResult {
    this.#assertOpen()
    return this.#preloadTelemetry.report(report)
  }

  async initialize(pageIndex = 0, signal?: AbortSignal): Promise<FrameSnapshot> {
    this.#assertOpen()
    signal?.throwIfAborted()
    const target = clamp(pageIndex, this.#pages.length)
    await this.#prepareFrameMetadata(target, this.#options, signal)
    signal?.throwIfAborted()
    this.#anchorPageIndex = target
    this.#anchorPart = this.#firstPartFor(target, this.#options)
    const frame = this.snapshot()
    this.#refreshPreload(frame, "initial")
    return frame
  }

  async goTo(pageIndex: number, signal?: AbortSignal): Promise<FrameSnapshot> {
    return this.#goTo(pageIndex, "go-to", signal)
  }

  async #goTo(pageIndex: number, intent: ReaderNavigationIntent, signal?: AbortSignal, part?: ReaderPagePart): Promise<FrameSnapshot> {
    this.#assertOpen()
    signal?.throwIfAborted()
    const current = this.snapshot()
    const target = clamp(pageIndex, this.#pages.length)
    await this.#prepareFrameMetadata(target, this.#options, signal)
    signal?.throwIfAborted()
    const nextPart = this.#partFor(target, this.#options, part)
    const preservePreload = target === this.#anchorPageIndex
      && current.anchorPart !== undefined
      && nextPart !== undefined
      && current.anchorPart !== nextPart
    this.#anchorPageIndex = target
    this.#anchorPart = nextPart
    this.#generation += 1
    return this.#publishFrame(intent, preservePreload)
  }

  async next(signal?: AbortSignal): Promise<FrameSnapshot> {
    const current = this.snapshot()
    if (current.anchorPart === firstReaderPagePart(current.direction)) {
      return this.#goTo(current.anchorPageIndex, "next", signal, secondReaderPagePart(current.direction))
    }
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
    if (current.anchorPart === secondReaderPagePart(current.direction)) {
      return this.#goTo(current.anchorPageIndex, "previous", signal, firstReaderPagePart(current.direction))
    }
    if (current.atStart) return current
    const previousIndex = current.anchorPageIndex - Math.max(current.pages.length, 1)
    const previousPart = this.#secondPartFor(previousIndex, this.#options)
    return this.#goTo(previousIndex, "previous", signal, previousPart)
  }

  async updateOptions(options: Partial<ReaderSessionOptions>, signal?: AbortSignal): Promise<FrameSnapshot> {
    this.#assertOpen()
    signal?.throwIfAborted()
    const nextOptions = mergeOptions(this.#options, options)
    await this.#prepareFrameMetadata(this.#anchorPageIndex, nextOptions, signal)
    signal?.throwIfAborted()
    this.#options = nextOptions
    this.#anchorPart = this.#firstPartFor(this.#anchorPageIndex, nextOptions)
    this.#generation += 1
    return this.#publishFrame("layout")
  }

  async updatePageOrder(patch: ReaderPageOrderPatch, signal?: AbortSignal): Promise<FrameSnapshot> {
    this.#assertOpen()
    signal?.throwIfAborted()
    const currentPageId = this.#pages[this.#anchorPageIndex]?.id
    const nextOrder = normalizeReaderPageOrder(patch, this.#pageOrder)
    const nextPages = orderReaderPages(this.book.pages, nextOrder)
    signal?.throwIfAborted()
    this.#pages = nextPages
    this.#pageOrder = nextOrder
    this.#pageIndexById = pageIndexMap(nextPages)
    this.#anchorPageIndex = currentPageId === undefined ? 0 : this.#pageIndexById.get(currentPageId) ?? 0
    await this.#prepareFrameMetadata(this.#anchorPageIndex, this.#options, signal)
    signal?.throwIfAborted()
    this.#anchorPart = this.#firstPartFor(this.#anchorPageIndex, this.#options)
    this.#generation += 1
    this.#frameWindowCache.clear()
    this.#frameWindowPending.clear()
    this.#preload.replacePages(this.#pages)
    this.#emit({ type: "pages-changed", pages: this.#pages, generation: this.#generation })
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
    this.#frameWindowCache.clear()
    this.#frameWindowPending.clear()
    this.#closed = true
    this.#preloadTelemetry.close()
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

  #publishFrame(intent: ReaderNavigationIntent, preservePreload = false): FrameSnapshot {
    const snapshot = this.snapshot()
    if (preservePreload) {
      this.#preloadPlan = this.#preload.retargetFrame(snapshot) ?? this.#preload.update(snapshot, intent, this.#preloadContext)
      this.#preloadTelemetry.updatePlan(this.#preloadPlan)
    } else {
      this.#refreshPreload(snapshot, intent)
    }
    this.#emit({ type: "frame", snapshot })
    return snapshot
  }

  #refreshPreload(frame: FrameSnapshot, intent: ReaderNavigationIntent): void {
    this.#preloadPlan = this.#preload.update(frame, intent, this.#preloadContext)
    this.#preloadTelemetry.updatePlan(this.#preloadPlan)
  }

  async #prepareFrameMetadata(
    anchorPageIndex: number,
    options: ReaderSessionOptions,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!this.#metadataProbe) return
    const pages = [this.#pages[anchorPageIndex]]
    if (options.layout.pageMode === "double") pages.push(this.#pages[anchorPageIndex + 1])
    await Promise.all(pages.filter((page): page is ReaderPage => Boolean(page)).map((page) => this.#probePage(page, signal)))
  }

  async #snapshotAt(anchorPageIndex: number, anchorPart?: ReaderPagePart, signal?: AbortSignal): Promise<FrameSnapshot> {
    await this.#prepareFrameMetadata(anchorPageIndex, this.#options, signal)
    signal?.throwIfAborted()
    return buildFrameSnapshot({
      pages: this.#pages,
      anchorPageIndex,
      anchorPart,
      generation: this.#generation,
      direction: this.#options.direction,
      layout: this.#options.layout,
    })
  }

  async #previousSnapshot(firstPageIndex: number, signal?: AbortSignal): Promise<FrameSnapshot | undefined> {
    const candidates: FrameSnapshot[] = []
    for (let anchor = Math.max(0, firstPageIndex - 2); anchor < firstPageIndex; anchor += 1) {
      const candidate = await this.#snapshotAt(anchor, undefined, signal)
      const last = Math.max(...candidate.pages.map((page) => page.pageIndex), candidate.anchorPageIndex)
      if (last < firstPageIndex) candidates.push(candidate)
    }
    return candidates.slice().sort((left, right) => {
      const leftLast = Math.max(...left.pages.map((page) => page.pageIndex), left.anchorPageIndex)
      const rightLast = Math.max(...right.pages.map((page) => page.pageIndex), right.anchorPageIndex)
      return rightLast - leftLast || right.anchorPageIndex - left.anchorPageIndex
    })[0]
  }

  async #adjacentSnapshot(frame: FrameSnapshot, direction: "next" | "previous", signal?: AbortSignal): Promise<FrameSnapshot | undefined> {
    if (direction === "next") {
      if (frame.anchorPart === firstReaderPagePart(frame.direction)) {
        return this.#snapshotAt(frame.anchorPageIndex, secondReaderPagePart(frame.direction), signal)
      }
      const lastPageIndex = Math.max(...frame.pages.map((page) => page.pageIndex), frame.anchorPageIndex)
      if (lastPageIndex >= this.#pages.length - 1) return undefined
      const nextIndex = lastPageIndex + 1
      return this.#snapshotAt(nextIndex, this.#firstPartFor(nextIndex, this.#options), signal)
    }
    if (frame.anchorPart === secondReaderPagePart(frame.direction)) {
      return this.#snapshotAt(frame.anchorPageIndex, firstReaderPagePart(frame.direction), signal)
    }
    const firstPageIndex = Math.min(...frame.pages.map((page) => page.pageIndex), frame.anchorPageIndex)
    if (firstPageIndex <= 0) return undefined
    const previous = await this.#previousSnapshot(firstPageIndex, signal)
    if (!previous) return undefined
    const part = this.#secondPartFor(previous.anchorPageIndex, this.#options)
    return part === undefined ? previous : this.#snapshotAt(previous.anchorPageIndex, part, signal)
  }

  #partFor(pageIndex: number, options: ReaderSessionOptions, requested?: ReaderPagePart): ReaderPagePart | undefined {
    if (!isSplitWidePage(this.#pages[pageIndex], options.layout)) return undefined
    return requested === 0 || requested === 1 ? requested : firstReaderPagePart(options.direction)
  }

  #firstPartFor(pageIndex: number, options: ReaderSessionOptions): ReaderPagePart | undefined {
    return this.#partFor(pageIndex, options, firstReaderPagePart(options.direction))
  }

  #secondPartFor(pageIndex: number, options: ReaderSessionOptions): ReaderPagePart | undefined {
    return this.#partFor(pageIndex, options, secondReaderPagePart(options.direction))
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

function pageIndexMap(pages: readonly ReaderPage[]): ReadonlyMap<PageId, number> {
  return new Map(pages.map((page, index) => [page.id, index]))
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
