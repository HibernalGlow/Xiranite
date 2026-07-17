import { describe, expect, it, vi } from "vitest"

import type { ReaderBookSettingsRecord, ReaderBookSettingsStore } from "../../ports/ReaderBookSettingsStore.js"
import {
  ReaderBookSettingsRevisionConflict,
  ReaderBookSettingsService,
  type ReaderBookSettingsDefaults,
} from "./ReaderBookSettingsService.js"

const defaults: ReaderBookSettingsDefaults = {
  favorite: false,
  rating: 0,
  direction: "left-to-right",
  pageMode: "single",
  horizontalBook: false,
}

describe("ReaderBookSettingsService", () => {
  it("[neoview.book-settings.service] persists one versioned override record and resets fields to inheritance", async () => {
    const store = memoryStore()
    const apply = vi.fn(async () => undefined)
    const service = new ReaderBookSettingsService(store, () => 123)

    await expect(service.read("book-1", defaults)).resolves.toMatchObject({
      schemaVersion: 1,
      revision: 0,
      overrides: {},
      effective: defaults,
      inherited: ["favorite", "rating", "direction", "pageMode", "horizontalBook"],
    })
    const saved = await service.update("book-1", 0, { favorite: true, direction: "right-to-left" }, defaults, apply)
    expect(saved).toMatchObject({
      revision: 1,
      updatedAt: 123,
      overrides: { favorite: true, direction: "right-to-left" },
      effective: { favorite: true, direction: "right-to-left", pageMode: "single" },
    })
    expect(apply).toHaveBeenCalledWith({ direction: "right-to-left", pageMode: "single", horizontalBook: false }, undefined)

    const inherited = await service.update("book-1", 1, { direction: null }, defaults, apply)
    expect(inherited).toMatchObject({ revision: 2, overrides: { favorite: true }, effective: { direction: "left-to-right" } })
    expect(inherited.inherited).toContain("direction")
  })

  it("[neoview.book-settings.revision] rejects stale writers before changing the active frame", async () => {
    const store = memoryStore({ bookId: "book-1", overrides: { pageMode: "double" }, revision: 3, updatedAt: 1 })
    const apply = vi.fn(async () => undefined)
    const service = new ReaderBookSettingsService(store)
    await expect(service.update("book-1", 2, { pageMode: "single" }, defaults, apply))
      .rejects.toBeInstanceOf(ReaderBookSettingsRevisionConflict)
    expect(apply).not.toHaveBeenCalled()
  })

  it("[neoview.book-settings.cas-rollback] applies the winning external revision when CAS loses after frame mutation", async () => {
    const original: ReaderBookSettingsRecord = {
      bookId: "book-1",
      overrides: { direction: "left-to-right", pageMode: "single" },
      revision: 1,
      updatedAt: 1,
    }
    const winner: ReaderBookSettingsRecord = {
      bookId: "book-1",
      overrides: { direction: "right-to-left", pageMode: "double", horizontalBook: true },
      revision: 2,
      updatedAt: 2,
    }
    let reads = 0
    const store: ReaderBookSettingsStore = {
      getBookSettings: vi.fn(async () => reads++ === 0 ? original : winner),
      saveBookSettings: vi.fn(async () => undefined),
      importBookSettings: vi.fn(async () => ({ inserted: 0, updated: 0, unchanged: 0 })),
    }
    const apply = vi.fn(async () => undefined)
    const service = new ReaderBookSettingsService(store)
    await expect(service.update("book-1", 1, { pageMode: "double" }, defaults, apply))
      .rejects.toMatchObject({ actualRevision: 2 })
    expect(apply.mock.calls).toEqual([
      [{ direction: "left-to-right", pageMode: "double", horizontalBook: false }, undefined],
      [{ direction: "right-to-left", pageMode: "double", horizontalBook: true }],
    ])
  })

  it("[neoview.book-settings.rollback] restores the previous frame when durable persistence fails", async () => {
    const current: ReaderBookSettingsRecord = {
      bookId: "book-1",
      overrides: { direction: "right-to-left", pageMode: "double" },
      revision: 1,
      updatedAt: 1,
    }
    const store: ReaderBookSettingsStore = {
      getBookSettings: vi.fn(async () => current),
      saveBookSettings: vi.fn(async () => { throw new Error("database busy") }),
      importBookSettings: vi.fn(async () => ({ inserted: 0, updated: 0, unchanged: 0 })),
    }
    const apply = vi.fn(async () => undefined)
    const service = new ReaderBookSettingsService(store)
    await expect(service.update("book-1", 1, { direction: "left-to-right", pageMode: "single" }, defaults, apply))
      .rejects.toThrow("database busy")
    expect(apply.mock.calls).toEqual([
      [{ direction: "left-to-right", pageMode: "single", horizontalBook: false }, undefined],
      [{ direction: "right-to-left", pageMode: "double", horizontalBook: false }],
    ])
  })

  it("[neoview.book-settings.metadata-stability] persists metadata-only overrides without rebuilding the active frame", async () => {
    const store = memoryStore()
    const apply = vi.fn(async () => undefined)
    const service = new ReaderBookSettingsService(store)
    await expect(service.update("book-1", 0, { favorite: true, rating: 5 }, defaults, apply))
      .resolves.toMatchObject({ overrides: { favorite: true, rating: 5 } })
    expect(apply).not.toHaveBeenCalled()
  })

  it("rejects unknown, empty and out-of-range patches before persistence", async () => {
    const store = memoryStore()
    const service = new ReaderBookSettingsService(store)
    const apply = vi.fn(async () => undefined)
    await expect(service.update("book-1", 0, {}, defaults, apply)).rejects.toThrow("must not be empty")
    await expect(service.update("book-1", 0, { rating: 6 }, defaults, apply)).rejects.toThrow()
    await expect(service.update("book-1", 0, { future: true }, defaults, apply)).rejects.toThrow()
  })
})

function memoryStore(initial?: ReaderBookSettingsRecord): ReaderBookSettingsStore {
  let record = initial
  return {
    async getBookSettings(bookId) {
      return record?.bookId === bookId ? structuredClone(record) : undefined
    },
    async saveBookSettings(bookId, overrides, expectedRevision, updatedAt) {
      const actual = record?.bookId === bookId ? record.revision : 0
      if (actual !== expectedRevision) return undefined
      record = { bookId, overrides: structuredClone(overrides), revision: actual + 1, updatedAt }
      return structuredClone(record)
    },
    async importBookSettings() {
      return { inserted: 0, updated: 0, unchanged: 0 }
    },
  }
}
