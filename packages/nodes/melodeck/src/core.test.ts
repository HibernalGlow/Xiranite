import { describe, expect, it, vi } from "vitest"
import { buildMelodeckCommand, normalizeMelodeckPaths, runMelodeck, type MelodeckRuntime } from "./core.js"

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
})
