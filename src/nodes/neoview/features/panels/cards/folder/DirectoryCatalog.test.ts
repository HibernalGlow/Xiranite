import { describe, expect, it } from "vitest"

import type { ReaderDirectoryPageDto } from "../../../../adapters/reader-http-client"
import {
  createDirectoryCatalog,
  directoryEntryAt,
  directoryPageHasMetadata,
  directoryPageCursors,
  mergeDirectoryPage,
  restoreDirectoryVisitState,
  trimDirectoryPages,
} from "./DirectoryCatalog"

describe("DirectoryCatalog", () => {
  it("[neoview.folder.sparse-pages] addresses remote pages without appending all preceding entries", () => {
    let catalog = createDirectoryCatalog(page(0, 10_000))
    catalog = mergeDirectoryPage(catalog, page(9_984, 10_000))
    expect(catalog.pages.size).toBe(2)
    expect(directoryEntryAt(catalog, 9_999)?.path).toBe("D:/library/item-9999")
    expect(directoryPageCursors(9_990, 9_999, 10_000, 128)).toEqual([9_984])
    expect(directoryPageHasMetadata(catalog, 9_984, [])).toBe(true)
    expect(directoryPageHasMetadata(catalog, 9_984, ["dimensions"])).toBe(false)
  })

  it("[neoview.folder.memory-bound] evicts pages furthest from the viewport anchor", () => {
    let catalog = createDirectoryCatalog(page(0, 10_000))
    for (const cursor of [128, 256, 384, 512]) catalog = mergeDirectoryPage(catalog, page(cursor, 10_000))
    catalog = trimDirectoryPages(catalog, 400, 3)
    expect([...catalog.pages.keys()].toSorted((left, right) => left - right)).toEqual([256, 384, 512])
    expect([...catalog.pageMetadataFields.keys()].toSorted((left, right) => left - right)).toEqual([256, 384, 512])
  })

  it("[neoview.folder.filter-catalog] normalizes older pages and preserves server-advertised filters", () => {
    expect(createDirectoryCatalog(page(0, 1))).toMatchObject({
      filter: "all",
      filterOptions: ["all", "archive", "directory", "video"],
    })
    expect(createDirectoryCatalog({ ...page(0, 1), filter: "video", filterOptions: ["all", "video"] })).toMatchObject({
      filter: "video",
      filterOptions: ["all", "video"],
    })
  })

  it("[neoview.folder.restore-focus-ui] relocates saved focus and drops incompatible viewport snapshots", () => {
    const restored = restoreDirectoryVisitState(
      { ...page(0, 10), suggestedSelection: { path: "D:/library/item-4", index: 4 } },
      undefined,
      new Map([[1, {
        selection: { generation: 0, ranges: [], explicit: new Map() },
        focusedPath: "D:/library/item-3",
        focusedIndex: 3,
        anchorIndex: 3,
        listSnapshot: { ranges: [] },
        gridSnapshot: { ranges: [] },
        detailsScrollTop: 240,
      }]]),
      {
        selection: { generation: 1, ranges: [], explicit: new Map() },
        anchorIndex: 0,
      },
    )

    expect(restored).toMatchObject({
      focusedPath: "D:/library/item-4",
      focusedIndex: 4,
      anchorIndex: 4,
      listSnapshot: undefined,
      gridSnapshot: undefined,
      detailsScrollTop: undefined,
    })
    expect(restored.selection.generation).toBe(1)
  })
})

function page(cursor: number, total: number): ReaderDirectoryPageDto {
  const length = Math.min(128, total - cursor)
  return {
    sessionId: "browser-1",
    navigationEntryId: 1,
    path: "D:/library",
    entries: Array.from({ length }, (_, offset) => ({
      name: `item-${cursor + offset}`,
      path: `D:/library/item-${cursor + offset}`,
      kind: "file" as const,
      readerSupported: true,
    })),
    cursor,
    nextCursor: cursor + length < total ? cursor + length : undefined,
    total,
    canGoBack: false,
    canGoForward: false,
    generation: 1,
    sort: { field: "name", order: "asc", directoriesFirst: true },
    sortFields: ["name", "date", "size", "type", "random", "path"],
    metadataFields: [],
    sortSource: "global-default",
    sortTemporary: false,
    globalDefaultSort: { field: "name", order: "asc", directoriesFirst: true },
    tabDefaultSort: { field: "name", order: "asc", directoriesFirst: true },
  }
}
