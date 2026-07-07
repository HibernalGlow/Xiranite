// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import { checkLocalBackendStatus } from "./localBackendStatus"
import { hydrateLocalBackendConfig, hydrateLocalBackendConfigFromWails } from "./localBackendConfig"
import { createXiraniteSystemClient } from "@xiranite/api/client"

const healthMock = vi.hoisted(() => vi.fn())

vi.mock("@xiranite/api/client", () => ({
  createXiraniteSystemClient: vi.fn(() => ({
    health: healthMock,
  })),
}))

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  delete window.__XIRANITE_BACKEND__
  delete window._wails
})

describe("checkLocalBackendStatus", () => {
  test("reports missing config without probing the backend", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })))
    const status = await checkLocalBackendStatus()

    expect(status.status).toBe("missing-config")
    expect(createXiraniteSystemClient).not.toHaveBeenCalled()
  })

  test("reports ready when /health succeeds", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })))
    window.__XIRANITE_BACKEND__ = { baseUrl: "http://127.0.0.1:3000", token: "test-token" }
    healthMock.mockResolvedValueOnce({ ok: true })

    const status = await checkLocalBackendStatus()

    expect(status.status).toBe("ready")
    expect(status.config?.baseUrl).toBe("http://127.0.0.1:3000")
    expect(createXiraniteSystemClient).toHaveBeenCalledWith("http://127.0.0.1:3000", { token: "test-token" })
  })

  test("refreshes runtime config from the dev manifest before probing health", async () => {
    window.__XIRANITE_BACKEND__ = { baseUrl: "http://127.0.0.1:3000", token: "stale-token" }
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      baseUrl: "http://127.0.0.1:41000",
      token: "manifest-token",
    }))))
    healthMock.mockResolvedValueOnce({ ok: true })

    const status = await checkLocalBackendStatus()

    expect(status.status).toBe("ready")
    expect(status.config?.baseUrl).toBe("http://127.0.0.1:41000")
    expect(createXiraniteSystemClient).toHaveBeenCalledWith("http://127.0.0.1:41000", { token: "manifest-token" })
  })

  test("reports unreachable when /health fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })))
    window.__XIRANITE_BACKEND__ = { baseUrl: "http://127.0.0.1:3000" }
    healthMock.mockRejectedValueOnce(new Error("connection refused"))

    const status = await checkLocalBackendStatus()

    expect(status.status).toBe("unreachable")
    expect(status.error).toContain("connection refused")
  })

  test("reports unreachable when /health hangs past the timeout", async () => {
    vi.useFakeTimers()
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })))
    window.__XIRANITE_BACKEND__ = { baseUrl: "http://127.0.0.1:3000" }
    healthMock.mockReturnValueOnce(new Promise(() => {}))

    const statusPromise = checkLocalBackendStatus(25)
    await vi.advanceTimersByTimeAsync(25)
    const status = await statusPromise

    expect(status.status).toBe("unreachable")
    expect(status.error).toContain("timed out")
  })
})

describe("hydrateLocalBackendConfigFromWails", () => {
  test("skips Wails calls in a plain browser runtime", async () => {
    await expect(hydrateLocalBackendConfigFromWails()).resolves.toBeUndefined()
    expect(window.__XIRANITE_BACKEND__).toBeUndefined()
  })
})

describe("hydrateLocalBackendConfig", () => {
  test("loads the framework-agnostic dev backend manifest before app startup", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      baseUrl: "http://127.0.0.1:41000",
      token: "manifest-token",
    }))))

    const config = await hydrateLocalBackendConfig()

    expect(config).toEqual({ baseUrl: "http://127.0.0.1:41000", token: "manifest-token" })
    expect(window.__XIRANITE_BACKEND__).toEqual(config)
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/.well-known/xiranite/backend.json?"), {
      cache: "no-store",
    })
  })
})
