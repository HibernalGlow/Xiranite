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
  it("[neoview.sevenzip.index-cache-singleflight] shares one load and returns isolated descriptors", async () => {
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
    await cache.close()
  })
})
