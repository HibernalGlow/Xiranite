import { describe, expect, it, vi } from "vitest"
import { chooseConverter, createFfmpegArgs, createVertPlans, deriveOutputPath, detectVertCategory, runVert, VERT_FORMAT_GROUPS, VERT_INPUT_FORMAT_GROUPS, withFfmpegCoverArt } from "./core.js"

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
    expect(createVertPlans({ paths: ["/tmp/book.epub"], targetFormat: "docx" }, capabilities)[0]?.args).toContain("--extract-media=.")
    expect(createFfmpegArgs("/tmp/movie.mp4", "/tmp/audio.opus")).toEqual(expect.arrayContaining(["-map", "0:a:0", "-vn", "-c:a", "libopus", "-ar", "48000"]))
    expect(createFfmpegArgs("/tmp/audio.flac", "/tmp/video.mp4")).toEqual(expect.arrayContaining(["-f", "lavfi", "color=c=black:s=512x512:rate=1", "-shortest", "-c:v", "libx264"]))
  })
  it("keeps VERT input-only formats out of target selectors", () => {
    expect(VERT_INPUT_FORMAT_GROUPS.image).toEqual(expect.arrayContaining(["ani", "icns", "heic", "cr3", "jfif", "fit"]))
    expect(VERT_FORMAT_GROUPS.image).not.toEqual(expect.arrayContaining(["ani", "icns", "heic", "cr3"]))
    expect(VERT_INPUT_FORMAT_GROUPS.audio).toEqual(expect.arrayContaining(["mogg", "caf", "dsf"]))
    expect(VERT_FORMAT_GROUPS.audio).not.toEqual(expect.arrayContaining(["mogg", "caf", "dsf"]))
  })
  it("writes ALAC into an m4a container and preserves optional cover art", () => {
    const [plan] = createVertPlans({ paths: ["/tmp/album.flac"], targetFormat: "alac" }, capabilities)
    expect(plan.outputPath).toBe("/tmp/album.m4a")
    expect(plan.args).toEqual(expect.arrayContaining(["-map", "0:v?", "-c:v", "copy", "-c:a", "alac", "/tmp/album.m4a"]))
  })
  it("replaces the generated black background with extracted album art", () => {
    const black = createFfmpegArgs("/tmp/audio.flac", "/tmp/video.mp4")
    const covered = withFfmpegCoverArt(black, "/tmp/cover.jpg")
    expect(covered).toEqual(expect.arrayContaining(["-loop", "1", "-i", "/tmp/cover.jpg", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2"]))
    expect(covered).not.toContain("color=c=black:s=512x512:rate=1")
  })
  it("prefers native commands in auto mode", async () => {
    const runCommand = vi.fn(async () => ({ code: 0, stdout: "", stderr: "", durationMs: 2 }))
    const result = await runVert({ action: "convert", paths: ["/tmp/a.png"], targetFormat: "webp", engine: "auto" }, { discoverCommands: async () => capabilities, runCommand, pathExists: async () => true })
    expect(result.success).toBe(true)
    expect(result.data.engineUsed).toBe("cli")
    expect(runCommand).toHaveBeenCalledOnce()
  })
  it("deletes a source only after a successful CLI conversion when explicitly enabled", async () => {
    const removeFile = vi.fn(async () => undefined)
    const result = await runVert({ action: "convert", paths: ["/tmp/a.png"], targetFormat: "webp", engine: "auto", deleteSourceAfterSuccess: true }, { discoverCommands: async () => capabilities, runCommand: async () => ({ code: 0, stdout: "", stderr: "", durationMs: 2 }), pathExists: async () => true, removeFile })
    expect(result.success).toBe(true)
    expect(removeFile).toHaveBeenCalledWith("/tmp/a.png")
  })
  it("keeps a source when conversion fails even if deletion is enabled", async () => {
    const removeFile = vi.fn(async () => undefined)
    const result = await runVert({ action: "convert", paths: ["/tmp/a.png"], targetFormat: "webp", engine: "auto", deleteSourceAfterSuccess: true }, { discoverCommands: async () => capabilities, runCommand: async () => ({ code: 1, stdout: "", stderr: "failed", durationMs: 2 }), pathExists: async () => true, removeFile })
    expect(result.success).toBe(false)
    expect(removeFile).not.toHaveBeenCalled()
  })
  it("signals the GUI Wasm fallback when a command is missing", async () => {
    const result = await runVert({ action: "convert", paths: ["/tmp/a.png"], targetFormat: "webp", engine: "auto" }, { discoverCommands: async () => ({ wasm: true }), runCommand: vi.fn(), pathExists: async () => true })
    expect(result.data.wasmFallbackRequired).toBe(true)
    expect(result.data.engineUsed).toBe("wasm")
  })
})
