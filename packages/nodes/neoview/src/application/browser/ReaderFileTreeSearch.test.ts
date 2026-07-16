import { describe, expect, it, vi } from "vitest"

import type { ReaderFileTreeEntry, ReaderFileTreeScanner } from "../../ports/ReaderFileTreeScanner.js"
import { searchReaderFileTree } from "./ReaderFileTreeSearch.js"

describe("searchReaderFileTree", () => {
  it("[neoview.folder.search-stream] streams metadata, bounded text matches, and an exact truncation summary", async () => {
    const scanner = scannerOf([
      entry("Series/Book One.cbz"),
      entry("Series/Book Two.cbz"),
      entry("Other/Book Three.cbz"),
      entry("Other/readme.txt"),
    ])
    const events = await collect(searchReaderFileTree(
      scanner,
      { id: "browser-1", rootPath: "/library", generation: 7 },
      "book",
      { maximumResults: 2 },
    ))
    expect(events).toEqual([
      { type: "meta", sessionId: "browser-1", rootPath: "/library", generation: 7, query: "book", mode: "text" },
      { type: "entry", index: 0, entry: entry("Series/Book One.cbz") },
      { type: "entry", index: 1, entry: entry("Series/Book Two.cbz") },
      { type: "complete", scanned: 3, matched: 2, truncated: true },
    ])
  })

  it("[neoview.folder.search-glob] [neoview.folder.search-path] delegates traversal bounds and applies explicit path matching", async () => {
    const scan = vi.fn((_rootPath: string, _options?: unknown, _signal?: AbortSignal) => scannerOf([
      entry("Series\\Book.CBZ"),
      entry("Series/readme.txt"),
    ]).scan("/ignored"))
    const events = await collect(searchReaderFileTree(
      { scan },
      { id: "browser-2", rootPath: "/library", generation: 1 },
      "**/*.cbz",
      { mode: "glob", kind: "file", maximumDepth: 5, excludePatterns: ["private/", "*.tmp"] },
    ))
    expect(events.filter((event) => event.type === "entry")).toEqual([
      { type: "entry", index: 0, entry: entry("Series\\Book.CBZ") },
    ])
    expect(scan).toHaveBeenCalledWith("/library", expect.objectContaining({
      maximumDepth: 5,
      includeDirectories: false,
      includeFiles: true,
      excludePatterns: ["private/", "*.tmp"],
    }), undefined)

    const nameOnly = await collect(searchReaderFileTree(
      scannerOf([entry("Series\\Book.CBZ")]),
      { id: "browser-3", rootPath: "/library", generation: 1 },
      "series/book",
    ))
    expect(nameOnly.some((event) => event.type === "entry")).toBe(false)

    const textPath = await collect(searchReaderFileTree(
      scannerOf([entry("Series\\Book.CBZ")]),
      { id: "browser-3", rootPath: "/library", generation: 1 },
      "series/book",
      { searchInPath: true },
    ))
    expect(textPath.some((event) => event.type === "entry")).toBe(true)
  })

  it("[neoview.folder.search-validation] rejects invalid queries and budgets before starting the scanner", () => {
    const scanner = scannerOf([])
    const session = { id: "browser-1", rootPath: "/library", generation: 1 }
    expect(() => searchReaderFileTree(scanner, session, " ")).toThrow("1..512")
    expect(() => searchReaderFileTree(scanner, session, "book", { maximumResults: 10_001 })).toThrow("maximumResults")
    expect(() => searchReaderFileTree(scanner, session, "book", { excludePatterns: Array(65).fill("tmp/") })).toThrow("64")
  })
})

function scannerOf(entries: readonly ReaderFileTreeEntry[]): ReaderFileTreeScanner {
  return {
    async *scan() {
      for (const value of entries) yield value
    },
  }
}

function entry(relativePath: string): ReaderFileTreeEntry {
  const normalized = relativePath.replaceAll("\\", "/")
  return {
    name: normalized.split("/").at(-1)!,
    path: `/library/${normalized}`,
    relativePath,
    depth: normalized.split("/").length - 1,
    kind: "file",
  }
}

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const output: T[] = []
  for await (const value of values) output.push(value)
  return output
}
