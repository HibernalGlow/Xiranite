import { describe, expect, it } from "vitest"

import { stableOpaqueId } from "./book-utils.js"
import { readerBookIdForSource, readerSourceIdentityPath } from "./ReaderSourceIdentity.js"

describe("Reader source identity", () => {
  it("ignores mutable CM score fields while retaining the work short code", () => {
    const positive = { kind: "archive" as const, path: "D:/Books/Title [CM1P0873-4K7Q].cbz" }
    const corrected = { kind: "archive" as const, path: "D:/Books/Title [CM9N0342-4K7Q].cbz" }

    expect(readerBookIdForSource(positive)).toBe(readerBookIdForSource(corrected))
    expect(readerSourceIdentityPath(positive.path)).toBe("D:/Books/Title [CM-4K7Q].cbz")
  })

  it("does not collapse distinct short codes, prefixes, suffixes or nested archive paths", () => {
    const base = { kind: "archive" as const, path: "D:/Books/Title [CM1P0873-4K7Q].cbz" }
    expect(readerBookIdForSource(base)).not.toBe(readerBookIdForSource({ ...base, path: "D:/Books/Title [CM1P0873-9X2M].cbz" }))
    expect(readerBookIdForSource(base)).not.toBe(readerBookIdForSource({ ...base, path: "D:/Books/Extra Title [CM1P0873-4K7Q].cbz" }))
    expect(readerBookIdForSource({ ...base, entryPaths: ["nested.cbz"] })).not.toBe(readerBookIdForSource({ ...base, entryPaths: ["other.cbz"] }))
  })

  it("preserves the legacy book id for sources without a CM score block", () => {
    const source = { kind: "directory" as const, path: "D:/Books/Title" }
    expect(readerBookIdForSource(source)).toBe(stableOpaqueId("book", source.kind, source.path))
  })
})
