import { describe, expect, it, vi } from "vitest"
import { DEFAULT_READER_RADIAL_MENU_CONFIG, type NeoviewRadialMenuPatch, type ReaderRadialMenuConfig } from "../../application/config/ReaderRadialMenuConfig.js"
import { ReaderHttpController } from "./ReaderHttpController.js"

describe("Reader radial menu HTTP", () => {
  it("[neoview.bindings.radial-http] validates and persists radial menus without replacing operation bindings", async () => {
    const initial = structuredClone(DEFAULT_READER_RADIAL_MENU_CONFIG)
    const updateRadialMenu = vi.fn(async (patch: NeoviewRadialMenuPatch) => patch.radialMenu.config ?? initial)
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "reader-token",
      radialMenu: initial,
      updateRadialMenu,
    })
    try {
      const config: ReaderRadialMenuConfig = {
        ...initial,
        menus: [{ id: "default", name: "阅读", layers: [[{ id: "next", label: "下一页", action: "reader.next-page", slotIndex: 0 }], [], []] }],
      }
      const response = await controller.handle(request({ radialMenu: { config } }))
      expect(response?.status).toBe(200)
      await expect(response!.json()).resolves.toMatchObject({ radialMenu: config, inputBindings: { bindings: expect.any(Array) } })
      expect(updateRadialMenu).toHaveBeenCalledWith({ radialMenu: { config } }, { bindings: { radial_menus: config } })

      expect((await controller.handle(request({ radialMenu: { config: { ...config, radius: 20 } } })))?.status).toBe(400)
      expect(updateRadialMenu).toHaveBeenCalledOnce()
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })
})

function request(body: unknown): Request {
  return new Request("http://127.0.0.1:41000/reader/config", {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-xiranite-token": "reader-token" },
    body: JSON.stringify(body),
  })
}
