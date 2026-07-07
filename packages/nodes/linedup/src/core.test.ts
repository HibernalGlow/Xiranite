import { describe, expect, test } from "vitest"
import { createDiffRows, filterLines, splitLines, uniqueNonEmptyLines } from "./core.js"

describe("linedup core", () => {
  test("normalizes and deduplicates non-empty lines", () => {
    expect(uniqueNonEmptyLines([" a ", "", "a", "b"])).toEqual(["a", "b"])
  })

  test("removes lines containing any filter token", () => {
    const result = filterLines({
      sourceLines: ["alpha", "beta-one", "gamma", "beta-two"],
      filterLines: ["beta"],
    })

    expect(result.filteredLines).toEqual(["alpha", "gamma"])
    expect(result.removedLines).toEqual(["beta-one", "beta-two"])
    expect(result.keptCount).toBe(2)
    expect(result.removedCount).toBe(2)
  })

  test("creates diff rows from source and filtered output", () => {
    expect(createDiffRows(splitLines("keep\nremove"), ["keep"])).toEqual([
      { line: "keep", status: "kept" },
      { line: "remove", status: "removed" },
    ])
  })
})
