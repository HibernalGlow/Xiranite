import { beforeEach, describe, expect, it, vi } from "vitest"

const backend = vi.hoisted(() => ({
  getAppConfigFromBackend: vi.fn(),
  getNodeConfigFromBackend: vi.fn(),
  saveAppConfigToBackend: vi.fn(),
  saveNodeConfigToBackend: vi.fn(),
}))

vi.mock("@/backend/configRpcClient", () => backend)

import { DEFAULT_MELODECK_CONFIG, loadMelodeckConfig, MELODECK_CONFIG_CHANGED_EVENT, saveMelodeckConfig } from "./config"

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
    expect(config).toMatchObject({
      config_version: 1,
      player_engine: "folia",
      playback: { volume: 0.65 },
      library: { roots: ["D:/Canonical"] },
    })
    expect(config.visualizer_style).toBe("Grid")
    expect(config.volume).toBe(65)
    expect(window.localStorage.getItem("xiranite.musicDock.sourcePath")).toBeNull()
    expect(window.localStorage.getItem("xiranite.musicDock.visualizerStyle")).toBeNull()
  })

  it("removes legacy audio files from library roots and persists the repaired config", async () => {
    backend.getNodeConfigFromBackend.mockResolvedValue({
      config: {
        config_version: 1,
        source_path: "E:/Music/current.flac",
        library: { roots: ["E:/Music/current.flac", "E:/Music", "E:/Music/Albums"] },
      },
      path: "config.toml",
    })

    const config = await loadMelodeckConfig()

    expect(config.library?.roots).toEqual(["E:/Music", "E:/Music/Albums"])
    expect(backend.saveNodeConfigToBackend).toHaveBeenCalledWith("melodeck", expect.objectContaining({
      library: { roots: ["E:/Music", "E:/Music/Albums"] },
    }))
  })

  it("does not migrate a legacy single-track source into library roots", async () => {
    backend.getNodeConfigFromBackend.mockResolvedValue({
      config: { source_path: "E:/Music/current.flac" },
      path: "config.toml",
    })

    const config = await loadMelodeckConfig()

    expect(config.library?.roots).toEqual([])
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

  it("preserves the legacy engine escape hatch in the versioned config", async () => {
    backend.getNodeConfigFromBackend.mockResolvedValue({
      config: {
        player_engine: "legacy",
        playback: { volume: 0.4, loop_mode: "random", active_track_id: "D:/Music/last.flac" },
        library: { roots: ["D:/Music", "E:/Music"] },
      },
      path: "config.toml",
    })

    const config = await loadMelodeckConfig()

    expect(config.player_engine).toBe("legacy")
    expect(config.playback?.volume).toBe(0.4)
    expect(config.playback?.loop_mode).toBe("random")
    expect(config.playback?.active_track_id).toBe("D:/Music/last.flac")
    expect(config.library?.roots).toEqual(["D:/Music", "E:/Music"])
  })

  it("defaults fullscreen floating follow to off and preserves an explicit opt-in", async () => {
    expect(DEFAULT_MELODECK_CONFIG.surfaces.follow_fullscreen_with_floating).toBe(false)
    backend.getNodeConfigFromBackend.mockResolvedValue({
      config: { surfaces: { follow_fullscreen_with_floating: true } },
      path: "config.toml",
    })

    const config = await loadMelodeckConfig()

    expect(config.surfaces?.follow_fullscreen_with_floating).toBe(true)
  })
})
