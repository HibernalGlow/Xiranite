import { describe, expect, it, vi } from "vitest"

import type { ReaderDirectoryEntryDto, ReaderDirectoryPageDto, ReaderHttpClient } from "../../../../adapters/reader-http-client"
import { compileFolderThumbnails } from "./compileFolderThumbnails"

describe("compileFolderThumbnails", () => {
  it("precompiles a large directory in bounded sequential background batches", async () => {
    const entries = Array.from({ length: 520 }, (_, index): ReaderDirectoryEntryDto => ({
      name: `entry-${index}`,
      path: `D:/library/entry-${index}${index % 2 ? ".cbz" : ""}`,
      kind: index % 2 ? "file" : "directory",
      readerSupported: true,
    }))
    const listDirectoryBrowser = vi.fn(async (_sessionId: string, cursor: number, limit: number) => page(entries.slice(cursor, cursor + limit), cursor, entries.length))
    const prewarmLibraryThumbnails = vi.fn(async (items: readonly unknown[]) => ({ total: items.length, completed: items.length, failed: 0 }))
    const progress = vi.fn()

    await expect(compileFolderThumbnails({
      listDirectoryBrowser,
      prewarmLibraryThumbnails,
    } as unknown as ReaderHttpClient, "browser-1", entries.length, { previewCount: 4 }, new AbortController().signal, progress)).resolves.toEqual({
      processed: 520,
      total: 520,
      completed: 520,
      failed: 0,
    })

    expect(listDirectoryBrowser.mock.calls.map((call) => [call[1], call[2]])).toEqual([[0, 256], [256, 256], [512, 8]])
    expect(prewarmLibraryThumbnails).toHaveBeenCalledTimes(3)
    expect(prewarmLibraryThumbnails.mock.calls[0]?.[0]?.[0]).toEqual({
      id: "folder-compile-0",
      path: "D:/library/entry-0",
      kind: "folder",
      previewCount: 4,
    })
    expect(prewarmLibraryThumbnails.mock.calls[0]?.[1]).toEqual({ mode: "ensure", concurrency: 2 })
    expect(progress).toHaveBeenLastCalledWith({ processed: 520, total: 520, completed: 520, failed: 0 })
  })
})

function page(entries: readonly ReaderDirectoryEntryDto[], cursor: number, total: number): ReaderDirectoryPageDto {
  return {
    sessionId: "browser-1",
    navigationEntryId: 1,
    path: "D:/library",
    total,
    cursor,
    entries,
    generation: 1,
    canGoBack: false,
    canGoForward: false,
    filter: "all",
    filterOptions: ["all"],
    sort: { field: "name", order: "asc" },
    sortFields: ["name"],
    metadataFields: [],
    metadataCapabilities: [],
    sortSource: "global-default",
    sortTemporary: false,
    globalDefaultSort: { field: "name", order: "asc" },
    tabDefaultSort: { field: "name", order: "asc" },
    watching: false,
  }
}
