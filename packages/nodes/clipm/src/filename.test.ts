import { describe, expect, it } from "vitest"

import {
  CLIPM_FILENAME_SUFFIX_PATTERN,
  clipmStableFilenameIdentity,
  compareClipmFilenameScores,
  parseClipmFilenameScore,
} from "./filename.js"

describe("ClipM filename scores", () => {
  it("parses canonical and legacy portable score suffixes", () => {
    expect(CLIPM_FILENAME_SUFFIX_PATTERN.source).toContain(String.raw`\[CM(?<version>\d+)`)
    expect(parseClipmFilenameScore("Title [CM12P0873-4K7Q].cbz")).toEqual({ version: 12n, label: "P", score: 873, shortCode: "4K7Q" })
    expect(parseClipmFilenameScore("Folder [CM1N0342-9X2M]")).toEqual({ version: 1n, label: "N", score: 342, shortCode: "9X2M" })
    expect(parseClipmFilenameScore("Title [CM-v12-P-S0873].cbz")).toEqual({ version: 12n, label: "P", score: 873 })
  })

  it.each([
    "Title [CM0P0873-4K7Q].cbz",
    "Title [CM1P1001-4K7Q].zip",
    "Title [CM-v1-P-S873]",
    "Title [CM-v1-P-S1001].cbz",
  ])("rejects invalid or misplaced suffix %s", (value) => {
    expect(parseClipmFilenameScore(value)).toBeUndefined()
  })

  it("projects only valid terminal score blocks to a stable filename identity", () => {
    expect(clipmStableFilenameIdentity("D:/Books/Title [CM1P0873-4K7Q].cbz")).toBe("D:/Books/Title [CM-4K7Q].cbz")
    expect(clipmStableFilenameIdentity("D:/Books/Title [CM9N0342-4K7Q].cbz")).toBe("D:/Books/Title [CM-4K7Q].cbz")
    expect(clipmStableFilenameIdentity("D:/Books/Title [CM-v1-P-S0873].cbz")).toBe("D:/Books/Title.cbz")
    expect(clipmStableFilenameIdentity("D:/Books/[CM1P0873-4K7Q] Title.cbz")).toBe("D:/Books/[CM1P0873-4K7Q] Title.cbz")
    expect(clipmStableFilenameIdentity("D:/Books/Title [CM1P9999-4K7Q].cbz")).toBe("D:/Books/Title [CM1P9999-4K7Q].cbz")
  })

  it("orders P before N, then newer versions and higher scores in descending order", () => {
    const names = [
      "Unrated",
      "N high [CM-v9-N-S0999]",
      "P old [CM-v1-P-S0999]",
      "P new low [CM2P0001-4K7Q]",
      "P new high [CM2P0873-9X2M]",
    ]

    expect(names.toSorted((left, right) => -compareClipmFilenameScores(left, right))).toEqual([
      "P new high [CM2P0873-9X2M]",
      "P new low [CM2P0001-4K7Q]",
      "P old [CM-v1-P-S0999]",
      "N high [CM-v9-N-S0999]",
      "Unrated",
    ])
  })
})
