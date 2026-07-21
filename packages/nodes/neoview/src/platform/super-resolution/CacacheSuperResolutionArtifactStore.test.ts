import { createWriteStream } from "node:fs"
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { once } from "node:events"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CacacheSuperResolutionArtifactStore } from "./CacacheSuperResolutionArtifactStore.js"
import { buildSuperResolutionArtifactKey } from "./SuperResolutionArtifactKey.js"

const PNG_HEADER = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 0, 0, 0, 0])
const metadata = { bookKey: "book:one", contentType: "image/png" as const, extension: "png" as const }

describe("CacacheSuperResolutionArtifactStore", () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "xr-upscale-artifacts-"))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it("[neoview.super-resolution.artifact-singleflight] publishes once and isolates a cancelled waiter", async () => {
    const store = createStore()
    const gate = deferred()
    const producer = vi.fn(async (path: string) => {
      await gate.promise
      await writeFile(path, PNG_HEADER)
    })
    const first = store.publish(key("same"), metadata, producer)
    const abort = new AbortController()
    const second = store.publish(key("same"), metadata, producer, abort.signal)
    abort.abort(new DOMException("caller left", "AbortError"))
    await expect(second).rejects.toMatchObject({ name: "AbortError" })
    gate.resolve()
    await expect(first).resolves.toBe(true)
    expect(producer).toHaveBeenCalledOnce()
    await store.close()
  })

  it("[neoview.super-resolution.artifact-demand-cancel] aborts the producer after its last waiter leaves", async () => {
    const store = createStore()
    const started = deferred()
    const stopped = deferred()
    const producer = vi.fn(async (_path: string, signal: AbortSignal) => {
      started.resolve()
      await new Promise<never>((_resolve, reject) => {
        const abort = () => { stopped.resolve(); reject(signal.reason) }
        signal.addEventListener("abort", abort, { once: true })
      })
    })
    const abort = new AbortController()
    const publication = store.publish(key("cancel-last"), metadata, producer, abort.signal)
    await started.promise
    abort.abort(new DOMException("generation changed", "AbortError"))
    await expect(publication).rejects.toMatchObject({ name: "AbortError" })
    await stopped.promise
    await expect.poll(async () => (await store.snapshot()).entries).toBe(0)
    expect(producer).toHaveBeenCalledOnce()
    await store.close()
  })

  it("[neoview.super-resolution.artifact-stream-lease] streams a verified artifact and defers invalidation until release", async () => {
    const store = createStore()
    const cacheKey = key("leased")
    expect(await store.publish(cacheKey, metadata, (path) => writeFile(path, PNG_HEADER))).toBe(true)
    const lease = await store.acquire(cacheKey)
    expect(lease).toMatchObject({ key: cacheKey, size: PNG_HEADER.length, metadata: { bookKey: "book:one" } })
    await store.invalidate(cacheKey)
    await expect(store.acquire(cacheKey)).resolves.toBeUndefined()
    const chunks: Buffer[] = []
    for await (const chunk of lease!.openStream()) chunks.push(Buffer.from(chunk))
    expect(Buffer.concat(chunks)).toEqual(PNG_HEADER)
    lease!.release()
    await expect.poll(async () => (await store.snapshot()).entries).toBe(0)
    await store.close()
  })

  it("[neoview.super-resolution.artifact-corrupt] rejects malformed image output without publishing an index entry", async () => {
    const store = createStore()
    expect(await store.publish(key("bad"), metadata, (path) => writeFile(path, Buffer.from("not png")))).toBe(false)
    expect(await store.snapshot()).toMatchObject({ entries: 0, writes: 0, rejectedWrites: 1 })
    await store.close()
  })

  it("[neoview.super-resolution.artifact-producer-failure] preserves provider failures for progress and retry handling", async () => {
    const store = createStore()
    const failure = new Error("GPU process exited")
    await expect(store.publish(key("failed"), metadata, async () => { throw failure })).rejects.toBe(failure)
    expect(await store.snapshot()).toMatchObject({ entries: 0, writes: 0, rejectedWrites: 1 })
    await store.close()
  })

  it("[neoview.super-resolution.artifact-flat-staging] keeps in-flight output outside cacache tmp during verification", async () => {
    const store = createStore()
    const produced = deferred()
    const release = deferred()
    let producerPath = ""
    const publication = store.publish(key("verify-race"), metadata, async (path) => {
      producerPath = path
      await writeFile(path, PNG_HEADER)
      produced.resolve()
      await release.promise
    })
    await produced.promise
    expect(producerPath).toContain(join(root, "staging-v1"))
    expect(producerPath).not.toContain(join(root, "tmp"))
    await (await import("cacache")).verify(root)
    release.resolve()
    await expect(publication).resolves.toBe(true)
    await expect(readdir(join(root, "staging-v1"))).resolves.toEqual([])
    const lease = await store.acquire(key("verify-race"))
    expect(lease).toMatchObject({ size: PNG_HEADER.length })
    lease!.release()
    await store.close()
  })

  it("[neoview.super-resolution.artifact-maintenance] clears one book, expires old entries, and trims to budget", async () => {
    let now = 1
    const store = createStore({ maxBytes: 48, maxEntryBytes: 24, maxAgeMs: 10, minimumRetentionMs: 0, now: () => now })
    await store.publish(key("book-one"), metadata, output(20, 1))
    await store.publish(key("book-two"), { ...metadata, bookKey: "book:two" }, output(20, 2))
    expect(await store.countBook("book:one")).toBe(1)
    expect(await store.countBook("book:two")).toBe(1)
    expect(await store.clearBook("book:one")).toMatchObject({ reason: "book", removedEntries: 1, entries: 1 })
    now = 100
    expect(await store.cleanup("age")).toMatchObject({ reason: "age", removedEntries: 1, entries: 0 })
    now = 101
    await store.publish(key("budget-a"), metadata, output(20, 3))
    await store.publish(key("budget-b"), metadata, output(20, 4))
    await store.publish(key("budget-c"), metadata, output(20, 5))
    expect(await store.snapshot()).toMatchObject({ entries: 2, bytes: 40, writes: 5, evictions: 3 })
    await store.close()
  })

  it("[neoview.super-resolution.artifact-periodic-cleanup] removes expired artifacts on the configured interval", async () => {
    let now = 1
    const store = createStore({ maxAgeMs: 10, cleanupIntervalMs: 20, now: () => now })
    await store.publish(key("periodic"), metadata, output(20, 1))
    now = 100
    await expect.poll(async () => (await store.snapshot()).entries, { timeout: 1_000 }).toBe(0)
    await store.close()
  })

  it("[neoview.super-resolution.artifact-dedup-accounting] counts shared cacache content once", async () => {
    const store = createStore()
    await store.publish(key("shared-a"), metadata, (path) => writeFile(path, PNG_HEADER))
    await store.publish(key("shared-b"), { ...metadata, bookKey: "book:two" }, (path) => writeFile(path, PNG_HEADER))
    expect(await store.snapshot()).toMatchObject({ entries: 2, bytes: PNG_HEADER.length })
    expect(await store.clearBook("book:one")).toMatchObject({ removedEntries: 1, removedBytes: 0, entries: 1 })
    expect(await store.clearBook("book:two")).toMatchObject({ removedEntries: 1, removedBytes: PNG_HEADER.length, entries: 0 })
    await store.close()
  })

  it("[neoview.super-resolution.artifact-streaming-rss] publishes and reads a 64 MiB output without buffering it in JS", async () => {
    const bytes = 64 * 1024 * 1024
    const store = createStore({ maxBytes: 96 * 1024 * 1024, maxEntryBytes: 80 * 1024 * 1024 })
    const before = process.memoryUsage().rss
    const heapBefore = process.memoryUsage().heapUsed
    expect(await store.publish(key("large"), metadata, async (path) => {
      const stream = createWriteStream(path)
      stream.write(PNG_HEADER)
      const chunk = Buffer.alloc(1024 * 1024)
      let written = PNG_HEADER.length
      while (written < bytes) {
        const length = Math.min(chunk.length, bytes - written)
        if (!stream.write(chunk.subarray(0, length))) await once(stream, "drain")
        written += length
      }
      stream.end()
      await once(stream, "close")
    })).toBe(true)
    const lease = await store.acquire(key("large"))
    let read = 0
    for await (const chunk of lease!.openStream()) read += Buffer.byteLength(chunk)
    expect(read).toBe(bytes)
    expect(process.memoryUsage().heapUsed - heapBefore).toBeLessThan(16 * 1024 * 1024)
    expect(process.memoryUsage().rss - before).toBeLessThan(96 * 1024 * 1024)
    lease!.release()
    await store.close()
  }, 30_000)

  function createStore(options: Partial<ConstructorParameters<typeof CacacheSuperResolutionArtifactStore>[0]> = {}) {
    return new CacacheSuperResolutionArtifactStore({
      root,
      maxBytes: 1024,
      maxEntryBytes: 512,
      minFreeBytes: 0,
      minimumRetentionMs: 0,
      ...options,
    })
  }
})

function key(identity: string): string {
  return buildSuperResolutionArtifactKey({
    sourceIdentity: "book",
    sourceRevision: "revision",
    pageIdentity: identity,
    modelId: "model",
    scale: 2,
    producerVersion: "runtime-1",
  })
}

function output(size: number, fill: number) {
  return async (path: string) => {
    const bytes = Buffer.alloc(size, fill)
    PNG_HEADER.copy(bytes)
    await writeFile(path, bytes)
  }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((current) => { resolve = current })
  return { promise, resolve }
}
