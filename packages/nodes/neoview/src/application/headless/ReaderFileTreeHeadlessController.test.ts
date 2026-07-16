import { describe, expect, it, vi } from "vitest"

import { ReaderFileTreeService } from "../browser/ReaderFileTreeService.js"
import { ReaderFileTreeHeadlessController } from "./ReaderFileTreeHeadlessController.js"
import { ReaderSearchHistoryService } from "../browser/ReaderSearchHistoryService.js"

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
    })
    const close = vi.spyOn(service, "close")
    const controller = new ReaderFileTreeHeadlessController(service)

    const opened = await controller.open({ path: "/library" })
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
})
