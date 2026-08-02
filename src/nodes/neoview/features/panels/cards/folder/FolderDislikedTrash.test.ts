import { describe, expect, it, vi } from "vitest"

import type { ReaderDirectoryEntryDto, ReaderDirectoryPageDto } from "../../../../adapters/reader-http-client"
import type { DirectoryCatalog } from "./DirectoryCatalog"
import { collectFolderDislikedTrashTargets } from "./FolderDislikedTrash"

describe("collectFolderDislikedTrashTargets", () => {
  it("loads the complete listing and selects only N files and aggregate-N directories", async () => {
    const entries: ReaderDirectoryEntryDto[] = Array.from({ length: 6 }, (_, index) => ({
      name: `plain-${index}.cbz`,
      path: `D:/books/plain-${index}.cbz`,
      kind: "file",
      readerSupported: true,
    }))
    entries[0] = entry("Book N [CM12N0342-4K7Q].cbz", "file")
    entries[1] = entry("Book P [CM12P0873-9X2M].cbz", "file")
    entries[2] = entry("Folder N", "directory")
    entries[3] = entry("Folder P", "directory")
    entries[4] = { ...entry("Hydrated N", "directory"), clipmScore: score("N") }

    const catalog = catalogWith(entries.slice(0, 2), entries.length)
    const loadPage = vi.fn(async (cursor: number, limit: number) => page(entries.slice(cursor, cursor + limit), cursor, entries.length))
    const getDirectoryScores = vi.fn(async (paths: readonly string[]) => paths.map((directoryPath) => ({
      directoryPath,
      work: { label: directoryPath.endsWith("Folder N") ? "N" as const : "P" as const },
    })))

    const result = await collectFolderDislikedTrashTargets({
      catalog,
      pageSize: 2,
      loadPage,
      getDirectoryScores,
      directoryScoreBatchSize: 1,
    })

    expect(loadPage).toHaveBeenCalledTimes(2)
    expect(getDirectoryScores.mock.calls.map(([paths]) => paths)).toEqual([
      ["D:/books/Folder N"],
      ["D:/books/Folder P"],
    ])
    expect(result).toMatchObject({ total: 3, fileCount: 1, directoryCount: 2 })
    expect(result.selection).toEqual({
      generation: 7,
      allSelected: false,
      ranges: [],
      explicit: [
        { path: "D:/books/Book N [CM12N0342-4K7Q].cbz", index: 0 },
        { path: "D:/books/Folder N", index: 2 },
        { path: "D:/books/Hydrated N", index: 4 },
      ],
    })
  })
})

function entry(name: string, kind: ReaderDirectoryEntryDto["kind"]): ReaderDirectoryEntryDto {
  return { name, path: `D:/books/${name}`, kind, readerSupported: true }
}

function score(label: "P" | "N"): NonNullable<ReaderDirectoryEntryDto["clipmScore"]> {
  return { label, score: label === "N" ? 342 : 873, bundleVersion: 12, shortCode: "4K7Q", sourcePath: "D:/source" }
}

function catalogWith(entries: readonly ReaderDirectoryEntryDto[], total: number): DirectoryCatalog {
  return {
    sessionId: "browser-1",
    navigationEntryId: 1,
    path: "D:/books",
    total,
    generation: 7,
    canGoBack: false,
    canGoForward: false,
    filter: "all",
    filterOptions: ["all"],
    showHiddenFolders: false,
    hideMissingEfuEntries: false,
    sort: { field: "name", order: "asc", directoriesFirst: true },
    sortFields: ["name"],
    metadataFields: [],
    metadataCapabilities: [],
    sortSource: "temporary",
    sortTemporary: true,
    globalDefaultSort: { field: "name", order: "asc", directoriesFirst: true },
    tabDefaultSort: { field: "name", order: "asc", directoriesFirst: true },
    watching: false,
    pages: new Map([[0, entries]]),
    pageMetadataFields: new Map([[0, new Set()]]),
  }
}

function page(entries: readonly ReaderDirectoryEntryDto[], cursor: number, total: number): ReaderDirectoryPageDto {
  return { ...catalogWith(entries, total), cursor, entries } as ReaderDirectoryPageDto
}
