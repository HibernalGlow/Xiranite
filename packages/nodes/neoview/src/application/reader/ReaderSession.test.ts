import { describe, expect, it, vi } from "vitest"
import type { ReaderBook } from "../../domain/book/book.js"
import type { ReaderPage } from "../../domain/page/page.js"
import type { PageContent } from "../../domain/page/page-content.js"
import type { ImageMetadataProbe } from "../../ports/ImageMetadataProbe.js"
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
    const loader = vi.fn(async () => book(3))
    const service = new CoreReaderService(loader)
    const first = await service.openViewSource({ kind: "directory", path: "C:/book" }, { initialPage: 2 })
    expect(service.sessionCount).toBe(1)
    expect(first.snapshot().anchorPageIndex).toBe(2)
    expect(service.getSession(first.id)).toBe(first)
    await service.closeSession(first.id)
    expect(service.sessionCount).toBe(0)
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
