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

  it("[neoview.file.explorer-context-menu-http] exposes preview, status and confirmed enable transport", async () => {
    const explorerContextMenu = {
      preview: vi.fn(async () => ({ available: true, plan: [], registryFile: "preview.reg" })),
      status: vi.fn(async () => ({ available: true, enabled: false })),
      setEnabled: vi.fn(async (enabled: boolean) => ({ available: true, enabled })),
    }
    const load = vi.fn(async () => new ReaderSystemIntegrationService({
      open: vi.fn(async () => undefined),
      reveal: vi.fn(async () => undefined),
      explorerContextMenu,
    }))
    const controller = new ReaderSystemIntegrationHttpController(load)

    const preview = await controller.handle(new Request("http://127.0.0.1/reader/system/explorer-context-menu/preview"))
    expect(preview?.status).toBe(200)
    await expect(preview?.json()).resolves.toMatchObject({ available: true, registryFile: "preview.reg" })
    const status = await controller.handle(new Request("http://127.0.0.1/reader/system/explorer-context-menu/status"))
    await expect(status?.json()).resolves.toEqual({ available: true, enabled: false })

    const rejected = await controller.handle(jsonRequest({ enabled: true }, "/reader/system/explorer-context-menu"))
    expect(rejected?.status).toBe(409)
    const enabled = await controller.handle(jsonRequest({ enabled: true, confirmed: true }, "/reader/system/explorer-context-menu"))
    await expect(enabled?.json()).resolves.toEqual({ available: true, enabled: true })
    expect(explorerContextMenu.setEnabled).toHaveBeenCalledWith(true, expect.any(AbortSignal))
    expect(load).toHaveBeenCalledOnce()
  })
})

function request(action: string, path: string): Request {
  return new Request(`http://127.0.0.1/reader/files/${action}`, { method: "POST", body: JSON.stringify({ path }) })
}

function jsonRequest(body: unknown, path: string): Request {
  return new Request(`http://127.0.0.1${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function absolute(path: string): string {
  return process.platform === "win32" ? `C:\\reader-test\\${path}` : `/reader-test/${path}`
}
