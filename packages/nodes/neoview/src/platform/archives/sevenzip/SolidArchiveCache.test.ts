import { describe, expect, it, vi } from "vitest"

import type { CacheableSolidArchiveMaterializer } from "./SolidArchiveCache.js"
import { SolidArchiveCache } from "./SolidArchiveCache.js"

describe("SolidArchiveCache", () => {
  it("[neoview.sevenzip.solid-cache-singleflight] shares a complete materializer across sequential sessions", async () => {
    const cache = new SolidArchiveCache({ maxBytes: 100 })
    const create = vi.fn(() => new FakeMaterializer())
    const first = await cache.acquire(input("fingerprint", "archive", 40, create))
    const concurrent = await cache.acquire(input("fingerprint", "archive", 40, create))
    expect(concurrent.materializer).toBe(first.materializer)
    expect(create).toHaveBeenCalledTimes(1)
    ;(first.materializer as FakeMaterializer).isComplete = true
    await first.release()
    await concurrent.release()
    expect(cache.entryCount).toBe(1)
    expect(cache.retainedBytes).toBe(40)

    const nextSession = await cache.acquire(input("fingerprint", "archive", 40, create))
    expect(nextSession.materializer).toBe(first.materializer)
    await nextSession.release()
    await cache.close()
    expect((first.materializer as FakeMaterializer).close).toHaveBeenCalledTimes(1)
  })

  it("[neoview.sevenzip.solid-cache-incomplete] never retains an incomplete or oversized result", async () => {
    const cache = new SolidArchiveCache({ maxBytes: 10 })
    const incomplete = new FakeMaterializer()
    const first = await cache.acquire(input("first", "first.7z", 5, () => incomplete))
    await first.release()
    expect(cache.entryCount).toBe(0)
    expect(incomplete.close).toHaveBeenCalledTimes(1)

    const oversized = new FakeMaterializer()
    oversized.isComplete = true
    const second = await cache.acquire(input("second", "second.7z", 11, () => oversized))
    await second.release()
    expect(cache.entryCount).toBe(0)
    expect(oversized.close).toHaveBeenCalledTimes(1)
    await cache.close()
  })

  it("[neoview.sevenzip.solid-cache-lru] evicts least-recently-used complete results by actual bytes", async () => {
    const cache = new SolidArchiveCache({ maxBytes: 10 })
    const oldest = new FakeMaterializer()
    oldest.isComplete = true
    const first = await cache.acquire(input("first", "first.7z", 6, () => oldest))
    await first.release()

    const newest = new FakeMaterializer()
    newest.isComplete = true
    const second = await cache.acquire(input("second", "second.7z", 6, () => newest))
    await second.release()
    expect(cache.entryCount).toBe(1)
    expect(cache.retainedBytes).toBe(6)
    expect(oldest.close).toHaveBeenCalledTimes(1)
    expect(newest.close).not.toHaveBeenCalled()
    await cache.close()
  })

  it("[neoview.sevenzip.solid-cache-fingerprint] invalidates a changed source after active leases release", async () => {
    const cache = new SolidArchiveCache({ maxBytes: 100 })
    const oldMaterializer = new FakeMaterializer()
    oldMaterializer.isComplete = true
    const oldLease = await cache.acquire(input("old", "same.7z", 5, () => oldMaterializer))

    const newMaterializer = new FakeMaterializer()
    newMaterializer.isComplete = true
    const newLease = await cache.acquire(input("new", "same.7z", 5, () => newMaterializer))
    expect(cache.entryCount).toBe(1)
    expect(oldMaterializer.close).not.toHaveBeenCalled()
    await oldLease.release()
    expect(oldMaterializer.close).toHaveBeenCalledTimes(1)
    await newLease.release()
    await cache.close()
  })

  it("[neoview.memory-pressure.solid-trim] evicts idle LRU materializations without deleting active leases", async () => {
    const cache = new SolidArchiveCache({ maxBytes: 100 })
    const idle = new FakeMaterializer()
    idle.isComplete = true
    const idleLease = await cache.acquire(input("idle", "idle.7z", 30, () => idle))
    await idleLease.release()
    const active = new FakeMaterializer()
    active.isComplete = true
    const activeLease = await cache.acquire(input("active", "active.7z", 40, () => active))

    await expect(cache.trimTo(0)).resolves.toEqual({ evictedEntries: 1, retainedBytes: 40, activeEntries: 1 })
    expect(idle.close).toHaveBeenCalledOnce()
    expect(active.close).not.toHaveBeenCalled()
    await activeLease.release()
    await expect(cache.trimTo(0)).resolves.toEqual({ evictedEntries: 1, retainedBytes: 0, activeEntries: 0 })
    expect(active.close).toHaveBeenCalledOnce()
    await cache.close()
  })

  it("removes a failed shared materializer when its lease invalidates", async () => {
    const cache = new SolidArchiveCache({ maxBytes: 100 })
    const failed = new FakeMaterializer()
    const lease = await cache.acquire(input("failed", "failed.7z", 5, () => failed))
    await lease.invalidate()
    await lease.invalidate()
    expect(cache.entryCount).toBe(0)
    expect(failed.close).not.toHaveBeenCalled()
    await lease.release()
    expect(failed.close).toHaveBeenCalledTimes(1)
    await cache.close()
  })
})

class FakeMaterializer implements CacheableSolidArchiveMaterializer {
  isComplete = false
  readonly close = vi.fn(async () => undefined)

  async pathFor(entryId: string): Promise<string> {
    return entryId
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }
}

function input(
  fingerprint: string,
  sourceIdentity: string,
  materializedBytes: number,
  create: () => CacheableSolidArchiveMaterializer,
) {
  return { fingerprint, sourceIdentity, materializedBytes, create }
}
