import { describe, expect, it, vi } from "vitest"

import type { LegacyBookSettingsImporter } from "../../migration/LegacyBookSettingsImporter.js"
import { ReaderBookSettingsMigrationService } from "./ReaderBookSettingsMigrationService.js"

describe("ReaderBookSettingsMigrationService", () => {
  it("[neoview.book-settings.legacy-service-lifecycle] closes its owned dependency exactly once", async () => {
    const dispose = vi.fn(async () => undefined)
    const importer = { import: vi.fn() } as unknown as LegacyBookSettingsImporter
    const service = new ReaderBookSettingsMigrationService(importer, undefined, dispose)

    expect(service.inspect(JSON.stringify({ "D:/book.cbz": { favorite: true } }))).toMatchObject({
      report: { validEntries: 1 },
    })
    await service[Symbol.asyncDispose]()
    await service[Symbol.asyncDispose]()

    expect(dispose).toHaveBeenCalledOnce()
    expect(() => service.inspect("{}")).toThrow("disposed")
  })
})
