import { describe, expect, it, vi } from "vitest"

import type { HeadlessReaderSnapshot } from "./ReaderHeadlessController.js"
import { executeReaderHeadlessInputAction, type ReaderHeadlessInputActionPort } from "./ReaderHeadlessInputActionExecutor.js"

describe("ReaderHeadlessInputActionExecutor", () => {
  it("[neoview.bindings.action-dispatch-headless] dispatches navigation, direction and adjacent-book actions", async () => {
    const controller = fixture("right-to-left")
    await expect(executeReaderHeadlessInputAction("reader.page-left", controller)).resolves.toMatchObject({ handled: true })
    expect(controller.next).toHaveBeenCalledOnce()
    await executeReaderHeadlessInputAction("reader.last-page", controller)
    expect(controller.goTo).toHaveBeenCalledWith(9, undefined)
    await executeReaderHeadlessInputAction("reader.next-book", controller)
    expect(controller.openAdjacent).toHaveBeenCalledWith("next", undefined, undefined)
  })

  it("[neoview.bindings.action-dispatch-capability] reports GUI-only and missing capabilities without pretending to execute", async () => {
    const controller = fixture("left-to-right")
    await expect(executeReaderHeadlessInputAction("reader.zoom-in", controller)).resolves.toEqual({
      handled: false, action: "reader.zoom-in", reason: "unsupported-on-headless-surface",
    })
    await expect(executeReaderHeadlessInputAction("reader.next-page", { inspect: controller.inspect })).resolves.toEqual({
      handled: false, action: "reader.next-page", reason: "missing-controller-capability",
    })
  })
})

function fixture(direction: "left-to-right" | "right-to-left") {
  const snapshot = readerSnapshot(direction)
  return {
    inspect: vi.fn(() => snapshot),
    next: vi.fn(async () => snapshot),
    previous: vi.fn(async () => snapshot),
    goTo: vi.fn(async () => snapshot),
    openAdjacent: vi.fn(async () => snapshot),
    closeBook: vi.fn(async () => undefined),
  } satisfies ReaderHeadlessInputActionPort
}

function readerSnapshot(direction: "left-to-right" | "right-to-left"): HeadlessReaderSnapshot {
  return {
    book: { displayName: "book.cbz", pageCount: 10 },
    frame: {
      generation: 0, anchorPageIndex: 4, direction,
      layout: { pageMode: "single", panorama: false, singleFirstPage: true, singleLastPage: true, treatWidePageAsSingle: true },
      pages: [{ pageId: "page-5", pageIndex: 4, side: "single" }], pageCount: 10, atStart: false, atEnd: false,
    },
    visiblePages: [{ id: "page-5", index: 4, name: "5.jpg", mediaKind: "image", contentVersion: "v1" }],
  }
}
