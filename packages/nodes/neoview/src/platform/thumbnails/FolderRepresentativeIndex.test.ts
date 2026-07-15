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
})

function file(name: string) {
  return { name, isFile: () => true }
}

function directory(name: string) {
  return { name, isFile: () => false }
}

function stats(size: number, mtimeMs: number) {
  return { size, mtimeMs, isFile: () => true }
}

function missing(path: string): Error & { code: string } {
  return Object.assign(new Error(`Missing: ${path}`), { code: "ENOENT" })
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((current) => { resolve = current })
  return { promise, resolve }
}
