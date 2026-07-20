import { describe, expect, it, vi } from "vitest"

import { ReaderOpdsHeadlessController } from "./ReaderOpdsHeadlessController.js"

describe("ReaderOpdsHeadlessController", () => {
  it("[neoview.opds.headless] delegates catalog reads and closes exactly once", async () => {
    const read = vi.fn(async (url: string) => ({ url, navigation: [], publications: [], links: [] }))
    const close = vi.fn(async () => undefined)
    const controller = new ReaderOpdsHeadlessController({ read, [Symbol.asyncDispose]: close })

    await expect(controller.readCatalog("https://catalog.example/feed")).resolves.toMatchObject({ url: "https://catalog.example/feed" })
    await controller.close()
    await controller.close()
    expect(close).toHaveBeenCalledOnce()
    expect(() => controller.readCatalog("https://catalog.example/feed")).toThrow("closed")
  })
})
