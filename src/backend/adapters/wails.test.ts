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
