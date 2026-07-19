import { describe, expect, it, vi } from "vitest"

import { ReaderLibraryThumbnailWarmupService } from "./ReaderLibraryThumbnailWarmupService.js"

describe("ReaderLibraryThumbnailWarmupService", () => {
  it("[neoview.thumbnail.library-warmup] bounds concurrency and reports individual failures", async () => {
    let active = 0
    let maximumActive = 0
    const modes: string[] = []
    const progress = vi.fn()
    const service = new ReaderLibraryThumbnailWarmupService({
      async warm(item, options) {
        modes.push(options.mode)
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await Promise.resolve()
        active -= 1
        if (item.id === "bad") throw new Error("decode failed")
      },
    })

    await expect(service.run({
      concurrency: 2,
      mode: "refresh",
      items: [
        { id: "one", path: "D:/one.jpg", kind: "file", previewCount: 1 },
        { id: "bad", path: "D:/bad.jpg", kind: "file", previewCount: 1 },
        { id: "folder", path: "D:/folder", kind: "folder", previewCount: 4 },
      ],
    }, { contextId: "gui:folder-main", onProgress: progress })).resolves.toEqual({ total: 3, completed: 2, failed: 1 })
    expect(maximumActive).toBeLessThanOrEqual(2)
    expect(modes).toEqual(["refresh", "refresh", "refresh"])
    expect(progress).toHaveBeenCalledTimes(3)
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

  it("drains already-started warmups before rejecting cancellation and does not start queued items", async () => {
    const firstStarted = deferred<void>()
    const secondStarted = deferred<void>()
    const releaseFirst = deferred<void>()
    const controller = new AbortController()
    const warm = vi.fn(async (item: { id: string }, options: { signal?: AbortSignal }) => {
      if (item.id === "first") {
        firstStarted.resolve()
        await releaseFirst.promise
        return
      }
      secondStarted.resolve()
      controller.abort(new DOMException("cancelled", "AbortError"))
      options.signal?.throwIfAborted()
    })
    const service = new ReaderLibraryThumbnailWarmupService({ warm })
    let settled = false
    const operation = service.run({
      concurrency: 2,
      items: [
        { id: "first", path: "D:/first.jpg", kind: "file", previewCount: 1 },
        { id: "second", path: "D:/second.jpg", kind: "file", previewCount: 1 },
        { id: "queued", path: "D:/queued.jpg", kind: "file", previewCount: 1 },
      ],
    }, { contextId: "gui:folder-main", signal: controller.signal }).finally(() => { settled = true })

    await Promise.all([firstStarted.promise, secondStarted.promise])
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(warm).toHaveBeenCalledTimes(2)

    releaseFirst.resolve()
    await expect(operation).rejects.toMatchObject({ name: "AbortError" })
    expect(warm).toHaveBeenCalledTimes(2)
  })

  it("stops dispatching queued items after a provider-level abort", async () => {
    const activeStarted = deferred<void>()
    const releaseActive = deferred<void>()
    const warm = vi.fn(async (item: { id: string }) => {
      if (item.id === "abort") throw new DOMException("superseded", "AbortError")
      if (item.id === "active") {
        activeStarted.resolve()
        await releaseActive.promise
      }
    })
    const service = new ReaderLibraryThumbnailWarmupService({ warm })
    const operation = service.run({
      concurrency: 2,
      items: [
        { id: "abort", path: "D:/abort.jpg", kind: "file", previewCount: 1 },
        { id: "active", path: "D:/active.jpg", kind: "file", previewCount: 1 },
        { id: "queued", path: "D:/queued.jpg", kind: "file", previewCount: 1 },
      ],
    }, { contextId: "gui:folder-main" })

    await activeStarted.promise
    expect(warm).toHaveBeenCalledTimes(2)
    releaseActive.resolve()
    await expect(operation).rejects.toMatchObject({ name: "AbortError" })
    expect(warm).toHaveBeenCalledTimes(2)
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}
