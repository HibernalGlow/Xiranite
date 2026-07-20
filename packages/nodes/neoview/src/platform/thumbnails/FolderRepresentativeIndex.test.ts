import { describe, expect, it, vi } from "vitest"

import { FolderRepresentativeIndex } from "./FolderRepresentativeIndex.js"

describe("FolderRepresentativeIndex", () => {
  it("[neoview.thumbnail.folder-index] selects the natural-first image and validates it without rescanning", async () => {
    const files = new Map([
      ["page2.png", stats(20, 2_000)],
      ["page10.png", stats(100, 1_000)],
    ])
    const readDirectory = vi.fn(async () => [file("page10.png"), directory("nested"), file("notes.txt"), file("page2.png")])
    const statPath = vi.fn(async (path: string) => {
      const value = files.get(path.replaceAll("\\", "/").split("/").at(-1)!)
      if (!value) throw missing(path)
      return value
    })
    const index = new FolderRepresentativeIndex({ readDirectory, statPath })

    await expect(index.describe("D:/library", 500)).resolves.toBe("page2.png:20:2000")
    await expect(index.describe("D:/library", 500)).resolves.toBe("page2.png:20:2000")
    expect(readDirectory).toHaveBeenCalledOnce()
    expect(statPath).toHaveBeenCalledTimes(2)

    files.set("page2.png", stats(21, 2_001))
    await expect(index.describe("D:/library", 500)).resolves.toBe("page2.png:21:2001")
    expect(readDirectory).toHaveBeenCalledOnce()

    await expect(index.describe("D:/library", 501)).resolves.toBe("page2.png:21:2001")
    expect(readDirectory).toHaveBeenCalledTimes(2)
    index.clear()
  })

  it("[neoview.thumbnail.folder-index-singleflight] lets one waiter cancel without aborting another", async () => {
    const listing = deferred<ReturnType<typeof file>[]>()
    const readDirectory = vi.fn(() => listing.promise)
    const index = new FolderRepresentativeIndex({
      readDirectory,
      statPath: async () => stats(8, 9),
    })
    const abort = new AbortController()
    const cancelled = index.describe("D:/shared", 100, abort.signal)
    const retained = index.describe("D:/shared", 100)
    abort.abort(new DOMException("window changed", "AbortError"))
    listing.resolve([file("cover.webp")])

    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" })
    await expect(retained).resolves.toBe("cover.webp:8:9")
    expect(readDirectory).toHaveBeenCalledOnce()
    index.clear()
  })

  it("[neoview.thumbnail.folder-index-scheduler] schedules one representative scan per shared flight", async () => {
    const listing = deferred<ReturnType<typeof file>[]>()
    const release = vi.fn()
    const acquire = vi.fn(async () => ({ release }))
    const index = new FolderRepresentativeIndex({
      readDirectory: () => listing.promise,
      statPath: async () => stats(8, 9),
      resourceScheduler: { acquire },
    })
    const first = index.describe("D:/shared", 100, undefined, 4, "background")
    const second = index.describe("D:/shared", 100, undefined, 4, "background")
    await vi.waitFor(() => expect(acquire).toHaveBeenCalledOnce())
    expect(acquire).toHaveBeenCalledWith({
      resource: "io",
      kind: "neoview.thumbnail.folder-representative",
      priority: "background",
    }, expect.any(AbortSignal))
    listing.resolve([file("cover.webp")])
    await expect(Promise.all([first, second])).resolves.toEqual(["cover.webp:8:9", "cover.webp:8:9"])
    expect(release).toHaveBeenCalledOnce()
    index.clear()
  })

  it("[neoview.thumbnail.folder-index-race] retries once when the selected file disappears during enumeration", async () => {
    const readDirectory = vi.fn()
      .mockResolvedValueOnce([file("001.png"), file("002.png")])
      .mockResolvedValueOnce([file("002.png")])
    const statPath = vi.fn(async (path: string) => {
      if (path.endsWith("001.png")) throw missing(path)
      return stats(12, 34)
    })
    const index = new FolderRepresentativeIndex({ readDirectory, statPath })

    await expect(index.describe("D:/racing", 10)).resolves.toBe("002.png:12:34")
    expect(readDirectory).toHaveBeenCalledTimes(2)
    index.clear()
  })

  it("[neoview.thumbnail.folder-index-mosaic] fingerprints the natural-first 4/9/16 representatives", async () => {
    const readDirectory = vi.fn(async () => [file("10.png"), file("2.png"), file("1.png"), file("3.png"), file("4.png")])
    const statPath = vi.fn(async (path: string) => stats(Number(path.match(/(\d+)\.png$/)?.[1]), 100))
    const index = new FolderRepresentativeIndex({ readDirectory, statPath })
    await expect(index.describe("D:/mosaic", 50, undefined, 4)).resolves.toBe(
      "1.png:1:100|2.png:2:100|3.png:3:100|4.png:4:100",
    )
    await expect(index.describe("D:/mosaic", 50, undefined, 4)).resolves.toContain("4.png:4:100")
    expect(readDirectory).toHaveBeenCalledOnce()
    expect(statPath).toHaveBeenCalledTimes(8)
    index.clear()
  })

  it("[neoview.thumbnail.folder-index-persistent] reuses a validated manifest after a process-local cache reset", async () => {
    const manifests = new Map<string, { directoryModifiedAtMs: number; sources: readonly { name: string; size: number; modifiedAtMs: number }[] }>()
    const manifestStore = {
      getFolderRepresentativeManifest: vi.fn(async (path: string, count: number, revision: number) => manifests.get(`${path}:${count}:${revision}`)),
      putFolderRepresentativeManifest: vi.fn(async (path: string, count: number, revision: number, manifest: { directoryModifiedAtMs: number; sources: readonly { name: string; size: number; modifiedAtMs: number }[] }) => {
        manifests.set(`${path}:${count}:${revision}`, manifest)
      }),
    }
    const readDirectory = vi.fn(async () => [file("cover.webp")])
    const statPath = vi.fn(async () => stats(42, 1_234))
    const first = new FolderRepresentativeIndex({ readDirectory, statPath, manifestStore })

    await expect(first.describe("D:/compiled", 500)).resolves.toBe("cover.webp:42:1234")
    await vi.waitFor(() => expect(manifestStore.putFolderRepresentativeManifest).toHaveBeenCalledOnce())
    first.clear()

    const reopened = new FolderRepresentativeIndex({
      readDirectory: async () => { throw new Error("persistent manifest should avoid a directory scan") },
      statPath,
      manifestStore,
    })
    await expect(reopened.describe("D:/compiled", 500)).resolves.toBe("cover.webp:42:1234")
    expect(readDirectory).toHaveBeenCalledOnce()
    expect(manifestStore.getFolderRepresentativeManifest).toHaveBeenCalledTimes(2)
    reopened.clear()
  })

  it("[neoview.thumbnail.folder-index-poster-names] prioritizes a directory-named cover before natural page order", async () => {
    const readDirectory = vi.fn(async () => [file("001.png"), file("01 library-cover 2.jpg"), file("002.png")])
    const index = new FolderRepresentativeIndex({
      readDirectory,
      statPath: async (path) => stats(path.endsWith("01 library-cover 2.jpg") ? 30 : 10, 100),
    })

    await expect(index.describe("D:/library", 50)).resolves.toBe("01 library-cover 2.jpg:30:100")
    index.clear()
  })

  it("[neoview.thumbnail.folder-index-poster-stems] recognizes OpenComic poster aliases", async () => {
    const index = new FolderRepresentativeIndex({
      readDirectory: async () => [file("001.png"), file("poster.avif")],
      statPath: async (path) => stats(path.endsWith("poster.avif") ? 20 : 10, 100),
    })

    await expect(index.describe("D:/library", 50)).resolves.toBe("poster.avif:20:100")
    index.clear()
  })

  it("[neoview.thumbnail.folder-index-recursive] finds bounded nested image and archive representatives", async () => {
    const readDirectory = vi.fn(async (path: string) => path.endsWith("nested")
      ? [file("2.cbz"), file("1.jpg")]
      : [directory("nested")])
    const index = new FolderRepresentativeIndex({
      readDirectory,
      statPath: async (path) => stats(path.endsWith("1.jpg") ? 10 : 20, 100),
    })

    await expect(index.resolve("D:/library", 50, undefined, 2)).resolves.toEqual({
      version: expect.stringContaining("nested"),
      paths: [expect.stringContaining("1.jpg"), expect.stringContaining("2.cbz")],
    })
    index.clear()
  })

  it("[neoview.thumbnail.folder-index-directory-covers] descends through sibling folders until it finds media", async () => {
    const index = new FolderRepresentativeIndex({
      readDirectory: async (path) => path.endsWith("artist-a")
        ? [file("a.jpg")]
        : path.endsWith("artist-b") ? [file("b.jpg")] : [directory("artist-b"), directory("artist-a")],
      statPath: async (path) => path.endsWith(".jpg") ? stats(10, 100) : directoryStats(0, 100),
    })

    await expect(index.resolve("D:/library", 50, undefined, 2)).resolves.toMatchObject({
      paths: [expect.stringContaining("artist-a"), expect.stringContaining("artist-b")],
    })
    index.clear()
  })
})

function file(name: string) {
  return { name, isFile: () => true, isDirectory: () => false }
}

function directory(name: string) {
  return { name, isFile: () => false, isDirectory: () => true }
}

function stats(size: number, mtimeMs: number) {
  return { size, mtimeMs, isFile: () => true, isDirectory: () => false }
}

function directoryStats(size: number, mtimeMs: number) {
  return { size, mtimeMs, isFile: () => false, isDirectory: () => true }
}

function missing(path: string): Error & { code: string } {
  return Object.assign(new Error(`Missing: ${path}`), { code: "ENOENT" })
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((current) => { resolve = current })
  return { promise, resolve }
}
