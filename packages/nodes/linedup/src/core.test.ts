import { describe, expect, test } from "vitest"
import {
  analyzeReadLines,
  createDiffRows,
  explainRemovals,
  filterLines,
  findDuplicateLines,
  splitLines,
  uniqueNonEmptyLines,
} from "./core.js"

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

  test("finds duplicate lines with counts", () => {
    const duplicates = findDuplicateLines(["a", "b", "a", "c", "b", "a", ""])
    expect([...duplicates.entries()].sort()).toEqual([["a", 3], ["b", 2]])
  })

  test("analyzes read lines into total, unique, and duplicate stats", () => {
    const stats = analyzeReadLines(["alpha", "beta", "alpha", "", "gamma"])
    expect(stats.totalLines).toBe(4)
    expect(stats.uniqueLines).toBe(3)
    expect([...stats.duplicates.entries()]).toEqual([["alpha", 2]])
  })

  test("explains which filter token matched each removed line", () => {
    const details = explainRemovals(
      ["alpha", "beta-one", "gamma", "beta-two"],
      ["beta", "gamma"],
    )
    expect(details).toEqual([
      { line: "beta-one", matchedFilter: "beta" },
      { line: "gamma", matchedFilter: "gamma" },
      { line: "beta-two", matchedFilter: "beta" },
    ])
  })

  test("explainRemovals respects case sensitivity", () => {
    const caseSensitive = explainRemovals(["Alpha", "BETA"], ["alpha"])
    expect(caseSensitive).toEqual([])

    const caseInsensitive = explainRemovals(["Alpha", "BETA"], ["alpha"], false)
    expect(caseInsensitive).toEqual([{ line: "Alpha", matchedFilter: "alpha" }])
  })
})
