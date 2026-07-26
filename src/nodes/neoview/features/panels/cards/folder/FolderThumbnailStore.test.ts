import { describe, expect, it, vi } from "vitest"

import { FolderThumbnailStore } from "./FolderThumbnailStore"

describe("FolderThumbnailStore", () => {
  it("notifies only the paths whose thumbnail snapshot changed", () => {
    const store = new FolderThumbnailStore()
    const firstListener = vi.fn()
    const secondListener = vi.fn()
    store.subscribe("C:/books/first.cbz", firstListener)
    store.subscribe("C:/books/second.cbz", secondListener)

    store.replace({
      thumbnailUrls: new Map([
        ["C:/books/first.cbz", "blob:first-v1"],
        ["C:/books/second.cbz", "blob:second-v1"],
      ]),
      thumbnailUrlSets: new Map(),
      thumbnailProfiles: new Map(),
    })
    firstListener.mockClear()
    secondListener.mockClear()

    store.replace({
      thumbnailUrls: new Map([
        ["C:/books/first.cbz", "blob:first-v2"],
        ["C:/books/second.cbz", "blob:second-v1"],
      ]),
      thumbnailUrlSets: new Map(),
      thumbnailProfiles: new Map(),
    })

    expect(firstListener).toHaveBeenCalledOnce()
    expect(secondListener).not.toHaveBeenCalled()
    expect(store.entry("C:/books/first.cbz").thumbnailUrl).toBe("blob:first-v2")
  })

  it("notifies a path when its cached thumbnail is removed", () => {
    const store = new FolderThumbnailStore()
    store.replace({
      thumbnailUrls: new Map([["C:/books/book.cbz", "blob:book"]]),
      thumbnailUrlSets: new Map([["C:/books/book.cbz", ["blob:book"]]]),
      thumbnailProfiles: new Map([["C:/books/book.cbz", "file:cover"]]),
    })
    const listener = vi.fn()
    store.subscribe("C:/books/book.cbz", listener)

    store.replace({ thumbnailUrls: new Map(), thumbnailUrlSets: new Map(), thumbnailProfiles: new Map() })

    expect(listener).toHaveBeenCalledOnce()
    expect(store.entry("C:/books/book.cbz")).toEqual({})
  })
})
