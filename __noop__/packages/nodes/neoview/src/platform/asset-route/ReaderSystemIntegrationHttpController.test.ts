import { describe, expect, it, vi } from "vitest"

import { ReaderSystemIntegrationService } from "../../application/files/ReaderSystemIntegrationService.js"
import { ReaderSystemIntegrationHttpController } from "./ReaderSystemIntegrationHttpController.js"

describe("ReaderSystemIntegrationHttpController", () => {
  it("[neoview.file-operations.system-http] lazily shares open and reveal routes", async () => {
    const provider = { open: vi.fn(async () => undefined), reveal: vi.fn(async () => undefined) }
    const load = vi.fn(async () => new ReaderSystemIntegrationService(provider))
    const controller = new ReaderSystemIntegrationHttpController(load)
    const path = absolute("page.jpg")

    expect((await controller.handle(request("open", path)))?.status).toBe(204)
    expect((await controller.handle(request("reveal", path)))?.status).toBe(204)
    expect(load).toHaveBeenCalledOnce()
    expect(provider.open).toHaveBeenCalledWith(path, expect.any(AbortSignal))
    expect(provider.reveal).toHaveBeenCalledWith(path, expect.any(AbortSignal))
  })
})

function request(action: string, path: string): Request {
  return new Request(`http://127.0.0.1/reader/files/${action}`, { method: "POST", body: JSON.stringify({ path }) })
}

function absolute(path: string): string {
  return process.platform === "win32" ? `C:\\reader-test\\${path}` : `/reader-test/${path}`
}
