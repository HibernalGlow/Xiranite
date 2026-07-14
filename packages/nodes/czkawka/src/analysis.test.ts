import { describe, expect, test } from "vitest"
import type { CzkawkaEntry, CzkawkaGroup } from "./core.js"
import { buildCzkawkaAnalysis, buildFormatStats, buildSimilarityStats } from "./analysis.js"

describe("Czkawka shared analysis", () => {
  test("groups formats by count and bytes with deterministic percentages", () => {
    const stats = buildFormatStats([entry("a.JPG", 30), entry("b.jpg", 10), entry("archive.zip", 60), entry("README", 0)])
    expect(stats.map((item) => item.format)).toEqual(["zip", "jpg", "unknown"])
    expect(stats[0]).toMatchObject({ count: 1, bytes: 60, countPercent: 25, bytesPercent: 60 })
    expect(stats[1]).toMatchObject({ count: 2, bytes: 40, countPercent: 50, bytesPercent: 40 })
  })

  test("classifies image differences with the same hash-size thresholds as the fork", () => {
    const stats = buildSimilarityStats([
      { ...entry("reference.jpg", 1), similarity: "0", isReference: true },
      { ...entry("same.jpg", 1), similarity: "" },
      { ...entry("very-high.jpg", 1), similarity: "2 (Diff)" },
      { ...entry("high.jpg", 1), similarity: "5" },
      { ...entry("minimal.jpg", 1), similarity: "99" },
    ], 16)
    expect(stats.map((item) => [item.level, item.count, item.range])).toEqual([
      ["original", 1, "= 0"],
      ["very-high", 1, "≤ 2"],
      ["high", 1, "≤ 5"],
      ["minimal", 1, "≤ 40"],
    ])
    expect(stats.reduce((sum, item) => sum + item.percent, 0)).toBe(100)
  })

  test("combines format, similarity, and shared selection statistics", () => {
    const groups: CzkawkaGroup[] = [{ id: 0, entries: [{ ...entry("a.png", 10), similarity: "0" }, { ...entry("b.png", 20), similarity: "3" }], totalBytes: 30, reclaimableBytes: 20 }]
    expect(buildCzkawkaAnalysis(groups, ["b.png"], "similar-images", 16)).toMatchObject({
      fileCount: 2,
      totalBytes: 30,
      selection: { selectedCount: 1, selectedBytes: 20, reclaimableBytes: 20 },
      formats: [{ format: "png", count: 2, bytes: 30 }],
    })
  })

  test("classifies normalized video hash distances with video intervals", () => {
    const stats = buildSimilarityStats([{ ...entry("a.mp4", 1), similarity: "0.00" }, { ...entry("b.mp4", 1), similarity: "2.80" }, { ...entry("c.mp4", 1), similarity: "18.50" }], 16, "similar-videos")
    expect(stats.map(({ level, count, range }) => ({ level, count, range }))).toEqual([
      { level: "original", count: 1, range: "= 0" },
      { level: "high", count: 1, range: "≤ 5" },
      { level: "small", count: 1, range: "≤ 20" },
    ])
  })
})

function entry(path: string, size: number): CzkawkaEntry { return { id: path, groupId: 0, path, name: path, size, modifiedDate: 1 } }
