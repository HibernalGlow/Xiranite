import { describe, expect, it, vi } from "vitest"
import type { ReaderBook, ReaderPage } from "./core.js"
import { CoreReaderService, CoreReaderSession } from "./session.js"

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
    const session = new CoreReaderSession("reader-1", book(2))
    const controller = new AbortController()
    controller.abort(new Error("cancelled"))
    await expect(session.goTo(1, controller.signal)).rejects.toThrow("cancelled")
    expect(session.generation).toBe(0)
    await session.close()
    await session.close()
    expect(() => session.snapshot()).toThrow("closed")
  })
})

describe("CoreReaderService", () => {
  it("[neoview.session.lifecycle] owns sessions and releases them on close/dispose", async () => {
    const loader = vi.fn(async () => book(3))
    const service = new CoreReaderService(loader)
    const first = await service.openViewSource({ kind: "directory", path: "C:/book" }, { initialPage: 2 })
    expect(first.snapshot().anchorPageIndex).toBe(2)
    expect(service.getSession(first.id)).toBe(first)
    await service.closeSession(first.id)
    expect(service.getSession(first.id)).toBeUndefined()

    const second = await service.openViewSource({ kind: "image", path: "C:/book/1.jpg" })
    await service[Symbol.asyncDispose]()
    expect(service.getSession(second.id)).toBeUndefined()
    await expect(service.openViewSource({ kind: "image", path: "x" })).rejects.toThrow("closed")
  })
})

function book(pageCount: number): ReaderBook {
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
    })),
  }
}
