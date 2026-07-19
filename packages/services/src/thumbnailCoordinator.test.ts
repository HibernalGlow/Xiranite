import { describe, expect, it, vi } from "vitest"
import {
  ThumbnailCoordinatorService,
  thumbnailLanePriority,
  thumbnailQueuePriority,
  type ThumbnailAsset,
  type ThumbnailDemand,
  type ThumbnailCoordinatorFlightEvent,
  type ThumbnailResolver,
} from "./thumbnailCoordinator.js"

describe("ThumbnailCoordinatorService", () => {
  it("[neoview.thumbnail.coordinator.singleflight] shares generation while preserving independent leases", async () => {
    const pending = deferred<ThumbnailAsset>()
    const resolve = vi.fn(() => pending.promise)
    const coordinator = new ThumbnailCoordinatorService<string>({ resolver: { resolve }, maxMemoryBytes: 64, maxEntryBytes: 64 })
    const first = coordinator.acquire(demand("same", "first"))
    const second = coordinator.acquire(demand("same", "second"))
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(1))
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
    const events: ThumbnailCoordinatorFlightEvent<string>[] = []
    const resolver: ThumbnailResolver<string> = {
      resolve: (_request, signal) => {
        resolverSignal = signal
        return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))
      },
    }
    const coordinator = new ThumbnailCoordinatorService<string>({ resolver, onFlightEvent: (event) => events.push(event) })
    const old = coordinator.acquire(demand("old", "page", { contextId: "book", generation: 1 }))
    coordinator.advanceContext("book", 2)
    await expect(old.ready).rejects.toMatchObject({ name: "AbortError" })
    expect(resolverSignal?.aborted).toBe(true)
    await vi.waitFor(() => expect(events.map((event) => event.state)).toEqual([
      "started",
      "cancellation-requested",
      "settled",
    ]))
    expect(events.at(-1)?.outcome).toBe("cancelled")
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
    const coordinator = new ThumbnailCoordinatorService<string>({ resolver, maxConcurrent: 1 })
    const lease = coordinator.acquire(demand("active", "page"))
    const queued = coordinator.acquire(demand("queued", "page", { lane: "background" }))
    await vi.waitFor(() => expect(coordinator.snapshot()).toMatchObject({ queuedFlights: 1, runningFlights: 1 }))
    await coordinator.dispose()
    await expect(lease.ready).rejects.toMatchObject({ name: "AbortError" })
    await expect(queued.ready).rejects.toMatchObject({ name: "AbortError" })
    expect(coordinator.snapshot()).toEqual({
      demands: 0,
      activeFlights: 0,
      queuedFlights: 0,
      runningFlights: 0,
      cachedEntries: 0,
      cachedBytes: 0,
      demandsByLane: {
        "reader-visible": 0,
        "library-visible": 0,
        prefetch: 0,
        "folder-preview": 0,
        background: 0,
      },
      telemetry: expect.any(Object),
    })
  })

  it("[neoview.thumbnail.coordinator.telemetry] records bounded cumulative outcomes by lane", async () => {
    const coordinator = new ThumbnailCoordinatorService<string>({
      resolver: {
        resolve: async (request, signal) => {
          if (request.source === "bad") throw new Error("decode failed")
          if (request.source === "cancel") {
            return new Promise<ThumbnailAsset>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))
          }
          return asset(4, 1)
        },
      },
    })
    const first = coordinator.acquire(demand("same", "ok"))
    await first.ready
    first.release()
    const hit = coordinator.acquire(demand("same", "ok"))
    await hit.ready
    hit.release()
    const failed = coordinator.acquire(demand("bad", "bad"))
    await expect(failed.ready).rejects.toThrow("decode failed")
    failed.release()
    const cancelled = coordinator.acquire(demand("cancel", "cancel"))
    cancelled.release()
    await expect(cancelled.ready).rejects.toMatchObject({ name: "AbortError" })
    await vi.waitFor(() => expect(coordinator.snapshot().telemetry.cancelled).toBe(1))

    expect(coordinator.snapshot().telemetry).toMatchObject({ cacheHits: 1, cacheMisses: 3, completed: 1, failed: 1, cancelled: 1, evictions: 0 })
    expect(coordinator.snapshot().telemetry.byLane["reader-visible"]).toMatchObject({ demands: 4, cacheHits: 1, cacheMisses: 3, completed: 1, failed: 1, cancelled: 1 })
    await coordinator.dispose()
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

  it("[neoview.thumbnail.coordinator.prime-ttl] prewarms byte-accounted volatile assets and expires them deterministically", async () => {
    let now = 1_000
    const resolve = vi.fn(async () => asset(7, 2))
    const coordinator = new ThumbnailCoordinatorService<string>({
      resolver: { resolve },
      maxMemoryBytes: 16,
      maxEntryBytes: 8,
      now: () => now,
    })
    expect(coordinator.prime("legacy", { ...asset(6, 1), cacheable: false }, { ttlMs: 2_000 })).toBe(true)
    expect(coordinator.snapshot()).toMatchObject({ cachedEntries: 1, cachedBytes: 6 })
    const warm = coordinator.acquire(demand("legacy", "page"))
    await expect(warm.ready).resolves.toMatchObject({ cacheable: false })
    expect(resolve).not.toHaveBeenCalled()
    warm.release()

    now = 3_001
    const cold = coordinator.acquire(demand("legacy", "page", { generation: 1 }))
    await expect(cold.ready).resolves.toMatchObject({ contentType: "image/webp" })
    expect(resolve).toHaveBeenCalledOnce()
    cold.release()
    await coordinator.dispose()
  })

  it("[neoview.thumbnail.coordinator.hibernate] evicts matching unpinned entries without disturbing active leases", async () => {
    const coordinator = new ThumbnailCoordinatorService<string>({
      resolver: { resolve: async (request) => asset(6, request.source === "page" ? 1 : 2) },
      maxMemoryBytes: 32,
      maxEntryBytes: 16,
    })
    const page = coordinator.acquire(demand("page:page-strip-v1", "page"))
    const library = coordinator.acquire(demand("file:library-cover-v1", "library", { contextId: "library" }))
    await Promise.all([page.ready, library.ready])
    library.release()

    expect(coordinator.evictUnpinned((key) => key.endsWith("page-strip-v1"))).toEqual({ entries: 0, bytes: 0 })
    page.release()
    expect(coordinator.evictUnpinned((key) => key.endsWith("page-strip-v1"))).toEqual({ entries: 1, bytes: 6 })
    expect(coordinator.snapshot()).toMatchObject({ cachedEntries: 1, cachedBytes: 6 })

    await coordinator.dispose()
  })

  it("[neoview.thumbnail.coordinator.admission] bounds resolver concurrency", async () => {
    const gates = Array.from({ length: 4 }, () => deferred<ThumbnailAsset>())
    let running = 0
    let peak = 0
    const coordinator = new ThumbnailCoordinatorService<number>({
      maxConcurrent: 2,
      resolver: {
        resolve: async (request) => {
          running += 1
          peak = Math.max(peak, running)
          try {
            return await gates[request.source]!.promise
          } finally {
            running -= 1
          }
        },
      },
    })
    const leases = gates.map((_, index) => coordinator.acquire({ ...demand(`key-${index}`, "unused"), source: index }))
    await vi.waitFor(() => expect(coordinator.snapshot()).toMatchObject({ activeFlights: 4, queuedFlights: 2, runningFlights: 2 }))
    expect(peak).toBe(2)
    gates[0]!.resolve(asset(8, 1))
    gates[1]!.resolve(asset(8, 2))
    await vi.waitFor(() => expect(coordinator.snapshot().runningFlights).toBe(2))
    gates[2]!.resolve(asset(8, 3))
    gates[3]!.resolve(asset(8, 4))
    await Promise.all(leases.map((lease) => lease.ready))
    expect(peak).toBe(2)
    leases.forEach((lease) => lease.release())
    await coordinator.dispose()
  })

  it("[neoview.thumbnail.coordinator.priority] admits visible work before older background work", async () => {
    const blocker = deferred<ThumbnailAsset>()
    const order: string[] = []
    const coordinator = new ThumbnailCoordinatorService<string>({
      maxConcurrent: 1,
      resolver: {
        resolve: async (request) => {
          order.push(request.source)
          if (request.source === "blocker") return blocker.promise
          return asset(8, 1)
        },
      },
    })
    const leases = [
      coordinator.acquire(demand("blocker", "blocker", { lane: "reader-visible" })),
      coordinator.acquire(demand("background-1", "background-1", { lane: "background" })),
      coordinator.acquire(demand("background-2", "background-2", { lane: "background" })),
      coordinator.acquire(demand("visible", "visible", { lane: "reader-visible" })),
    ]
    await vi.waitFor(() => expect(coordinator.snapshot()).toMatchObject({ queuedFlights: 3, runningFlights: 1 }))
    blocker.resolve(asset(8, 1))
    await Promise.all(leases.map((lease) => lease.ready))
    expect(order).toEqual(["blocker", "visible", "background-1", "background-2"])
    leases.forEach((lease) => lease.release())
    await coordinator.dispose()
  })

  it("[neoview.thumbnail.coordinator.priority-upgrade] promotes a queued singleflight when it becomes visible", async () => {
    const blocker = deferred<ThumbnailAsset>()
    const order: string[] = []
    const coordinator = new ThumbnailCoordinatorService<string>({
      maxConcurrent: 1,
      resolver: {
        resolve: async (request) => {
          order.push(`${request.source}:${request.lane}`)
          if (request.source === "blocker") return blocker.promise
          return asset(8, 1)
        },
      },
    })
    const active = coordinator.acquire(demand("blocker", "blocker"))
    const older = coordinator.acquire(demand("older", "older", { lane: "prefetch" }))
    const low = coordinator.acquire(demand("shared", "shared", { lane: "background", contextId: "background" }))
    const high = coordinator.acquire(demand("shared", "ignored", { lane: "reader-visible", contextId: "visible" }))
    blocker.resolve(asset(8, 1))
    await Promise.all([active.ready, older.ready, low.ready, high.ready])
    expect(order).toEqual(["blocker:reader-visible", "shared:reader-visible", "older:prefetch"])
    expect(order.filter((value) => value.startsWith("shared:"))).toHaveLength(1)
    ;[active, older, low, high].forEach((lease) => lease.release())
    await coordinator.dispose()
  })

  it("[neoview.thumbnail.coordinator.queued-cancel] removes stale queued work before it starts", async () => {
    const blocker = deferred<ThumbnailAsset>()
    const resolve = vi.fn(async (request: Readonly<ThumbnailDemand<string>>) => request.source === "blocker" ? blocker.promise : asset(8, 1))
    const events: ThumbnailCoordinatorFlightEvent<string>[] = []
    const coordinator = new ThumbnailCoordinatorService<string>({ maxConcurrent: 1, resolver: { resolve }, onFlightEvent: (event) => events.push(event) })
    const active = coordinator.acquire(demand("blocker", "blocker", { contextId: "active" }))
    const stale = coordinator.acquire(demand("stale", "stale", { contextId: "book", generation: 1, lane: "background" }))
    await vi.waitFor(() => expect(coordinator.snapshot()).toMatchObject({ queuedFlights: 1, runningFlights: 1 }))
    coordinator.advanceContext("book", 2)
    await expect(stale.ready).rejects.toMatchObject({ name: "AbortError" })
    await vi.waitFor(() => expect(events.filter((event) => event.demand.source === "stale").map((event) => event.state)).toEqual([
      "cancellation-requested",
      "settled",
    ]))
    expect(events.find((event) => event.demand.source === "stale" && event.state === "settled")?.outcome).toBe("cancelled")
    await vi.waitFor(() => expect(coordinator.snapshot()).toMatchObject({ activeFlights: 1, queuedFlights: 0, runningFlights: 1 }))
    blocker.resolve(asset(8, 1))
    await active.ready
    expect(resolve.mock.calls.map(([request]) => request.source)).toEqual(["blocker"])
    active.release()
    await coordinator.dispose()
  })

  it("maps thumbnail lanes onto the shared scheduler priorities", () => {
    expect(thumbnailLanePriority("reader-visible")).toBe("interactive")
    expect(thumbnailLanePriority("library-visible")).toBe("view")
    expect(thumbnailLanePriority("prefetch")).toBe("ahead")
    expect(thumbnailLanePriority("folder-preview")).toBe("background")
    expect(thumbnailQueuePriority("reader-visible")).toBeGreaterThan(thumbnailQueuePriority("library-visible"))
    expect(thumbnailQueuePriority("library-visible")).toBeGreaterThan(thumbnailQueuePriority("prefetch"))
    expect(thumbnailQueuePriority("prefetch")).toBeGreaterThan(thumbnailQueuePriority("folder-preview"))
    expect(thumbnailQueuePriority("folder-preview")).toBeGreaterThan(thumbnailQueuePriority("background"))
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
