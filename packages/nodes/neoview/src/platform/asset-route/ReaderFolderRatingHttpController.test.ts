import { describe, expect, it, vi } from "vitest"
import { ReaderFolderRatingHttpController } from "./ReaderFolderRatingHttpController.js"
import { ReaderFolderRatingService } from "../../application/metadata/ReaderFolderRatingService.js"

describe("ReaderFolderRatingHttpController", () => {
  it("serializes explicit cache mutations and validates a supplement path", async () => {
    const service = { load: vi.fn(async () => ({ entries: [] })), rebuild: vi.fn(async () => ({ entries: [], updatedAt: 1 })), supplement: vi.fn(async () => ({ entries: [], updatedAt: 2 })), clear: vi.fn(async () => undefined) }
    const runMutation = vi.fn(async <T>(operation: () => Promise<T>) => operation())
    const controller = new ReaderFolderRatingHttpController(service as never, runMutation)
    expect((await controller.handle(new Request("http://x/reader/folder-ratings/rebuild", { method: "POST" })))?.status).toBe(200)
    expect(runMutation).toHaveBeenCalledOnce()
    expect((await controller.handle(new Request("http://x/reader/folder-ratings/supplement", { method: "POST", body: "{}" })))?.status).toBe(400)
  })

  it("rebuilds, supplements, exports a snapshot, and clears through the real service", async () => {
    let snapshot = { entries: [] as any[], updatedAt: undefined as number | undefined }
    const service = new ReaderFolderRatingService(
      { listEmmRatingRecords: async () => [{ path: "D:/books/a/one.cbz", rating: 4 }, { path: "D:/books/b/two.cbz", rating: 2 }] },
      {
        loadFolderRatingCache: async () => snapshot,
        replaceFolderRatingCache: async (entries, updatedAt) => { snapshot = { entries: [...entries], updatedAt } },
        clearFolderRatingCache: async () => { snapshot = { entries: [], updatedAt: undefined } },
      },
      () => 99,
    )
    const controller = new ReaderFolderRatingHttpController(service, async (operation) => operation())
    const rebuilt = await controller.handle(new Request("http://x/reader/folder-ratings/rebuild", { method: "POST" }))
    await expect(rebuilt!.json()).resolves.toMatchObject({ updatedAt: 99, entries: expect.any(Array) })
    expect((await controller.handle(new Request("http://x/reader/folder-ratings/supplement", { method: "POST", body: JSON.stringify({ path: "D:/books" }) })))?.status).toBe(200)
    expect((await controller.handle(new Request("http://x/reader/folder-ratings", { method: "DELETE" })))?.status).toBe(204)
    await expect((await controller.handle(new Request("http://x/reader/folder-ratings")))!.json()).resolves.toEqual({ entries: [] })
  })
})
