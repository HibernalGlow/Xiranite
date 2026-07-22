import { describe, expect, it, vi } from "vitest"
import { buildMelodeckCommand, normalizeMelodeckPaths, runMelodeck, type MelodeckRuntime } from "./core.js"
import { resolveMelodeckPaths } from "./cli.js"

function runtime(): MelodeckRuntime { return { resolve: vi.fn(async () => ({ found: true, path: "mpv" })), launch: vi.fn(async () => {}), command: vi.fn(async () => ({ error: "success" })) } }

describe("Melodeck core", () => {
  it("normalizes paths and builds a safe mpv launch command", () => {
    expect(normalizeMelodeckPaths([" 'D:/Music/a.flac' ", "", "b.mp3"])).toEqual(["D:/Music/a.flac", "b.mp3"])
    expect(buildMelodeckCommand("play", ["a.flac"], 130)).toEqual(["--no-video", "--force-window=no", "--idle=yes", "--volume=100", "a.flac"])
  })
  it("launches a queue through the injected runtime", async () => {
    const host = runtime()
    const result = await runMelodeck({ action: "play", paths: ["a.flac", "b.mp3"] }, host)
    expect(result.success).toBe(true)
    expect(host.launch).toHaveBeenCalledWith("mpv", expect.arrayContaining(["a.flac", "b.mp3"]))
  })
  it("sends control commands through mpv IPC", async () => {
    const host = runtime()
    const result = await runMelodeck({ action: "next", ipcPath: "pipe" }, host)
    expect(result.success).toBe(true)
    expect(host.command).toHaveBeenCalledWith("pipe", { command: ["playlist-next", "force"] })
  })
  it("returns a controlled failure when no mpv IPC session is running", async () => {
    const host = runtime()
    vi.mocked(host.command).mockRejectedValueOnce(new Error("pipe not found"))
    const result = await runMelodeck({ action: "pause", ipcPath: "pipe" }, host)
    expect(result.success).toBe(false)
    expect(result.message).toContain("mpv IPC is unavailable")
  })
  it("reports a missing status pipe as an idle player", async () => {
    const host = runtime()
    vi.mocked(host.command).mockRejectedValueOnce(new Error("pipe not found"))
    const result = await runMelodeck({ action: "status", ipcPath: "pipe" }, host)
    expect(result.success).toBe(true)
    expect(result.message).toBe("Melodeck is not running.")
    expect(result.data?.status.running).toBe(false)
  })
  it("uses node-level Melodeck paths and only falls back to legacy AppUI fields", () => {
    expect(resolveMelodeckPaths({ saved_tracks: [{ path: "D:/Music/a.flac" }, { path: "D:/Music/a.flac" }, { path: "D:/Music/b.mp3" }], source_path: "D:/Music" })).toEqual(["D:/Music/a.flac", "D:/Music/b.mp3"])
    expect(resolveMelodeckPaths({ saved_tracks: [], source_path: "D:/Music" })).toEqual(["D:/Music"])
    expect(resolveMelodeckPaths({}, { savedTracks: [{ path: "D:/Legacy/track.mp3" }], sourcePath: "D:/Legacy" })).toEqual(["D:/Legacy/track.mp3"])
  })
})
