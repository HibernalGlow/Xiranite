import { describe, expect, it, vi } from "vitest"

import type { NeoviewBookSettingsTuiPort } from "../interaction.js"
import { createNeoviewBookSettingsTuiDefinition } from "../interaction.js"

describe("NeoView book-settings terminal interaction", () => {
  it("[neoview.book-settings.tui] projects one shared form into the current revisioned controller", async () => {
    const dispose = vi.fn(async () => undefined)
    const open = vi.fn(async () => readerSnapshot())
    const getBookSettings = vi.fn(async () => settingsSnapshot(7))
    const updateBookSettings = vi.fn(async (_revision, patch) => ({
      settings: {
        ...settingsSnapshot(8),
        overrides: patch,
        effective: {
          ...settingsSnapshot(8).effective,
          favorite: patch.favorite ?? false,
          direction: patch.direction ?? "left-to-right",
          pageMode: patch.pageMode ?? "single",
        },
      },
      reader: readerSnapshot(),
    }))
    const controller = { open, getBookSettings, updateBookSettings, [Symbol.asyncDispose]: dispose } as NeoviewBookSettingsTuiPort
    const definition = createNeoviewBookSettingsTuiDefinition("en", async () => controller)

    await expect(definition.run({ action: "get", path: "D:/books/book.cbz" }, () => undefined)).resolves.toMatchObject({
      success: true,
      settings: { revision: 7 },
    })
    await expect(definition.run({
      action: "set",
      path: "D:/books/book.cbz",
      patch: { favorite: true, rating: null, direction: "right-to-left", pageMode: "double" },
    }, () => undefined)).resolves.toMatchObject({ success: true, settings: { revision: 8 } })
    expect(updateBookSettings).toHaveBeenCalledWith(7, {
      favorite: true,
      rating: null,
      direction: "right-to-left",
      pageMode: "double",
    })
    expect(open).toHaveBeenCalledWith({ path: "D:/books/book.cbz", archivePasswords: undefined })
    expect(dispose).toHaveBeenCalledTimes(2)
  })

  it("[neoview.book-settings.tui-schema] maps keep/inherit values without a second validation implementation", () => {
    const schema = createNeoviewBookSettingsTuiDefinition("en", async () => { throw new Error("unused") }).schema
    const input = schema.toInput({
      action: "set",
      path: " book.cbz ",
      favorite: "true",
      rating: "inherit",
      direction: "keep",
      pageMode: "double",
      horizontalBook: "false",
    })
    expect(input).toEqual({
      action: "set",
      path: "book.cbz",
      patch: { favorite: true, rating: null, pageMode: "double", horizontalBook: false },
    })
    expect(schema.validate({}, input)).toBeNull()
    expect(schema.validate({}, { action: "set", path: "book.cbz", patch: {} })).toContain("at least one")
    expect(schema.isDangerous(input)).toBe(false)
  })
})

function settingsSnapshot(revision: number) {
  return {
    schemaVersion: 1 as const,
    bookId: "opaque-book",
    revision,
    overrides: {},
    effective: { favorite: false, rating: 0, direction: "left-to-right" as const, pageMode: "single" as const, horizontalBook: true },
    inherited: ["favorite", "rating", "direction", "pageMode", "horizontalBook"] as const,
  }
}

function readerSnapshot() {
  return {
    book: { displayName: "book.cbz", pageCount: 1 },
    frame: {
      generation: 0,
      anchorPageIndex: 0,
      direction: "left-to-right" as const,
      layout: { pageMode: "single" as const, panorama: false, singleFirstPage: true, singleLastPage: true, treatWidePageAsSingle: true },
      pages: [{ pageId: "page-1", pageIndex: 0, side: "single" as const }],
      pageCount: 1,
      atStart: true,
      atEnd: true,
    },
    visiblePages: [{ id: "page-1", index: 0, name: "1.jpg", mediaKind: "image" as const, contentVersion: "v1" }],
  }
}
