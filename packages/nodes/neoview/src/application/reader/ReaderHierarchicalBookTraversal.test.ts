import { describe, expect, it } from "vitest"

import type { ReaderDirectoryEntry, ReaderDirectoryListingProvider } from "../../ports/ReaderDirectoryListingProvider.js"
import { ReaderFolderPenetrationResolver } from "../browser/ReaderFolderPenetrationResolver.js"
import { ReaderHierarchicalBookTraversal } from "./ReaderHierarchicalBookTraversal.js"

describe("ReaderHierarchicalBookTraversal", () => {
  it("[neoview.folder.penetration-traversal] enters ambiguous branches without skipping their books", async () => {
    const listing = provider({
      "C:/Library": [directory("C:/Library/A"), directory("C:/Library/B"), directory("C:/Library/C")],
      "C:/Library/A": [file("C:/Library/A/book-a.cbz", true)],
      "C:/Library/B": [file("C:/Library/B/book-b1.cbz", true), file("C:/Library/B/book-b2.cbz", true)],
      "C:/Library/C": [directory("C:/Library/C/nested")],
      "C:/Library/C/nested": [file("C:/Library/C/nested/book-c.cbz", true)],
    })
    const penetration = new ReaderFolderPenetrationResolver(listing)
    const traversal = new ReaderHierarchicalBookTraversal(listing, undefined, isBook, penetration)
    const a = await penetration.resolve("C:/Library/A")
    expect(a.terminal?.path).toBe("C:/Library/A/book-a.cbz")

    const first = await traversal.resolve({
      source: { kind: "archive", path: a.terminal!.path },
      direction: "next",
      cursor: { rootPath: "C:/Library", frames: [{ directoryPath: "C:/Library", currentEntryPath: "C:/Library/A" }] },
    })
    expect(first?.path).toBe("C:/Library/B/book-b1.cbz")
    const second = await traversal.resolve({
      source: { kind: "archive", path: first!.path },
      direction: "next",
      cursor: first!.cursor,
    })
    expect(second?.path).toBe("C:/Library/B/book-b2.cbz")
    const third = await traversal.resolve({
      source: { kind: "archive", path: second!.path },
      direction: "next",
      cursor: second!.cursor,
    })
    expect(third?.path).toBe("C:/Library/C/nested/book-c.cbz")
    await expect(traversal.resolve({
      source: { kind: "archive", path: third!.path },
      direction: "previous",
      cursor: third!.cursor,
    })).resolves.toMatchObject({ path: "C:/Library/B/book-b2.cbz" })
  })

  it("[neoview.folder.penetration-traversal-depth] descends a branch when atomic penetration reaches its depth limit", async () => {
    const listing = provider({
      "C:/Library": [directory("C:/Library/A"), directory("C:/Library/deep")],
      "C:/Library/A": [file("C:/Library/A/book-a.cbz", true)],
      "C:/Library/deep": [directory("C:/Library/deep/one")],
      "C:/Library/deep/one": [directory("C:/Library/deep/one/two")],
      "C:/Library/deep/one/two": [file("C:/Library/deep/one/two/book.cbz", true)],
    })
    const penetration = new ReaderFolderPenetrationResolver(listing)
    const traversal = new ReaderHierarchicalBookTraversal(listing, undefined, isBook, penetration)
    await expect(traversal.resolve({
      source: { kind: "archive", path: "C:/Library/A/book-a.cbz" },
      direction: "next",
      cursor: { rootPath: "C:/Library", frames: [{ directoryPath: "C:/Library", currentEntryPath: "C:/Library/A" }] },
      penetration: { maxDepth: 1 },
    })).resolves.toMatchObject({ path: "C:/Library/deep/one/two/book.cbz" })
  })
})

function provider(entriesByPath: Record<string, readonly ReaderDirectoryEntry[]>): ReaderDirectoryListingProvider {
  return {
    canonicalize: async (path) => path,
    read: async (path) => ({ path, entries: entriesByPath[path] ?? [] }),
  }
}

function directory(path: string): ReaderDirectoryEntry {
  return { name: path.split("/").at(-1)!, path, kind: "directory", readerSupported: true }
}

function file(path: string, readerSupported: boolean): ReaderDirectoryEntry {
  return { name: path.split("/").at(-1)!, path, kind: "file", readerSupported }
}

function isBook(entry: ReaderDirectoryEntry): boolean {
  return entry.kind === "file" && entry.readerSupported
}
