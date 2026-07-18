import { describe, expect, it, vi } from "vitest"

import { ReaderFileTreeService } from "../browser/ReaderFileTreeService.js"
import { ReaderFileTreeHeadlessController } from "./ReaderFileTreeHeadlessController.js"
import { ReaderSearchHistoryService } from "../browser/ReaderSearchHistoryService.js"
import { ReaderEmmTagSuggestionService } from "../metadata/ReaderEmmTagSuggestionService.js"
import type { ReaderDirectoryEmmEditService } from "../metadata/ReaderDirectoryEmmEditService.js"

describe("ReaderFileTreeHeadlessController", () => {
  it("[neoview.folder.headless] shares lazy tree, streaming search, exclusions and deterministic disposal", async () => {
    const persist = vi.fn(async (paths: readonly string[]) => paths)
    const service = new ReaderFileTreeService({
      async read(path) {
        return {
          path,
          entries: path.replaceAll("\\", "/").toLocaleLowerCase().endsWith("/library")
            ? [{ name: "nested", path: `${path}/nested`, kind: "directory", readerSupported: true }]
            : [],
        }
      },
      async canonicalize(path) { return path },
    }, undefined, undefined, {
      updateExcludedPaths: persist,
      scanner: {
        async *scan(rootPath, _options, signal) {
          signal?.throwIfAborted()
          yield { name: "book.cbz", path: `${rootPath}/nested/book.cbz`, relativePath: "nested/book.cbz", depth: 1, kind: "file" }
        },
      },
      directorySizeProvider: {
        async measure(path) { return { path, bytes: 42, fileCount: 3 } },
      },
      classifyEntry: (entry) => entry.kind === "directory" ? "directory" : "other",
    })
    const close = vi.spyOn(service, "close")
    const controller = new ReaderFileTreeHeadlessController(service)

    const opened = await controller.open({ path: "/library" })
    await expect(controller.directorySizes(opened.generation, ["/library/nested"]))
      .resolves.toMatchObject({ generation: opened.generation, results: [{ path: "/library/nested", status: "ok", bytes: 42, fileCount: 3 }] })
    await expect(controller.setFilter("directory")).resolves.toMatchObject({ filter: "directory", total: 1 })
    await expect(controller.setFilter("all")).resolves.toMatchObject({ filter: "all", total: 1 })
    await expect(controller.tree()).resolves.toMatchObject({ sessionId: opened.sessionId, entries: [{ name: "nested" }] })
    const search = controller.search("book")
    const events = []
    for await (const event of search.events) events.push(event)
    await search.close()
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ type: "entry", entry: { name: "book.cbz", path: "/library/nested/book.cbz", relativePath: "nested/book.cbz", depth: 1, kind: "file" } })]))

    await expect(controller.updateExclusion({ action: "exclude", path: "/library/nested" })).resolves.toMatchObject({ excludedPaths: [expect.stringContaining("library")] })
    expect(persist).toHaveBeenCalledOnce()
    await controller.open({ path: "/other" })
    expect(close).toHaveBeenCalledWith(opened.sessionId)
    await controller[Symbol.asyncDispose]()
    expect(() => controller.tree()).toThrow("closed")
  })

  it("[neoview.folder.search-history-headless] loads persistence only on first history operation and disposes it once", async () => {
    const service = new ReaderFileTreeService({
      async read(path) { return { path, entries: [] } },
      async canonicalize(path) { return path },
    })
    const rows: Array<{ scope: string; query: string; usedAt: number; useCount: number }> = []
    const close = vi.fn(async () => undefined)
    const loadSearchHistory = vi.fn(async () => ({
      service: new ReaderSearchHistoryService({
        async listSearchHistory(scope, limit) { return rows.filter((row) => row.scope === scope).slice(0, limit) },
        async recordSearchHistory(record) {
          const row = { ...record, useCount: 1 }
          rows.unshift(row)
          return row
        },
        async deleteSearchHistory() { return false },
        async clearSearchHistory() { return 0 },
        close,
        [Symbol.asyncDispose]: close,
      }, () => 123),
      close,
    }))
    const controller = new ReaderFileTreeHeadlessController(service, { loadSearchHistory })

    await controller.open({ path: "/library" })
    expect(loadSearchHistory).not.toHaveBeenCalled()
    await expect(controller.recordSearchHistory("folder", "book")).resolves.toMatchObject({ query: "book", usedAt: 123 })
    await expect(controller.listSearchHistory("folder")).resolves.toHaveLength(1)
    expect(loadSearchHistory).toHaveBeenCalledOnce()
    await controller[Symbol.asyncDispose]()
    await controller[Symbol.asyncDispose]()
    expect(close).toHaveBeenCalledOnce()
  })

  it("[neoview.folder.emm-tag-suggestions-headless] lazily shares suggestions and closes owned resources once", async () => {
    const service = new ReaderFileTreeService({
      async read(path) { return { path, entries: [] } },
      async canonicalize(path) { return path },
    })
    const loadEmmTagSuggestions = vi.fn(async () => new ReaderEmmTagSuggestionService({
      sampleEmmTags: async () => [{ category: "artist", tag: "Alice" }],
    }, { load: async () => ({ tags: [] }) }, () => 0))
    const closeResources = vi.fn(async () => undefined)
    const controller = new ReaderFileTreeHeadlessController(service, { loadEmmTagSuggestions, closeResources })

    expect(loadEmmTagSuggestions).not.toHaveBeenCalled()
    await expect(Promise.all([controller.suggestEmmTags(1), controller.suggestEmmTags(1)]))
      .resolves.toEqual([[{ category: "artist", tag: "Alice", favorite: false }], [{ category: "artist", tag: "Alice", favorite: false }]])
    expect(loadEmmTagSuggestions).toHaveBeenCalledOnce()
    await controller[Symbol.asyncDispose]()
    await controller[Symbol.asyncDispose]()
    expect(closeResources).toHaveBeenCalledOnce()
  })

  it("[neoview.folder.emm-edit-headless] lazily delegates generation-bound CAS batches to the shared editor", async () => {
    const service = new ReaderFileTreeService({
      async read(path) {
        return { path, entries: [{ name: "A.cbz", path: `${path}/A.cbz`, kind: "file", readerSupported: true }] }
      },
      async canonicalize(path) { return path },
    })
    const update = vi.fn(async (_sessionId, command) => ({
      generation: command.generation + 1,
      refreshRequired: false,
      results: [{ index: 0, status: "succeeded" as const, metadata: { revision: 1, overrides: { rating: 5 }, inherited: ["manualTags", "translatedTitle"] as const } }],
      succeeded: 1,
      conflicts: 0,
      failed: 0,
    }))
    const loadEmmEditor = vi.fn(async () => ({ update }) as unknown as ReaderDirectoryEmmEditService)
    const controller = new ReaderFileTreeHeadlessController(service, { loadEmmEditor })
    const opened = await controller.open({ path: "/library" })
    const command = {
      generation: opened.generation,
      updates: [{ path: "/library/A.cbz", expectedRevision: 0, patch: { rating: 5 as const } }],
    }

    await expect(controller.editEmm(command)).resolves.toMatchObject({ generation: opened.generation + 1, succeeded: 1 })
    expect(loadEmmEditor).toHaveBeenCalledOnce()
    expect(update).toHaveBeenCalledWith(opened.sessionId, command, undefined)
    await controller[Symbol.asyncDispose]()
  })

  it("[neoview.folder.headless-lazy-retry] retries rejected history and suggestion resource loads", async () => {
    const service = new ReaderFileTreeService({ async read(path) { return { path, entries: [] } } })
    const history = new ReaderSearchHistoryService({
      listSearchHistory: async () => [],
      recordSearchHistory: async (record) => ({ ...record, useCount: 1 }),
      deleteSearchHistory: async () => false,
      clearSearchHistory: async () => 0,
    })
    const loadSearchHistory = vi.fn()
      .mockRejectedValueOnce(new Error("history locked"))
      .mockResolvedValue({ service: history, close: async () => undefined })
    const suggestions = new ReaderEmmTagSuggestionService({ sampleEmmTags: async () => [] }, { load: async () => ({ tags: [] }) })
    const loadEmmTagSuggestions = vi.fn()
      .mockRejectedValueOnce(new Error("tags locked"))
      .mockResolvedValue(suggestions)
    const controller = new ReaderFileTreeHeadlessController(service, { loadSearchHistory, loadEmmTagSuggestions })

    await expect(controller.listSearchHistory("folder")).rejects.toThrow("history locked")
    await expect(controller.listSearchHistory("folder")).resolves.toEqual([])
    await expect(controller.suggestEmmTags()).rejects.toThrow("tags locked")
    await expect(controller.suggestEmmTags()).resolves.toEqual([])
    expect(loadSearchHistory).toHaveBeenCalledTimes(2)
    expect(loadEmmTagSuggestions).toHaveBeenCalledTimes(2)
    await controller[Symbol.asyncDispose]()
  })
})
