import { spawnSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createFfmpegThumbnailCommand, FfmpegVideoThumbnailProvider, runFluentFfmpegThumbnail } from "./FfmpegVideoThumbnailProvider.js"

const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1])
const ffmpegAvailable = spawnSync("ffmpeg", ["-hide_banner", "-version"], { windowsHide: true }).status === 0

describe("FfmpegVideoThumbnailProvider", () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    })))
  })

  it("[neoview.thumbnail.video.scheduler] uses a process slot plus the host CPU lease and emits a fixed WebP command", async () => {
    const processRelease = vi.fn()
    const resourceRelease = vi.fn()
    const processAcquire = vi.fn(async () => ({ release: processRelease }))
    const resourceAcquire = vi.fn(async () => ({ release: resourceRelease }))
    const runThumbnail = vi.fn(async () => WEBP)
    const provider = new FfmpegVideoThumbnailProvider({
      executablePath: "D:/tools/ffmpeg.exe",
      processScheduler: { acquire: processAcquire },
      resourceScheduler: { acquire: resourceAcquire },
      runThumbnail,
    })
    await expect(provider.generate({
      sourcePath: "D:/private/video.mp4",
      maxEdge: 416,
      quality: 82,
      priority: "view",
      ownerId: "library:videos",
    })).resolves.toEqual({ bytes: WEBP, contentType: "image/webp" })
    expect(processAcquire).toHaveBeenCalledWith(expect.objectContaining({ kind: "neoview.thumbnail.video-process", priority: "view" }), undefined)
    expect(resourceAcquire).toHaveBeenCalledWith(expect.objectContaining({ kind: "neoview.thumbnail.video-ffmpeg", priority: "view" }), undefined)
    expect(runThumbnail).toHaveBeenCalledWith(expect.objectContaining({ sourcePath: "D:/private/video.mp4", maxEdge: 416, quality: 82 }), expect.objectContaining({
      executablePath: "D:/tools/ffmpeg.exe",
      maxOutputBytes: 2 * 1024 * 1024,
    }))
    const args = createFfmpegThumbnailCommand({ sourcePath: "D:/private/video.mp4", maxEdge: 416, quality: 82 }, "D:/tools/ffmpeg.exe")._getArguments()
    expect(args).toEqual(expect.arrayContaining([
      "-nostdin", "-i", "D:/private/video.mp4", "-map", "0:v:0",
      "-filter:v", "thumbnail=30,scale=416:416:force_original_aspect_ratio=decrease:force_divisible_by=2",
      "-c:v", "libwebp", "-f", "image2pipe",
    ]))
    expect(processAcquire.mock.invocationCallOrder[0]).toBeLessThan(resourceAcquire.mock.invocationCallOrder[0]!)
    expect(resourceRelease).toHaveBeenCalledOnce()
    expect(processRelease).toHaveBeenCalledOnce()
  })

  it("[neoview.thumbnail.video.cancellation] kills an active child process when its demand is aborted", async () => {
    const abort = new AbortController()
    const processRelease = vi.fn()
    const runThumbnail = vi.fn((_request, options: { signal?: AbortSignal }) => new Promise<Uint8Array>((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true })
    }))
    const provider = new FfmpegVideoThumbnailProvider({
      processScheduler: { acquire: async () => ({ release: processRelease }) },
      runThumbnail: runThumbnail as typeof runFluentFfmpegThumbnail,
    })
    const running = provider.generate({ sourcePath: "D:/video.mp4", maxEdge: 320, quality: 78, priority: "interactive" }, abort.signal)
    await vi.waitFor(() => expect(runThumbnail).toHaveBeenCalledOnce())
    abort.abort(new DOMException("superseded", "AbortError"))
    await expect(running).rejects.toMatchObject({ name: "AbortError" })
    expect(processRelease).toHaveBeenCalledOnce()
  })

  it.skipIf(!ffmpegAvailable)("[neoview.thumbnail.video.ffmpeg-e2e] extracts a real representative frame without a temporary image", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-video-thumbnail-"))
    roots.push(root)
    const videoPath = join(root, "sample.mp4")
    const generated = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=15", "-t", "1",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath,
    ], { windowsHide: true })
    expect(generated.status).toBe(0)
    const result = await new FfmpegVideoThumbnailProvider().generate({
      sourcePath: videoPath,
      maxEdge: 128,
      quality: 80,
      priority: "view",
    })
    expect(result.bytes.subarray(0, 4)).toEqual(Uint8Array.from([0x52, 0x49, 0x46, 0x46]))
    expect(new TextDecoder().decode(result.bytes.subarray(8, 12))).toBe("WEBP")
    expect(result.bytes.byteLength).toBeLessThan(256 * 1024)
    await expect(runFluentFfmpegThumbnail({
      sourcePath: videoPath,
      maxEdge: 128,
      quality: 80,
      priority: "view",
    }, { executablePath: "ffmpeg", maxOutputBytes: 32 })).rejects.toThrow("exceeded 32 bytes")
  })
})
