import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SevenZipArchiveIndexCache } from "./SevenZipArchiveIndexCache.js"

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("SevenZipArchiveIndexCache", () => {
  it("[neoview.sevenzip.index-cache-telemetry] [neoview.sevenzip.index-cache-singleflight] shares one load and returns isolated descriptors", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-index-cache-"))
    cleanup.push(root)
    const sourcePath = join(root, "book.7z")
    await writeFile(sourcePath, Uint8Array.of(1, 2, 3))
    const cache = new SevenZipArchiveIndexCache(2)
    const load = vi.fn(async () => ({
      solid: true,
      entries: [{ id: "entry-1", path: "001.jpg", kind: "file" as const, uncompressedSize: 3 }],
    }))
    const options = {
      sourcePath,
      executablePath: "C:/tools/7zz.exe",
      executableVersion: "26.02",
      maxListingBytes: 1024,
      load,
    }
    const [first, second] = await Promise.all([cache.getOrLoad(options), cache.getOrLoad(options)])
    expect(load).toHaveBeenCalledOnce()
    expect(first).not.toBe(second)
    expect(first.entries[0]).not.toBe(second.entries[0])
    expect(cache.size).toBe(1)
    expect(cache.snapshot()).toMatchObject({ entries: 1, maxEntries: 2, hits: 1, misses: 1, evictions: 0 })
    await cache.close()
  })

  it("[neoview.sevenzip.index-cache-revision] reloads when the source archive revision changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-index-cache-revision-"))
    cleanup.push(root)
    const sourcePath = join(root, "book.7z")
    await writeFile(sourcePath, Uint8Array.of(1, 2, 3))
    const cache = new SevenZipArchiveIndexCache(2)
    let revision = 0
    const load = vi.fn(async () => ({
      solid: false,
      entries: [{ id: `entry-${++revision}`, path: `${revision}.jpg`, kind: "file" as const, uncompressedSize: revision }],
    }))
    const options = {
      sourcePath,
      executablePath: "C:/tools/7zz.exe",
      executableVersion: "26.02",
      maxListingBytes: 1024,
      load,
    }

    const first = await cache.getOrLoad(options)
    await writeFile(sourcePath, Uint8Array.of(4, 5, 6, 7))
    const second = await cache.getOrLoad(options)

    expect(load).toHaveBeenCalledTimes(2)
    expect(first.entries[0]?.id).toBe("entry-1")
    expect(second.entries[0]?.id).toBe("entry-2")
    expect(cache.size).toBe(1)
    expect(cache.snapshot()).toMatchObject({ entries: 1, hits: 0, misses: 2, evictions: 1 })
    await cache.close()
  })

  it("[neoview.sevenzip.index-cache-revision-flight] does not republish an older concurrent load", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-index-cache-flight-"))
    cleanup.push(root)
    const sourcePath = join(root, "book.7z")
    await writeFile(sourcePath, Uint8Array.of(1, 2, 3))
    const cache = new SevenZipArchiveIndexCache(2)
    let releaseOld!: (index: { solid: false; entries: readonly [] }) => void
    let oldStarted!: () => void
    const started = new Promise<void>((resolve) => { oldStarted = resolve })
    const load = vi.fn(() => {
      if (load.mock.calls.length === 1) {
        oldStarted()
        return new Promise<{ solid: false; entries: readonly [] }>((resolve) => { releaseOld = resolve })
      }
      return Promise.resolve({ solid: false, entries: [] as const })
    })
    const options = {
      sourcePath,
      executablePath: "C:/tools/7zz.exe",
      executableVersion: "26.02",
      maxListingBytes: 1024,
      load,
    }

    const oldPending = cache.getOrLoad(options)
    await started
    await writeFile(sourcePath, Uint8Array.of(4, 5, 6, 7))
    await expect(cache.getOrLoad(options)).resolves.toEqual({ solid: false, entries: [] })
    releaseOld({ solid: false, entries: [] })
    await oldPending
    expect(cache.size).toBe(1)
    expect(load).toHaveBeenCalledTimes(2)
    expect(cache.snapshot()).toMatchObject({ hits: 0, misses: 2, evictions: 0 })
    await cache.close()
  })

  it("[neoview.sevenzip.index-cache-revision-stability] retries a listing when the source changes during load", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-index-cache-stability-"))
    cleanup.push(root)
    const sourcePath = join(root, "book.7z")
    await writeFile(sourcePath, Uint8Array.of(1, 2, 3))
    const cache = new SevenZipArchiveIndexCache(2)
    let first = true
    const load = vi.fn(async () => {
      if (first) {
        first = false
        await writeFile(sourcePath, Uint8Array.of(4, 5, 6, 7))
        return { solid: false, entries: [{ id: "stale", path: "stale.jpg", kind: "file" as const, uncompressedSize: 3 }] }
      }
      return { solid: false, entries: [{ id: "current", path: "current.jpg", kind: "file" as const, uncompressedSize: 4 }] }
    })
    const result = await cache.getOrLoad({
      sourcePath,
      executablePath: "C:/tools/7zz.exe",
      executableVersion: "26.02",
      maxListingBytes: 1024,
      load,
    })

    expect(load).toHaveBeenCalledTimes(2)
    expect(result.entries[0]?.id).toBe("current")
    expect(cache.size).toBe(1)
    expect(cache.snapshot()).toMatchObject({ entries: 1, hits: 0, misses: 1, evictions: 0 })
    await cache.close()
  })

  it("[neoview.sevenzip.index-cache-revision-unstable] bounds retries when the source never stabilizes", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-index-cache-unstable-"))
    cleanup.push(root)
    const sourcePath = join(root, "book.7z")
    await writeFile(sourcePath, Uint8Array.of(1))
    const cache = new SevenZipArchiveIndexCache(2)
    const load = vi.fn(async () => {
      await writeFile(sourcePath, new Uint8Array(load.mock.calls.length + 1))
      return { solid: false, entries: [] as const }
    })

    await expect(cache.getOrLoad({
      sourcePath,
      executablePath: "C:/tools/7zz.exe",
      executableVersion: "26.02",
      maxListingBytes: 1024,
      load,
    })).rejects.toThrow("changed while its index was being loaded")
    expect(load).toHaveBeenCalledTimes(2)
    expect(cache.size).toBe(0)
    expect(cache.snapshot()).toMatchObject({ entries: 0, payloadBytes: 0, hits: 0, misses: 1, evictions: 0 })
    await cache.close()
  })

  it("[neoview.sevenzip.index-cache-cancel] lets one caller cancel without cancelling the shared load", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-index-cache-cancel-"))
    cleanup.push(root)
    const sourcePath = join(root, "book.7z")
    await writeFile(sourcePath, Uint8Array.of(1))
    const cache = new SevenZipArchiveIndexCache()
    let resolveLoad!: (value: { solid: false; entries: [] }) => void
    let loadStarted!: () => void
    const started = new Promise<void>((resolve) => { loadStarted = resolve })
    const load = () => {
      loadStarted()
      return new Promise<{ solid: false; entries: [] }>((resolve) => { resolveLoad = resolve })
    }
    const controller = new AbortController()
    const options = {
      sourcePath,
      executablePath: "C:/tools/7zz.exe",
      executableVersion: "26.02",
      maxListingBytes: 1024,
      load,
    }
    const cancelled = cache.getOrLoad({ ...options, signal: controller.signal })
    const shared = cache.getOrLoad(options)
    await started
    controller.abort(new Error("caller left"))
    await expect(cancelled).rejects.toThrow("caller left")
    resolveLoad({ solid: false, entries: [] })
    await expect(shared).resolves.toEqual({ solid: false, entries: [] })
    await cache.close()
  })

  it("[neoview.sevenzip.index-cache-disabled] bypasses storage when the entry budget is zero", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-index-cache-disabled-"))
    cleanup.push(root)
    const sourcePath = join(root, "book.7z")
    await writeFile(sourcePath, Uint8Array.of(1))
    const cache = new SevenZipArchiveIndexCache(0)
    const load = vi.fn(async () => ({ solid: false, entries: [] as const }))
    const options = {
      sourcePath,
      executablePath: "C:/tools/7zz.exe",
      executableVersion: "26.02",
      maxListingBytes: 1024,
      load,
    }
    await cache.getOrLoad(options)
    await cache.getOrLoad(options)
    expect(load).toHaveBeenCalledTimes(2)
    expect(cache.size).toBe(0)
    expect(cache.snapshot()).toEqual({ entries: 0, maxEntries: 0, payloadBytes: 0, maxPayloadBytes: 0, hits: 0, misses: 2, evictions: 0 })
    await cache.close()
  })

  it("[neoview.sevenzip.index-cache-close] counts cached revisions removed on close", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-index-cache-close-"))
    cleanup.push(root)
    const sourcePath = join(root, "book.7z")
    await writeFile(sourcePath, Uint8Array.of(1))
    const cache = new SevenZipArchiveIndexCache(1)

    await cache.getOrLoad({
      sourcePath,
      executablePath: "C:/tools/7zz.exe",
      executableVersion: "26.02",
      maxListingBytes: 1024,
      load: async () => ({ solid: false, entries: [{ id: "entry", path: "1.jpg", kind: "file" as const, uncompressedSize: 1 }] }),
    })
    expect(cache.snapshot()).toMatchObject({ entries: 1, evictions: 0 })
    await cache.close()
    expect(cache.snapshot()).toMatchObject({ entries: 0, payloadBytes: 0, evictions: 1 })
  })
})
