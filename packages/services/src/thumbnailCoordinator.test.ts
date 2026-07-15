import { describe, expect, it, vi } from "vitest"
import {
  ThumbnailCoordinatorService,
  thumbnailLanePriority,
  type ThumbnailAsset,
  type ThumbnailDemand,
  type ThumbnailResolver,
} from "./thumbnailCoordinator.js"

describe("ThumbnailCoordinatorService", () => {
  it("[neoview.thumbnail.coordinator.singleflight] shares generation while preserving independent leases", async () => {
    const pending = deferred<ThumbnailAsset>()
    const resolve = vi.fn(() => pending.promise)
    const coordinator = new ThumbnailCoordinatorService<string>({ resolver: { resolve }, maxMemoryBytes: 64, maxEntryBytes: 64 })
    const first = coordinator.acquire(demand("same", "first"))
    const second = coordinator.acquire(demand("same", "second"))
    expect(resolve).toHaveBeenCalledTimes(1)
    first.release()
    pending.resolve(asset(8, 1))
    await expect(second.ready).resolves.toMatchObject({ contentType: "image/webp" })
    expect(coordinator.snapshot()).toMatchObject({ demands: 1, cachedEntries: 1, cachedBytes: 8 })
    second.release()
    expect(coordinator.snapshot().demands).toBe(0)
    await coordinator.dispose()
  })

  it("[neoview.thumbnail.coordinator.generation] cancels superseded work when its context advances", async () => {
    let resolverSignal: AbortSignal | undefined
    const resolver: ThumbnailResolver<string> = {
      resolve: (_request, signal) => {
        resolverSignal = signal
        return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))
      },
    }
    const coordinator = new ThumbnailCoordinatorService<string>({ resolver })
    const old = coordinator.acquire(demand("old", "page", { contextId: "book", generation: 1 }))
    coordinator.advanceContext("book", 2)
    await expect(old.ready).rejects.toMatchObject({ name: "AbortError" })
    expect(resolverSignal?.aborted).toBe(true)
    expect(coordinator.snapshot()).toMatchObject({ demands: 0, activeFlights: 0 })
    await coordinator.dispose()
  })

  it("[neoview.thumbnail.coordinator.memory] enforces a hard byte budget and evicts only unpinned LRU entries", async () => {
    const coordinator = new ThumbnailCoordinatorService<string>({
      resolver: { resolve: async (request) => asset(6, request.source === "a" ? 1 : 2) },
      maxMemoryBytes: 10,
      maxEntryBytes: 10,
    })
    const first = coordinator.acquire(demand("a", "a"))
    await first.ready
    const second = coordinator.acquire(demand("b", "b"))
    await second.ready
    expect(coordinator.snapshot()).toMatchObject({ cachedEntries: 1, cachedBytes: 6, demands: 2 })
    first.release()
    second.release()

    const third = coordinator.acquire(demand("b", "b", { generation: 1 }))
    await third.ready
    expect(coordinator.snapshot()).toMatchObject({ cachedEntries: 1, cachedBytes: 6 })
    third.release()
    await coordinator.dispose()
  })

  it("[neoview.thumbnail.coordinator.dispose] aborts active work and clears all state", async () => {
    const resolver: ThumbnailResolver<string> = {
      resolve: (_request, signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
    }
    const coordinator = new ThumbnailCoordinatorService<string>({ resolver })
    const lease = coordinator.acquire(demand("active", "page"))
    await coordinator.dispose()
    await expect(lease.ready).rejects.toMatchObject({ name: "AbortError" })
    expect(coordinator.snapshot()).toEqual({
      demands: 0,
      activeFlights: 0,
      cachedEntries: 0,
      cachedBytes: 0,
      demandsByLane: {
        "reader-visible": 0,
        "library-visible": 0,
        prefetch: 0,
        "folder-preview": 0,
        background: 0,
      },
    })
  })

  it("[neoview.thumbnail.coordinator.context-release] forgets one context without cancelling shared consumers", async () => {
    const pending = deferred<ThumbnailAsset>()
    const coordinator = new ThumbnailCoordinatorService<string>({ resolver: { resolve: async () => pending.promise } })
    const released = coordinator.acquire(demand("shared", "page", { contextId: "library:old", generation: 5 }))
    const retained = coordinator.acquire(demand("shared", "page", { contextId: "reader:active", generation: 0 }))
    coordinator.releaseContext("library:old")
    await expect(released.ready).rejects.toMatchObject({ name: "AbortError" })
    pending.resolve(asset(8, 1))
    await expect(retained.ready).resolves.toMatchObject({ contentType: "image/webp" })
    expect(coordinator.snapshot()).toMatchObject({ demands: 1, activeFlights: 0 })
    retained.release()
    expect(() => coordinator.acquire(demand("new", "page", { contextId: "library:old", generation: 0 }))).not.toThrow()
    await coordinator.dispose()
  })

  it("maps thumbnail lanes onto the shared scheduler priorities", () => {
    expect(thumbnailLanePriority("reader-visible")).toBe("interactive")
    expect(thumbnailLanePriority("library-visible")).toBe("view")
    expect(thumbnailLanePriority("prefetch")).toBe("ahead")
    expect(thumbnailLanePriority("folder-preview")).toBe("background")
  })
})

function demand(cacheKey: string, source: string, overrides: Partial<ThumbnailDemand<string>> = {}): ThumbnailDemand<string> {
  return {
    cacheKey,
    source,
    lane: "reader-visible",
    contextId: "reader",
    generation: 0,
    ...overrides,
  }
}

function asset(bytes: number, fill: number): ThumbnailAsset {
  return { bytes: new Uint8Array(bytes).fill(fill), contentType: "image/webp" }
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((current) => { resolve = current })
  return { promise, resolve }
}
