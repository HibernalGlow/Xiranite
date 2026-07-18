import { describe, expect, it, vi } from "vitest"

import type { ReaderInputBinding, ReaderInputBindingsConfig } from "../../domain/input/ReaderInputBindings.js"
import type { HeadlessReaderSnapshot } from "./ReaderHeadlessController.js"
import { executeReaderHeadlessInputBinding } from "./ReaderHeadlessInputBindingExecutor.js"

describe("ReaderHeadlessInputBindingExecutor", () => {
  it("[neoview.bindings.context-stack-headless] selects the highest-priority active context without flattening bindings", async () => {
    const controller = fixture()
    const config = bindings(
      binding("global", "reader.first-page", "global"),
      binding("reader", "reader.next-page", "reader"),
      binding("video", "reader.last-page", "video"),
      binding("panel", "reader.previous-page", "panel"),
    )

    await expect(executeReaderHeadlessInputBinding(config, key(), ["reader", "video"], controller)).resolves.toMatchObject({
      matched: true, bindingId: "video", context: "video", action: "reader.last-page", result: { handled: true },
    })
    expect(controller.goTo).toHaveBeenLastCalledWith(9, undefined)
    await expect(executeReaderHeadlessInputBinding(config, key(), ["reader", "panel"], controller)).resolves.toMatchObject({
      matched: true, bindingId: "panel", context: "panel", action: "reader.previous-page",
    })
    expect(controller.previous).toHaveBeenCalledOnce()
  })

  it("[neoview.bindings.context-stack-isolation] suppresses global fallback in editor and modal contexts", async () => {
    const controller = fixture()
    const config = bindings(binding("global", "reader.next-page", "global"))
    await expect(executeReaderHeadlessInputBinding(config, key(), ["editor"], controller)).resolves.toEqual({
      matched: false, contexts: ["editor"], reason: "binding-not-found",
    })
    await expect(executeReaderHeadlessInputBinding(config, key(), ["modal"], controller)).resolves.toEqual({
      matched: false, contexts: ["modal"], reason: "binding-not-found",
    })
    expect(controller.next).not.toHaveBeenCalled()
  })

  it("[neoview.bindings.context-stack-capability] preserves matches while reporting unsupported headless providers", async () => {
    const controller = fixture()
    const config = bindings(binding("viewer", "viewer.toggle-render-mode", "reader"))
    await expect(executeReaderHeadlessInputBinding(config, key(), ["reader"], controller)).resolves.toEqual({
      matched: true,
      bindingId: "viewer",
      context: "reader",
      action: "viewer.toggle-render-mode",
      result: { handled: false, action: "viewer.toggle-render-mode", reason: "unsupported-on-headless-surface" },
    })
  })
})

function key() {
  return { device: "keyboard", code: "KeyK" } as const
}

function binding(id: string, action: ReaderInputBinding["action"], context: ReaderInputBinding["context"]): ReaderInputBinding {
  return { id, action, context, enabled: true, input: key() }
}

function bindings(...values: ReaderInputBinding[]): ReaderInputBindingsConfig {
  return { bindings: values }
}

function fixture() {
  const snapshot = {
    book: { displayName: "book.cbz", pageCount: 10 },
    frame: {
      generation: 0,
      anchorPageIndex: 4,
      direction: "left-to-right" as const,
      layout: { pageMode: "single" as const, panorama: false, singleFirstPage: true, singleLastPage: true, treatWidePageAsSingle: true },
      pages: [{ pageId: "page-5", pageIndex: 4, side: "single" as const }],
      pageCount: 10,
      atStart: false,
      atEnd: false,
    },
    visiblePages: [{ id: "page-5", index: 4, name: "5.jpg", mediaKind: "image" as const, contentVersion: "v1" }],
  } satisfies HeadlessReaderSnapshot
  return {
    inspect: vi.fn(() => snapshot),
    next: vi.fn(async () => snapshot),
    previous: vi.fn(async () => snapshot),
    goTo: vi.fn(async () => snapshot),
  }
}
