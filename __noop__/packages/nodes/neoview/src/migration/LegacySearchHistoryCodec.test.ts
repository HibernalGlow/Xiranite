import { describe, expect, it } from "vitest"

import { LegacySearchHistoryCodec } from "./LegacySearchHistoryCodec.js"

describe("LegacySearchHistoryCodec", () => {
  it("[neoview.folder.search-history-codec] decodes exported object history and legacy string arrays", () => {
    const decoded = new LegacySearchHistoryCodec(() => 200_000_000).decode({
      version: "1.0.0",
      extended: {
        searchHistory: {
          file: [{ query: " newest ", timestamp: 200 }, { query: "older", timestamp: 100 }],
          bookmark: ["tag", "tag", "other"],
          history: [],
        },
      },
    })
    expect(decoded.scopes).toEqual(["file", "bookmark", "history"])
    expect(decoded.entries).toEqual([
      { scope: "file", query: "newest", usedAt: 200 },
      { scope: "file", query: "older", usedAt: 100 },
      { scope: "bookmark", query: "tag", usedAt: 113_600_000 },
      { scope: "bookmark", query: "other", usedAt: 113_599_998 },
    ])
    expect(decoded.issues).toEqual([])
  })

  it("[neoview.folder.search-history-codec-raw] prefers raw localStorage and reports bad rows without dropping the scope", () => {
    const decoded = new LegacySearchHistoryCodec(() => 100_000_000).decode({
      version: "2.0.0",
      backupType: "manual",
      extended: { searchHistory: { folder: ["stale"] } },
      rawLocalStorage: {
        "neoview-folder-search-history": JSON.stringify([
          { query: "folder", timestamp: 50 },
          { query: "", timestamp: 40 },
          { broken: true },
        ]),
      },
    })
    expect(decoded.entries).toEqual([{ scope: "folder", query: "folder", usedAt: 50 }])
    expect(decoded.issues).toHaveLength(2)
  })
})
