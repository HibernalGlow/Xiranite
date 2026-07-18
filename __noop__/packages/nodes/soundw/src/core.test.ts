import { describe, expect, it, vi } from "vitest"
import { runSoundw, type SoundwRuntime } from "./core.js"

function runtime(): SoundwRuntime {
  return {
    resolve: vi.fn(async () => ({ found: true, path: "SoundSwitch.CLI.exe" })),
    run: vi.fn(async () => ({ code: 0, stdout: "ok", stderr: "" })),
  }
}

describe("runSoundw", () => {
  it("uses SoundSwitch's recording switch command", async () => {
    const host = runtime()

    const result = await runSoundw({ action: "switch-recording" }, host)

    expect(result.success).toBe(true)
    expect(host.run).toHaveBeenCalledWith("SoundSwitch.CLI.exe", ["switch", "--type", "Recording"])
  })

  it("uses the documented mute toggle command", async () => {
    const host = runtime()

    await runSoundw({ action: "toggle-mute" }, host)

    expect(host.run).toHaveBeenCalledWith("SoundSwitch.CLI.exe", ["mute", "--toggle"])
  })

  it("rejects an empty profile name before invoking SoundSwitch", async () => {
    const host = runtime()

    const result = await runSoundw({ action: "profile", profileName: " " }, host)

    expect(result.success).toBe(false)
    expect(host.run).not.toHaveBeenCalled()
  })

  it("explains when the CLI cannot reach the SoundSwitch background app", async () => {
    const host = runtime()
    vi.mocked(host.run).mockResolvedValue({ code: 1, stdout: "Managing microphone state...", stderr: "Error: The operation has timed out." })

    const result = await runSoundw({ action: "status" }, host)

    expect(result.success).toBe(false)
    expect(result.message).toContain("background app")
  })

  it("extracts profile names from SoundSwitch's table instead of showing its progress output", async () => {
    const host = runtime()
    vi.mocked(host.run).mockResolvedValue({ code: 0, stdout: "╭─────╮\n│ Profile │ Playback │\n├─────┤\n│ womic │ Not set  │\n╰─────╯\nFetching profiles...", stderr: "" })
    const result = await runSoundw({ action: "profiles" }, host)
    expect(result.data.profiles).toEqual(["womic"])
    expect(result.data.output).toBe("Profiles: womic")
  })
})
