import { describe, expect, it, vi } from "vitest"

import { DEFAULT_NEOVIEW_STARTUP_CONFIG } from "../../application/config/ReaderRuntimeConfig.js"
import { ReaderHttpController } from "./ReaderHttpController.js"

describe("Reader startup restore HTTP", () => {
  it("[neoview.startup-restore.http] returns and persists the canonical startup preference", async () => {
    const updateStartup = vi.fn(async (patch) => ({
      ...DEFAULT_NEOVIEW_STARTUP_CONFIG,
      ...patch.startup,
    }))
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "startup-token",
      updateStartup,
    })
    try {
      await expect((await controller.handle(authorized("/reader/config")))!.json()).resolves.toMatchObject({
        startup: DEFAULT_NEOVIEW_STARTUP_CONFIG,
      })
      const updated = (await controller.handle(authorized("/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startup: { restoreLastBook: false } }),
      })))!
      expect(updated.status).toBe(200)
      await expect(updated.json()).resolves.toMatchObject({ startup: { restoreLastBook: false } })
      expect(updateStartup).toHaveBeenCalledWith(
        { startup: { restoreLastBook: false } },
        { startup: { restore_last_book: false } },
      )
      const invalid = (await controller.handle(authorized("/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startup: {} }),
      })))!
      expect(invalid.status).toBe(400)
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })
})

function authorized(path: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers)
  headers.set("x-xiranite-token", "startup-token")
  return new Request(`http://127.0.0.1:41000${path}`, { ...init, headers })
}
