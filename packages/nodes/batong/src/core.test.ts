import { describe, expect, it, vi } from "vitest"
import { createBatongCommand, runBatong } from "./core.js"

describe("BATONG core", () => {
  it("creates the documented Baton conversion command", () => {
    expect(createBatongCommand({ action: "convert", from: "codex", to: "claude", latest: true, import: true })).toEqual({
      command: "baton",
      action: "convert",
      args: ["convert", "--from", "codex", "--to", "claude", "--latest", "--import"],
    })
  })

  it("preserves extra Baton flags for forward compatibility", () => {
    expect(createBatongCommand({ action: "doctor", extraArgs: ["--verbose", ""] }).args).toEqual(["doctor", "--verbose"])
  })

  it("requires both agent formats when converting", async () => {
    const result = await runBatong({ action: "convert", from: "codex" }, { findCommand: vi.fn(), runCommand: vi.fn() })
    expect(result.success).toBe(false)
    expect(result.message).toContain("--from and --to")
  })

  it("reports a missing Baton installation without invoking a command", async () => {
    const runCommand = vi.fn()
    const result = await runBatong({ action: "list" }, { findCommand: async () => undefined, runCommand })
    expect(result.success).toBe(false)
    expect(result.message).toContain("not installed")
    expect(runCommand).not.toHaveBeenCalled()
  })

  it("runs the detected Baton executable and captures its output", async () => {
    const result = await runBatong({ action: "list" }, {
      findCommand: async () => "C:/tools/baton.exe",
      runCommand: async (plan) => ({ code: 0, stdout: `ran ${plan.args.join(" ")}`, stderr: "", durationMs: 5 }),
    })
    expect(result.success).toBe(true)
    expect(result.data.command.command).toBe("C:/tools/baton.exe")
    expect(result.data.output).toBe("ran list")
  })
})
