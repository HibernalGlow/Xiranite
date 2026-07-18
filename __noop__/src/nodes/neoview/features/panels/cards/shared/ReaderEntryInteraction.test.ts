import { describe, expect, it } from "vitest"

import { readerEntryClickIntent } from "./ReaderEntryInteraction"

describe("readerEntryClickIntent", () => {
  it("[neoview.shared-entry.single-click-open] opens plain clicks and selects only explicit or modified clicks", () => {
    expect(readerEntryClickIntent({ ctrlKey: false, metaKey: false, shiftKey: false })).toBe("open")
    expect(readerEntryClickIntent({ ctrlKey: true, metaKey: false, shiftKey: false })).toBe("select")
    expect(readerEntryClickIntent({ ctrlKey: false, metaKey: true, shiftKey: false })).toBe("select")
    expect(readerEntryClickIntent({ ctrlKey: false, metaKey: false, shiftKey: true })).toBe("select")
    expect(readerEntryClickIntent({ ctrlKey: false, metaKey: false, shiftKey: false }, true)).toBe("select")
  })
})
