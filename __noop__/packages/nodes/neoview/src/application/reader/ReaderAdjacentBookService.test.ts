import { describe, expect, it, vi } from "vitest"

import type { ReaderDirectoryEntry } from "../../ports/ReaderDirectoryListingProvider.js"
import { ReaderAdjacentBookService } from "./ReaderAdjacentBookService.js"

describe("ReaderAdjacentBookService", () => {
  it("[neoview.book.adjacent] follows the shared natural folder order and legacy boundaries", async () => {
    const entries = [directory("Book 10"), directory("Book 2"), file("cover.jpg", false), file("clip.mp4", true)]
    const service = new ReaderAdjacentBookService(provider(entries), undefined, (entry) => entry.kind === "directory" || entry.name.endsWith(".mp4"))
    await expect(service.resolve({
      source: { kind: "directory", path: "C:/Library/Book 2" },
      direction: "next",
    })).resolves.toMatchObject({ name: "Book 10", index: 1, total: 3 })
    await expect(service.resolve({
      source: { kind: "directory", path: "C:/Library/Book 10" },
      direction: "next",
    })).resolves.toMatchObject({ name: "clip.mp4", index: 2, total: 3 })
    await expect(service.resolve({
      source: { kind: "media", path: "C:/Library/clip.mp4" },
      direction: "next",
    })).resolves.toBeUndefined()
    await expect(service.resolve({
      source: { kind: "directory", path: "C:/Library/missing" },
      direction: "previous",
    })).resolves.toMatchObject({ name: "clip.mp4", index: 2, total: 3 })
  })

  it("[neoview.book.adjacent-sort] hydrates only metadata required by the selected shared sort", async () => {
    const hydrate = vi.fn(async (entries: readonly ReaderDirectoryEntry[]) => entries.map((entry, index) => ({ ...entry, size: index ? 10 : 20 })))
    const service = new ReaderAdjacentBookService(provider([directory("A"), directory("B")]), {
      supportedFields: new Set(["size"]),
      hydrate,
    }, (entry) => entry.kind === "directory")
    await expect(service.resolve({
      source: { kind: "directory", path: "C:/Library/A" },
      direction: "next",
      sort: { field: "size", order: "asc", directoriesFirst: true },
    })).resolves.toBeUndefined()
    expect(hydrate).toHaveBeenCalledWith(expect.any(Array), new Set(["size"]), undefined)
  })

  it("[neoview.book.adjacent-single-file] keeps legacy single-image mode out of cross-book navigation", async () => {
    const read = vi.fn()
    const service = new ReaderAdjacentBookService({ read }, undefined, () => true)
    await expect(service.resolve({
      source: { kind: "image", path: "C:/Library/cover.jpg" },
      direction: "next",
    })).resolves.toBeUndefined()
    expect(read).not.toHaveBeenCalled()
  })
})

function provider(entries: readonly ReaderDirectoryEntry[]) {
  return { read: vi.fn(async () => ({ path: "C:/Library", entries })) }
}

function directory(name: string): ReaderDirectoryEntry {
  return { name, path: `C:/Library/${name}`, kind: "directory", readerSupported: true }
}

function file(name: string, readerSupported: boolean): ReaderDirectoryEntry {
  return { name, path: `C:/Library/${name}`, kind: "file", readerSupported }
}
