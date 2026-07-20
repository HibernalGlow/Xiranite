import { describe, expect, it } from "vitest"

import { libraryItemFolderPath } from "./libraryItemFolderPath"

describe("libraryItemFolderPath", () => {
  it("preserves folder paths and both platform separator styles", () => {
    expect(libraryItemFolderPath("D:/library", true)).toBe("D:/library")
    expect(libraryItemFolderPath("D:\\library\\Demo.cbz", false)).toBe("D:\\library")
    expect(libraryItemFolderPath("D:/library/Demo.cbz", false)).toBe("D:/library")
  })

  it("keeps filesystem roots navigable", () => {
    expect(libraryItemFolderPath("D:/Demo.cbz", false)).toBe("D:/")
    expect(libraryItemFolderPath("/Demo.cbz", false)).toBe("/")
  })
})
