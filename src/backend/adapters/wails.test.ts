import { beforeEach, describe, expect, it, vi } from "vitest"

const runtime = vi.hoisted(() => ({
  isFullscreen: false,
  IsFullscreen: vi.fn(async () => runtime.isFullscreen),
  ToggleFullscreen: vi.fn(async () => {
    runtime.isFullscreen = !runtime.isFullscreen
  }),
  ToggleMaximise: vi.fn(async () => undefined),
}))

vi.mock("@wailsio/runtime", () => ({
  Call: { ByName: vi.fn() },
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
})
