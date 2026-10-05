import { describe, expect, it, vi } from "vitest"

import { createTauriRuntime, detectTauriRuntime } from "./tauri"

/**
 * The adapter is the only place the Tauri command *names* and *argument shapes* are written down, and a
 * misspelled command fails silently at runtime (the WebView just sees a rejected promise). So the names
 * are asserted here against the handler list in `crates/xiranite-desktop/src/main.rs`.
 */
function fakeTauri(invoke = vi.fn(async () => ({ success: true, supported: true, message: "ok" }))) {
  return { webView: { __TAURI__: { core: { invoke }, event: {} } }, invoke }
}

describe("detectTauriRuntime", () => {
  it("is false in a plain browser document", () => {
    expect(detectTauriRuntime({})).toBe(false)
    expect(detectTauriRuntime(undefined)).toBe(false)
  })

  it("is true when the host injected the global", () => {
    expect(detectTauriRuntime(fakeTauri().webView)).toBe(true)
  })
})

describe("Tauri window adapter", () => {
  it("keeps the HTTP-backed surfaces from the web adapter and overrides only kind and windows", () => {
    const { webView } = fakeTauri()
    const runtime = createTauriRuntime(webView)

    expect(runtime.kind).toBe("tauri")
    expect(typeof runtime.fs.exists).toBe("function")
    expect(typeof runtime.storage.get).toBe("function")
    expect(typeof runtime.nodeRunner.runNode).toBe("function")
  })

  /// The argument key is part of the contract: Tauri matches `input` to the Rust parameter by name.
  it("calls the commands the host registers, with the argument keys it declares", async () => {
    const { webView, invoke } = fakeTauri()
    const windows = createTauriRuntime(webView).windows

    await windows.getCapabilities()
    expect(invoke).toHaveBeenLastCalledWith("xiranite_window_capabilities", undefined)

    await windows.openComponent({ componentId: "cmp-7", moduleId: "node:trename" })
    expect(invoke).toHaveBeenLastCalledWith("xiranite_open_component_window", {
      input: { componentId: "cmp-7", moduleId: "node:trename" },
    })

    await windows.controlMain("minimize")
    expect(invoke).toHaveBeenLastCalledWith("xiranite_window_control", { id: "main", action: "minimize" })

    await windows.controlComponent("component-cmp-7", "close")
    expect(invoke).toHaveBeenLastCalledWith("xiranite_window_control", { id: "component-cmp-7", action: "close" })

    await windows.focus("component-cmp-7")
    expect(invoke).toHaveBeenLastCalledWith("xiranite_window_focus", { id: "component-cmp-7" })

    await windows.setFrame({ x: 40, y: 60, width: 500, height: 400 }, "component-cmp-7")
    expect(invoke).toHaveBeenLastCalledWith("xiranite_window_set_frame", {
      frame: { x: 40, y: 60, width: 500, height: 400 },
      id: "component-cmp-7",
    })

    await windows.startDragging("component-cmp-7")
    expect(invoke).toHaveBeenLastCalledWith("xiranite_window_start_dragging", { id: "component-cmp-7" })
  })

  /// An absent id means the main window on the host side; the empty string is how the adapter says it.
  it("sends the main-window convention for optional ids", async () => {
    const { webView, invoke } = fakeTauri()
    const windows = createTauriRuntime(webView).windows

    await windows.getFrame()
    expect(invoke).toHaveBeenLastCalledWith("xiranite_window_get_frame", { id: "" })
    await windows.openDevTools()
    expect(invoke).toHaveBeenLastCalledWith("xiranite_window_open_devtools", { id: "" })
  })

  it("reports no frame for a host that answers null", async () => {
    const { webView, invoke } = fakeTauri(vi.fn(async () => null))
    expect(await createTauriRuntime(webView).windows.getFrame("main")).toBeNull()
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it("degrades to a no-op subscription when the event API is missing", async () => {
    const runtime = createTauriRuntime({ __TAURI__: { core: { invoke: vi.fn() } } })
    const unsubscribe = await runtime.windows.subscribeFrameChanges(() => {})
    expect(() => unsubscribe()).not.toThrow()
  })
})
