import { describe, expect, it } from "vitest"

import type { ReaderDirectoryEntry } from "../../ports/ReaderDirectoryListingProvider.js"
import { sortReaderDirectoryEntries } from "./ReaderDirectorySort.js"

const entries: ReaderDirectoryEntry[] = [
  { name: "book10 [CM1P0873-4K7Q]", path: "C:/books/book10.cbz", kind: "file", readerSupported: true, modifiedAt: 10, size: 20, rating: 2, collectTagCount: 1 },
  { name: "folder", path: "C:/books/folder", kind: "directory", readerSupported: true, modifiedAt: 5, size: 100, rating: 1, collectTagCount: 4 },
  { name: "book2 [CM2N0999-9X2M]", path: "C:/books/book2.zip", kind: "file", readerSupported: true, modifiedAt: 20, size: 10, rating: 5, collectTagCount: 2 },
]

describe("sortReaderDirectoryEntries", () => {
  it("[neoview.folder.sort-fields] implements every frozen legacy sort field with stable directory priority", () => {
    expect(names("name")).toEqual(["folder", "book2 [CM2N0999-9X2M]", "book10 [CM1P0873-4K7Q]"])
    expect(names("date")).toEqual(["folder", "book10 [CM1P0873-4K7Q]", "book2 [CM2N0999-9X2M]"])
    expect(names("size")).toEqual(["folder", "book2 [CM2N0999-9X2M]", "book10 [CM1P0873-4K7Q]"])
    expect(names("type")).toEqual(["folder", "book2 [CM2N0999-9X2M]", "book10 [CM1P0873-4K7Q]"])
    expect(names("rating", "desc")).toEqual(["folder", "book2 [CM2N0999-9X2M]", "book10 [CM1P0873-4K7Q]"])
    expect(names("cmRating", "desc", false)).toEqual(["book10 [CM1P0873-4K7Q]", "book2 [CM2N0999-9X2M]", "folder"])
    expect(names("path", "desc")).toEqual(["folder", "book10 [CM1P0873-4K7Q]", "book2 [CM2N0999-9X2M]"])
    expect(names("collectTagCount", "desc")).toEqual(["folder", "book2 [CM2N0999-9X2M]", "book10 [CM1P0873-4K7Q]"])
  })

  it("[neoview.folder.sort-random] keeps random order stable for the same seed", () => {
    const rule = { field: "random" as const, order: "asc" as const, directoriesFirst: false }
    const first = sortReaderDirectoryEntries(entries, rule, "seed-a").map((entry) => entry.path)
    expect(sortReaderDirectoryEntries(entries, rule, "seed-a").map((entry) => entry.path)).toEqual(first)
    expect(sortReaderDirectoryEntries(entries, rule, "seed-b").map((entry) => entry.path)).not.toEqual(first)
  })
})

function names(field: Parameters<typeof sortReaderDirectoryEntries>[1]["field"], order: "asc" | "desc" = "asc", directoriesFirst = true) {
  return sortReaderDirectoryEntries(entries, { field, order, directoriesFirst }, "seed").map((entry) => entry.name)
}
