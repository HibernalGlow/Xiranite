import type { ReaderBook, ViewSource } from "../../domain/book/book.js"
import type { FramePage, FrameSnapshot, ReaderGeneration } from "../../domain/frame/frame.js"
import type { PageId, ReaderPage } from "../../domain/page/page.js"
import type { PageByteRange, PageSource } from "../../domain/page/page-content.js"
import type {
  OpenViewSourceOptions,
  ReaderSession,
  ReaderSessionEvent,
  ReaderSessionId,
  ReaderSessionOptions,
} from "../../application/reader/contracts.js"
import { DEFAULT_READER_SESSION_OPTIONS } from "../../application/reader/contracts.js"
import { DEFAULT_READER_PAGE_ORDER, type ReaderPageOrder, type ReaderPageOrderPatch } from "../../application/reader/ReaderPageOrder.js"
import type { ReaderPreloadContext, ReaderPreloadPlan } from "../../application/preloading/PreloadCoordinator.js"
import {
  ReaderPreloadTelemetry,
  type ReaderPreloadReport,
  type ReaderPreloadReportResult,
  type ReaderPreloadTelemetrySnapshot,
} from "../../application/preloading/PreloadTelemetry.js"
import type { NeoxideNativeBinding } from "./neoxideNativeBinding.js"

class NeoxideNativePageSource implements PageSource {
  #bytes?: { data: Buffer; mimeType: string }

  constructor(
    private readonly binding: NeoxideNativeBinding,
    private readonly sessionId: string,
    private readonly pageIndex: number,
  ) {}

  #getBytes(): { data: Buffer; mimeType: string } {
    if (!this.#bytes) {
      this.#bytes = this.binding.readerGetPageBytes(this.sessionId, this.pageIndex)
    }
    return this.#bytes
  }

  get byteLength(): number | undefined {
    return this.#getBytes().data.length
  }

  get contentType(): string | undefined {
    return this.#getBytes().mimeType
  }

  readonly rangeSupported = true

  async open(_signal?: AbortSignal, range?: PageByteRange): Promise<ReadableStream<Uint8Array>> {
    const { data } = this.#getBytes()
    const slice = range ? data.subarray(range.start, range.end + 1) : data
    return new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(slice.buffer, slice.byteOffset, slice.byteLength))
        controller.close()
      },
    })
  }

  async close(): Promise<void> {
    this.#bytes = undefined
  }
  async [Symbol.asyncDispose](): Promise<void> {
    this.#bytes = undefined
  }
}

export class NeoxideNativeReaderSession implements ReaderSession {
  readonly id: ReaderSessionId
  readonly book: ReaderBook
  readonly pages: readonly ReaderPage[]
  readonly pageOrder: ReaderPageOrder = DEFAULT_READER_PAGE_ORDER
  #generation: ReaderGeneration = 0
  #currentFrame: FrameSnapshot
  #listeners = new Set<(event: ReaderSessionEvent) => void>()
  #pagesById = new Map<PageId, ReaderPage>()
  #pageIndexById = new Map<PageId, number>()
  #closed = false

  constructor(
    private readonly binding: NeoxideNativeBinding,
    rawSession: any,
    source: ViewSource,
    _options?: OpenViewSourceOptions,
  ) {
    this.id = rawSession.sessionId
    const bookTitle = rawSession.book?.displayName ?? "Book"
    const rawPages = (rawSession.visiblePages ?? []) as any[]

    const pageCount = rawSession.book?.pageCount ?? rawPages.length
    const pages: ReaderPage[] = []

    for (let idx = 0; idx < pageCount; idx++) {
      const rawPage = rawPages[idx]
      const pageId = rawPage?.id ?? `${this.id}:${idx}`
      const page: ReaderPage = {
        id: pageId,
        index: idx,
        name: rawPage?.name ?? `Page ${idx + 1}`,
        sourcePath: source.path,
        mediaKind: "image",
        mimeType: rawPage?.mimeType ?? "image/jpeg",
        contentVersion: rawPage?.contentVersion ?? "1",
        content: {
          load: async () => new NeoxideNativePageSource(this.binding, this.id, idx),
        },
      }
      pages.push(page)
      this.#pagesById.set(pageId, page)
      this.#pageIndexById.set(pageId, idx)
    }

    this.pages = Object.freeze(pages)
    this.book = {
      id: rawSession.book?.id ?? this.id,
      source,
      displayName: bookTitle,
      pages: this.pages,
      close: async () => this.close(),
      [Symbol.asyncDispose]: async () => this.close(),
    }

    this.#currentFrame = this.#convertFrameSnapshot(rawSession.frame)
  }

  get generation(): ReaderGeneration {
    return this.#generation
  }

  snapshot(): FrameSnapshot {
    return this.#currentFrame
  }

  readonly #preloadTelemetry = new ReaderPreloadTelemetry()
  readonly #emptyPlan: ReaderPreloadPlan = {
    generation: 0,
    frameGeneration: 0,
    direction: "forward",
    directionConfidence: 1,
    mode: "paged",
    admission: "normal",
    velocityPagesPerSecond: 0,
    stableForMs: 0,
    focused: true,
    queueWaitMs: 0,
    memoryPressure: "normal",
    currentPageIndexes: [0],
    candidates: [],
  }

  preloadPlan(): ReaderPreloadPlan | undefined {
    return undefined
  }

  cancelSpeculativePreload(): ReaderPreloadPlan {
    return this.#emptyPlan
  }

  updatePreloadContext(_context: ReaderPreloadContext): ReaderPreloadPlan {
    return this.#emptyPlan
  }

  preloadTelemetry(): ReaderPreloadTelemetrySnapshot {
    return this.#preloadTelemetry.snapshot()
  }

  reportPreload(report: ReaderPreloadReport): ReaderPreloadReportResult {
    return this.#preloadTelemetry.report(report)
  }

  getPage(pageId: PageId): ReaderPage | undefined {
    return this.#pagesById.get(pageId)
  }

  pageIndex(pageId: PageId): number | undefined {
    return this.#pageIndexById.get(pageId)
  }

  async frameWindow(centerPageIndex: number, radius: number, _signal?: AbortSignal): Promise<readonly FrameSnapshot[]> {
    if (this.#closed) return [this.#currentFrame]
    const raw = this.binding.readerFrameWindow(this.id, centerPageIndex, radius)
    if (Array.isArray(raw?.frames)) {
      return raw.frames.map((f: any) => this.#convertFrameSnapshot(f))
    }
    return [this.#currentFrame]
  }

  async goTo(pageIndex: number, _signal?: AbortSignal): Promise<FrameSnapshot> {
    if (this.#closed) return this.#currentFrame
    const nav = this.binding.readerGoto(this.id, pageIndex)
    this.#updateNav(nav)
    return this.#currentFrame
  }

  async next(_signal?: AbortSignal): Promise<FrameSnapshot> {
    if (this.#closed) return this.#currentFrame
    const nav = this.binding.readerNavigate(this.id, "next")
    this.#updateNav(nav)
    return this.#currentFrame
  }

  async previous(_signal?: AbortSignal): Promise<FrameSnapshot> {
    if (this.#closed) return this.#currentFrame
    const nav = this.binding.readerNavigate(this.id, "previous")
    this.#updateNav(nav)
    return this.#currentFrame
  }

  async updateOptions(_options: Partial<ReaderSessionOptions>, _signal?: AbortSignal): Promise<FrameSnapshot> {
    return this.#currentFrame
  }

  async updatePageOrder(_order: ReaderPageOrderPatch, _signal?: AbortSignal): Promise<FrameSnapshot> {
    return this.#currentFrame
  }

  subscribe(listener: (event: ReaderSessionEvent) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    try {
      this.binding.readerClose(this.id)
    } catch {}
    for (const listener of this.#listeners) {
      try {
        listener({ type: "closed", sessionId: this.id })
      } catch {}
    }
    this.#listeners.clear()
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }

  #updateNav(nav: any) {
    if (nav?.frame) {
      this.#generation++
      this.#currentFrame = this.#convertFrameSnapshot(nav.frame)
      for (const listener of this.#listeners) {
        try {
          listener({ type: "frame", snapshot: this.#currentFrame })
        } catch {}
      }
    }
  }

  #convertFrameSnapshot(raw: any): FrameSnapshot {
    const anchor = raw?.anchorPageIndex ?? 0
    const pageIndices: number[] = Array.isArray(raw?.pageIndices) && raw.pageIndices.length
      ? raw.pageIndices
      : [anchor]
    const pageMode = raw?.layout === "double" ? "double" : "single"
    const pages: FramePage[] = pageIndices.map((idx, i) => ({
      pageId: `${this.id}:${idx}`,
      pageIndex: idx,
      side: pageIndices.length > 1 ? (i === 0 ? "left" : "right") : "single",
    }))

    return {
      generation: this.#generation,
      anchorPageIndex: anchor,
      direction: raw?.direction === "right-to-left" ? "right-to-left" : "left-to-right",
      layout: {
        pageMode,
        panorama: false,
        singleFirstPage: true,
        singleLastPage: false,
        treatWidePageAsSingle: false,
      },
      pages,
      pageCount: this.pages?.length ?? 1,
      atStart: Boolean(raw?.atStart ?? anchor === 0),
      atEnd: Boolean(raw?.atEnd ?? (this.pages ? anchor >= this.pages.length - 1 : false)),
    }
  }
}
