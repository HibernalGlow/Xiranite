// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import { checkLocalBackendStatus } from "./localBackendStatus"
import { createXiraniteSystemClient } from "@xiranite/api/client"

const healthMock = vi.hoisted(() => vi.fn())

vi.mock("@xiranite/api/client", () => ({
  createXiraniteSystemClient: vi.fn(() => ({
    health: healthMock,
  })),
}))

afterEach(() => {
  vi.clearAllMocks()
  delete window.__XIRANITE_BACKEND__
})

describe("checkLocalBackendStatus", () => {
  test("reports missing config without probing the backend", async () => {
    const status = await checkLocalBackendStatus()

    expect(status.status).toBe("missing-config")
    expect(createXiraniteSystemClient).not.toHaveBeenCalled()
  })

  test("reports ready when /health succeeds", async () => {
    window.__XIRANITE_BACKEND__ = { baseUrl: "http://127.0.0.1:3000", token: "test-token" }
    healthMock.mockResolvedValueOnce({ ok: true })

    const status = await checkLocalBackendStatus()

    expect(status.status).toBe("ready")
    expect(status.config?.baseUrl).toBe("http://127.0.0.1:3000")
    expect(createXiraniteSystemClient).toHaveBeenCalledWith("http://127.0.0.1:3000", { token: "test-token" })
  })

  test("reports unreachable when /health fails", async () => {
    window.__XIRANITE_BACKEND__ = { baseUrl: "http://127.0.0.1:3000" }
    healthMock.mockRejectedValueOnce(new Error("connection refused"))

    const status = await checkLocalBackendStatus()

    expect(status.status).toBe("unreachable")
    expect(status.error).toContain("connection refused")
  })
})
