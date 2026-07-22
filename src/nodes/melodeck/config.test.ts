import { beforeEach, describe, expect, it, vi } from "vitest"

const backend = vi.hoisted(() => ({
  getAppConfigFromBackend: vi.fn(),
  getNodeConfigFromBackend: vi.fn(),
  saveAppConfigToBackend: vi.fn(),
  saveNodeConfigToBackend: vi.fn(),
}))

vi.mock("@/backend/configRpcClient", () => backend)

import { loadMelodeckConfig, MELODECK_CONFIG_CHANGED_EVENT, saveMelodeckConfig } from "./config"

describe("Melodeck config migration", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    backend.getNodeConfigFromBackend.mockResolvedValue({ config: undefined, path: "config.toml" })
    backend.getAppConfigFromBackend.mockResolvedValue({ config: {}, path: "config.toml" })
    backend.saveAppConfigToBackend.mockResolvedValue(undefined)
    backend.saveNodeConfigToBackend.mockResolvedValue(undefined)
  })

  it("moves the legacy AppUI music dock into nodes.melodeck", async () => {
    backend.getAppConfigFromBackend.mockResolvedValue({
      config: {
        workspace: { theme: "spatial" },
        musicDock: {
          sourcePath: "D:/Music",
          savedTracks: [{ name: "Track", path: "D:/Music/track.flac" }],
          mode: "floating",
          floatingOffset: { x: -12, y: -8 },
        },
      },
      path: "config.toml",
    })

    const config = await loadMelodeckConfig()

    expect(config).toMatchObject({
      source_path: "D:/Music",
      saved_tracks: [{ name: "Track", path: "D:/Music/track.flac" }],
      mode: "floating",
      floating_offset: { x: -12, y: -8 },
    })
    expect(backend.saveNodeConfigToBackend).toHaveBeenCalledWith("melodeck", expect.objectContaining({ source_path: "D:/Music" }))
    expect(backend.saveAppConfigToBackend).toHaveBeenCalledWith("ui", { workspace: { theme: "spatial" } })
  })

  it("uses node config first and migrates remaining legacy localStorage fields", async () => {
    backend.getNodeConfigFromBackend.mockResolvedValue({
      config: { source_path: "D:/Canonical", volume: 65 },
      path: "config.toml",
    })
    window.localStorage.setItem("xiranite.musicDock.sourcePath", "D:/Legacy")
    window.localStorage.setItem("xiranite.musicDock.visualizerStyle", "Grid")

    const config = await loadMelodeckConfig()

    expect(config.source_path).toBe("D:/Canonical")
    expect(config.visualizer_style).toBe("Grid")
    expect(config.volume).toBe(65)
    expect(window.localStorage.getItem("xiranite.musicDock.sourcePath")).toBeNull()
    expect(window.localStorage.getItem("xiranite.musicDock.visualizerStyle")).toBeNull()
  })

  it("broadcasts direct config saves so other Melodeck surfaces refresh", async () => {
    const listener = vi.fn()
    window.addEventListener(MELODECK_CONFIG_CHANGED_EVENT, listener)

    await saveMelodeckConfig({ mode: "floating" })

    expect(backend.saveNodeConfigToBackend).toHaveBeenCalledWith("melodeck", { mode: "floating" })
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener(MELODECK_CONFIG_CHANGED_EVENT, listener)
  })

  it("supports silent provider persistence without refreshing itself", async () => {
    const listener = vi.fn()
    window.addEventListener(MELODECK_CONFIG_CHANGED_EVENT, listener)

    await saveMelodeckConfig({ mode: "bottom" }, { broadcast: false })

    expect(backend.saveNodeConfigToBackend).toHaveBeenCalledWith("melodeck", { mode: "bottom" })
    expect(listener).not.toHaveBeenCalled()
    window.removeEventListener(MELODECK_CONFIG_CHANGED_EVENT, listener)
  })
})
