import { describe, expect, it } from "vitest"

import { folderClipmPathName, predictFolderClipmPath, projectFolderClipmEntry } from "./FolderClipmProjection"

describe("FolderClipmProjection", () => {
  it("writes the canonical suffix before an archive extension", () => {
    expect(predictFolderClipmPath(
      { kind: "file", path: "D:\\Comics\\Book.v2.cbz" },
      { bundleVersion: 3, label: "P", score: 87, shortCode: "4K7Q" },
    )).toBe("D:\\Comics\\Book.v2 [CM3P0087-4K7Q].cbz")
  })

  it("replaces canonical and legacy suffixes without restoring an older title", () => {
    expect(predictFolderClipmPath(
      { kind: "directory", path: "D:/Comics/Renamed [CM1P0873-4K7Q]" },
      { bundleVersion: 2, label: "N", score: 342, shortCode: "4K7Q" },
    )).toBe("D:/Comics/Renamed [CM2N0342-4K7Q]")
    expect(predictFolderClipmPath(
      { kind: "file", path: "D:/Comics/Renamed [CM-v1-P-S0873].zip" },
      { bundleVersion: 2, label: "N", score: 342, shortCode: "4K7Q" },
    )).toBe("D:/Comics/Renamed [CM2N0342-4K7Q].zip")
  })

  it("projects only the entry path and display name", () => {
    const entry = { name: "Book.cbz", path: "D:/Comics/Book.cbz", kind: "file" as const, readerSupported: true, size: 42 }
    expect(projectFolderClipmEntry(entry, "D:/Comics/Book [CM1P0873-4K7Q].cbz")).toEqual({
      ...entry,
      name: "Book [CM1P0873-4K7Q].cbz",
      path: "D:/Comics/Book [CM1P0873-4K7Q].cbz",
    })
    expect(folderClipmPathName("D:\\Comics\\Book.cbz")).toBe("Book.cbz")
  })
})
