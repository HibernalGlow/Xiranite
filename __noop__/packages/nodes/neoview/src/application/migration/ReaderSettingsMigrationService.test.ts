import { describe, expect, it, vi } from "vitest"

import { ReaderSettingsMigrationService } from "./ReaderSettingsMigrationService.js"

const input = JSON.stringify({
  format: "NeoView/1.0",
  config: { system: { language: "zh-CN" }, book: { readingDirection: "right-to-left" } },
})

describe("ReaderSettingsMigrationService", () => {
  it("[neoview.settings.service-inspect] validates modules and delegates to the frozen codec", () => {
    const service = new ReaderSettingsMigrationService()
    expect(service.inspect({ content: input, modules: ["native-settings"] })).toMatchObject({
      configPatch: { schema_version: 1, system: { language: "zh-CN" }, reader: { reading_direction: "right-to-left" } },
      report: { sourceKind: "neoview-1.0" },
    })
    expect(() => service.inspect({ content: input, modules: ["unknown"] })).toThrow("Unknown settings module")
    expect(() => service.inspect({ content: input, modules: ["native-settings", "native-settings"] })).toThrow("must be unique")
  })

  it("[neoview.settings.service-import] requires confirmation and commits exactly the decoded patch", async () => {
    const commit = vi.fn(async () => ({ changed: true, backupPath: "config.bak" }))
    const service = new ReaderSettingsMigrationService({ commit })
    await expect(service.import({ content: input, confirmed: false })).rejects.toThrow("explicit confirmation")
    await expect(service.import({ content: input, confirmed: true, strategy: "overwrite" })).resolves.toMatchObject({
      changed: true,
      backupPath: "config.bak",
      strategy: "overwrite",
      decoded: { report: { sourceKind: "neoview-1.0" } },
    })
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ schema_version: 1 }), "overwrite")
  })

  it("[neoview.settings.service-budget] rejects oversized UTF-8 content before decoding", () => {
    const service = new ReaderSettingsMigrationService(undefined, undefined, 4)
    expect(() => service.inspect({ content: "你好" })).toThrow("exceeds 4 bytes")
  })
})
