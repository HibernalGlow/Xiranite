import { describe, expect, it, vi } from "vitest"

import type { ReaderLibraryHeadlessController } from "../core.js"
import { createNeoviewLibraryTuiDefinition } from "../interaction.js"

describe("NeoView library terminal interaction", () => {
  it("[neoview.library.tui] shares the headless controller and marks database deletion dangerous", async () => {
    const dispose = vi.fn(async () => undefined)
    const controller = {
      listBookmarks: vi.fn(async () => [{ id: "bookmark-1", name: "Demo" }]),
      removeBookmark: vi.fn(async () => true),
      [Symbol.asyncDispose]: dispose,
    } as unknown as ReaderLibraryHeadlessController
    const definition = createNeoviewLibraryTuiDefinition("en", async () => controller)

    await expect(definition.run({ action: "list-bookmarks", limit: 20 }, () => undefined)).resolves.toEqual({
      success: true,
      message: "1 bookmarks.",
      lines: [JSON.stringify({ id: "bookmark-1", name: "Demo" })],
    })
    expect(controller.listBookmarks).toHaveBeenCalledWith(undefined, 20)
    expect(definition.schema.isDangerous({ action: "delete-bookmark", id: "bookmark-1" })).toBe(true)
    expect(definition.schema.isDangerous({ action: "list-bookmarks" })).toBe(false)
    expect(dispose).toHaveBeenCalledOnce()
  })
})
