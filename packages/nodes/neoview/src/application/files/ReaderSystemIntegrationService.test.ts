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

  it("[neoview.emm-raw-data.url-service] allowlists bounded credential-free HTTP URLs", async () => {
    const openExternalUrl = vi.fn(async () => undefined)
    const service = new ReaderSystemIntegrationService({
      open: vi.fn(async () => undefined),
      reveal: vi.fn(async () => undefined),
      openExternalUrl,
    })

    await service.openExternalUrl("https://example.com/source?q=reader")
    expect(openExternalUrl).toHaveBeenCalledWith("https://example.com/source?q=reader", undefined)
    await expect(service.openExternalUrl("file:///C:/secret.txt")).rejects.toThrow("HTTP or HTTPS")
    await expect(service.openExternalUrl("https://user:secret@example.com/")).rejects.toThrow("without credentials")
    await expect(service.openExternalUrl(`https://example.com/${"x".repeat(4_096)}`)).rejects.toThrow("bounded")
  })

  it("[neoview.file.explorer-context-menu.service] delegates capability state and mutations", async () => {
    const explorerContextMenu = {
      preview: vi.fn(async () => ({ available: true, plan: [], registryFile: "registry" })),
      status: vi.fn(async () => ({ available: true, enabled: false })),
      setEnabled: vi.fn(async (enabled: boolean) => ({ available: true, enabled })),
    }
    const service = new ReaderSystemIntegrationService({
      open: vi.fn(async () => undefined),
      reveal: vi.fn(async () => undefined),
      explorerContextMenu,
    })

    await expect(service.explorerContextMenuPreview()).resolves.toMatchObject({ available: true, registryFile: "registry" })
    await expect(service.explorerContextMenuStatus()).resolves.toEqual({ available: true, enabled: false })
    await expect(service.explorerContextMenuSetEnabled(true)).resolves.toEqual({ available: true, enabled: true })
    expect(explorerContextMenu.setEnabled).toHaveBeenCalledWith(true, undefined)
  })
})

function absolute(path: string): string {
  return process.platform === "win32" ? `C:\\reader-test\\${path}` : `/reader-test/${path}`
}
