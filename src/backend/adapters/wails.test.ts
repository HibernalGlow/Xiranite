import { beforeEach, describe, expect, it, vi } from "vitest"

const runtime = vi.hoisted(() => ({
  isFullscreen: false,
  IsFullscreen: vi.fn(async () => runtime.isFullscreen),
  ToggleFullscreen: vi.fn(async () => {
    runtime.isFullscreen = !runtime.isFullscreen
  }),
  ToggleMaximise: vi.fn(async () => undefined),
  callByName: vi.fn(),
  eventsOn: vi.fn(() => vi.fn()),
}))

vi.mock("@wailsio/runtime", () => ({
  Call: { ByName: runtime.callByName },
  Events: { On: runtime.eventsOn },
  Window: runtime,
}))

import { createWailsRuntime } from "./wails"

describe("Wails window runtime", () => {
  beforeEach(() => {
    runtime.isFullscreen = false
    vi.clearAllMocks()
  })

  it("toggles native fullscreen independently from maximise", async () => {
    const windows = createWailsRuntime().windows

    await expect(windows.controlMain("toggle-fullscreen")).resolves.toMatchObject({
      success: true,
      state: "fullscreen",
    })
    await expect(windows.controlMain("toggle-fullscreen")).resolves.toMatchObject({
      success: true,
      state: "normal",
    })

    expect(runtime.ToggleFullscreen).toHaveBeenCalledTimes(2)
    expect(runtime.IsFullscreen).toHaveBeenCalledTimes(2)
    expect(runtime.ToggleMaximise).not.toHaveBeenCalled()
  })

  it("delegates minimize and close to the desktop host tray policy", async () => {
    runtime.callByName
      .mockResolvedValueOnce({ success: true, supported: true, state: "minimized" })
      .mockResolvedValueOnce({ success: true, supported: true, state: "closed" })

    const windows = createWailsRuntime().windows

    await expect(windows.controlMain("minimize")).resolves.toMatchObject({ state: "minimized" })
    await expect(windows.controlMain("close")).resolves.toMatchObject({ state: "closed" })

    expect(runtime.callByName).toHaveBeenNthCalledWith(1, "main.XiraniteService.WindowControlMain", "minimize")
    expect(runtime.callByName).toHaveBeenNthCalledWith(2, "main.XiraniteService.WindowControlMain", "close")
  })

  it("targets component window controls without invoking the main window policy", async () => {
    runtime.callByName
      .mockResolvedValueOnce({ success: true, supported: true, id: "component-1", state: "minimized" })
      .mockResolvedValueOnce({ success: true, supported: true, id: "component-1", state: "closed" })

    const windows = createWailsRuntime().windows

    await expect(windows.controlComponent("component-1", "minimize")).resolves.toMatchObject({ state: "minimized" })
    await expect(windows.controlComponent("component-1", "close")).resolves.toMatchObject({ state: "closed" })

    expect(runtime.callByName).toHaveBeenNthCalledWith(1, "main.XiraniteService.WindowControl", "component-1", "minimize")
    expect(runtime.callByName).toHaveBeenNthCalledWith(2, "main.XiraniteService.WindowControl", "component-1", "close")
  })

  it("opens developer tools through the compiled host service", async () => {
    runtime.callByName.mockResolvedValueOnce({ success: true, supported: true, message: "Developer tools opened." })

    await expect(createWailsRuntime().windows.openDevTools()).resolves.toMatchObject({ success: true })

    expect(runtime.callByName).toHaveBeenCalledWith("main.XiraniteService.WindowOpenDevTools", "")
  })

  it("adapts the generic tray runtime to Wails calls and events", async () => {
    runtime.callByName.mockResolvedValueOnce({
      supported: true,
      mainTray: true,
      standaloneTrays: true,
    })
    const trays = createWailsRuntime().trays

    await expect(trays.getCapabilities()).resolves.toMatchObject({ supported: true })
    await trays.setMainEnabled(false)
    await trays.sync([{ id: "xiranite.main", kind: "main", tooltip: "Xiranite", items: [] }])

    expect(runtime.callByName).toHaveBeenNthCalledWith(1, "main.XiraniteService.TrayCapabilities")
    expect(runtime.callByName).toHaveBeenNthCalledWith(2, "main.XiraniteService.TraySetMainEnabled", false)
    expect(runtime.callByName).toHaveBeenNthCalledWith(
      3,
      "main.XiraniteService.TraySync",
      JSON.stringify([{
        id: "xiranite.main",
        kind: "main",
        tooltip: "Xiranite",
        items: [],
      }]),
    )

    const handler = vi.fn()
    await trays.subscribe(handler)
    const eventHandler = runtime.eventsOn.mock.calls[0]?.[1] as ((event: unknown) => void) | undefined
    eventHandler?.({ data: { trayId: "xiranite.main", itemId: "node.music.play" } })
    expect(handler).toHaveBeenCalledWith({ trayId: "xiranite.main", itemId: "node.music.play" })
  })
})
