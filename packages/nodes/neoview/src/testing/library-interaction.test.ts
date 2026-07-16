import { describe, expect, it, vi } from "vitest"

import type { ReaderLibraryHeadlessController } from "../core.js"
import { createNeoviewLibraryTuiDefinition } from "../interaction.js"

describe("NeoView library terminal interaction", () => {
  it("[neoview.library.tui] shares the headless controller and marks database deletion dangerous", async () => {
    const dispose = vi.fn(async () => undefined)
    const controller = {
      listBookmarks: vi.fn(async () => [{ id: "bookmark-1", name: "Demo" }]),
      removeBookmark: vi.fn(async () => true),
      cleanupInvalid: vi.fn(async () => ({ kind: "both", scanned: 1, missing: 1, unknown: 0, deleted: 1, truncated: false })),
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
    await expect(definition.run({ action: "cleanup-invalid", cleanupKind: "both", limit: 20, concurrency: 2 }, () => undefined)).resolves.toMatchObject({
      success: true, message: "1/1 invalid entries deleted.",
    })
    expect(controller.cleanupInvalid).toHaveBeenCalledWith({ kind: "both", scanLimit: 20, deleteLimit: 20, concurrency: 2 })
    expect(definition.schema.isDangerous({ action: "cleanup-invalid" })).toBe(true)
    expect(dispose).toHaveBeenCalledTimes(2)
  })
})
