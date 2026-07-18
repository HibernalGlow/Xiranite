import { DEFAULT_READER_PAGE_TRANSITION } from "@xiranite/node-neoview/page-transition"
import { describe, expect, it, vi } from "vitest"

import {
  LEGACY_READER_PAGE_TRANSITION_KEY,
  migrateLegacyReaderPageTransition,
} from "./LegacyReaderPageTransitionMigration"

describe("migrateLegacyReaderPageTransition", () => {
  it("[neoview.page-transition.legacy-import] imports legacy JSON once", async () => {
    const storage = memoryStorage(JSON.stringify({ enabled: true, type: "slide", duration: 240 }))
    const persist = vi.fn(async () => undefined)
    await expect(migrateLegacyReaderPageTransition({
      storage,
      canonical: DEFAULT_READER_PAGE_TRANSITION,
      persist,
    })).resolves.toBe("imported")
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, type: "slide", duration: 240 }))
    expect(storage.getItem(LEGACY_READER_PAGE_TRANSITION_KEY)).toBeNull()
  })

  it("[neoview.page-transition.persistence] lets canonical TOML win", async () => {
    const storage = memoryStorage(JSON.stringify({ enabled: true }))
    const persist = vi.fn(async () => undefined)
    await expect(migrateLegacyReaderPageTransition({
      storage,
      canonical: { ...DEFAULT_READER_PAGE_TRANSITION, duration: 200 },
      persist,
    })).resolves.toBe("canonical-won")
    expect(persist).not.toHaveBeenCalled()
    expect(storage.getItem(LEGACY_READER_PAGE_TRANSITION_KEY)).toBeNull()
  })

  it("[neoview.page-transition.legacy-import] retains invalid and failed data for retry", async () => {
    const invalid = memoryStorage("{")
    await expect(migrateLegacyReaderPageTransition({
      storage: invalid,
      canonical: DEFAULT_READER_PAGE_TRANSITION,
      persist: vi.fn(),
    })).resolves.toBe("invalid")
    expect(invalid.getItem(LEGACY_READER_PAGE_TRANSITION_KEY)).toBe("{")

    const failed = memoryStorage(JSON.stringify({ type: "zoom" }))
    await expect(migrateLegacyReaderPageTransition({
      storage: failed,
      canonical: DEFAULT_READER_PAGE_TRANSITION,
      persist: async () => { throw new Error("write failed") },
    })).rejects.toThrow("write failed")
    expect(failed.getItem(LEGACY_READER_PAGE_TRANSITION_KEY)).not.toBeNull()
  })
})

function memoryStorage(value: string) {
  let current: string | null = value
  return {
    getItem: (key: string) => key === LEGACY_READER_PAGE_TRANSITION_KEY ? current : null,
    removeItem: (key: string) => { if (key === LEGACY_READER_PAGE_TRANSITION_KEY) current = null },
  }
}
