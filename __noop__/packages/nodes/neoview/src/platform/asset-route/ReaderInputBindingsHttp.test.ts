import { describe, expect, it, vi } from "vitest"
import { ReaderHttpController } from "./ReaderHttpController.js"
import type { ReaderInputBindingsConfig } from "../../domain/input/ReaderInputBindings.js"

describe("Reader input bindings HTTP", () => {
  it("[neoview.bindings.http] authenticates, validates and publishes one canonical update", async () => {
    const initial: ReaderInputBindingsConfig = { bindings: [
      { id: "next", action: "reader.next-page", context: "reader", enabled: true, input: { device: "keyboard", code: "ArrowRight" } },
    ] }
    const updateInputBindings = vi.fn(async (patch: { inputBindings: { bindings?: ReaderInputBindingsConfig["bindings"] } }) => ({ bindings: patch.inputBindings.bindings ?? [] }))
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "reader-token",
      inputBindings: initial,
      updateInputBindings,
    })
    try {
      expect((await controller.handle(request({ inputBindings: { bindings: [] } }, false)))?.status).toBe(401)
      const conflict = await controller.handle(request({ inputBindings: { bindings: [
        initial.bindings[0],
        { id: "previous", action: "reader.previous-page", context: "reader", enabled: true, input: { device: "keyboard", code: "ArrowRight" } },
      ] } }))
      expect(conflict?.status).toBe(400)
      expect(updateInputBindings).not.toHaveBeenCalled()

      const updated = { inputBindings: { bindings: [
        { id: "pad-next", action: "reader.next-page", context: "reader", enabled: true, input: { device: "gamepad", button: 5 } },
      ] } }
      const response = await controller.handle(request(updated))
      expect(response?.status).toBe(200)
      await expect(response!.json()).resolves.toMatchObject({ inputBindings: updated.inputBindings })
      expect(updateInputBindings).toHaveBeenCalledWith(updated, { bindings: { items: updated.inputBindings.bindings } })
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })
})

function request(body: unknown, authorized = true): Request {
  const headers = new Headers({ "content-type": "application/json" })
  if (authorized) headers.set("x-xiranite-token", "reader-token")
  return new Request("http://127.0.0.1:41000/reader/config", { method: "PATCH", headers, body: JSON.stringify(body) })
}
