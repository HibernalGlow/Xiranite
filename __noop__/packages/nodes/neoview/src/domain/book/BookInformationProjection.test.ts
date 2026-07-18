import { describe, expect, it } from "vitest"

import { projectReaderBookInformation } from "./BookInformationProjection.js"

describe("BookInformationProjection", () => {
  it("[neoview.book-information.projection] preserves translated-title priority and clamped progress", () => {
    expect(projectReaderBookInformation({
      displayName: "Original.cbz",
      translatedTitle: "  译名  ",
      sourceKind: "archive",
      currentPage: 99,
      pageCount: 12,
    }, "zh")).toEqual({
      displayTitle: "译名",
      originalTitle: "Original.cbz",
      typeLabel: "压缩包",
      currentPage: 12,
      pageCount: 12,
      pageText: "12 / 12",
      progressPercent: 100,
      progressText: "100.0%",
    })
  })

  it("[neoview.book-information.projection-zero] preserves zero-page and localized type boundaries", () => {
    expect(projectReaderBookInformation({ displayName: "demo.pdf", sourceKind: "document", sourceFormat: "PDF", currentPage: 1, pageCount: 0 }, "en"))
      .toMatchObject({ displayTitle: "demo.pdf", originalTitle: undefined, typeLabel: "PDF", pageText: "0 / 0", progressText: "—" })
    expect(projectReaderBookInformation({ displayName: "folder", sourceKind: "directory", currentPage: Number.NaN, pageCount: 2 }, "en").typeLabel).toBe("Folder")
    expect(projectReaderBookInformation({ displayName: "page.png", sourceKind: "path", currentPage: 1, pageCount: 1 }, "zh").typeLabel).toBe("文件")
  })
})
