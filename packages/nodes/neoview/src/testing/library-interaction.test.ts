import { describe, expect, it, vi } from "vitest"

import type { ReaderLibraryHeadlessController } from "../core.js"
import { createNeoviewLibraryTuiDefinition } from "../interaction.js"

describe("NeoView library terminal interaction", () => {
  it("[neoview.library.tui] [neoview.history.cleanup-tui] [neoview.folder.filter-library-tui] shares the headless controller and marks database deletion dangerous", async () => {
    const dispose = vi.fn(async () => undefined)
    const controller = {
      listBookmarks: vi.fn(async () => [{ id: "bookmark-1", name: "Demo" }]),
      removeBookmark: vi.fn(async () => true),
      cleanupInvalid: vi.fn(async () => ({ kind: "both", scanned: 1, missing: 1, unknown: 0, deleted: 1, truncated: false })),
      removeOldestRecents: vi.fn(async () => ({ selectedIds: ["book-1"], deleted: 1 })),
      clearByFolder: vi.fn(async () => 2),
      clearAll: vi.fn(async () => 3),
      [Symbol.asyncDispose]: dispose,
    } as unknown as ReaderLibraryHeadlessController
    const definition = createNeoviewLibraryTuiDefinition("en", async () => controller)

    await expect(definition.run({ action: "list-bookmarks", limit: 20, filter: "archive" }, () => undefined)).resolves.toEqual({
      success: true,
      message: "1 bookmarks.",
      lines: [JSON.stringify({ id: "bookmark-1", name: "Demo" })],
    })
    expect(controller.listBookmarks).toHaveBeenCalledWith(undefined, 20, 0, "archive")
    expect(definition.schema.isDangerous({ action: "delete-bookmark", id: "bookmark-1" })).toBe(true)
    expect(definition.schema.isDangerous({ action: "list-bookmarks" })).toBe(false)
    await expect(definition.run({ action: "cleanup-invalid", cleanupKind: "both", limit: 20, concurrency: 2 }, () => undefined)).resolves.toMatchObject({
      success: true, message: "1/1 invalid entries deleted.",
    })
    expect(controller.cleanupInvalid).toHaveBeenCalledWith({ kind: "both", scanLimit: 20, deleteLimit: 20, concurrency: 2 })
    expect(definition.schema.isDangerous({ action: "cleanup-invalid" })).toBe(true)
    await definition.run({ action: "cleanup-recents-oldest", limit: 10 }, () => undefined)
    expect(controller.removeOldestRecents).toHaveBeenCalledWith(10, expect.any(AbortSignal))
    await definition.run({ action: "cleanup-recents-folder", path: "D:/Books" }, () => undefined)
    expect(controller.clearByFolder).toHaveBeenCalledWith("recents", "D:/Books")
    await definition.run({ action: "clear-recents" }, () => undefined)
    expect(controller.clearAll).toHaveBeenCalledWith("recents")
    expect(definition.schema.isDangerous({ action: "cleanup-recents-oldest" })).toBe(true)
    expect(definition.schema.isDangerous({ action: "cleanup-recents-folder" })).toBe(true)
    expect(definition.schema.isDangerous({ action: "clear-recents" })).toBe(true)
    expect(dispose).toHaveBeenCalledTimes(5)
  })

  it("[neoview.history.cleanup-tui-cancel] aborts oldest cleanup through the shared service signal", async () => {
    let receivedSignal: AbortSignal | undefined
    const dispose = vi.fn(async () => undefined)
    const controller = {
      removeOldestRecents: vi.fn(async (_limit: number, signal?: AbortSignal) => {
        receivedSignal = signal
        await new Promise<void>((_resolve, reject) => signal?.addEventListener("abort", () => reject(new Error("cleanup cancelled")), { once: true }))
        return { selectedIds: [], deleted: 0, missingIds: [] }
      }),
      [Symbol.asyncDispose]: dispose,
    } as unknown as ReaderLibraryHeadlessController
    const definition = createNeoviewLibraryTuiDefinition("en", async () => controller)

    const running = definition.run({ action: "cleanup-recents-oldest", limit: 10 }, () => undefined)
    await vi.waitFor(() => expect(receivedSignal).toBeDefined())
    await definition.cancel?.()

    await expect(running).resolves.toEqual({ success: false, message: "cleanup cancelled" })
    expect(receivedSignal?.aborted).toBe(true)
    expect(dispose).toHaveBeenCalledOnce()
  })
})
