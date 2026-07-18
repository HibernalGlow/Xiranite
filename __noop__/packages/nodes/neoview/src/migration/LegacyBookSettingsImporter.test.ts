import { describe, expect, it, vi } from "vitest"

import type { ReaderBookSettingsStore } from "../ports/ReaderBookSettingsStore.js"
import { LegacyBookSettingsImporter } from "./LegacyBookSettingsImporter.js"

describe("LegacyBookSettingsImporter", () => {
  it("[neoview.book-settings.legacy-importer] resolves canonical identities, deduplicates aliases and performs one batch write", async () => {
    const importBookSettings = vi.fn(async () => ({ inserted: 1, updated: 0, unchanged: 0 }))
    const store = fakeStore(importBookSettings)
    const importer = new LegacyBookSettingsImporter(store, async (source) => ({
      bookId: source.path.includes("alias") ? "book-1" : source.path.includes("missing") ? "book-2" : "book-1",
      source,
      canonical: !source.path.includes("missing"),
    }), () => 123)
    const result = await importer.import({
      entries: [
        { path: "D:/one.cbz", overrides: { favorite: true } },
        { path: "D:/alias.cbz", overrides: { rating: 4 } },
        { path: "D:/missing.cbz", overrides: { pageMode: "double" } },
      ],
      report: { totalEntries: 3, validEntries: 3, invalidEntries: 0, invalidFields: 0, unknownFields: 0 },
    }, "merge")
    expect(result).toEqual({
      applied: { inserted: 1, updated: 0, unchanged: 0 },
      unresolvedSources: 1,
      duplicateIdentities: 1,
    })
    expect(importBookSettings).toHaveBeenCalledWith([
      { bookId: "book-1", overrides: { rating: 4 } },
      { bookId: "book-2", overrides: { pageMode: "double" } },
    ], "merge", 123)
  })

  it("[neoview.book-settings.legacy-cancel] does not write a pre-cancelled import", async () => {
    const importBookSettings = vi.fn(async () => ({ inserted: 0, updated: 0, unchanged: 0 }))
    const importer = new LegacyBookSettingsImporter(fakeStore(importBookSettings), async (source) => ({ bookId: "book", source, canonical: true }))
    const cancellation = new AbortController()
    cancellation.abort(new DOMException("cancelled", "AbortError"))
    await expect(importer.import({
      entries: [{ path: "D:/one.cbz", overrides: { favorite: true } }],
      report: { totalEntries: 1, validEntries: 1, invalidEntries: 0, invalidFields: 0, unknownFields: 0 },
    }, "merge", cancellation.signal)).rejects.toMatchObject({ name: "AbortError" })
    expect(importBookSettings).not.toHaveBeenCalled()
  })
})

function fakeStore(importBookSettings: ReaderBookSettingsStore["importBookSettings"]): ReaderBookSettingsStore {
  return {
    getBookSettings: vi.fn(async () => undefined),
    saveBookSettings: vi.fn(async () => undefined),
    importBookSettings,
  }
}
