import { describe, expect, it, vi } from "vitest"

import { ReaderSystemIntegrationService } from "./ReaderSystemIntegrationService.js"

describe("ReaderSystemIntegrationService", () => {
  it("[neoview.file-operations.system-service] validates paths and shares one platform port", async () => {
    const provider = { open: vi.fn(async () => undefined), reveal: vi.fn(async () => undefined) }
    const service = new ReaderSystemIntegrationService(provider)
    const path = absolute("page.jpg")

    await service.open(path)
    await service.reveal(path)
    expect(provider.open).toHaveBeenCalledWith(path, undefined)
    expect(provider.reveal).toHaveBeenCalledWith(path, undefined)
    await expect(service.open("relative.jpg")).rejects.toThrow("absolute")
  })
})

function absolute(path: string): string {
  return process.platform === "win32" ? `C:\\reader-test\\${path}` : `/reader-test/${path}`
}
