import { describe, expect, it } from "vitest"

import { timestampsFromArchiveEntry } from "./book-utils.js"

describe("reader page timestamps", () => {
  it("[neoview.time-information.archive-invalid] rejects invalid archive entry timestamps", () => {
    expect(timestampsFromArchiveEntry()).toBeUndefined()
    expect(timestampsFromArchiveEntry("not-a-date")).toBeUndefined()
    expect(timestampsFromArchiveEntry("2024-01-02T03:04:06.000Z")).toEqual({
      source: "archive-entry",
      modifiedAtMs: 1_704_164_646_000,
    })
  })
})
