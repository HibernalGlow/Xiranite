import { describe, expect, it, vi } from "vitest"
import { chooseConverter, createVertPlans, deriveOutputPath, detectVertCategory, runVert } from "./core.js"

// @xiranite-real-run vert

const capabilities = { wasm: true as const, ffmpeg: "C:/bin/ffmpeg.exe", magick: "C:/bin/magick.exe", pandoc: "C:/bin/pandoc.exe" }
describe("VERT core", () => {
  it("routes format families to their native converters", () => {
    expect(chooseConverter("photo.png", "webp")).toBe("magick")
    expect(chooseConverter("clip.mov", "mp3")).toBe("ffmpeg")
    expect(chooseConverter("notes.md", "docx")).toBe("pandoc")
    expect(detectVertCategory("clip.mov")).toBe("video")
    expect(detectVertCategory("voice.flac")).toBe("audio")
  })
  it("builds safe argument arrays and output paths", () => {
    const [plan] = createVertPlans({ paths: ["D:\\in box\\photo.png"], targetFormat: ".webp", quality: 82 }, capabilities)
    expect(plan.command).toContain("magick")
    expect(plan.args).toEqual(["D:\\in box\\photo.png", "-quality", "82", "D:\\in box\\photo.webp"])
    expect(deriveOutputPath("/tmp/a.mov", "mp3", "/out")).toBe("/out/a.mp3")
  })
  it("prefers native commands in auto mode", async () => {
    const runCommand = vi.fn(async () => ({ code: 0, stdout: "", stderr: "", durationMs: 2 }))
    const result = await runVert({ action: "convert", paths: ["/tmp/a.png"], targetFormat: "webp", engine: "auto" }, { discoverCommands: async () => capabilities, runCommand, pathExists: async () => true })
    expect(result.success).toBe(true)
    expect(result.data.engineUsed).toBe("cli")
    expect(runCommand).toHaveBeenCalledOnce()
  })
  it("signals the GUI Wasm fallback when a command is missing", async () => {
    const result = await runVert({ action: "convert", paths: ["/tmp/a.png"], targetFormat: "webp", engine: "auto" }, { discoverCommands: async () => ({ wasm: true }), runCommand: vi.fn(), pathExists: async () => true })
    expect(result.data.wasmFallbackRequired).toBe(true)
    expect(result.data.engineUsed).toBe("wasm")
  })
})
