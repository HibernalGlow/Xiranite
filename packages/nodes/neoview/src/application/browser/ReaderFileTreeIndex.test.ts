import { describe, expect, it, vi } from "vitest"

import type {
  ReaderDirectoryListing,
  ReaderDirectoryListingProvider,
} from "../../ports/ReaderDirectoryListingProvider.js"
import { ReaderFileTreeIndex } from "./ReaderFileTreeIndex.js"

describe("ReaderFileTreeIndex", () => {
  it("[neoview.folder.tree-lazy] loads only the requested node and reuses a bounded LRU entry until refresh", async () => {
    const provider = providerOf({
      [resolved("/library")]: listing("/library", [directory("Series 10"), file("cover.jpg"), directory("Series 2")]),
      [resolved("/library/Series 2")]: listing("/library/Series 2", [directory("Volume 1")]),
    })
    const tree = new ReaderFileTreeIndex(provider, { maximumCacheEntries: 1 })

    const first = await tree.read(resolved("/library"))
    expect(first.entries.map((entry) => entry.name)).toEqual(["Series 2", "Series 10"])
    expect(first.cacheHit).toBe(false)
    expect(provider.read).toHaveBeenCalledTimes(1)

    expect((await tree.read(resolved("/library"))).cacheHit).toBe(true)
    expect(provider.read).toHaveBeenCalledTimes(1)
    await tree.read(resolved("/library/Series 2"))
    expect((await tree.read(resolved("/library"))).cacheHit).toBe(false)
    expect(provider.read).toHaveBeenCalledTimes(3)
    expect((await tree.read(resolved("/library"), true)).cacheHit).toBe(false)
    expect(provider.read).toHaveBeenCalledTimes(4)
  })

  it("[neoview.folder.tree-exclusions] persists canonical exclusions and shares descendant pruning patterns", async () => {
    const update = vi.fn(async (paths: readonly string[]) => paths)
    const provider = providerOf({
      [resolved("/library")]: listing("/library", [directory("Private"), directory("Visible")]),
    })
    provider.canonicalize = vi.fn(async (path) => path)
    const tree = new ReaderFileTreeIndex(provider, { updateExcludedPaths: update })

    await expect(tree.updateExclusion({ action: "exclude", path: resolved("/library/Private") })).resolves.toEqual([resolved("/library/Private")])
    expect((await tree.read(resolved("/library"))).entries.map((entry) => entry.name)).toEqual(["Visible"])
    expect(tree.exclusionPatterns(resolved("/library"))).toEqual(["Private/"])
    expect(tree.isExcluded(resolved("/library/Private/Nested"))).toBe(true)
    await expect(tree.read(resolved("/library/Private"))).rejects.toThrow("excluded")

    await expect(tree.updateExclusion({ action: "include", path: resolved("/library/Private") })).resolves.toEqual([])
    expect(update).toHaveBeenNthCalledWith(1, [resolved("/library/Private")])
    expect(update).toHaveBeenNthCalledWith(2, [])
    expect(tree.exclusionPatterns(resolved("/library"))).toEqual([])
  })

  it("[neoview.folder.tree-exclusion-serialization] serializes concurrent TOML updates without losing a path", async () => {
    const writes: string[][] = []
    const provider = providerOf({})
    provider.canonicalize = vi.fn(async (path) => path)
    const tree = new ReaderFileTreeIndex(provider, {
      async updateExcludedPaths(paths) {
        await new Promise((resolve) => setTimeout(resolve, 1))
        writes.push([...paths])
        return paths
      },
    })

    await Promise.all([
      tree.updateExclusion({ action: "exclude", path: resolved("/library/first") }),
      tree.updateExclusion({ action: "exclude", path: resolved("/library/second") }),
    ])
    expect(writes).toEqual([
      [resolved("/library/first")],
      [resolved("/library/first"), resolved("/library/second")],
    ])
  })
})

function providerOf(listings: Record<string, ReaderDirectoryListing>): ReaderDirectoryListingProvider & { read: ReturnType<typeof vi.fn> } {
  const normalizedListings = new Map(Object.entries(listings).map(([path, value]) => [key(path), value]))
  return {
    read: vi.fn(async (path: string) => {
      const value = normalizedListings.get(key(path))
      if (!value) throw new Error(`missing fixture: ${path}`)
      return value
    }),
  }
}

function key(path: string): string {
  const normalized = path.replaceAll("\\", "/")
  return process.platform === "win32" ? normalized.toLocaleLowerCase() : normalized
}

function listing(path: string, entries: ReaderDirectoryListing["entries"]): ReaderDirectoryListing {
  return {
    path: resolved(path),
    parentPath: path === "/library" ? undefined : resolved(path.split("/").slice(0, -1).join("/")),
    entries: entries.map((entry) => ({ ...entry, path: resolved(`${path}/${entry.name}`) })),
  }
}

function directory(name: string) {
  return { name, path: "", kind: "directory" as const, readerSupported: true }
}

function file(name: string) {
  return { name, path: "", kind: "file" as const, readerSupported: true }
}

function resolved(path: string): string {
  return process.platform === "win32" ? `D:${path.replaceAll("/", "\\")}` : path
}
