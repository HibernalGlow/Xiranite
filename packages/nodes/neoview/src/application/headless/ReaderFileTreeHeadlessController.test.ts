import { describe, expect, it, vi } from "vitest"

import { ReaderFileTreeService } from "../browser/ReaderFileTreeService.js"
import { ReaderFileTreeHeadlessController } from "./ReaderFileTreeHeadlessController.js"

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
})
