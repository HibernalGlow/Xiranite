import { describe, expect, it, vi } from "vitest"
import { buildMelodeckCommand, normalizeMelodeckPaths, runMelodeck, type MelodeckRuntime } from "./core.js"
import { resolveMelodeckPaths } from "./cli.js"

function runtime(initiallyRunning = true, properties: Record<string, unknown> = {}): MelodeckRuntime {
  let running = initiallyRunning
  const values = {
    pause: false,
    path: "D:/Music/a.flac",
    "media-title": "Track A",
    duration: 120,
    "time-pos": 12,
    volume: 80,
    playlist: [{ filename: "D:/Music/a.flac" }],
    ...properties,
  }
  return {
    ipcPath: "pipe",
    resolve: vi.fn(async () => ({ found: true, path: "mpv" })),
    launch: vi.fn(async () => { running = true; return { stop: vi.fn() } }),
    waitForIpc: vi.fn(async () => running),
    command: vi.fn(async (_path, request) => {
      const command = request.command as unknown[]
      if (command[0] === "get_property") {
        if (!running) throw new Error("pipe not found")
        return { error: "success", data: values[String(command[1]) as keyof typeof values] }
      }
      if (!running) throw new Error("pipe not found")
      if (command[0] === "quit") running = false
      return { error: "success" }
    }),
  }
}

describe("Melodeck core", () => {
  it("normalizes paths and builds a safe mpv launch command", () => {
    expect(normalizeMelodeckPaths([" 'D:/Music/a.flac' ", "", "b.mp3"])).toEqual(["D:/Music/a.flac", "b.mp3"])
    expect(buildMelodeckCommand("play", ["a.flac"], 130)).toEqual(["--no-terminal", "--no-video", "--force-window=no", "--idle=yes", "--volume=100", "a.flac"])
  })
  it("launches a queue through the injected runtime", async () => {
    const host = runtime(false)
    const result = await runMelodeck({ action: "play", paths: ["a.flac", "b.mp3"] }, host)
    expect(result.success).toBe(true)
    expect(host.launch).toHaveBeenCalledWith("mpv", expect.arrayContaining(["a.flac", "b.mp3"]))
  })
  it("terminates a newly spawned mpv process when IPC never becomes ready", async () => {
    const host = runtime(false)
    const process = { stop: vi.fn() }
    vi.mocked(host.launch).mockResolvedValueOnce(process)
    vi.mocked(host.waitForIpc).mockResolvedValueOnce(false)
    const result = await runMelodeck({ action: "play", paths: ["a.flac"] }, host)
    expect(result.success).toBe(false)
    expect(process.stop).toHaveBeenCalledOnce()
  })
  it("sends control commands through mpv IPC", async () => {
    const host = runtime()
    const result = await runMelodeck({ action: "next", ipcPath: "pipe" }, host)
    expect(result.success).toBe(true)
    expect(host.command).toHaveBeenCalledWith("pipe", { command: ["playlist-next", "force"] })
  })
  it("quits the idle mpv process when stopping playback", async () => {
    const host = runtime()
    const result = await runMelodeck({ action: "stop", ipcPath: "pipe" }, host)
    expect(result.success).toBe(true)
    expect(host.command).toHaveBeenCalledWith("pipe", { command: ["quit"] })
    expect(result.data?.status.running).toBe(false)
  })
  it("reads the real paused state from mpv status", async () => {
    const host = runtime(true, { pause: true })
    const result = await runMelodeck({ action: "status", ipcPath: "pipe" }, host)
    expect(result.data?.status.paused).toBe(true)
  })
  it("seeks and changes volume through mpv before refreshing state", async () => {
    const host = runtime()
    expect((await runMelodeck({ action: "seek", seekSeconds: -10, ipcPath: "pipe" }, host)).success).toBe(true)
    expect(host.command).toHaveBeenCalledWith("pipe", { command: ["seek", -10, "relative+exact"] })
    expect((await runMelodeck({ action: "volume", volume: 55, ipcPath: "pipe" }, host)).success).toBe(true)
    expect(host.command).toHaveBeenCalledWith("pipe", { command: ["set_property", "volume", 55] })
  })
  it("returns a controlled failure when no mpv IPC session is running", async () => {
    const host = runtime()
    vi.mocked(host.command).mockRejectedValueOnce(new Error("pipe not found"))
    const result = await runMelodeck({ action: "pause", ipcPath: "pipe" }, host)
    expect(result.success).toBe(false)
    expect(result.message).toContain("Melodeck is not running")
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
