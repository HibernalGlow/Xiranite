import { describe, expect, it } from "vitest"

import {
  createReaderDirectorySelectionBatchSource,
  ReaderDirectorySelectionStaleError,
} from "./ReaderDirectorySelection.js"

describe("ReaderDirectorySelection", () => {
  it("[neoview.folder.selection-backend-100k] iterates all-selected exceptions in bounded batches", () => {
    const entries = directoryEntries(100_000)
    const source = createReaderDirectorySelectionBatchSource(entries, 7, {
      generation: 7,
      allSelected: true,
      ranges: [{ start: 10, end: 20 }],
      explicit: [{ path: entries[50]!.path, index: 50 }],
    })
    const batches = [...source.batches(256)]

    expect(source.total).toBe(100_000)
    expect(source.selectedCount).toBe(99_988)
    expect(batches.every((batch) => batch.length <= 256)).toBe(true)
    expect(batches.reduce((count, batch) => count + batch.length, 0)).toBe(99_988)
    expect(batches.flatMap((batch) => batch).some((entry) => entry.path === entries[50]!.path)).toBe(false)
  })

  it("[neoview.folder.selection-backend-identity] resolves path-only identities before counting range overlap", () => {
    const entries = directoryEntries(100)
    const source = createReaderDirectorySelectionBatchSource(entries, 3, {
      generation: 3,
      allSelected: false,
      ranges: [{ start: 10, end: 20 }],
      explicit: [
        { path: entries[15]!.path },
        { path: entries[50]!.path },
      ],
    })

    expect(source.selectedCount).toBe(12)
    expect([...source.batches(8)].flatMap((batch) => batch).map((entry) => entry.name)).toEqual([
      ...Array.from({ length: 11 }, (_, offset) => `item-${offset + 10}`),
      "item-50",
    ])
  })

  it("[neoview.folder.selection-backend-validation] rejects stale, non-canonical and forged descriptors", () => {
    const entries = directoryEntries(10)
    expect(() => createReaderDirectorySelectionBatchSource(entries, 2, {
      generation: 1,
      allSelected: false,
      ranges: [],
      explicit: [],
    })).toThrow(ReaderDirectorySelectionStaleError)
    expect(() => createReaderDirectorySelectionBatchSource(entries, 2, {
      generation: 2,
      allSelected: false,
      ranges: [{ start: 1, end: 3 }, { start: 4, end: 5 }],
      explicit: [],
    })).toThrow("sorted, disjoint and non-adjacent")
    expect(() => createReaderDirectorySelectionBatchSource(entries, 2, {
      generation: 2,
      allSelected: false,
      ranges: [],
      explicit: [{ path: "C:/outside/forged.cbz" }],
    })).toThrow("not in the current listing")
    expect(() => createReaderDirectorySelectionBatchSource(entries, 2, {
      generation: 2,
      allSelected: false,
      ranges: [],
      explicit: [{ path: entries[2]!.path, index: 3 }],
    })).toThrow("index does not match")
  })

  it("[neoview.folder.selection-backend-cancel] checks cancellation while streaming a snapshot", () => {
    const controller = new AbortController()
    const source = createReaderDirectorySelectionBatchSource(directoryEntries(1_000), 1, {
      generation: 1,
      allSelected: true,
      ranges: [],
      explicit: [],
    })
    const iterator = source.batches(64, controller.signal)[Symbol.iterator]()
    expect(iterator.next().value).toHaveLength(64)
    controller.abort(new DOMException("cancelled", "AbortError"))
    expect(() => iterator.next()).toThrow(/cancelled/u)
  })
})

function directoryEntries(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    name: `item-${index}`,
    path: `C:/library/item-${index}`,
    kind: "file" as const,
    readerSupported: true,
  }))
}
