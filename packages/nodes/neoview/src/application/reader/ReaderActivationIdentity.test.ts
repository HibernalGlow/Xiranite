import { describe, expect, it } from "vitest"

import { resolveReaderActivationIdentity } from "./ReaderActivationIdentity.js"

describe("Reader activation identity", () => {
  it("keeps a collapsed penetrated folder as the activated entry", () => {
    expect(resolveReaderActivationIdentity("D:/books/A/deep/001.jpg", {
      rootPath: "D:/books",
      frames: [{ directoryPath: "D:/books", currentEntryPath: "D:/books/A" }],
    })).toEqual({
      readerSourcePath: "D:/books/A/deep/001.jpg",
      activatedEntryPath: "D:/books/A",
      traversalRootPath: "D:/books",
      traversalFrames: [{ directoryPath: "D:/books", currentEntryPath: "D:/books/A" }],
    })
  })

  it("keeps an explicitly selected auto-expanded file as the activated entry", () => {
    expect(resolveReaderActivationIdentity("D:/books/A/001.jpg", {
      rootPath: "D:/books/A",
      frames: [{ directoryPath: "D:/books/A", currentEntryPath: "D:/books/A/001.jpg", selfTerminal: true }],
    })).toEqual({
      readerSourcePath: "D:/books/A/001.jpg",
      activatedEntryPath: "D:/books/A/001.jpg",
      traversalRootPath: "D:/books/A",
      traversalFrames: [{ directoryPath: "D:/books/A", currentEntryPath: "D:/books/A/001.jpg", selfTerminal: true }],
      selfTerminal: true,
    })
  })

  it("uses the concrete leaf from a multi-frame expanded branch", () => {
    expect(resolveReaderActivationIdentity("D:/books/A/volume/001.jpg", {
      rootPath: "D:/books",
      frames: [
        { directoryPath: "D:/books", currentEntryPath: "D:/books/A" },
        { directoryPath: "D:/books/A", currentEntryPath: "D:/books/A/volume" },
        { directoryPath: "D:/books/A/volume", currentEntryPath: "D:/books/A/volume/001.jpg" },
      ],
    })).toEqual({
      readerSourcePath: "D:/books/A/volume/001.jpg",
      activatedEntryPath: "D:/books/A/volume/001.jpg",
      traversalRootPath: "D:/books",
      traversalFrames: [
        { directoryPath: "D:/books", currentEntryPath: "D:/books/A" },
        { directoryPath: "D:/books/A", currentEntryPath: "D:/books/A/volume" },
        { directoryPath: "D:/books/A/volume", currentEntryPath: "D:/books/A/volume/001.jpg" },
      ],
    })
  })

  it("uses the direct source and its parent without traversal provenance", () => {
    expect(resolveReaderActivationIdentity("D:/books/Book.cbz")).toEqual({
      readerSourcePath: "D:/books/Book.cbz",
      activatedEntryPath: "D:/books/Book.cbz",
      traversalRootPath: "D:/books",
    })
  })
})
