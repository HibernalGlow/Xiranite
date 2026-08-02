import { describe, expect, it } from "vitest"

import {
  legacyThumbnailKeyLikePattern,
  stableThumbnailKey,
  usesStableClipmThumbnailAlias,
} from "./ThumbnailKeyIdentity.js"

describe("ThumbnailKeyIdentity", () => {
  it("keeps one stable thumbnail identity across ClipM score corrections", () => {
    expect(stableThumbnailKey("D:/Books/Title [CM1P0873-4K7Q].cbz"))
      .toBe("D:/Books/Title [CM-4K7Q].cbz")
    expect(stableThumbnailKey("D:/Books/Title [CM9N0342-4K7Q].cbz"))
      .toBe("D:/Books/Title [CM-4K7Q].cbz")
    expect(stableThumbnailKey("D:/Books/Title [CM1P0873-9X2M].cbz"))
      .not.toBe("D:/Books/Title [CM-4K7Q].cbz")
  })

  it("normalizes only the physical archive source before an entry key", () => {
    expect(stableThumbnailKey("D:/Books/Title [CM1P0873-4K7Q].cbz::pages/[CM2N0300-9X2M].jpg#4"))
      .toBe("D:/Books/Title [CM-4K7Q].cbz::pages/[CM2N0300-9X2M].jpg#4")
  })

  it("leaves non-terminal and invalid score-like text unchanged", () => {
    expect(stableThumbnailKey("D:/Books/[CM1P0873-4K7Q] Title.cbz"))
      .toBe("D:/Books/[CM1P0873-4K7Q] Title.cbz")
    expect(stableThumbnailKey("D:/Books/Title [CM1P9999-4K7Q].cbz"))
      .toBe("D:/Books/Title [CM1P9999-4K7Q].cbz")
  })

  it("builds escaped legacy lookup patterns and identifies synthetic stable keys", () => {
    expect(legacyThumbnailKeyLikePattern("D:/Books/A_100% [CM-4K7Q].cbz::page_1.jpg#0"))
      .toBe("D:/Books/A\\_100\\%%[CM%-4K7Q].cbz::page\\_1.jpg#0")
    expect(usesStableClipmThumbnailAlias("D:/Books/Title [CM-4K7Q].cbz::page.jpg#0")).toBe(true)
    expect(usesStableClipmThumbnailAlias("D:/Books/Title [CM1P0873-4K7Q].cbz")).toBe(false)
  })
})
