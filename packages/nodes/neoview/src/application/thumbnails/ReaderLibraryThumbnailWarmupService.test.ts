import { describe, expect, it, vi } from "vitest"

import { ReaderLibraryThumbnailWarmupService } from "./ReaderLibraryThumbnailWarmupService.js"

describe("ReaderLibraryThumbnailWarmupService", () => {
  it("[neoview.thumbnail.library-warmup] bounds concurrency and reports individual failures", async () => {
    let active = 0
    let maximumActive = 0
    const progress = vi.fn()
    const service = new ReaderLibraryThumbnailWarmupService({
      async warm(item) {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await Promise.resolve()
        active -= 1
        if (item.id === "bad") throw new Error("decode failed")
      },
    })

    await expect(service.run({
      concurrency: 2,
      items: [
        { id: "one", path: "D:/one.jpg", kind: "file", previewCount: 1 },
        { id: "bad", path: "D:/bad.jpg", kind: "file", previewCount: 1 },
        { id: "folder", path: "D:/folder", kind: "folder", previewCount: 4 },
      ],
    }, { contextId: "gui:folder-main", onProgress: progress })).resolves.toEqual({ total: 3, completed: 2, failed: 1 })
    expect(maximumActive).toBeLessThanOrEqual(2)
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ id: "bad", status: "failed", error: "decode failed" }))
  })

  it("[neoview.thumbnail.library-warmup-cancel] propagates cancellation instead of reporting a failed item", async () => {
    const controller = new AbortController()
    const progress = vi.fn()
    const service = new ReaderLibraryThumbnailWarmupService({
      async warm(_item, options) {
        controller.abort(new DOMException("cancelled", "AbortError"))
        options.signal?.throwIfAborted()
      },
    })

    await expect(service.run({ items: [{ id: "one", path: "D:/one.jpg", kind: "file", previewCount: 1 }], concurrency: 1 }, {
      contextId: "gui:folder-main",
      signal: controller.signal,
      onProgress: progress,
    })).rejects.toMatchObject({ name: "AbortError" })
    expect(progress).not.toHaveBeenCalled()
  })

  it("[neoview.thumbnail.library-warmup-validation] rejects duplicate ids and file mosaics before work starts", async () => {
    const warm = vi.fn()
    const service = new ReaderLibraryThumbnailWarmupService({ warm })
    await expect(service.run({ items: [
      { id: "same", path: "D:/one.jpg", kind: "file", previewCount: 1 },
      { id: "same", path: "D:/two.jpg", kind: "file", previewCount: 1 },
    ], concurrency: 2 }, { contextId: "gui" })).rejects.toThrow("duplicate id")
    await expect(service.run({ items: [
      { id: "file", path: "D:/one.jpg", kind: "file", previewCount: 4 },
    ], concurrency: 2 }, { contextId: "gui" })).rejects.toThrow("mosaic previews require a folder")
    expect(warm).not.toHaveBeenCalled()
  })
})
