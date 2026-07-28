import { describe, expect, test } from "vitest"
import { analyzeClassfDeletionHistory, suggestClassfBlacklistKeywords } from "./deletion-history.js"

describe("ClassF deletion history", () => {
  test("counts successful deletes with SameA labels and ignores failed/restored records", () => {
    const csv = [
      "id,sourcePath,state",
      "1,\"D:/downloads/[Circle (Artist)] work 1.zip\",trashed",
      "2,\"D:/downloads/[Circle (Artist)] work 2.zip\",trashed",
      "3,\"D:/downloads/[Circle (Artist)] work 3.zip\",permanent",
      "4,\"D:/downloads/[Circle (Artist)] failed.zip\",delete-failed",
      "5,\"D:/downloads/[Circle (Artist)] restored.zip\",restored",
      "6,\"D:/downloads/[中国翻訳] not-an-artist.zip\",trashed",
    ].join("\n")

    expect(analyzeClassfDeletionHistory(csv)).toEqual({
      importedRecords: 6,
      successfulDeletions: 4,
      artistDeletionCount: 4,
      candidates: [{ keyword: "[Circle (Artist)]", occurrences: 3 }],
    })
    expect(suggestClassfBlacklistKeywords(csv)).toEqual([
      { keyword: "[Circle (Artist)]", occurrences: 3 },
    ])
  })
})
