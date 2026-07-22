import { describe, expect, it, vi } from "vitest"

import { ReaderHttpController } from "./ReaderHttpController.js"
import { DEFAULT_NEOVIEW_PRELOAD_CONFIG } from "../../application/config/ReaderRuntimeConfig.js"

describe("Reader preload configuration HTTP", () => {
  it("[neoview.preload.transport-http] persists only the bounded next-session candidate budget", async () => {
    const updatePreload = vi.fn(async (patch) => ({ ...DEFAULT_NEOVIEW_PRELOAD_CONFIG, ...patch.preload }))
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "preload-config-token",
      updatePreload,
    })
    try {
      expect((await controller.handle(new Request("http://127.0.0.1:41000/reader/config")))?.status).toBe(401)
      const response = (await controller.handle(authorized("/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preload: { maxCandidatePages: 12 } }),
      })))!
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({ preload: { maxCandidatePages: 12 } })
      expect(updatePreload).toHaveBeenCalledWith(
        { preload: { maxCandidatePages: 12 } },
        { performance: { preload_pages: 12 } },
      )
      const invalid = (await controller.handle(authorized("/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preload: { maxCandidatePages: 33 } }),
      })))!
      expect(invalid.status).toBe(400)
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.config-section-registry] accepts the explicit section protocol", async () => {
    const updatePreload = vi.fn(async (patch) => ({ ...DEFAULT_NEOVIEW_PRELOAD_CONFIG, ...patch.preload }))
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "preload-config-token",
      updatePreload,
    })
    try {
      const response = (await controller.handle(authorized("/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ section: "preload", patch: { maxCandidatePages: 12 } }),
      })))!
      expect(response.status).toBe(200)
      expect(updatePreload).toHaveBeenCalledWith(
        { preload: { maxCandidatePages: 12 } },
        { performance: { preload_pages: 12 } },
      )
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.config-section-registry] rejects unknown explicit sections before dispatch", async () => {
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "preload-config-token",
      updatePreload: vi.fn(),
    })
    try {
      const response = (await controller.handle(authorized("/reader/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ section: "futureSetting", patch: { enabled: true } }),
      })))!
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({ error: "Unsupported reader config section: futureSetting." })
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })
})

function authorized(path: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers)
  headers.set("x-xiranite-token", "preload-config-token")
  return new Request(`http://127.0.0.1:41000${path}`, { ...init, headers })
}
