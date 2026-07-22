import { describe, expect, it, vi } from "vitest"
import { ReaderFolderRatingHttpController } from "./ReaderFolderRatingHttpController.js"

describe("ReaderFolderRatingHttpController", () => {
  it("serializes explicit cache mutations and validates a supplement path", async () => {
    const service = { load: vi.fn(async () => ({ entries: [] })), rebuild: vi.fn(async () => ({ entries: [], updatedAt: 1 })), supplement: vi.fn(async () => ({ entries: [], updatedAt: 2 })), clear: vi.fn(async () => undefined) }
    const runMutation = vi.fn(async <T>(operation: () => Promise<T>) => operation())
    const controller = new ReaderFolderRatingHttpController(service as never, runMutation)
    expect((await controller.handle(new Request("http://x/reader/folder-ratings/rebuild", { method: "POST" })))?.status).toBe(200)
    expect(runMutation).toHaveBeenCalledOnce()
    expect((await controller.handle(new Request("http://x/reader/folder-ratings/supplement", { method: "POST", body: "{}" })))?.status).toBe(400)
  })
})
