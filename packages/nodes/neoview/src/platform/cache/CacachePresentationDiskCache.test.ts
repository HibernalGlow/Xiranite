import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { execFile } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import cacache from "cacache"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CacachePresentationDiskCache } from "./CacachePresentationDiskCache.js"
import { buildPresentationCacheKey } from "./PresentationCacheKey.js"

const execFileAsync = promisify(execFile)

describe("CacachePresentationDiskCache", () => {
  let root = ""

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "xiranite-neoview-l3-test-"))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it("[neoview.cache.l3-roundtrip] publishes verified bytes and keeps the dependency lazy", async () => {
    let loads = 0
    const cache = new CacachePresentationDiskCache({
      root,
      maxBytes: 64,
      maxEntryBytes: 32,
      minFreeBytes: 0,
      loadCacache: async () => { loads += 1; return import("cacache") },
    })
    expect(loads).toBe(0)
    expect(await cache.put(key("page-1"), value(12, 7))).toBe(true)
    expect(loads).toBe(1)

    const lease = await cache.acquire(key("page-1"))
    expect([...lease!.bytes]).toEqual(Array(12).fill(7))
    expect(lease!.contentType).toBe("image/webp")
    expect((await cache.snapshot()).activeLeases).toBe(1)
    lease!.release()
    lease!.release()
    expect(await cache.snapshot()).toMatchObject({ entries: 1, bytes: 12, activeLeases: 0, hits: 1, writes: 1 })
    await cache.close()
  })

  it("[neoview.cache.l3-singleflight] coalesces concurrent writes for the same typed key", async () => {
    const cache = createCache({ maxBytes: 64, maxEntryBytes: 32 })
    const cacheKey = key("same")
    expect(await Promise.all(Array.from({ length: 12 }, () => cache.put(cacheKey, value(8, 3))))).toEqual(Array(12).fill(true))
    const lease = await cache.acquire(cacheKey)
    expect([...lease!.bytes]).toEqual(Array(8).fill(3))
    lease!.release()
    expect(await cache.snapshot()).toMatchObject({ entries: 1, writes: 1 })
    await cache.close()
  })

  it("[neoview.cache.l3-integrity] rejects and removes corrupt content instead of serving partial bytes", async () => {
    const cache = createCache({ maxBytes: 64, maxEntryBytes: 32 })
    const cacheKey = key("corrupt")
    await cache.put(cacheKey, value(16, 9))
    const info = await cacache.get.info(root, cacheKey)
    const bytes = await readFile(info!.path)
    bytes[0] ^= 0xff
    await writeFile(info!.path, bytes)

    expect(await cache.acquire(cacheKey)).toBeUndefined()
    await expect.poll(async () => (await cache.snapshot()).entries).toBe(0)
    expect(await cache.snapshot()).toMatchObject({ activeLeases: 0, integrityFailures: 1 })
    await cache.close()
  })

  it("[neoview.cache.l3-lease] defers invalidation until the active lease is released", async () => {
    const cache = createCache({ maxBytes: 64, maxEntryBytes: 32 })
    const cacheKey = key("leased")
    await cache.put(cacheKey, value(10, 4))
    const lease = await cache.acquire(cacheKey)
    await cache.invalidate(cacheKey)
    expect(await cache.acquire(cacheKey)).toBeUndefined()
    expect(await cache.snapshot()).toMatchObject({ entries: 1, activeLeases: 1 })
    lease!.release()
    await expect.poll(async () => (await cache.snapshot()).entries).toBe(0)
    await cache.close()
  })

  it("[neoview.cache.l3-cross-process-read-lock] skips maintenance while another instance is loading the same entry", async () => {
    const api = await import("cacache")
    const cacheKey = key("cross-process-read")
    const seed = createCache({ maxBytes: 64, maxEntryBytes: 32 })
    await seed.put(cacheKey, value(10, 6))
    await seed.close()

    const started = deferred<void>()
    const resume = deferred<void>()
    const delayedGet = Object.assign(async (...args: Parameters<typeof api.get>) => {
      started.resolve()
      await resume.promise
      return api.get(...args)
    }, api.get) as typeof api.get
    const reader = createCache({
      maxBytes: 64,
      maxEntryBytes: 32,
      loadCacache: async () => ({ ...api, get: delayedGet }),
    })
    const reading = reader.acquire(cacheKey)
    await started.promise

    const child = execFileAsync("bun", [
      join(process.cwd(), "test/helpers/clear-presentation-cache.ts"),
    ], {
      cwd: process.cwd(),
      env: { ...process.env, NEOVIEW_CACHE_TEST_ROOT: root },
    })
    const { stdout } = await child
    expect(JSON.parse(stdout)).toMatchObject({ removedEntries: 0, entries: 1 })
    resume.resolve()
    const lease = await reading
    expect(lease?.bytes).toEqual(value(10, 6).bytes)
    lease?.release()

    const maintenance = createCache({ maxBytes: 64, maxEntryBytes: 32 })
    await expect(maintenance.clear()).resolves.toMatchObject({ removedEntries: 1, entries: 0 })
    await reader.close()
    await maintenance.close()
  })

  it("[neoview.cache.l3-clear] clears unleased entries immediately and retires leased entries on release", async () => {
    const cache = createCache({ maxBytes: 64, maxEntryBytes: 32 })
    await cache.put(key("free"), value(8, 1))
    await cache.put(key("active-clear"), value(8, 2))
    const lease = await cache.acquire(key("active-clear"))
    expect(await cache.clear()).toMatchObject({ removedEntries: 1, entries: 1, activeLeases: 1 })
    expect(await cache.acquire(key("active-clear"))).toBeUndefined()
    lease!.release()
    await expect.poll(async () => (await cache.snapshot()).entries).toBe(0)
    await cache.close()
  })

  it("[neoview.cache.l3-windows-lock] keeps a failed invalidation blocked until maintenance can retry it", async () => {
    const api = await import("cacache")
    let locked = true
    const entry = Object.assign(async (...args: Parameters<typeof api.rm.entry>) => {
      if (locked) {
        locked = false
        throw Object.assign(new Error("fixture file is locked"), { code: "EPERM" })
      }
      return api.rm.entry(...args)
    }, api.rm.entry)
    const cache = createCache({
      maxBytes: 64,
      maxEntryBytes: 32,
      loadCacache: async () => ({ ...api, rm: Object.assign(entry, { ...api.rm, entry }) as typeof api.rm }),
    })
    const cacheKey = key("locked")
    await cache.put(cacheKey, value(8, 1))
    const lease = await cache.acquire(cacheKey)
    await cache.invalidate(cacheKey)
    lease!.release()
    await expect.poll(async () => (await cache.snapshot()).entries).toBe(1)
    expect(await cache.acquire(cacheKey)).toBeUndefined()
    expect(await cache.clear()).toMatchObject({ removedEntries: 1, entries: 0 })
    await cache.close()
  })

  it("[neoview.cache.l3-windows-lock-no-lease] blocks a failed idle invalidation until maintenance can retry it", async () => {
    const api = await import("cacache")
    let locked = true
    const entry = Object.assign(async (...args: Parameters<typeof api.rm.entry>) => {
      if (locked) {
        locked = false
        throw Object.assign(new Error("fixture file is locked"), { code: "EPERM" })
      }
      return api.rm.entry(...args)
    }, api.rm.entry)
    const cache = createCache({
      maxBytes: 64,
      maxEntryBytes: 32,
      loadCacache: async () => ({ ...api, rm: Object.assign(entry, { ...api.rm, entry }) as typeof api.rm }),
    })
    const cacheKey = key("locked-idle")
    await cache.put(cacheKey, value(8, 1))
    await cache.invalidate(cacheKey)

    expect(await cache.acquire(cacheKey)).toBeUndefined()
    expect(await cache.snapshot()).toMatchObject({ entries: 1, activeLeases: 0 })
    expect(await cache.clear()).toMatchObject({ removedEntries: 1, entries: 0 })
    await cache.close()
  })

  it("[neoview.cache.l3-budget] trims old unleased content far enough to admit the next entry", async () => {
    let now = 1
    const cache = createCache({
      maxBytes: 10,
      maxEntryBytes: 6,
      trimRatio: 0.8,
      minimumRetentionMs: 0,
      now: () => now++,
    })
    await cache.put(key("a"), value(4, 1))
    await cache.put(key("b"), value(4, 2))
    await cache.put(key("c"), value(4, 3))
    expect(await cache.acquire(key("a"))).toBeUndefined()
    const b = await cache.acquire(key("b"))
    const c = await cache.acquire(key("c"))
    b!.release()
    c!.release()
    expect(await cache.snapshot()).toMatchObject({ entries: 2, bytes: 8, evictions: 1, writes: 3 })
    await cache.close()
  })

  it("[neoview.cache.l3-age] cleanup removes expired entries but skips an active lease", async () => {
    let now = 1
    const cache = createCache({
      maxBytes: 64,
      maxEntryBytes: 32,
      maxAgeMs: 10,
      minimumRetentionMs: 0,
      now: () => now,
    })
    await cache.put(key("expired"), value(8, 1))
    await cache.put(key("active"), value(8, 2))
    const lease = await cache.acquire(key("active"))
    now = 100
    const cleanup = await cache.cleanup("age")
    expect(cleanup).toMatchObject({ removedEntries: 1, removedBytes: 8, entries: 1, activeLeases: 1 })
    lease!.release()
    await cache.cleanup("age")
    expect(await cache.snapshot()).toMatchObject({ entries: 0, bytes: 0 })
    await cache.close()
  })

  it("[neoview.cache.l3-cancel-publish] removes a completed publication when its producer is cancelled", async () => {
    const api = await import("cacache")
    const started = deferred<void>()
    const resume = deferred<void>()
    const delayedPut = Object.assign(async (...args: Parameters<typeof api.put>) => {
      started.resolve()
      await resume.promise
      return api.put(...args)
    }, { stream: api.put.stream })
    const cache = createCache({
      maxBytes: 64,
      maxEntryBytes: 32,
      loadCacache: async () => ({ ...api, put: delayedPut }),
    })
    const abort = new AbortController()
    const publication = cache.put(key("cancelled"), value(12, 5), abort.signal)
    await started.promise
    abort.abort(new DOMException("fixture cancelled", "AbortError"))
    await expect(publication).rejects.toMatchObject({ name: "AbortError" })
    resume.resolve()
    await cache.close()
    expect(await cache.snapshot()).toMatchObject({ entries: 0, bytes: 0, rejectedWrites: 1 })
  })

  it("[neoview.cache.l3-close] stops admission but lets an atomic publication already in flight finish", async () => {
    const api = await import("cacache")
    const started = deferred<void>()
    const resume = deferred<void>()
    const delayedPut = Object.assign(async (...args: Parameters<typeof api.put>) => {
      started.resolve()
      await resume.promise
      return api.put(...args)
    }, { stream: api.put.stream })
    const cache = createCache({
      maxBytes: 64,
      maxEntryBytes: 32,
      loadCacache: async () => ({ ...api, put: delayedPut }),
    })
    const publication = cache.put(key("closing"), value(12, 8))
    await started.promise
    const closing = cache.close()
    expect(await cache.put(key("rejected-after-close"), value(4, 1))).toBe(false)
    resume.resolve()
    expect(await publication).toBe(true)
    await closing
    expect(await cache.snapshot()).toMatchObject({ entries: 1, bytes: 12, writes: 1, rejectedWrites: 1 })
  })

  it("[neoview.cache.l3-publish-failure] leaves no ready entry when cacache publication fails", async () => {
    const api = await import("cacache")
    const failingPut = Object.assign(async () => {
      throw Object.assign(new Error("injected rename failure"), { code: "EPERM" })
    }, { stream: api.put.stream }) as typeof api.put
    const cache = createCache({
      maxBytes: 64,
      maxEntryBytes: 32,
      loadCacache: async () => ({ ...api, put: failingPut }),
    })
    expect(await cache.put(key("rename-failure"), value(12, 6))).toBe(false)
    expect(await cache.snapshot()).toMatchObject({ entries: 0, bytes: 0, rejectedWrites: 1 })
    await cache.close()
  })

  it("[neoview.cache.l3-low-disk] rejects admission before publication below the free-space floor", async () => {
    const api = await import("cacache")
    const put = vi.fn(api.put)
    Object.assign(put, { stream: api.put.stream })
    const cache = createCache({
      maxBytes: 64,
      maxEntryBytes: 32,
      minFreeBytes: 32,
      availableBytes: async () => 8,
      loadCacache: async () => ({ ...api, put: put as typeof api.put }),
    })
    expect(await cache.put(key("low-disk"), value(12, 7))).toBe(false)
    expect(put).not.toHaveBeenCalled()
    expect(await cache.snapshot()).toMatchObject({ entries: 0, rejectedWrites: 1 })
    await cache.close()
  })

  function createCache(options: Omit<ConstructorParameters<typeof CacachePresentationDiskCache>[0], "root">) {
    return new CacachePresentationDiskCache({ root, minFreeBytes: 0, ...options })
  }
})

function key(entryIdentity: string): string {
  return buildPresentationCacheKey({
    cacheKind: "presentation-transform",
    sourceIdentity: "book-source",
    sourceRevision: "book-v1",
    entryIdentity,
    producerVersion: "sharp-0.35.3-jxl",
    transformProfile: "320:auto:1:inside:webp:82",
  })
}

function value(size: number, fill: number) {
  return { bytes: new Uint8Array(size).fill(fill), contentType: "image/webp" }
}

function deferred<T = void>(): { promise: Promise<T>; resolve(value?: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((current) => { resolve = current })
  return { promise, resolve: resolve as (value?: T) => void }
}
