import { describe, expect, it } from "vitest"

import type { ReaderDirectoryPageDto } from "../../../../adapters/reader-http-client"
import {
  createDirectoryCatalog,
  directoryEntryAt,
  directoryEntryIndex,
  directoryPageHasMetadata,
  directoryPageCursors,
  folderMetadataFieldsForView,
  folderErrorMessage,
  mergeDirectoryPage,
  nearestLoadedDirectoryEntry,
  normalizeFolderNavigationPath,
  removeDirectoryCatalogEntry,
  restoreDirectoryVisitState,
  sortDirectoryCatalogEntries,
  trimDirectoryPages,
} from "./DirectoryCatalog"

describe("DirectoryCatalog", () => {
  it("[neoview.folder.windows-root-path] makes drive roots explicit directories", () => {
    expect(normalizeFolderNavigationPath(" E: ")).toBe("E:\\")
    expect(normalizeFolderNavigationPath("E:/")).toBe("E:\\")
    expect(normalizeFolderNavigationPath("e:\\")).toBe("e:\\")
    expect(normalizeFolderNavigationPath("E:/Books")).toBe("E:/Books")
    expect(normalizeFolderNavigationPath("bookmark:recent")).toBe("bookmark:recent")
  })

  it("[neoview.folder.path-boundaries] trims user input but preserves virtual, UNC and POSIX paths", () => {
    expect(normalizeFolderNavigationPath("  ")).toBe("")
    expect(normalizeFolderNavigationPath("  bookmark:recent  ")).toBe("bookmark:recent")
    expect(normalizeFolderNavigationPath("  history:downloads  ")).toBe("history:downloads")
    expect(normalizeFolderNavigationPath("\\\\server\\share\\books")).toBe("\\\\server\\share\\books")
    expect(normalizeFolderNavigationPath("/srv/books")).toBe("/srv/books")
  })

  it("[neoview.folder.error-safety] turns filesystem failures into actionable messages without exposing local paths", () => {
    expect(folderErrorMessage(new Error("ENOENT: no such file or directory, scandir 'E:'"))).toBe("目录不存在或已断开。")
    expect(folderErrorMessage(Object.assign(new Error("access denied: C:\\private\\books"), { code: "EACCES" }))).toBe("没有权限访问此目录。")
    expect(folderErrorMessage(new Error("failed to read D:/private/books"))).toBe("无法读取当前目录，请重试。")
    expect(folderErrorMessage(new Error("服务暂时不可用"))).toBe("服务暂时不可用")
  })

  it("[neoview.folder.sparse-pages] addresses remote pages without appending all preceding entries", () => {
    let catalog = createDirectoryCatalog(page(0, 10_000))
    catalog = mergeDirectoryPage(catalog, page(9_984, 10_000))
    expect(catalog.pages.size).toBe(2)
    expect(directoryEntryAt(catalog, 9_999)?.path).toBe("D:/library/item-9999")
    expect(directoryPageCursors(9_990, 9_999, 10_000, 128)).toEqual([9_984])
    expect(directoryPageHasMetadata(catalog, 9_984, [])).toBe(true)
    expect(directoryPageHasMetadata(catalog, 9_984, ["dimensions"])).toBe(false)
  })

  it("[neoview.folder.emm-visible-hydration] requests EMM fields only for rich visible renderers", () => {
    const capabilities = ["rating", "collectTagCount", "tags", "dimensions", "directoryEmpty"] as const

    expect(folderMetadataFieldsForView("compact", capabilities)).toEqual([])
    expect(folderMetadataFieldsForView("cover-list", capabilities)).toEqual(["rating", "collectTagCount", "tags", "directoryEmpty"])
    expect(folderMetadataFieldsForView("mosaic-list", capabilities)).toEqual(["rating", "collectTagCount", "tags", "directoryEmpty"])
    expect(folderMetadataFieldsForView("cover-grid", ["rating", "tags", "directoryEmpty"])).toEqual(["rating", "tags", "directoryEmpty"])
    expect(folderMetadataFieldsForView("mosaic-grid", capabilities)).toEqual(["dimensions", "rating", "collectTagCount", "tags", "directoryEmpty"])
    expect(folderMetadataFieldsForView("details", capabilities)).toEqual([])
  })

  it("[neoview.folder.memory-bound] evicts pages furthest from the viewport anchor", () => {
    let catalog = createDirectoryCatalog(page(0, 10_000))
    for (const cursor of [128, 256, 384, 512]) catalog = mergeDirectoryPage(catalog, page(cursor, 10_000))
    catalog = trimDirectoryPages(catalog, 400, 3)
    expect([...catalog.pages.keys()].toSorted((left, right) => left - right)).toEqual([256, 384, 512])
    expect([...catalog.pageMetadataFields.keys()].toSorted((left, right) => left - right)).toEqual([256, 384, 512])
  })

  it("[neoview.folder.catalog-100k-bound] keeps a 100K remote catalog sparse after jumping to its tail", () => {
    let catalog = createDirectoryCatalog(page(0, 100_000))
    for (const cursor of [128, 256, 384, 512, 640, 99_872]) catalog = mergeDirectoryPage(catalog, page(cursor, 100_000))

    catalog = trimDirectoryPages(catalog, 99_900, 3)

    const retainedEntries = [...catalog.pages.values()].reduce((total, entries) => total + entries.length, 0)
    expect(catalog.total).toBe(100_000)
    expect(catalog.pages.size).toBeLessThanOrEqual(3)
    expect(retainedEntries).toBeLessThanOrEqual(384)
    expect(directoryEntryAt(catalog, 99_999)?.path).toBe("D:/library/item-99999")
    expect(directoryEntryAt(catalog, 0)).toBeUndefined()
  })

  it("[neoview.folder.optimistic-delete-catalog] removes a loaded entry without changing server page cursors", () => {
    let catalog = createDirectoryCatalog(page(0, 260))
    catalog = mergeDirectoryPage(catalog, page(128, 260))
    catalog = mergeDirectoryPage(catalog, page(256, 260))

    const updated = removeDirectoryCatalogEntry(catalog, "d:\\LIBRARY\\item-40")

    expect(updated.total).toBe(259)
    expect(directoryEntryIndex(updated, "D:/library/item-40")).toBeUndefined()
    expect(directoryEntryAt(updated, 40)?.path).toBe("D:/library/item-41")
    expect(directoryEntryAt(updated, 127)).toBeUndefined()
    expect(directoryEntryAt(updated, 128)?.path).toBe("D:/library/item-128")
    expect(nearestLoadedDirectoryEntry(updated, 127)).toEqual({
      index: 128,
      entry: expect.objectContaining({ path: "D:/library/item-128" }),
    })
    expect(nearestLoadedDirectoryEntry(updated, 260)).toEqual({
      index: 258,
      entry: expect.objectContaining({ path: "D:/library/item-258" }),
    })
    expect([...updated.pages.keys()]).toEqual([0, 128, 256])
    expect([...updated.pageMetadataFields.keys()]).toEqual([0, 128, 256])
    expect(removeDirectoryCatalogEntry(updated, "D:/library/missing")).toBe(updated)
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

  it("[neoview.folder.virtual-sort] sorts the loaded virtual result set without changing its source identity", () => {
    const source = page(0, 4)
    const catalog = createDirectoryCatalog({
      ...source,
      path: "virtual://search/deep",
      entries: [
        { name: "zeta.cbz", path: "D:/deep/zeta.cbz", kind: "file", size: 2, readerSupported: true },
        { name: "folder", path: "D:/deep/folder", kind: "directory", readerSupported: true },
        { name: "alpha.zip", path: "D:/deep/alpha.zip", kind: "file", size: 20, readerSupported: true },
        { name: "alpha.cbz", path: "D:/deep/alpha.cbz", kind: "file", size: 20, readerSupported: true },
      ],
    })

    const sorted = sortDirectoryCatalogEntries(catalog, { field: "size", order: "desc", directoriesFirst: true })

    expect(sorted.path).toBe("virtual://search/deep")
    expect(sorted.total).toBe(4)
    expect([...sorted.pages.keys()]).toEqual([0])
    expect([...sorted.pages.values()].flat().map((entry) => entry.name)).toEqual([
      "folder",
      "alpha.cbz",
      "alpha.zip",
      "zeta.cbz",
    ])
  })

  it("[neoview.folder.virtual-random-sort] keeps random ordering deterministic for the same result paths", () => {
    const source = page(0, 3)
    const catalog = createDirectoryCatalog({
      ...source,
      path: "virtual://search/random",
      entries: [
        { name: "a.cbz", path: "D:/deep/a.cbz", kind: "file", readerSupported: true },
        { name: "b.cbz", path: "D:/deep/b.cbz", kind: "file", readerSupported: true },
        { name: "c.cbz", path: "D:/deep/c.cbz", kind: "file", readerSupported: true },
      ],
    })
    const rule = { field: "random", order: "asc", directoriesFirst: false } as const

    const first = [...sortDirectoryCatalogEntries(catalog, rule).pages.values()].flat().map((entry) => entry.path)
    const second = [...sortDirectoryCatalogEntries(catalog, rule).pages.values()].flat().map((entry) => entry.path)

    expect(first).toEqual(second)
    expect(first.toSorted()).toEqual(["D:/deep/a.cbz", "D:/deep/b.cbz", "D:/deep/c.cbz"])
  })

  it("[neoview.folder.virtual-cm-rating-sort] applies CM label, version and score precedence to search results", () => {
    const catalog = createDirectoryCatalog({
      ...page(0, 5),
      path: "virtual://search/cm",
      entries: [
        { name: "Unrated", path: "D:/deep/unrated", kind: "directory", readerSupported: true },
        { name: "N [CM-v9-N-S9999]", path: "D:/deep/n", kind: "directory", readerSupported: true },
        { name: "P old [CM-v1-P-S9999]", path: "D:/deep/p-old", kind: "file", readerSupported: true },
        { name: "P low [CM-v2-P-S0001]", path: "D:/deep/p-low", kind: "file", readerSupported: true },
        { name: "P high [CM-v2-P-S0873]", path: "D:/deep/p-high", kind: "file", readerSupported: true },
      ],
    })

    const sorted = sortDirectoryCatalogEntries(catalog, { field: "cmRating", order: "desc", directoriesFirst: false })

    expect([...sorted.pages.values()].flat().map((entry) => entry.name)).toEqual([
      "P high [CM-v2-P-S0873]",
      "P low [CM-v2-P-S0001]",
      "P old [CM-v1-P-S9999]",
      "N [CM-v9-N-S9999]",
      "Unrated",
    ])
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
