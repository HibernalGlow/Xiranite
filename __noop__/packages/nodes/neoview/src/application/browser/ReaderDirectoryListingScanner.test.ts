import { describe, expect, it } from "vitest"

import type { ReaderDirectoryEntry } from "../../ports/ReaderDirectoryListingProvider.js"
import { ReaderDirectoryListingScanner } from "./ReaderDirectoryListingScanner.js"

const entries: ReaderDirectoryEntry[] = [
  { name: "Folder", path: "/library/Folder", kind: "directory", readerSupported: true },
  { name: "cover.jpg", path: "/library/cover.jpg", kind: "file", readerSupported: true },
  { name: "notes.tmp", path: "/library/notes.tmp", kind: "file", readerSupported: false },
  { name: "device", path: "/library/device", kind: "other", readerSupported: false },
]

describe("ReaderDirectoryListingScanner", () => {
  it("[neoview.folder.search-listing-adapter] preserves listing order and applies kind and ignore options", async () => {
    const scanner = new ReaderDirectoryListingScanner(entries)

    await expect(collect(scanner.scan("/ignored", {
      includeDirectories: true,
      includeFiles: true,
      includeOther: true,
      excludePatterns: ["Folder/", "*.tmp"],
    }))).resolves.toEqual([
      { name: "cover.jpg", path: "/library/cover.jpg", relativePath: "cover.jpg", depth: 0, kind: "file" },
      { name: "device", path: "/library/device", relativePath: "device", depth: 0, kind: "other" },
    ])

    await expect(collect(scanner.scan("/ignored", {
      includeDirectories: true,
      includeFiles: false,
    }))).resolves.toEqual([
      { name: "Folder", path: "/library/Folder", relativePath: "Folder", depth: 0, kind: "directory" },
    ])
  })

  it("[neoview.folder.search-listing-adapter] enforces entry limits and aborts before yielding", async () => {
    const scanner = new ReaderDirectoryListingScanner(entries)
    await expect(collect(scanner.scan("/ignored", { maximumEntries: 1 }))).rejects.toThrow("1 entry limit")

    const controller = new AbortController()
    controller.abort(new DOMException("Search cancelled", "AbortError"))
    await expect(collect(scanner.scan("/ignored", {}, controller.signal))).rejects.toMatchObject({ name: "AbortError" })
  })
})

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const value of values) result.push(value)
  return result
}
