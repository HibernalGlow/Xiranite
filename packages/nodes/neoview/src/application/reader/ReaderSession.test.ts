import { describe, expect, it, vi } from "vitest"
import type { ReaderBook } from "../../domain/book/book.js"
import type { ReaderPage } from "../../domain/page/page.js"
import type { PageContent } from "../../domain/page/page-content.js"
import type { ImageMetadataProbe } from "../../ports/ImageMetadataProbe.js"
import type { ReaderProgressRecord, ReaderProgressStore } from "../../ports/ReaderProgressStore.js"
import { CoreReaderService } from "./ReaderService.js"
import { CoreReaderSession } from "./ReaderSession.js"

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
