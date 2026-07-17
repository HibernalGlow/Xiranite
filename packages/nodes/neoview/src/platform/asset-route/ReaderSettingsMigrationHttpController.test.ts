import { describe, expect, it, vi } from "vitest"

import { ReaderSettingsMigrationService } from "../../application/migration/ReaderSettingsMigrationService.js"
import { ReaderSettingsPortableService } from "../../application/migration/ReaderSettingsPortableService.js"
import { ReaderSettingsMigrationHttpController } from "./ReaderSettingsMigrationHttpController.js"

const content = JSON.stringify({ format: "NeoView/1.0", config: { system: { language: "en" } } })

describe("ReaderSettingsMigrationHttpController", () => {
  it("[neoview.settings.http-inspect] returns a secret-free preview without committing", async () => {
    const commit = vi.fn(async () => ({ changed: true }))
    const controller = new ReaderSettingsMigrationHttpController(
      async () => new ReaderSettingsMigrationService({ commit }),
      (operation) => operation(),
    )
    const response = (await controller.handle(request("/reader/settings/migration/inspect", { content })))!
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      report: { sourceKind: "neoview-1.0" },
      configPatch: { system: { language: "en" } },
    })
    expect(commit).not.toHaveBeenCalled()
  })

  it("[neoview.settings.http-import] requires confirmation, serializes mutation and hides config paths", async () => {
    const commit = vi.fn(async () => ({ changed: true, configPath: "D:/private/xiranite.config.toml", backupPath: "D:/private/backup" }))
    const runMutation = vi.fn(async <T>(operation: () => Promise<T>) => operation())
    const controller = new ReaderSettingsMigrationHttpController(
      async () => new ReaderSettingsMigrationService({ commit }),
      runMutation,
    )
    expect((await controller.handle(request("/reader/settings/migration/import", { content, confirmed: false })))?.status).toBe(400)
    const response = (await controller.handle(request("/reader/settings/migration/import", {
      content,
      modules: ["native-settings"],
      strategy: "overwrite",
      confirmed: true,
    })))!
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).not.toContain("D:/private")
    expect(JSON.parse(text)).toMatchObject({ changed: true, backupCreated: true, strategy: "overwrite" })
    expect(runMutation).toHaveBeenCalledOnce()
  })

  it("[neoview.settings.http-validation] rejects malformed and unknown fields", async () => {
    const controller = new ReaderSettingsMigrationHttpController(
      async () => new ReaderSettingsMigrationService(),
      (operation) => operation(),
    )
    expect((await controller.handle(request("/reader/settings/migration/inspect", { content, extra: true })))?.status).toBe(400)
    expect((await controller.handle(request("/reader/settings/migration/inspect", { content, modules: "native-settings" })))?.status).toBe(400)
    expect((await controller.handle(new Request("http://localhost/reader/settings/migration/inspect", { method: "GET" })))?.status).toBe(405)
  })

  it("[neoview.settings.portable-http] downloads no-store JSON and imports through the shared mutation queue", async () => {
    const commit = vi.fn(async () => ({ changed: true, backupPath: "private.bak" }))
    const runMutation = vi.fn(async <T>(operation: () => Promise<T>) => operation())
    const portable = new ReaderSettingsPortableService(
      { read: async () => ({ schema_version: 1, future: { enabled: true }, secret: "hidden" }) },
      { commit },
    )
    const controller = new ReaderSettingsMigrationHttpController(
      async () => new ReaderSettingsMigrationService(),
      runMutation,
      async () => portable,
    )
    const download = (await controller.handle(new Request("http://localhost/reader/settings/portable")))!
    expect(download.status).toBe(200)
    expect(download.headers.get("content-disposition")).toMatch(/^attachment; filename="xiranite-neoview-settings-/)
    expect(download.headers.get("cache-control")).toBe("no-store")
    const content = await download.text()
    expect(content).not.toContain("hidden")
    expect(JSON.parse(content)).toMatchObject({
      format: "Xiranite/NeoViewConfig",
      version: 1,
      nodeConfig: { schema_version: 1, future: { enabled: true } },
      omittedSensitivePaths: ["secret"],
    })

    const imported = (await controller.handle(request("/reader/settings/portable", {
      content,
      strategy: "overwrite",
      confirmed: true,
    })))!
    await expect(imported.json()).resolves.toMatchObject({ changed: true, backupCreated: true, strategy: "overwrite" })
    expect(runMutation).toHaveBeenCalledOnce()
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ future: { enabled: true } }), "overwrite")
  })

  it("[neoview.settings.backup-http] requires confirmation and does not expose the destination path", async () => {
    const manifest = {
      format: "Xiranite/NeoViewBackup" as const,
      version: 1 as const,
      createdAt: 1,
      settings: { name: "settings.json", bytes: 1, sha256: "a".repeat(64), format: "Xiranite/NeoViewConfig" as const, version: 1 as const, omittedSensitivePaths: [] },
      database: { name: "thumbnails.db", bytes: 1, sha256: "b".repeat(64), compatibility: "current", quickCheck: "ok" as const },
    }
    const create = vi.fn(async () => ({ destinationPath: "D:/private/backup", manifest }))
    const portable = new ReaderSettingsPortableService({ read: async () => ({}) }).withBackupProvider({ create })
    const controller = new ReaderSettingsMigrationHttpController(
      async () => new ReaderSettingsMigrationService(),
      (operation) => operation(),
      async () => portable,
    )
    expect((await controller.handle(request("/reader/settings/backup", { destination: "D:/private/backup", confirmed: false })))?.status).toBe(400)
    const response = (await controller.handle(request("/reader/settings/backup", { destination: "D:/private/backup", confirmed: true })))!
    const text = await response.text()
    expect(text).not.toContain("D:/private")
    expect(JSON.parse(text)).toMatchObject({ created: true, manifest: { format: "Xiranite/NeoViewBackup" } })
    expect(create).toHaveBeenCalledWith("D:/private/backup", expect.any(AbortSignal))
  })

  it("[neoview.settings.backup-http-validation] rejects unknown fields and methods without loading backup", async () => {
    const loadPortable = vi.fn(async () => new ReaderSettingsPortableService({ read: async () => ({}) }))
    const controller = new ReaderSettingsMigrationHttpController(
      async () => new ReaderSettingsMigrationService(),
      (operation) => operation(),
      loadPortable,
    )
    expect((await controller.handle(request("/reader/settings/backup", { destination: "D:/backup", confirmed: true, extra: true })))?.status).toBe(400)
    expect((await controller.handle(new Request("http://localhost/reader/settings/backup")))?.status).toBe(405)
    expect(loadPortable).not.toHaveBeenCalled()
  })
})

function request(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}
