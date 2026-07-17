import { describe, expect, it, vi } from "vitest"

import { ReaderSettingsMigrationService } from "../../application/migration/ReaderSettingsMigrationService.js"
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
})

function request(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}
