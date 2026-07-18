import { describe, expect, it, vi } from "vitest"

import type { ReaderMediaProgressRecord, ReaderMediaProgressStore } from "../../ports/ReaderMediaProgressStore.js"
import { ReaderMediaProgressService } from "./ReaderMediaProgressService.js"

describe("ReaderMediaProgressService", () => {
  it("[neoview.media-progress.coalesce] keeps the latest update per book and flushes one write", async () => {
    const saveMediaProgress = vi.fn(async () => undefined)
    const store = fixtureStore({
      bookId: "book-1",
      position: 1,
      duration: 100,
      completed: false,
      updatedAt: 10,
    }, saveMediaProgress)
    const service = new ReaderMediaProgressService(store, () => 20, 60_000)
    service.record("book-1", { position: 20, duration: 100, completed: false })
    const latest = service.record("book-1", { position: 40, duration: 100, completed: false })
    await expect(service.get("book-1")).resolves.toEqual(latest)
    await service.flush("book-1")
    expect(saveMediaProgress).toHaveBeenCalledOnce()
    expect(saveMediaProgress).toHaveBeenCalledWith({
      bookId: "book-1",
      position: 40,
      duration: 100,
      completed: false,
      updatedAt: 20,
    })
    await service.close()
  })

  it("[neoview.media-progress.validation] rejects invalid playback state before scheduling a write", async () => {
    const saveMediaProgress = vi.fn(async () => undefined)
    const service = new ReaderMediaProgressService(fixtureStore(undefined, saveMediaProgress))
    expect(() => service.record("book-1", { position: 101, duration: 100, completed: false })).toThrow("cannot exceed")
    expect(() => service.record("book-1", { position: Number.NaN, duration: 100, completed: false })).toThrow()
    expect(saveMediaProgress).not.toHaveBeenCalled()
    await service.close()
  })

  it("[neoview.media-progress.close-flush] persists pending state before closing without owning the store", async () => {
    const saveMediaProgress = vi.fn(async () => undefined)
    const store = fixtureStore(undefined, saveMediaProgress)
    const service = new ReaderMediaProgressService(store, () => 30, 60_000)
    service.record("book-2", { position: 30, duration: 30, completed: true })
    await service.close()
    expect(saveMediaProgress).toHaveBeenCalledOnce()
    expect(store.close).not.toHaveBeenCalled()
  })

  it("[neoview.media-progress.read-your-write] returns an active write instead of stale stored state", async () => {
    const write = deferred<void>()
    const store = fixtureStore({
      bookId: "book-3",
      position: 1,
      duration: 10,
      completed: false,
      updatedAt: 1,
    }, vi.fn(() => write.promise))
    const service = new ReaderMediaProgressService(store, () => 2, 60_000)
    const latest = service.record("book-3", { position: 8, duration: 10, completed: false })
    const flushing = service.flush("book-3")
    await expect(service.get("book-3")).resolves.toEqual(latest)
    write.resolve()
    await flushing
    await service.close()
  })
})

function deferred<T>(): { promise: Promise<T>; resolve(value: T | PromiseLike<T>): void } {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((current) => { resolve = current })
  return { promise, resolve }
}

function fixtureStore(
  restored: ReaderMediaProgressRecord | undefined,
  saveMediaProgress: ReaderMediaProgressStore["saveMediaProgress"],
): ReaderMediaProgressStore & { close: ReturnType<typeof vi.fn> } {
  return {
    getMediaProgress: vi.fn(async () => restored),
    saveMediaProgress,
    close: vi.fn(),
  }
}
