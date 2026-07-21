import { describe, expect, it } from "vitest"
import { buildReaderFolderRatingCache } from "./ReaderFolderRatingCache.js"

describe("buildReaderFolderRatingCache", () => {
  it("keeps direct averages and supplies bounded parent projections", () => {
    const cache = buildReaderFolderRatingCache([
      { path: "D:/books/a/one.cbz", rating: 4 },
      { path: "D:/books/a/two.cbz", rating: 5 },
      { path: "D:/books/b/three.cbz", rating: 2 },
    ])
    expect(cache).toContainEqual({ path: "D:/books/a", averageRating: 4.5, count: 2, direct: true })
    expect(cache).toContainEqual({ path: "D:/books", averageRating: 3.25, count: 2, direct: false })
  })

  it("drops invalid ratings and never walks above the configured parent boundary", () => {
    const cache = buildReaderFolderRatingCache([{ path: "D:/a/b/c/d/e/book.cbz", rating: 3 }, { path: "D:/bad.cbz", rating: 0 }])
    expect(cache.map((entry) => entry.path)).toContain("D:/a/b/c/d/e")
    expect(cache.map((entry) => entry.path)).not.toContain("D:")
  })
})
