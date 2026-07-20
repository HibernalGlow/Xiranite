import { describe, expect, it } from "vitest"
import { composeReaderEmmStores } from "./CompositeReaderEmmStore.js"

describe("composeReaderEmmStores", () => {
  it("keeps thumbnail overrides while filling missing external EMM fields", async () => {
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
})
