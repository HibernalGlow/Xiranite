import { describe, expect, it } from "vitest"

import { compareReaderCmRatingNames, parseReaderCmRating, READER_CM_RATING_SUFFIX_PATTERN } from "./ReaderCmRating.js"

describe("ReaderCmRating", () => {
  it("[neoview.folder.cm-rating-regex] parses only the canonical CM suffix", () => {
    expect(READER_CM_RATING_SUFFIX_PATTERN.source).toBe(String.raw`\s*\[CM-v(?<version>\d+)-(?<label>[PN])-S(?<score>\d{4})\]$`)
    expect(parseReaderCmRating("Title [CM-v12-P-S0873]")).toEqual({ version: 12n, label: "P", score: 873 })
    expect(parseReaderCmRating("Title[CM-v2-N-S0342]")).toEqual({ version: 2n, label: "N", score: 342 })
    expect(parseReaderCmRating("Title [CM-v1-P-S873]")).toBeUndefined()
    expect(parseReaderCmRating("Title [CM-v1-P-S0873].cbz")).toBeUndefined()
  })

  it("[neoview.folder.cm-rating-order] ranks P before N, then newer versions and higher scores in descending order", () => {
    const names = [
      "Unrated",
      "N high [CM-v9-N-S9999]",
      "P old [CM-v1-P-S9999]",
      "P new low [CM-v2-P-S0001]",
      "P new high [CM-v2-P-S0873]",
    ]

    expect(names.toSorted((left, right) => -compareReaderCmRatingNames(left, right))).toEqual([
      "P new high [CM-v2-P-S0873]",
      "P new low [CM-v2-P-S0001]",
      "P old [CM-v1-P-S9999]",
      "N high [CM-v9-N-S9999]",
      "Unrated",
    ])
  })
})
