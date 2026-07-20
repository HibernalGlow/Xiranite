import { describe, expect, it, vi } from "vitest"
import type { ReaderBook } from "../../domain/book/book.js"
import type { ReaderPage } from "../../domain/page/page.js"
import type { PageContent } from "../../domain/page/page-content.js"
import type { ImageMetadataProbe } from "../../ports/ImageMetadataProbe.js"
import type { ReaderProgressRecord, ReaderProgressStore } from "../../ports/ReaderProgressStore.js"
import { CoreReaderService } from "./ReaderService.js"
import { CoreReaderSession } from "./ReaderSession.js"
import { DEFAULT_READER_SESSION_OPTIONS } from "./contracts.js"

describe("CoreReaderSession", () => {
  it("[neoview.session.navigation] advances by frames and increments generation", async () => {
    const session = new CoreReaderSession("reader-1", book(4), {
      layout: { pageMode: "double", panorama: false, singleFirstPage: false, singleLastPage: false, treatWidePageAsSingle: false },
    })
    expect(session.snapshot().pages.map((page) => page.pageIndex)).toEqual([0, 1])
    const next = await session.next()
    expect(next.pages.map((page) => page.pageIndex)).toEqual([2, 3])
    expect(next.generation).toBe(1)
    const previous = await session.previous()
    expect(previous.pages.map((page) => page.pageIndex)).toEqual([0, 1])
    expect(previous.generation).toBe(2)
  })

  it("[neoview.session.navigation] honors loop and reports next-book boundaries", async () => {
    const loop = new CoreReaderSession("loop", book(2), { tailOverflow: "loop" })
    await loop.goTo(1)
    expect((await loop.next()).anchorPageIndex).toBe(0)

    const nextBook = new CoreReaderSession("next-book", book(1), { tailOverflow: "next-book" })
    const listener = vi.fn()
    nextBook.subscribe(listener)
    await nextBook.next()
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: "error", code: "NEXT_BOOK_REQUIRED" }))
  })

  it("[neoview.session.frame-window-cache] reuses identical windows within one frame generation", async () => {
    const session = new CoreReaderSession("window-cache", book(8), {
      layout: { pageMode: "double", panorama: true, singleFirstPage: false, singleLastPage: false, treatWidePageAsSingle: true },
    })
    const [first, second] = await Promise.all([
      session.frameWindow(2, 2),
      session.frameWindow(2, 2),
    ])
    expect(first).toBe(second)
    expect(first.map((frame) => frame.anchorPageIndex)).toEqual([0, 2, 4, 6])
    const cached = await session.frameWindow(2, 2)
    expect(cached).toBe(first)
    await session.goTo(4)
    expect(await session.frameWindow(2, 2)).not.toBe(first)
  })

  it("[neoview.reader.split-wide-pages] navigates landscape halves without duplicating physical pages", async () => {
    const sourceBook = book(3)
    sourceBook.pages[0]!.dimensions = { width: 1600, height: 900 }
    sourceBook.pages[1]!.dimensions = { width: 900, height: 1600 }
    sourceBook.pages[2]!.dimensions = { width: 1600, height: 900 }
    const session = new CoreReaderSession("split-wide", sourceBook, {
      direction: "left-to-right",
      layout: { ...DEFAULT_READER_SESSION_OPTIONS.layout, pageMode: "single", splitWidePages: true },
    })

    expect(session.snapshot()).toMatchObject({
      anchorPageIndex: 0,
      anchorPart: 0,
      atStart: true,
      atEnd: false,
      pages: [{ pageIndex: 0, part: 0, cropInsets: { top: 0, right: 50, bottom: 0, left: 0 } }],
    })
    session.updatePreloadContext({ mode: "paged" })
    const firstPreloadGeneration = session.preloadPlan()!.generation
    expect(await session.next()).toMatchObject({ anchorPageIndex: 0, anchorPart: 1, atStart: false })
    expect(session.preloadPlan()).toMatchObject({ generation: firstPreloadGeneration, frameGeneration: session.generation })
    const portrait = await session.next()
    expect(portrait).toMatchObject({ anchorPageIndex: 1, pages: [{ pageIndex: 1 }] })
    expect(portrait.pages[0]).not.toHaveProperty("part")
    expect(await session.next()).toMatchObject({ anchorPageIndex: 2, anchorPart: 0, atEnd: false })
    expect(await session.next()).toMatchObject({ anchorPageIndex: 2, anchorPart: 1, atEnd: true })
    expect(await session.previous()).toMatchObject({ anchorPageIndex: 2, anchorPart: 0 })
    const previousPortrait = await session.previous()
    expect(previousPortrait).toMatchObject({ anchorPageIndex: 1 })
    expect(previousPortrait).not.toHaveProperty("anchorPart")

    const window = await session.frameWindow(1, 2)
    expect(window.map((frame) => [frame.anchorPageIndex, frame.anchorPart])).toEqual([[0, 0], [0, 1], [1, undefined], [2, 0], [2, 1]])
  })

  it("[neoview.reader.split-wide-pages] starts RTL pages on the right half and resets go-to deterministically", async () => {
    const sourceBook = book(2)
    for (const page of sourceBook.pages) page.dimensions = { width: 1600, height: 900 }
    const session = new CoreReaderSession("split-wide-rtl", sourceBook, {
      direction: "right-to-left",
      layout: { ...DEFAULT_READER_SESSION_OPTIONS.layout, pageMode: "single", splitWidePages: true },
    })

    expect(session.snapshot()).toMatchObject({ anchorPageIndex: 0, anchorPart: 1, pages: [{ part: 1, cropInsets: { left: 50, right: 0 } }] })
    expect(await session.next()).toMatchObject({ anchorPageIndex: 0, anchorPart: 0 })
    expect(await session.next()).toMatchObject({ anchorPageIndex: 1, anchorPart: 1 })
    expect(await session.previous()).toMatchObject({ anchorPageIndex: 0, anchorPart: 0 })
    expect(await session.goTo(1)).toMatchObject({ anchorPageIndex: 1, anchorPart: 1 })
    const panorama = await session.updateOptions({ layout: { ...session.snapshot().layout, panorama: true } })
    expect(panorama).not.toHaveProperty("anchorPart")
    expect(panorama.pages[0]).not.toHaveProperty("cropInsets")
  })

  it("[neoview.toolbar.sort] reorders once, preserves physical identity, and keeps navigation index-based", async () => {
    const sourceBook = book(4)
    sourceBook.pages[0]!.name = "page10.jpg"
    sourceBook.pages[1]!.name = "clip.mp4"
    sourceBook.pages[1]!.mediaKind = "video"
    sourceBook.pages[2]!.name = "page2.jpg"
    sourceBook.pages[3]!.name = "cover.jpg"
    const session = new CoreReaderSession("page-order", sourceBook)
    await session.goTo(2)
    const physicalPage = session.getPage("page-2")
    const listener = vi.fn()
    session.subscribe(listener)

    const frame = await session.updatePageOrder({ sortMode: "fileName", mediaPriority: "videoFirst" })
    expect(session.pages.map((page) => page.name)).toEqual(["clip.mp4", "cover.jpg", "page2.jpg", "page10.jpg"])
    expect(session.pages[2]).toBe(physicalPage)
    expect(frame).toMatchObject({ anchorPageIndex: 2, pages: [{ pageId: "page-2", pageIndex: 2 }] })
    expect(session.pageIndex("page-2")).toBe(2)
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: "pages-changed" }))
    expect((await session.next()).pages[0]).toMatchObject({ pageId: "page-0", pageIndex: 3 })
    expect(session.preloadPlan()!.currentPageIndexes).toEqual([3])
  })

  it("[neoview.session.lifecycle] rejects cancelled navigation and closes idempotently", async () => {
    const sourceBook = book(2)
    const session = new CoreReaderSession("reader-1", sourceBook)
    const controller = new AbortController()
    controller.abort(new Error("cancelled"))
    await expect(session.goTo(1, controller.signal)).rejects.toThrow("cancelled")
    expect(session.generation).toBe(0)
    await session.close()
    await session.close()
    expect(sourceBook.close).toHaveBeenCalledOnce()
    expect(() => session.snapshot()).toThrow("closed")
  })
})

describe("CoreReaderService", () => {
  it("[neoview.toolbar.sort-locks] applies locked order before the first book snapshot", async () => {
    const source = book(3)
    source.pages[0]!.name = "page10.jpg"
    source.pages[1]!.name = "clip.mp4"
    source.pages[1]!.mediaKind = "video"
    source.pages[2]!.name = "page2.jpg"
    const service = new CoreReaderService(async () => source, undefined, {}, undefined, undefined, {
      sortMode: "fileNameDescending",
      mediaPriority: "videoFirst",
    })
    const session = await service.openViewSource({ kind: "directory", path: "C:/book" })
    expect(session.pageOrder).toMatchObject({ sortMode: "fileNameDescending", mediaPriority: "videoFirst" })
    expect(session.pages.map((page) => page.name)).toEqual(["clip.mp4", "page10.jpg", "page2.jpg"])
    expect(session.snapshot().pages[0]).toMatchObject({ pageId: "page-1", pageIndex: 0 })
    await service[Symbol.asyncDispose]()
  })

  it("[neoview.settings.runtime] applies service defaults while explicit open options win", async () => {
    const service = new CoreReaderService(async () => book(4), undefined, {
      direction: "right-to-left",
      layout: { pageMode: "double", panorama: false, singleFirstPage: false, singleLastPage: false, treatWidePageAsSingle: false },
      tailOverflow: "loop",
    })
    const configured = await service.openViewSource({ kind: "directory", path: "C:/configured" })
    expect(configured.snapshot()).toMatchObject({
      direction: "right-to-left",
      layout: { pageMode: "double" },
      pages: [{ pageIndex: 1 }, { pageIndex: 0 }],
    })
    await configured.goTo(3)
    expect((await configured.next()).anchorPageIndex).toBe(0)

    const explicit = await service.openViewSource({ kind: "directory", path: "C:/explicit" }, {
      direction: "left-to-right",
      layout: { pageMode: "single", panorama: false, singleFirstPage: true, singleLastPage: true, treatWidePageAsSingle: true },
      tailOverflow: "stay-on-last-page",
    })
    expect(explicit.snapshot()).toMatchObject({ direction: "left-to-right", layout: { pageMode: "single" } })
    await explicit.goTo(3)
    expect((await explicit.next()).anchorPageIndex).toBe(3)
    await service[Symbol.asyncDispose]()
  })

  it("[neoview.session.lifecycle] owns sessions and releases them on close/dispose", async () => {
    const loaded = book(3)
    loaded.runtimeResources = () => ({ archiveProviders: 1, archiveIndexEntries: 3, archiveIndexPayloadBytes: 96, archiveActiveExtractions: 0 })
    const loader = vi.fn(async () => loaded)
    const service = new CoreReaderService(loader)
    const first = await service.openViewSource({ kind: "directory", path: "C:/book" }, { initialPage: 2 })
    expect(service.sessionCount).toBe(1)
    expect(service.runtimeResourceDiagnostics()).toEqual({ archiveProviders: 1, archiveIndexEntries: 3, archiveIndexPayloadBytes: 96, archiveActiveExtractions: 0 })
    expect(first.snapshot().anchorPageIndex).toBe(2)
    expect(service.getSession(first.id)).toBe(first)
    await service.closeSession(first.id)
    expect(service.sessionCount).toBe(0)
    expect(service.runtimeResourceDiagnostics()).toEqual({ archiveProviders: 0, archiveIndexEntries: 0, archiveIndexPayloadBytes: 0, archiveActiveExtractions: 0 })
    expect(service.getSession(first.id)).toBeUndefined()
    expect(first.book.close).toHaveBeenCalledOnce()

    const second = await service.openViewSource({ kind: "image", path: "C:/book/1.jpg" })
    expect(service.sessionCount).toBe(1)
    await service[Symbol.asyncDispose]()
    expect(service.sessionCount).toBe(0)
    expect(service.getSession(second.id)).toBeUndefined()
    await expect(service.openViewSource({ kind: "image", path: "x" })).rejects.toThrow("closed")
  })

  it("[neoview.preload.viewport-session] updates only the preload generation and carries viewport admission into navigation", async () => {
    const service = new CoreReaderService(async () => book(8))
    const session = await service.openViewSource({ kind: "directory", path: "C:/book" }, { initialPage: 2 })
    const frameGeneration = session.generation
    const paused = session.updatePreloadContext({ mode: "continuous", velocityPagesPerSecond: 5, stableForMs: 200 })
    expect(paused).toMatchObject({ admission: "paused", candidates: [], frameGeneration })
    expect(session.generation).toBe(frameGeneration)
    const next = await session.next()
    expect(next.generation).toBe(frameGeneration + 1)
    expect(session.preloadPlan()).toMatchObject({ admission: "paused", frameGeneration: frameGeneration + 1 })
    const resumed = session.updatePreloadContext({ mode: "continuous", velocityPagesPerSecond: 0.5, stableForMs: 200 })
    expect(resumed.admission).toBe("normal")
    expect(resumed.candidates.length).toBeGreaterThan(0)
    await service[Symbol.asyncDispose]()
  })

  it("[neoview.preload.config-session] applies the shared candidate budget to every new session", async () => {
    const service = new CoreReaderService(async () => book(10), undefined, {}, undefined, undefined, undefined, { maxCandidatePages: 2 })
    const session = await service.openViewSource({ kind: "directory", path: "C:/book" }, { initialPage: 3 })
    expect(session.preloadPlan()?.candidates.flatMap((candidate) => candidate.pageIndexes)).toHaveLength(2)
    await service[Symbol.asyncDispose]()
  })

  it("[neoview.preload.cancel-speculative] pauses a fresh empty generation, cancels active telemetry and resumes on navigation", async () => {
    const service = new CoreReaderService(async () => book(8))
    const session = await service.openViewSource({ kind: "directory", path: "C:/book" }, { initialPage: 2 })
    const initial = session.preloadPlan()!
    const startedPageId = initial.candidates[0]!.pageIds[0]!
    expect(session.reportPreload({ generation: initial.generation, pageId: startedPageId, outcome: "started" })).toEqual({ accepted: true })

    const cancelled = session.cancelSpeculativePreload()
    expect(cancelled).toMatchObject({ admission: "paused", candidates: [], frameGeneration: session.generation })
    expect(cancelled.generation).toBeGreaterThan(initial.generation)
    expect(session.preloadTelemetry()).toMatchObject({ active: 0, started: 1, cancelled: 1, generation: cancelled.generation })
    expect(session.reportPreload({ generation: initial.generation, pageId: startedPageId, outcome: "ready" }))
      .toEqual({ accepted: false, reason: "stale-generation" })

    await session.next()
    expect(session.preloadPlan()).toMatchObject({ admission: "normal" })
    expect(session.preloadPlan()!.generation).toBeGreaterThan(cancelled.generation)
    expect(session.preloadPlan()!.candidates.length).toBeGreaterThan(0)
    await service[Symbol.asyncDispose]()
  })

  it("[neoview.session.lifecycle] disposes a loaded book when cancellation wins the post-load race", async () => {
    const controller = new AbortController()
    const loaded = book(1)
    const service = new CoreReaderService(async () => {
      controller.abort(new Error("cancelled after load"))
      return loaded
    })
    await expect(service.openViewSource(
      { kind: "image", path: "C:/book/1.jpg" },
      { signal: controller.signal },
    )).rejects.toThrow("cancelled after load")
    expect(loaded.close).toHaveBeenCalledOnce()
    await service[Symbol.asyncDispose]()
  })

  it("[neoview.session.lifecycle] closes a loaded book when settings restoration is cancelled before session ownership", async () => {
    const controller = new AbortController()
    const loaded = book(1)
    let settingsStarted!: () => void
    let releaseSettings!: () => void
    const settingsStartedPromise = new Promise<void>((resolve) => {
      settingsStarted = resolve
    })
    const settingsPending = new Promise<void>((resolve) => {
      releaseSettings = resolve
    })
    const store: ReaderBookSettingsStore = {
      async getBookSettings() {
        settingsStarted()
        await settingsPending
        return undefined
      },
      async saveBookSettings() {
        return undefined
      },
      async importBookSettings() {
        return { inserted: 0, updated: 0, unchanged: 0 }
      },
    }
    const service = new CoreReaderService(async () => loaded, undefined, {}, undefined, store)
    const opening = service.openViewSource(
      { kind: "image", path: "C:/book/1.jpg" },
      { signal: controller.signal },
    )

    await settingsStartedPromise
    controller.abort(new DOMException("cancelled while restoring settings", "AbortError"))
    releaseSettings()

    await expect(opening).rejects.toMatchObject({ name: "AbortError" })
    expect(loaded.close).toHaveBeenCalledOnce()
    expect(service.sessionCount).toBe(0)
    await service[Symbol.asyncDispose]()
  })

  it("[neoview.session.lifecycle] rejects an in-flight open when service disposal wins the load race", async () => {
    let release!: (loaded: ReaderBook) => void
    const pending = new Promise<ReaderBook>((resolve) => {
      release = resolve
    })
    const loaded = book(1)
    const service = new CoreReaderService(() => pending)
    const opening = service.openViewSource({ kind: "path", path: "C:/book" })
    const disposal = service[Symbol.asyncDispose]()
    release(loaded)
    await expect(opening).rejects.toThrow("closed")
    expect(loaded.close).toHaveBeenCalledOnce()
    await disposal
  })

  it("[neoview.image.probe-layout] probes only frame candidates before applying wide and double-page layout", async () => {
    const { sourceBook, dimensions } = bookWithoutDimensions()
    const probe: ImageMetadataProbe = {
      probe: vi.fn(async (content) => ({
        format: "png",
        dimensions: dimensions.get(content)!,
        bytesRead: 24,
      })),
    }
    const service = new CoreReaderService(async () => sourceBook, probe)
    const session = await service.openViewSource({ kind: "directory", path: "C:/book" }, {
      layout: { pageMode: "double", panorama: false, singleFirstPage: false, singleLastPage: false, treatWidePageAsSingle: true },
    })
    expect(session.snapshot().pages.map((page) => page.pageIndex)).toEqual([0])
    expect(probe.probe).toHaveBeenCalledTimes(2)
    expect(session.book.pages[0]?.dimensions).toEqual({ width: 1600, height: 900 })

    const next = await session.next()
    expect(next.pages.map((page) => page.pageIndex)).toEqual([1, 2])
    expect(probe.probe).toHaveBeenCalledTimes(3)
    await service[Symbol.asyncDispose]()
  })

  it("[neoview.progress.restore] restores the last page while an explicit page wins", async () => {
    const store = memoryProgressStore({
      bookId: "book-1",
      source: { kind: "directory", path: "C:/book" },
      displayName: "Book",
      pageIndex: 2,
      pageCount: 4,
      updatedAt: 1,
    })
    const service = new CoreReaderService(async () => book(4), undefined, {}, store)
    const restored = await service.openViewSource({ kind: "directory", path: "C:/book" })
    expect(restored.snapshot().anchorPageIndex).toBe(2)
    await restored.close()

    const explicit = await service.openViewSource({ kind: "directory", path: "C:/book" }, { initialPage: 1 })
    expect(explicit.snapshot().anchorPageIndex).toBe(1)
    await service[Symbol.asyncDispose]()
  })

  it("[neoview.progress.flush] keeps navigation off the write path and flushes the latest page on close", async () => {
    let releaseWrite!: () => void
    const writes: ReaderProgressRecord[] = []
    const store = memoryProgressStore(undefined, async (progress) => {
      writes.push(progress)
      await new Promise<void>((resolve) => { releaseWrite = resolve })
    })
    const service = new CoreReaderService(async () => book(5), undefined, {}, store)
    const session = await service.openViewSource({ kind: "directory", path: "C:/book" })
    await session.goTo(1)
    await session.goTo(4)
    expect(writes).toEqual([])

    const closing = session.close()
    await vi.waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]?.pageIndex).toBe(4)
    let closed = false
    void closing.then(() => { closed = true })
    await Promise.resolve()
    expect(closed).toBe(false)
    releaseWrite()
    await closing
    await service[Symbol.asyncDispose]()
    expect(store.close).toHaveBeenCalledOnce()
  })
})

function book(pageCount: number): ReaderBook {
  const close = vi.fn(async () => undefined)
  return {
    id: "book-1",
    displayName: "Book",
    source: { kind: "directory", path: "C:/book" },
    pages: Array.from({ length: pageCount }, (_, index): ReaderPage => ({
      id: `page-${index}`,
      index,
      name: `${index}.jpg`,
      sourcePath: `C:/book/${index}.jpg`,
      mediaKind: "image",
      dimensions: { width: 800, height: 1200 },
      contentVersion: "fixture-v1",
      content: {
        async load() {
          throw new Error("Reader session tests do not load page content.")
        },
      },
    })),
    close,
    [Symbol.asyncDispose]: close,
  }
}

function bookWithoutDimensions(): { sourceBook: ReaderBook; dimensions: Map<PageContent, { width: number; height: number }> } {
  const dimensions = new Map<PageContent, { width: number; height: number }>()
  const pages = [
    { width: 1600, height: 900 },
    { width: 800, height: 1200 },
    { width: 800, height: 1200 },
  ].map((size, index): ReaderPage => {
    const content: PageContent = { async load() { throw new Error("Fake metadata probe owns this content.") } }
    dimensions.set(content, size)
    return {
      id: `probe-page-${index}`,
      index,
      name: `${index}.png`,
      sourcePath: `C:/book/${index}.png`,
      mediaKind: "image",
      mimeType: "image/png",
      contentVersion: "fixture-v1",
      content,
    }
  })
  const close = vi.fn(async () => undefined)
  return {
    dimensions,
    sourceBook: {
      id: "probe-book",
      displayName: "Probe Book",
      source: { kind: "directory", path: "C:/book" },
      pages,
      close,
      [Symbol.asyncDispose]: close,
    },
  }
}

function memoryProgressStore(
  initial?: ReaderProgressRecord,
  save: (progress: ReaderProgressRecord) => Promise<void> = async () => undefined,
): ReaderProgressStore & { close: ReturnType<typeof vi.fn> } {
  let current = initial
  const close = vi.fn(async () => undefined)
  return {
    async get() { return current },
    async save(progress) {
      current = progress
      await save(progress)
    },
    close,
    [Symbol.asyncDispose]: close,
  }
}
