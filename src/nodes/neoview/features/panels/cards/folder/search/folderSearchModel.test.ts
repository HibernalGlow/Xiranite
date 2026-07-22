import { describe, expect, it } from "vitest"

import {
  applyTagSelection,
  buildDirectorySearchOptions,
  canSaveSearchToTab,
  createDefaultSearchCriteria,
  createSearchDirectoryPage,
  createSearchTabSnapshot,
  hasSearchCriteria,
  isVirtualSearchPath,
  restoreResultFromSnapshot,
  searchTabTitle,
  snapshotSearchResult,
  splitTagKey,
  virtualSearchLabel,
  virtualSearchPath,
} from "./folderSearchModel"

describe("folderSearchModel", () => {
  it("[neoview.folder.search-model-criteria] builds default criteria and detects emptiness", () => {
    const criteria = createDefaultSearchCriteria({ includeSubfolders: true, searchInPath: false })
    expect(criteria).toMatchObject({
      query: "",
      mode: "text",
      kind: "all",
      caseSensitive: false,
      includeSubfolders: true,
      searchInPath: false,
      includeTags: [],
      excludeTags: [],
      tagMode: "all",
    })
    expect(hasSearchCriteria(criteria)).toBe(false)
    expect(hasSearchCriteria({ ...criteria, query: "  cover  " })).toBe(true)
    expect(hasSearchCriteria({ ...criteria, includeTags: ["artist:alice"] })).toBe(true)
  })

  it("[neoview.folder.search-model-options] maps recursive/current depth and tag filters into shared options", () => {
    const recursive = buildDirectorySearchOptions(createDefaultSearchCriteria(
      { includeSubfolders: true, searchInPath: true },
      { query: "book", kind: "file", mode: "glob", caseSensitive: true, includeTags: ["a:b"], excludeTags: ["c:d"], tagMode: "any" },
    ))
    expect(recursive).toEqual(expect.objectContaining({
      mode: "glob",
      kind: "file",
      caseSensitive: true,
      searchInPath: true,
      maximumDepth: undefined,
      maximumResults: 512,
      includeTags: ["a:b"],
      excludeTags: ["c:d"],
      tagMode: "any",
    }))

    const currentOnly = buildDirectorySearchOptions(createDefaultSearchCriteria(
      { includeSubfolders: false, searchInPath: false },
      { query: "book" },
    ))
    expect(currentOnly.maximumDepth).toBe(0)
  })

  it("[neoview.folder.search-model-tags] applies replace / toggle-include / toggle-exclude like legacy modifiers", () => {
    expect(applyTagSelection({ includeTags: [], excludeTags: [] }, { category: "artist", tag: "alice" }, "replace-include"))
      .toEqual({ includeTags: ["artist:alice"], excludeTags: [] })

    expect(applyTagSelection(
      { includeTags: ["artist:alice"], excludeTags: [] },
      { category: "female", tag: "glasses" },
      "toggle-include",
    )).toEqual({ includeTags: ["artist:alice", "female:glasses"], excludeTags: [] })

    expect(applyTagSelection(
      { includeTags: ["artist:alice", "female:glasses"], excludeTags: [] },
      { category: "language", tag: "chinese" },
      "toggle-exclude",
    )).toEqual({ includeTags: ["artist:alice", "female:glasses"], excludeTags: ["language:chinese"] })

    expect(applyTagSelection(
      { includeTags: ["artist:alice"], excludeTags: [] },
      { category: "artist", tag: "alice" },
      "toggle-include",
    )).toEqual({ includeTags: [], excludeTags: [] })

    expect(splitTagKey("artist:alice")).toEqual({ category: "artist", tag: "alice" })
    expect(splitTagKey("plain")).toEqual({ category: "", tag: "plain" })
  })

  it("[neoview.folder.search-model-tab] titles, save gates and round-trips tab snapshots", () => {
    const criteria = createDefaultSearchCriteria(
      { includeSubfolders: true, searchInPath: false },
      { query: "cover art from long title that should truncate", includeTags: ["artist:alice"] },
    )
    expect(searchTabTitle(criteria).startsWith("搜索: ")).toBe(true)
    expect(searchTabTitle(criteria).endsWith("…")).toBe(true)
    expect(searchTabTitle(criteria).length).toBeLessThanOrEqual("搜索: ".length + 24)
    const tagTitle = searchTabTitle({ query: "", includeTags: ["artist:alice"], excludeTags: ["language:chinese"] })
    expect(tagTitle.startsWith("搜索: artist:alice")).toBe(true)
    expect(tagTitle.includes("…")).toBe(true)
    expect(searchTabTitle({ query: "", includeTags: [], excludeTags: [] })).toBe("搜索结果")
    expect(searchTabTitle({ query: "short", includeTags: [], excludeTags: [] })).toBe("搜索: short")

    expect(canSaveSearchToTab({
      criteria,
      hasResult: true,
      loading: false,
      rootPath: "D:/books",
      tabCount: 2,
      maxTabs: 8,
    })).toBe(true)
    expect(canSaveSearchToTab({
      criteria,
      hasResult: true,
      loading: true,
      rootPath: "D:/books",
      tabCount: 2,
      maxTabs: 8,
    })).toBe(false)
    expect(canSaveSearchToTab({
      criteria: { query: "", includeTags: [], excludeTags: [] },
      hasResult: true,
      loading: false,
      rootPath: "D:/books",
      tabCount: 2,
      maxTabs: 8,
    })).toBe(false)
    expect(canSaveSearchToTab({
      criteria,
      hasResult: true,
      loading: false,
      rootPath: "D:/books",
      tabCount: 8,
      maxTabs: 8,
    })).toBe(false)

    const result = {
      sessionId: "browser-1",
      rootPath: "D:/books",
      generation: 3,
      query: "cover",
      mode: "text" as const,
      entries: [{ name: "a.cbz", path: "D:/books/a.cbz", kind: "file" as const, readerSupported: true }],
      scanned: 10,
      matched: 1,
      truncated: false,
    }
    const snapshot = createSearchTabSnapshot({ criteria: { ...criteria, query: "  cover  " }, rootPath: "D:/books", result })
    expect(snapshot.criteria.query).toBe("cover")
    expect(snapshot.result).toEqual(snapshotSearchResult(result))
    expect(restoreResultFromSnapshot(snapshot.result!, "browser-2")).toEqual({
      ...result,
      sessionId: "browser-2",
    })
  })

  it("[neoview.folder.search-virtual-page] builds a virtual directory page for File Card views", () => {
    expect(isVirtualSearchPath("virtual://search")).toBe(true)
    expect(isVirtualSearchPath("virtual://search/cover")).toBe(true)
    expect(isVirtualSearchPath("D:/books")).toBe(false)
    expect(virtualSearchPath("cover art")).toBe("virtual://search/cover%20art")
    expect(virtualSearchLabel("virtual://search/cover%20art")).toBe("cover art")

    const page = createSearchDirectoryPage({
      sessionId: "browser-1",
      rootPath: "D:/books",
      criteria: createDefaultSearchCriteria({ includeSubfolders: true, searchInPath: false }, { query: "cover" }),
      result: {
        entries: [
          { name: "a.cbz", path: "D:/books/a.cbz", kind: "file", readerSupported: true },
          { name: "b", path: "D:/books/b", kind: "directory", readerSupported: false },
        ],
        generation: 9,
        query: "cover",
        mode: "text",
      },
    })
    expect(page.path).toBe("virtual://search/cover")
    expect(page.parentPath).toBe("D:/books")
    expect(page.total).toBe(2)
    expect(page.entries).toHaveLength(2)
    expect(page.cursor).toBe(0)
    expect(page.canGoBack).toBe(true)
    expect(page.watching).toBe(false)
    expect(page.sessionId).toBe("browser-1")
  })
})
