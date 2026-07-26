import { describe, expect, test } from "vitest"
import { appendXlchemyAnalysis, createXlchemyAnalysisSummary, xlchemyAnalysisData } from "./analysis.js"

describe("XLchemy bounded analysis", () => {
  test("keeps exact converted-format totals independently of retained file details", () => {
    const summary = createXlchemyAnalysisSummary()
    appendXlchemyAnalysis(summary, { sourcePath: "D:/images/a.png", sourceBytes: 100, outputBytes: 40, status: "converted" })
    appendXlchemyAnalysis(summary, { sourcePath: "D:/images/b.jpg", sourceBytes: 200, outputBytes: 100, status: "converted" })
    appendXlchemyAnalysis(summary, { sourcePath: "D:/images/c.png", sourceBytes: 300, status: "skipped" })

    expect(xlchemyAnalysisData(summary)).toMatchObject({
      inputAnalysis: { totalFiles: 3, totalSize: 600 },
      outputAnalysis: {
        formats: [
          { key: "jpg", count: 1, sourceBytes: 200, outputBytes: 100 },
          { key: "png", count: 1, sourceBytes: 100, outputBytes: 40 },
        ],
      },
    })
  })
})
