import { describe, expect, test } from "vitest"

import { createAudiovPlan, deriveAudioOutputPath, runAudiov, type AudiovRuntime } from "./core.js"

const runtime: AudiovRuntime = {
  findFfmpeg: async () => "C:/tools/ffmpeg.exe",
  runCommand: async () => ({ code: 0, stdout: "done", stderr: "", durationMs: 12 }),
}

describe("native AudioV core", () => {
  test("builds a fixed AAC/M4A ffmpeg plan without arbitrary user arguments", () => {
    const [plan] = createAudiovPlan(["D:/Video/clip.mkv"])
    expect(plan).toMatchObject({
      command: "ffmpeg",
      inputPath: "D:/Video/clip.mkv",
      outputPath: "D:/Video/clip.audio.m4a",
    })
    expect(plan?.args).toEqual(["-n", "-i", "D:/Video/clip.mkv", "-map", "0:a:0", "-vn", "-c:a", "aac", "-b:a", "192k", "D:/Video/clip.audio.m4a"])
    expect(deriveAudioOutputPath("clip")).toBe("clip.audio.m4a")
  })

  test("keeps run in plan-only mode while dry run is enabled", async () => {
    const result = await runAudiov({ action: "run", paths: ["D:/Video/clip.mp4"], dryRun: true }, runtime)
    expect(result.success).toBe(true)
    expect(result.data?.commandResults).toEqual([])
    expect(result.message).toContain("no files were written")
  })

  test("executes every command when live execution is confirmed", async () => {
    const result = await runAudiov({ action: "run", paths: ["D:/Video/a.mp4", "D:/Video/b.mp4"], dryRun: false }, runtime)
    expect(result.success).toBe(true)
    expect(result.data?.commandResults).toHaveLength(2)
    expect(result.data?.outputPaths).toEqual(["D:/Video/a.audio.m4a", "D:/Video/b.audio.m4a"])
  })
})
