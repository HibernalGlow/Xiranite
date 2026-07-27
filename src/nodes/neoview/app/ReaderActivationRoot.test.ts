import { describe, expect, it, vi } from "vitest"

import {
  isSameReaderPath,
  notifyReaderPathCommitted,
  resolveReaderActivationRootPath,
  restoredReaderActivationRootForPath,
} from "./ReaderActivationRoot"

describe("Reader activation root", () => {
  it("uses the selected outer entry rather than a penetrated Reader terminal", () => {
    expect(resolveReaderActivationRootPath(
      "D:/books/series/volume/pages/001.jpg",
      { browserOriginPath: "D:/books", browserOriginEntryPath: "D:/books/series" },
    )).toBe("D:/books/series")
  })

  it("restores a persisted activation root only when an open has no new provenance", () => {
    expect(resolveReaderActivationRootPath(
      "D:/books/series/volume/pages/001.jpg",
      undefined,
      "D:/books/series",
    )).toBe("D:/books/series")
    expect(resolveReaderActivationRootPath("D:/books/next.cbz")).toBe("D:/books/next.cbz")
  })

  it("compares persisted and replacement paths before reusing an activation root", () => {
    expect(isSameReaderPath("D:\\books\\series\\inside.cbz", "d:/books/series/inside.cbz")).toBe(true)
    expect(isSameReaderPath("D:/books/series/inside.cbz", "D:/books/replacement.cbz")).toBe(false)
    expect(restoredReaderActivationRootForPath(
      "D:/books/series/inside.cbz",
      "D:/books/replacement.cbz",
      "D:/books/series",
    )).toBeUndefined()
  })

  it("only persists roots that differ from the active Reader source", () => {
    const callback = vi.fn()
    notifyReaderPathCommitted(callback, "D:/books/next.cbz", "D:/books", "D:/books/next.cbz")
    notifyReaderPathCommitted(callback, "D:/books/series/inside.cbz", "D:/books", "D:/books/series")

    expect(callback).toHaveBeenNthCalledWith(1, "D:/books/next.cbz", "D:/books")
    expect(callback).toHaveBeenNthCalledWith(2, "D:/books/series/inside.cbz", "D:/books", "D:/books/series")
  })
})
