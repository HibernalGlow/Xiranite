import { describe, expect, it } from "vitest"

import { LegacyReaderDataCodec } from "./LegacyReaderDataCodec.js"

describe("LegacyReaderDataCodec", () => {
  it("[neoview.reader-data.backup-codec] decodes raw localStorage and preserves list semantics", () => {
    const decoded = new LegacyReaderDataCodec().decode({
      version: "2.0.0",
      backupType: "manual",
      rawLocalStorage: {
        "neoview-unified-history": JSON.stringify([{
          id: "history-1",
          pathStack: [
            { path: "D:/books/outer.cbz" },
            { path: "D:/books/outer.cbz", innerPath: "nested.cbz" },
          ],
          currentIndex: 99,
          totalItems: 20,
          displayName: "Nested",
          timestamp: 200,
          videoProgress: { position: 12, duration: 30, completed: false },
        }]),
        "neoview-history": JSON.stringify([{ path: "D:/books/outer.cbz", currentPage: 1, totalPages: 20, timestamp: 100 }]),
        "neoview-bookmarks": JSON.stringify([{
          id: "bookmark-1",
          path: "D:/books/outer.cbz",
          name: "Outer",
          type: "file",
          createdAt: "2025-01-02T00:00:00.000Z",
          listIds: ["default", "reading", "favorites"],
        }]),
        "neoview-bookmark-lists-v2": JSON.stringify([
          { id: "default", name: "Default", system: true, createdAt: 1 },
          { id: "reading", name: "Reading", isFavorite: true, createdAt: 2 },
        ]),
        "neoview-bookmark-active-list-v2": "reading",
        "neoview-history-settings": JSON.stringify({ maxHistorySize: 200, syncFileTreeOnHistorySelect: true }),
      },
    })

    expect(decoded.sourceKind).toBe("backup")
    expect(decoded.history).toEqual([expect.objectContaining({
      legacyId: "history-1",
      source: { kind: "archive", path: "D:/books/outer.cbz", entryPaths: ["nested.cbz"] },
      pageIndex: 19,
      pageCount: 20,
      videoProgress: { position: 12, duration: 30, completed: false },
    })])
    expect(decoded.bookmarks).toEqual([expect.objectContaining({
      id: "bookmark-1",
      starred: true,
      listIds: ["default", "favorites", "reading"],
    })])
    expect(decoded.bookmarkLists).toEqual([{ id: "reading", name: "Reading", isFavorite: true, createdAt: 2 }])
    expect(decoded.activeBookmarkListId).toBe("reading")
    expect(decoded.historySettings).toMatchObject({ maxHistorySize: 200, syncFileTreeOnHistorySelect: true })
    expect(decoded.report.summary.normalized).toBe(1)
  })

  it("[neoview.reader-data.export-codec] deduplicates full exports and synthesizes missing custom lists", () => {
    const decoded = new LegacyReaderDataCodec().decode({
      version: "1.0.0",
      includeExtendedData: true,
      extended: {
        history: [
          { id: "old", path: "D:/Book", name: "Old", currentPage: 1, totalPages: 3, timestamp: 10 },
          { id: "new", pathStack: [{ path: "d:\\book" }], displayName: "New", currentIndex: 2, totalItems: 3, timestamp: 20 },
          { id: "invalid" },
        ],
        bookmarks: [{ path: "D:/Book", name: "Book", listIds: ["missing-list"], createdAt: 30 }],
      },
    })

    expect(decoded.sourceKind).toBe("full-export")
    expect(decoded.history).toEqual([expect.objectContaining({ legacyId: "new", displayName: "New", pageIndex: 2 })])
    expect(decoded.bookmarkLists).toEqual([{ id: "missing-list", name: "missing-list", isFavorite: false, createdAt: 30 }])
    expect(decoded.report.summary.deduplicated).toBe(1)
    expect(decoded.report.summary["skipped-invalid"]).toBe(1)
    expect(decoded.report.summary.synthesized).toBe(1)
    expect(decoded.report.fullyRecognized).toBe(false)
  })

  it("rejects non-object input and reports malformed storage JSON without leaking values", () => {
    const codec = new LegacyReaderDataCodec()
    expect(() => codec.decode("[]")).toThrow("JSON object")
    const decoded = codec.decode({ "neoview-history": "{secret-token" })
    expect(JSON.stringify(decoded.report)).not.toContain("secret-token")
    expect(decoded.report.summary["skipped-invalid"]).toBe(1)
  })
})
