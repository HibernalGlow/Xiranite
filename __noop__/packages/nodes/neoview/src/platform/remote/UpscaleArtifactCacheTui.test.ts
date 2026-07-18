import { describe, expect, it, vi } from "vitest"

import type { HeadlessReaderSnapshot } from "../../application/headless/ReaderHeadlessController.js"
import {
  createNeoviewUpscaleCacheTuiDefinition,
  type NeoviewUpscaleCacheTuiPort,
} from "../../interaction.js"

describe("Remote upscale artifact cache OpenTUI", () => {
  it("[neoview.super-resolution.cache-controls.tui] maps stats and confirmed cleanup to the shared remote port", async () => {
    const controllers: Array<ReturnType<typeof fakeController>> = []
    const definition = createNeoviewUpscaleCacheTuiDefinition("en", async () => {
      const controller = fakeController()
      controllers.push(controller)
      return controller
    })

    await expect(definition.run({ action: "stats", path: "D:/book.cbz" }, () => undefined)).resolves.toMatchObject({
      success: true,
      snapshot: { entries: 3, bytes: 300 },
    })
    await definition.run({ action: "cleanup-age", path: "D:/book.cbz" }, () => undefined)
    await definition.run({ action: "cleanup-book", path: "D:/book.cbz" }, () => undefined)
    await definition.run({ action: "clear-all", path: "D:/book.cbz" }, () => undefined)

    expect(controllers[0]!.open).toHaveBeenCalledWith(expect.objectContaining({ path: "D:/book.cbz", signal: expect.any(AbortSignal) }))
    expect(controllers[0]!.getUpscaleArtifactCache).toHaveBeenCalledWith(expect.any(AbortSignal))
    expect(controllers[1]!.cleanupUpscaleArtifactCache).toHaveBeenCalledWith("age", expect.any(AbortSignal))
    expect(controllers[2]!.cleanupUpscaleArtifactCache).toHaveBeenCalledWith("book", expect.any(AbortSignal))
    expect(controllers[3]!.cleanupUpscaleArtifactCache).toHaveBeenCalledWith("all", expect.any(AbortSignal))
    expect(definition.schema.isDangerous({ action: "stats", path: "D:/book.cbz" })).toBe(false)
    expect(definition.schema.isDangerous({ action: "cleanup-age", path: "D:/book.cbz" })).toBe(true)
    expect(definition.schema.isDangerous({ action: "cleanup-book", path: "D:/book.cbz" })).toBe(true)
    expect(definition.schema.isDangerous({ action: "clear-all", path: "D:/book.cbz" })).toBe(true)
    expect(controllers.every((controller) => controller[Symbol.asyncDispose].mock.calls.length === 1)).toBe(true)
  })

  it("[neoview.super-resolution.cache-controls.tui.cancel] aborts the remote request and releases the temporary session", async () => {
    let receivedSignal: AbortSignal | undefined
    const controller = fakeController()
    controller.getUpscaleArtifactCache.mockImplementation(async (signal) => {
      receivedSignal = signal
      await new Promise<void>((_resolve, reject) => signal?.addEventListener("abort", () => reject(new Error("cache request cancelled")), { once: true }))
      return snapshot()
    })
    const definition = createNeoviewUpscaleCacheTuiDefinition("en", async () => controller)
    const running = definition.run({ action: "stats", path: "D:/book.cbz" }, () => undefined)
    await vi.waitFor(() => expect(receivedSignal).toBeDefined())
    await definition.cancel?.()

    await expect(running).resolves.toEqual({ success: false, message: "cache request cancelled" })
    expect(receivedSignal?.aborted).toBe(true)
    expect(controller[Symbol.asyncDispose]).toHaveBeenCalledOnce()
  })
})

function fakeController() {
  return {
    open: vi.fn(async (): Promise<HeadlessReaderSnapshot> => ({
      book: { displayName: "book.cbz", pageCount: 1 },
      frame: {
        generation: 0,
        anchorPageIndex: 0,
        direction: "left-to-right",
        layout: { pageMode: "single", widePageMode: "single", firstPageMode: "normal" },
        pages: [{ pageId: "page-1", pageIndex: 0, role: "primary" }],
        atStart: true,
        atEnd: true,
      },
      visiblePages: [],
    })),
    getUpscaleArtifactCache: vi.fn(async () => snapshot()),
    cleanupUpscaleArtifactCache: vi.fn(async (kind: "age" | "book" | "all") => ({
      ...snapshot(),
      reason: kind === "age" ? "age" as const : kind === "book" ? "book" as const : "explicit" as const,
      removedEntries: 2,
      removedBytes: 20,
    })),
    [Symbol.asyncDispose]: vi.fn(async () => undefined),
  } satisfies NeoviewUpscaleCacheTuiPort
}

function snapshot() {
  return {
    entries: 3, bytes: 300, maxBytes: 1_024, maxEntryBytes: 512, activeLeases: 0,
    hits: 2, misses: 1, writes: 3, rejectedWrites: 0, evictions: 0, integrityFailures: 0,
  }
}
