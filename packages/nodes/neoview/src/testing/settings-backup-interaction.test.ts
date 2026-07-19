import { describe, expect, it, vi } from "vitest"

import type { ReaderBackupBundleResult, ReaderBackupInspection, ReaderBackupRestoreResult } from "../platform/backup/ReaderBackupBundleService.js"
import {
  createNeoviewSettingsBackupTuiDefinition,
  type NeoviewSettingsBackupTuiPort,
} from "../interaction.js"

describe("NeoView settings backup terminal interaction", () => {
  it("[neoview.settings.backup-tui] reuses the verified bundle service for create, inspect, and offline restore", async () => {
    const create = vi.fn(async () => ({ destinationPath: "D:/private/backup", manifest: fixtureManifest() }) satisfies ReaderBackupBundleResult)
    const inspect = vi.fn(async () => ({
      bundlePath: "D:/private/backup",
      manifest: fixtureManifest(),
      database: { compatibility: "current", quickCheck: "ok" },
    }) as ReaderBackupInspection)
    const restore = vi.fn(async () => ({
      manifest: fixtureManifest(),
      settingsChanged: true,
      database: { quickCheck: "ok" },
    }) as ReaderBackupRestoreResult)
    const createService = vi.fn(async (_options: { configPath?: string; databasePath?: string }) => ({ create, inspect, restore }) satisfies NeoviewSettingsBackupTuiPort)
    const definition = createNeoviewSettingsBackupTuiDefinition("en", createService)

    const created = await definition.run(definition.schema.toInput({
      action: "create",
      bundlePath: " D:/backup ",
      configPath: " xiranite.config.toml ",
      databasePath: " thumbnails.db ",
    }), () => undefined)
    expect(created).toMatchObject({ success: true, message: "NeoView backup created and verified." })
    expect(created.lines?.join("\n")).not.toContain("D:/private")
    expect(create).toHaveBeenCalledWith("D:/backup", expect.any(AbortSignal))
    expect(createService).toHaveBeenCalledWith({ configPath: "xiranite.config.toml", databasePath: "thumbnails.db" })

    const inspected = await definition.run(definition.schema.toInput({ action: "inspect", bundlePath: "D:/backup" }), () => undefined)
    expect(inspected).toMatchObject({ success: true, lines: expect.arrayContaining(["databaseCompatibility=current"]) })

    const restoredInput = definition.schema.toInput({ action: "restore", bundlePath: "D:/backup", quarantinePath: "D:/quarantine" })
    expect(definition.schema.validate({}, restoredInput)).toBeNull()
    expect(definition.schema.isDangerous(restoredInput)).toBe(true)
    expect(definition.schema.dangerPrompt?.(restoredInput)).toMatchObject({ confirmLabel: "Restore offline" })
    await expect(definition.run(restoredInput, () => undefined)).resolves.toMatchObject({ success: true, message: "NeoView backup restored; the original database was quarantined." })
    expect(restore).toHaveBeenCalledWith("D:/backup", { quarantinePath: "D:/quarantine" }, expect.any(AbortSignal))
  })

  it("[neoview.settings.backup-tui-schema] requires a bundle path and an offline quarantine destination for restore", () => {
    const schema = createNeoviewSettingsBackupTuiDefinition("en", async () => { throw new Error("unused") }).schema
    expect(schema.validate({}, schema.toInput({ action: "inspect", bundlePath: "" }))).toContain("Enter a destination")
    expect(schema.validate({}, schema.toInput({ action: "restore", bundlePath: "D:/backup", quarantinePath: "" }))).toContain("quarantine")
    expect(schema.isDangerous(schema.toInput({ action: "inspect", bundlePath: "D:/backup" }))).toBe(false)
  })
})

function fixtureManifest() {
  return {
    format: "Xiranite/NeoViewBackup" as const,
    version: 1 as const,
    createdAt: 123,
    settings: {
      name: "settings.json",
      bytes: 40,
      sha256: "a".repeat(64),
      format: "Xiranite/NeoViewConfig" as const,
      version: 1 as const,
      omittedSensitivePaths: [],
    },
    database: {
      name: "thumbnails.db",
      bytes: 60,
      sha256: "b".repeat(64),
      compatibility: "current" as const,
      quickCheck: "ok" as const,
    },
  }
}
