import { describe, expect, it, vi } from "vitest"

import type { ReaderFileTreeHeadlessController } from "../core.js"
import { createNeoviewFileTreeTuiDefinition } from "../interaction.js"

describe("NeoView file-tree terminal interaction", () => {
  it("[neoview.folder.tui] uses the shared headless controller and marks persistent actions dangerous", async () => {
    const closeSearch = vi.fn(async () => undefined)
    const dispose = vi.fn(async () => undefined)
    const controller = {
      open: vi.fn(async () => ({ sessionId: "browser-1" })),
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
    }, (event) => events.push(event.message))
    expect(result).toEqual({ success: true, message: "1 matches.", paths: ["/library/book.cbz"] })
    expect(events).toEqual(["/library/book.cbz"])
    expect(closeSearch).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
    expect(definition.schema.isDangerous({ action: "exclude", path: "/library/private" })).toBe(true)
    expect(definition.schema.isDangerous({ action: "tree", path: "/library" })).toBe(false)
  })
})
