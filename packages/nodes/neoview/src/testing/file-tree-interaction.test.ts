import { describe, expect, it, vi } from "vitest"

import type { ReaderFileTreeHeadlessController } from "../core.js"
import { createNeoviewFileTreeTuiDefinition } from "../interaction.js"

describe("NeoView file-tree terminal interaction", () => {
  it("[neoview.folder.tui] [neoview.folder.filter-tui] [neoview.folder.emm-search-tui] [neoview.folder.emm-tags-tui] [neoview.folder.emm-edit-tui] [neoview.folder.search-history-tui] [neoview.folder.search-path-tui] uses the shared headless controller", async () => {
    const closeSearch = vi.fn(async () => undefined)
    const dispose = vi.fn(async () => undefined)
    const controller = {
      open: vi.fn(async () => ({ sessionId: "browser-1", generation: 7 })),
      setFilter: vi.fn(async () => ({ sessionId: "browser-1", filter: "video" })),
      search: vi.fn(() => ({
        events: {
          async *[Symbol.asyncIterator]() {
            yield { type: "meta", sessionId: "browser-1", rootPath: "/library", generation: 1, query: "book", mode: "text" }
            yield { type: "entry", index: 0, entry: { name: "book.cbz", path: "/library/book.cbz", relativePath: "book.cbz", depth: 0, kind: "file" } }
            yield { type: "complete", scanned: 1, matched: 1, truncated: false }
          },
        },
        close: closeSearch,
        [Symbol.asyncDispose]: closeSearch,
      })),
      recordSearchHistory: vi.fn(async () => ({ scope: "folder", query: "book", usedAt: 1, useCount: 1 })),
      listSearchHistory: vi.fn(async () => [{ scope: "folder", query: "book", usedAt: 1, useCount: 1 }]),
      removeSearchHistory: vi.fn(async () => true),
      clearSearchHistory: vi.fn(async () => 1),
      suggestEmmTags: vi.fn(async () => [
        { category: "artist", tag: "Alice", favorite: true, translatedTag: "爱丽丝" },
        { category: "genre", tag: "Comedy", favorite: false },
      ]),
      editEmm: vi.fn(async () => ({
        generation: 8,
        refreshRequired: false,
        results: [{ index: 0, status: "succeeded", metadata: { revision: 1, overrides: { rating: 5 }, inherited: ["manualTags", "translatedTitle"] } }],
        succeeded: 1,
        conflicts: 0,
        failed: 0,
      })),
      [Symbol.asyncDispose]: dispose,
    } as unknown as ReaderFileTreeHeadlessController
    const definition = createNeoviewFileTreeTuiDefinition("en", async () => controller)
    const events: string[] = []

    const result = await definition.run({
      action: "search",
      path: "/library",
      query: "book",
      mode: "text",
      maximumDepth: 10,
      maximumResults: 20,
      searchInPath: true,
      filter: "video",
      includeTags: ["artist:Alice"],
      excludeTags: ["genre:Horror"],
      tagMode: "any",
    }, (event) => events.push(event.message))
    expect(result).toEqual({ success: true, message: "1 matches.", paths: ["/library/book.cbz"] })
    expect(events).toEqual(["/library/book.cbz"])
    expect(controller.setFilter).toHaveBeenCalledWith("video")
    expect(controller.search).toHaveBeenCalledWith("book", expect.objectContaining({
      searchInPath: true,
      includeTags: ["artist:Alice"],
      excludeTags: ["genre:Horror"],
      tagMode: "any",
    }))
    expect(closeSearch).toHaveBeenCalledOnce()
    expect(controller.recordSearchHistory).toHaveBeenCalledWith("folder", "book")
    expect(dispose).toHaveBeenCalledOnce()
    expect(definition.schema.isDangerous({ action: "exclude", path: "/library/private" })).toBe(true)
    expect(definition.schema.isDangerous({ action: "tree", path: "/library" })).toBe(false)

    const history = await definition.run({ action: "history", path: "", scope: "folder", maximumResults: 20 }, () => undefined)
    expect(history).toEqual({ success: true, message: "1 history entries.", paths: ["book"] })
    expect(controller.open).toHaveBeenCalledTimes(1)
    expect(definition.schema.isDangerous({ action: "clear-history", path: "", scope: "folder" })).toBe(true)

    const suggestions = await definition.run({ action: "emm-tags", path: "", maximumResults: 2 }, () => undefined)
    expect(suggestions).toEqual({
      success: true,
      message: "2 EMM tag suggestions.",
      paths: ["artist:Alice\t爱丽丝", "genre:Comedy"],
    })
    expect(controller.suggestEmmTags).toHaveBeenCalledWith(2)
    expect(controller.open).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(3)

    const edit = await definition.run({
      action: "emm-edit",
      path: "/library",
      emmUpdatesJson: JSON.stringify({
        updates: [{ path: "/library/book.cbz", expectedRevision: 0, patch: { rating: 5 } }],
      }),
      emmConcurrency: 2,
    }, () => undefined)
    expect(edit).toMatchObject({ success: true, message: "EMM metadata: 1 succeeded, 0 conflicts, 0 failed." })
    expect(controller.editEmm).toHaveBeenCalledWith({
      generation: 7,
      updates: [{ path: "/library/book.cbz", expectedRevision: 0, patch: { rating: 5 } }],
      concurrency: 2,
    })
    expect(definition.schema.isDangerous({ action: "emm-edit", path: "/library", emmUpdatesJson: "{}" })).toBe(true)
    expect(dispose).toHaveBeenCalledTimes(4)

    const tagOnly = definition.schema.toInput({
      action: "search",
      path: "/library",
      query: "",
      includeTags: "artist:Alice, genre:Comedy",
      excludeTags: "genre:Horror",
      tagMode: "any",
    })
    expect(tagOnly).toMatchObject({
      includeTags: ["artist:Alice", "genre:Comedy"],
      excludeTags: ["genre:Horror"],
      tagMode: "any",
    })
    expect(definition.schema.validate({}, tagOnly)).toBeNull()
  })
})
