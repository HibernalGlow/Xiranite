import { describe, expect, it } from "vitest"

import { createDirectoryCatalog } from "./DirectoryCatalog"
import { removeFolderCatalogEntry } from "./FolderCatalogRemoval"

describe("removeFolderCatalogEntry", () => {
  it("removes an external deletion and focuses the nearest remaining entry", () => {
    const catalog = createDirectoryCatalog({
      sessionId: "folder-1",
      navigationEntryId: 1,
      path: "D:/books",
      total: 2,
      generation: 1,
      canGoBack: false,
      canGoForward: false,
      filter: "all",
      filterOptions: ["all"],
      showHiddenFolders: false,
      hideMissingEfuEntries: false,
      sort: { field: "name", order: "asc", directoriesFirst: false },
      sortFields: ["name"],
      metadataFields: [],
      sortSource: "global-default",
      sortTemporary: false,
      globalDefaultSort: { field: "name", order: "asc", directoriesFirst: false },
      tabDefaultSort: { field: "name", order: "asc", directoriesFirst: false },
      watching: false,
      cursor: 0,
      entries: [
        { name: "series", path: "D:/books/series", kind: "directory", readerSupported: true },
        { name: "next.cbz", path: "D:/books/next.cbz", kind: "file", readerSupported: true },
      ],
    })

    const removal = removeFolderCatalogEntry({
      catalog,
      targetPath: "D:/books/series",
      sourcePath: "D:/books/series/inside/001.jpg",
    })

    expect(removal?.catalog.total).toBe(1)
    expect(removal?.focusedPath).toBe("D:/books/next.cbz")
    expect(removal?.selection.explicit.get("D:/books/next.cbz")).toBe(0)
  })
})
