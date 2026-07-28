import { describe, expect, test } from "vitest"
import {
  mergeXlchemyInputPaths,
  parseXlchemyInputPaths,
  removeXlchemyInputPaths,
  summarizeXlchemyInputPaths,
  XLCHEMY_INPUT_PREVIEW_LIMIT,
} from "./input-source-model"

describe("XLchemy input source model", () => {
  test("counts 200,000 sources while retaining only the bounded preview", () => {
    const input = Array.from({ length: 200_000 }, (_, index) => `D:/images/${index}.png`).join("\n")
    const summary = summarizeXlchemyInputPaths(input)

    expect(summary).toMatchObject({ totalCount: 200_000, truncated: true })
    expect(summary.previewPaths).toHaveLength(XLCHEMY_INPUT_PREVIEW_LIMIT)
    expect(summary.previewPaths.at(-1)).toBe("D:/images/999.png")
  })

  test("merges unique sources and removes selected paths without touching the rest", () => {
    const merged = mergeXlchemyInputPaths("D:/a.png\r\nD:/b.png", ["D:/b.png", " D:/folder "])
    expect(parseXlchemyInputPaths(merged)).toEqual(["D:/a.png", "D:/b.png", "D:/folder"])
    expect(removeXlchemyInputPaths(merged, new Set(["D:/b.png"]))).toBe("D:/a.png\nD:/folder")
  })
})
