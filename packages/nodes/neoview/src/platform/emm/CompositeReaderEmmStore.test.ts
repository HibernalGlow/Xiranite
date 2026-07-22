import { describe, expect, it } from "vitest"
import { composeReaderEmmStores } from "./CompositeReaderEmmStore.js"

describe("composeReaderEmmStores", () => {
  it("[neoview.emm.external-merge] keeps thumbnail overrides while filling missing external EMM fields", async () => {
    const primary = {
      directoryEmmAvailable: true,
      readDirectoryEmmRecords: async () => new Map([["D:/Book.cbz", { ratingData: "manual-rating" }]]),
    }
    const fallback = {
      directoryEmmAvailable: true,
      readDirectoryEmmRecords: async () => new Map([["D:/Book.cbz", { ratingData: "external-rating", emmJson: "external-tags" }]]),
    }
    await expect(composeReaderEmmStores(primary, fallback).readDirectoryEmmRecords(["D:/Book.cbz"]))
      .resolves.toEqual(new Map([["D:/Book.cbz", { ratingData: "manual-rating", emmJson: "external-tags" }]]))
  })

  it("keeps the primary rating catalog record for a matching normalized path", async () => {
    const primary = { directoryEmmAvailable: true, readDirectoryEmmRecords: async () => new Map(), listEmmRatingRecords: async () => [{ path: "D:/Books/A.cbz", rating: 5 }] }
    const fallback = { directoryEmmAvailable: true, readDirectoryEmmRecords: async () => new Map(), listEmmRatingRecords: async () => [{ path: "d:/books/a.cbz", rating: 2 }, { path: "D:/Books/B.cbz", rating: 3 }] }
    await expect(composeReaderEmmStores(primary, fallback).listEmmRatingRecords!()).resolves.toEqual([
      { path: "D:/Books/A.cbz", rating: 5 }, { path: "D:/Books/B.cbz", rating: 3 },
    ])
  })
})
