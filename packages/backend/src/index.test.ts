import { describe, expect, test } from "bun:test"
import { createDefaultBackendApp, startBackend } from "./index.js"

describe("backend", () => {
  test("serves workspace list through the Elysia app", async () => {
    const app = createDefaultBackendApp({ now: 100 })
    const response = await app.handle(new Request("http://localhost/workspace"))
    const body = await response.json() as {
      workspaces: Array<{ id: string; label: string; createdAt: number; updatedAt: number }>
    }

    expect(response.status).toBe(200)
    expect(body.workspaces).toEqual([{ id: "ws-default", label: "Default", createdAt: 100, updatedAt: 100 }])
  })

  test("protects local service routes with a token", async () => {
    const backend = startBackend({ token: "test-token" })
    try {
      const blocked = await fetch(`${backend.url}/workspace`)
      expect(blocked.status).toBe(401)

      const allowed = await fetch(`${backend.url}/workspace`, {
        headers: { "x-xiranite-token": "test-token" },
      })
      expect(allowed.status).toBe(200)
    } finally {
      backend.server.stop(true)
    }
  })
})
