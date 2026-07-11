// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import type { XiraniteDesktopBindings } from "../../../desktop/bridge"
import { createDenoDesktopRuntime, detectDenoDesktop } from "./denoDesktop"

afterEach(() => {
  delete window.bindings
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
