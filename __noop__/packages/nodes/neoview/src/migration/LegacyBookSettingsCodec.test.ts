import { describe, expect, it } from "vitest"

import { LegacyBookSettingsCodec } from "./LegacyBookSettingsCodec.js"
import { LegacySettingsCodec } from "./LegacySettingsCodec.js"

describe("LegacyBookSettingsCodec", () => {
  it("[neoview.book-settings.legacy-codec] decodes valid fields independently and reports malformed or unknown data", () => {
    const decoded = new LegacyBookSettingsCodec().decode({
      "D:/books/one.cbz": {
        favorite: true,
        rating: 4,
        readingDirection: "right-to-left",
        doublePageView: true,
        horizontalBook: false,
        future: true,
      },
      "D:/books/partial.cbz": { favorite: false, rating: 9 },
      "D:/books/invalid.cbz": { rating: "five" },
    })
    expect(decoded.entries).toEqual([
      {
        path: "D:/books/one.cbz",
        overrides: { favorite: true, rating: 4, direction: "right-to-left", pageMode: "double", horizontalBook: false },
      },
      { path: "D:/books/partial.cbz", overrides: { favorite: false } },
    ])
    expect(decoded.report).toEqual({ totalEntries: 3, validEntries: 2, invalidEntries: 1, invalidFields: 2, unknownFields: 1 })
  })

  it("[neoview.book-settings.legacy-envelope] reuses the frozen settings envelope parser", () => {
    const value = JSON.stringify({ "D:/books/demo.cbz": { doublePageView: false, horizontalBook: true } })
    const decoded = new LegacyBookSettingsCodec().decode({
      version: "2.0.0",
      backupType: "manual",
      rawLocalStorage: { "neoview-book-settings": value },
    })
    expect(decoded.entries).toEqual([{
      path: "D:/books/demo.cbz",
      overrides: { pageMode: "single", horizontalBook: true },
    }])
    const pending = new LegacySettingsCodec().decode({
      version: "2.0.0",
      backupType: "manual",
      rawLocalStorage: { "neoview-book-settings": value },
    }, { modules: ["book-settings"] })
    expect(pending.pendingData).toHaveProperty("neoview-book-settings", value)
  })
})
