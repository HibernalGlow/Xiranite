import { describe, expect, it } from "vitest"

import { appendReaderActivationTraversalFrame } from "./ReaderActivationTraversalFrames"

describe("appendReaderActivationTraversalFrame", () => {
  it("preserves every selected parent across nested inline expansion", () => {
    const root = appendReaderActivationTraversalFrame("D:/books", "D:/books/series")
    const nested = appendReaderActivationTraversalFrame("D:/books", "D:/books/series/season-2", root)
    expect(appendReaderActivationTraversalFrame("D:/books", "D:/books/series/season-2/Book 3", nested)).toEqual([
      { directoryPath: "D:/books", currentEntryPath: "D:/books/series" },
      { directoryPath: "D:/books/series", currentEntryPath: "D:/books/series/season-2" },
      { directoryPath: "D:/books/series/season-2", currentEntryPath: "D:/books/series/season-2/Book 3" },
    ])
  })
})
