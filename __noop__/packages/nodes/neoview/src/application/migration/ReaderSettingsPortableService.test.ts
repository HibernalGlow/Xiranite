import { describe, expect, it, vi } from "vitest"

import { ReaderSettingsPortableService } from "./ReaderSettingsPortableService.js"

describe("ReaderSettingsPortableService", () => {
  it("[neoview.settings.portable-service] exports the current node config and imports through the shared committer", async () => {
    const read = vi.fn(async () => ({ schema_version: 1, future: { enabled: true }, apiKey: "hidden" }))
    const commit = vi.fn(async () => ({ changed: true, backupPath: "private.bak" }))
    const service = new ReaderSettingsPortableService({ read }, { commit })
    const exported = await service.export()
    expect(exported.nodeConfig).toEqual({ schema_version: 1, future: { enabled: true } })
    expect(exported.omittedSensitivePaths).toEqual(["apiKey"])
    await expect(service.import(JSON.stringify(exported), "overwrite", false)).rejects.toThrow("explicit confirmation")
    await expect(service.import(JSON.stringify(exported), "overwrite", true)).resolves.toMatchObject({
      changed: true,
      backupCreated: true,
      strategy: "overwrite",
    })
    expect(commit).toHaveBeenCalledWith(exported.nodeConfig, "overwrite")
  })
})
