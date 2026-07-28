import { describe, expect, test } from "vitest"
import { suggestClassfBlacklistKeywords } from "./deletion-history.js"

describe("ClassF deletion history", () => {
  test("counts only successfully trashed files and uses SameA author labels", () => {
    const csv = [
      "id,sourcePath,state",
      "1,\"D:/downloads/[Circle (Artist)] work 1.zip\",trashed",
      "2,\"D:/downloads/[Circle (Artist)] work 2.zip\",trashed",
      "3,\"D:/downloads/[Circle (Artist)] work 3.zip\",trashed",
      "4,\"D:/downloads/[Circle (Artist)] failed.zip\",delete-failed",
      "5,\"D:/downloads/[中国翻訳] not-an-artist.zip\",trashed",
    ].join("\n")

    expect(suggestClassfBlacklistKeywords(csv)).toEqual([
      { keyword: "[Circle (Artist)]", occurrences: 3 },
    ])
  })
})
