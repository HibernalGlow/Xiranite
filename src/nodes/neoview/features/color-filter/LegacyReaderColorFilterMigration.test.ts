import { DEFAULT_READER_COLOR_FILTER } from "@xiranite/node-neoview/ui-core"
import { describe, expect, it, vi } from "vitest"

import { LEGACY_READER_COLOR_FILTER_KEY, migrateLegacyReaderColorFilter } from "./LegacyReaderColorFilterMigration"

describe("migrateLegacyReaderColorFilter", () => {
  it("[neoview.color-filter.legacy-import] imports legacy JSON once through canonical persistence", async () => {
    const storage = memoryStorage(JSON.stringify({ brightness: 125, invert: true }))
    const persist = vi.fn(async () => undefined)
    await expect(migrateLegacyReaderColorFilter({ storage, canonical: DEFAULT_READER_COLOR_FILTER, persist })).resolves.toBe("imported")
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ brightness: 125, invert: true, contrast: 100 }))
    expect(storage.getItem(LEGACY_READER_COLOR_FILTER_KEY)).toBeNull()
  })

  it("[neoview.color-filter.scope] lets an existing TOML value win and prevents legacy resurrection", async () => {
    const storage = memoryStorage(JSON.stringify({ brightness: 75 }))
    const persist = vi.fn(async () => undefined)
    await expect(migrateLegacyReaderColorFilter({
      storage,
      canonical: { ...DEFAULT_READER_COLOR_FILTER, brightness: 130 },
      persist,
    })).resolves.toBe("canonical-won")
    expect(persist).not.toHaveBeenCalled()
    expect(storage.getItem(LEGACY_READER_COLOR_FILTER_KEY)).toBeNull()
  })

  it("[neoview.color-filter.legacy-import] preserves invalid or failed legacy data for a later retry", async () => {
    const invalid = memoryStorage("{")
    await expect(migrateLegacyReaderColorFilter({ storage: invalid, canonical: DEFAULT_READER_COLOR_FILTER, persist: vi.fn() })).resolves.toBe("invalid")
    expect(invalid.getItem(LEGACY_READER_COLOR_FILTER_KEY)).toBe("{")

    const failed = memoryStorage(JSON.stringify({ sepia: 30 }))
    await expect(migrateLegacyReaderColorFilter({
      storage: failed,
      canonical: DEFAULT_READER_COLOR_FILTER,
      persist: async () => { throw new Error("write failed") },
    })).rejects.toThrow("write failed")
    expect(failed.getItem(LEGACY_READER_COLOR_FILTER_KEY)).not.toBeNull()
  })
})

function memoryStorage(value: string) {
  let current: string | null = value
  return {
    getItem: (key: string) => key === LEGACY_READER_COLOR_FILTER_KEY ? current : null,
    removeItem: (key: string) => { if (key === LEGACY_READER_COLOR_FILTER_KEY) current = null },
  }
}
