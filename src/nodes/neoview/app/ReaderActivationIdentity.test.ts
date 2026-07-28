import { describe, expect, it } from "vitest"

import {
  legacyReaderActivationIdentity,
  parseReaderActivationIdentity,
  readerActivationIdentityMatchesProvenance,
  readerActivationProvenanceFromIdentity,
} from "./ReaderActivationIdentity"

describe("Reader activation identity", () => {
  it("round-trips the complete expanded traversal stack", () => {
    const identity = {
      readerSourcePath: "D:/books/series/Book 2",
      activatedEntryPath: "D:/books/series/Book 2",
      traversalRootPath: "D:/books",
      traversalFrames: [
        { directoryPath: "D:/books", currentEntryPath: "D:/books/series" },
        { directoryPath: "D:/books/series", currentEntryPath: "D:/books/series/Book 2" },
      ],
    }
    expect(parseReaderActivationIdentity(identity)).toEqual(identity)
    expect(readerActivationProvenanceFromIdentity(identity)).toEqual({
      browserOriginPath: "D:/books",
      browserOriginEntryPath: "D:/books/series/Book 2",
      browserOriginTraversalFrames: identity.traversalFrames,
    })
  })

  it("rejects a persisted frame stack that skips an expanded parent", () => {
    expect(parseReaderActivationIdentity({
      readerSourcePath: "D:/books/series/deep/Book 2",
      activatedEntryPath: "D:/books/series/deep/Book 2",
      traversalRootPath: "D:/books",
      traversalFrames: [
        { directoryPath: "D:/books", currentEntryPath: "D:/books/series" },
        { directoryPath: "D:/books/series/deep", currentEntryPath: "D:/books/series/deep/Book 2" },
      ],
    })).toBeUndefined()
  })

  it("distinguishes a same-source activation that selects another expanded child", () => {
    const identity = {
      readerSourcePath: "D:/books/series/Book 1",
      activatedEntryPath: "D:/books/series",
      traversalRootPath: "D:/books",
    }
    const selectedChild = {
      browserOriginPath: "D:/books",
      browserOriginEntryPath: "D:/books/series/Book 1",
      browserOriginTraversalFrames: [
        { directoryPath: "D:/books", currentEntryPath: "D:/books/series" },
        { directoryPath: "D:/books/series", currentEntryPath: "D:/books/series/Book 1" },
      ],
    }
    expect(readerActivationIdentityMatchesProvenance(identity, selectedChild)).toBe(false)
    expect(readerActivationIdentityMatchesProvenance({
      ...identity,
      activatedEntryPath: selectedChild.browserOriginEntryPath,
      traversalFrames: selectedChild.browserOriginTraversalFrames,
    }, selectedChild)).toBe(true)
  })

  it("reads legacy Card fields only as a compatibility identity", () => {
    expect(legacyReaderActivationIdentity(
      "D:/books/series/volume/pages/001.jpg",
      "D:/books",
      "D:/books/series",
    )).toEqual({
      readerSourcePath: "D:/books/series/volume/pages/001.jpg",
      activatedEntryPath: "D:/books/series",
      traversalRootPath: "D:/books",
    })
  })
})
