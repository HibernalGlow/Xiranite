import { afterEach, describe, expect, it, vi } from "vitest"

import { ReaderHttpController } from "./ReaderHttpController.js"

const controllers: ReaderHttpController[] = []

afterEach(async () => {
  await Promise.all(controllers.splice(0).map((controller) => controller[Symbol.asyncDispose]()))
})

describe("ReaderHttpController system integration composition", () => {
  it("[neoview.file.explorer-context-menu-composition] wires the injected GUI capability through the root controller", async () => {
    const explorerContextMenu = {
      preview: vi.fn(async () => ({ available: true, plan: [], registryFile: "preview.reg" })),
      status: vi.fn(async () => ({ available: true, enabled: false })),
      setEnabled: vi.fn(async (enabled: boolean) => ({ available: true, enabled })),
    }
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "reader-token",
      progressStore: false,
      explorerContextMenu,
    })
    controllers.push(controller)

    const response = await controller.handle(new Request("http://127.0.0.1:41000/reader/system/explorer-context-menu/status", {
      headers: { "x-xiranite-token": "reader-token" },
    }))
    expect(response?.status).toBe(200)
    await expect(response?.json()).resolves.toEqual({ available: true, enabled: false })
    expect(explorerContextMenu.status).toHaveBeenCalledOnce()
  })
})
