// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import type { XiraniteDesktopBindings } from "../../../desktop/bridge"
import { createDenoDesktopRuntime, detectDenoDesktop } from "./denoDesktop"

afterEach(() => {
  delete window.bindings
  delete window.__XIRANITE_DESKTOP__
  vi.restoreAllMocks()
})

describe("Deno Desktop runtime adapter", () => {
  test("detects the typed host binding and maps window operations", async () => {
    const bindings = createBindings()
    window.bindings = bindings

    expect(detectDenoDesktop()).toBe(true)
    const runtime = createDenoDesktopRuntime()
    expect(runtime.kind).toBe("deno-desktop")
    await expect(runtime.windows.getCapabilities()).resolves.toMatchObject({
      supported: true,
      componentWindows: "native",
    })
    await expect(runtime.windows.openComponent({ componentId: "component-1", moduleId: "marku" })).resolves.toMatchObject({
      success: true,
      id: "component-native-1",
    })
    expect(bindings.xiraniteDesktopWindowOpen).toHaveBeenCalledWith(JSON.stringify({
      componentId: "component-1",
      moduleId: "marku",
    }))
  })

  test("does not detect a normal browser", () => {
    expect(detectDenoDesktop()).toBe(false)
  })

  test("uses the automatic-window HTTP bridge and falls back to a browser popup", async () => {
    window.__XIRANITE_DESKTOP__ = {
      kind: "deno-desktop",
      version: 1,
      bridgeUrl: "http://127.0.0.1:45000/__xiranite_desktop_bridge",
    }
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { name: string }
      if (request.name === "xiraniteDesktopRuntimeInfo") {
        return new Response(JSON.stringify({
          ok: true,
          value: {
            kind: "deno-desktop",
            version: 1,
            capabilities: {
              supported: true,
              nativeWindowControls: false,
              frameless: false,
              componentWindows: "browser-popup",
            },
          },
        }))
      }
      return new Response(JSON.stringify({ ok: true, value: { success: false, supported: true, message: "fallback" } }))
    })
    vi.stubGlobal("fetch", fetchMock)
    vi.stubGlobal("open", vi.fn(() => window))

    const runtime = createDenoDesktopRuntime()
    await expect(runtime.windows.getCapabilities()).resolves.toMatchObject({ componentWindows: "browser-popup" })
    await expect(runtime.windows.openComponent({ componentId: "component-1", moduleId: "marku" })).resolves.toMatchObject({
      success: true,
      id: "component-1",
    })
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:45000/__xiranite_desktop_bridge",
      expect.objectContaining({ method: "POST" }),
    )
  })
})

function createBindings(): XiraniteDesktopBindings {
  return {
    xiraniteDesktopRuntimeInfo: vi.fn(async () => ({
      kind: "deno-desktop" as const,
      version: 1 as const,
      capabilities: {
        supported: true,
        nativeWindowControls: false,
        frameless: false,
        componentWindows: "native" as const,
      },
    })),
    xiraniteDesktopWindowControl: vi.fn(async () => ({ success: true, supported: true, message: "closed", state: "closed" as const })),
    xiraniteDesktopWindowOpen: vi.fn(async () => ({ success: true, supported: true, id: "component-native-1", message: "opened" })),
    xiraniteDesktopWindowFocus: vi.fn(async (id) => ({ success: true, supported: true, id, message: "focused" })),
    xiraniteDesktopWindowClose: vi.fn(async (id) => ({ success: true, supported: true, id, message: "closed", state: "closed" as const })),
    xiraniteDesktopWindowGetFrame: vi.fn(async () => ({ x: 10, y: 20, width: 800, height: 600 })),
    xiraniteDesktopWindowSetFrame: vi.fn(async (id) => ({ success: true, supported: true, id, message: "updated" })),
    xiraniteDesktopBackendConfig: vi.fn(async () => ({ baseUrl: "http://127.0.0.1:41000", token: "token" })),
    xiraniteDesktopBackendRestart: vi.fn(async () => ({ restarted: false, supported: false, message: "external" })),
  }
}
