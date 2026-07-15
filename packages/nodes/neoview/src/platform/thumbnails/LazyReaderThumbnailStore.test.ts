import { describe, expect, it, vi } from "vitest"

import type { ReaderThumbnailAsset, ReaderThumbnailStore } from "../../ports/ReaderThumbnailStore.js"
import { LazyReaderThumbnailStore } from "./LazyReaderThumbnailStore.js"

describe("LazyReaderThumbnailStore", () => {
  it("[neoview.thumbnail.store-lazy] singleflights first use and does not load while idle", async () => {
    const pending = deferred<ReaderThumbnailStore>()
    const load = vi.fn(() => pending.promise)
    const get = vi.fn(async (): Promise<ReaderThumbnailAsset | undefined> => ({ bytes: Uint8Array.of(1), contentType: "image/webp" }))
    const put = vi.fn(async () => undefined)
    const store = new LazyReaderThumbnailStore({ load })

    expect(load).not.toHaveBeenCalled()
    const reading = store.get("page", "file")
    const writing = store.put({ key: "page", category: "file", bytes: webp() })
    expect(load).toHaveBeenCalledOnce()
    pending.resolve({ get, put })

    await expect(reading).resolves.toMatchObject({ contentType: "image/webp" })
    await expect(writing).resolves.toBeUndefined()
    expect(get).toHaveBeenCalledWith("page", "file")
    expect(put).toHaveBeenCalledOnce()
    await store.close()
  })

  it("[neoview.thumbnail.store-unavailable] caches open failure and degrades normal cache operations", async () => {
    const load = vi.fn(async (): Promise<ReaderThumbnailStore> => { throw new Error("database is locked") })
    const store = new LazyReaderThumbnailStore({ load })

    await expect(store.get("page", "file")).resolves.toBeUndefined()
    await expect(store.getMany(["page"], "file")).resolves.toEqual(new Map())
    await expect(store.put({ key: "page", category: "file", bytes: webp() })).resolves.toBeUndefined()
    await expect(store.recordFailure({ key: "page", reason: "decode-error", lastAttempt: "2026-07-15 00:00:00" })).resolves.toBeUndefined()
    await expect(store.maintenanceSnapshot()).rejects.toThrow("statistics is unavailable")
    expect(load).toHaveBeenCalledOnce()
    await store.close()
  })

  it("[neoview.thumbnail.store-close-race] disposes a store that finishes loading after close starts", async () => {
    const pending = deferred<ReaderThumbnailStore>()
    const dispose = vi.fn(async () => undefined)
    const store = new LazyReaderThumbnailStore({ load: () => pending.promise, dispose })
    const reading = store.get("page", "file")
    const closing = store.close()
    const loaded: ReaderThumbnailStore = { get: vi.fn(async () => undefined) }
    pending.resolve(loaded)

    await expect(reading).resolves.toBeUndefined()
    await closing
    expect(dispose).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledWith(loaded)
  })

  it("[neoview.thumbnail.store-close-idle] closes without loading an unused database", async () => {
    const load = vi.fn(async (): Promise<ReaderThumbnailStore> => ({ get: async () => undefined }))
    const store = new LazyReaderThumbnailStore({ load })
    const closing = store.close()
    expect(store.close()).toBe(closing)
    await closing
    expect(load).not.toHaveBeenCalled()
    await expect(store.get("page", "file")).rejects.toThrow("closed")
  })
})

function webp(): Uint8Array {
  return Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((current) => { resolve = current })
  return { promise, resolve }
}
