import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { describe, expect, it, vi } from "vitest"

import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"
import { FfmpegVideoThumbnailProvider } from "./FfmpegVideoThumbnailProvider.js"
import {
  FfprobePageMediaMetadataProvider,
  parseFfprobeMediaDetails,
  runFfprobeMediaProbe,
} from "./FfprobePageMediaMetadataProvider.js"

describe("FfprobePageMediaMetadataProvider", () => {
  it("[neoview.image-information.ffprobe-normalize] normalizes supported fields and omits unknown values", () => {
    expect(parseFfprobeMediaDetails({
      format: { duration: "12.500000", bit_rate: "2000001" },
      streams: [
        { codec_type: "video", codec_name: "h264", avg_frame_rate: "30000/1001", bit_rate: "100" },
        { codec_type: "audio", codec_name: "aac" },
      ],
    })).toEqual({
      durationSeconds: 12.5,
      frameRate: 30000 / 1001,
      bitRateBps: 2_000_001,
      videoCodec: "h264",
      audioCodec: "aac",
    })
    expect(parseFfprobeMediaDetails({
      format: { duration: "N/A", bit_rate: 0 },
      streams: [{ codec_type: "video", codec_name: "unknown", avg_frame_rate: "0/0" }],
    })).toEqual({})
  })

  it("[neoview.image-information.ffprobe-scheduler] uses one process lease and the host CPU scheduler", async () => {
    const processLease = { release: vi.fn() }
    const resourceLease = { release: vi.fn() }
    const processAcquire = vi.fn(async () => processLease)
    const resourceAcquire = vi.fn(async () => resourceLease)
    const runProbe = vi.fn(async () => ({
      format: { duration: 5 },
      streams: [{ codec_type: "video", codec_name: "vp9", r_frame_rate: "24/1" }],
    }))
    const provider = new FfprobePageMediaMetadataProvider({
      executablePath: "D:/tools/ffprobe.exe",
      processScheduler: scheduler(processAcquire),
      resourceScheduler: scheduler(resourceAcquire),
      runProbe,
    })
    await expect(provider.inspect({
      sourcePath: "D:/media/clip.webm",
      priority: "view",
      ownerId: "reader:media-information:page-1",
    })).resolves.toEqual({ durationSeconds: 5, frameRate: 24, videoCodec: "vp9" })
    expect(processAcquire).toHaveBeenCalledWith(expect.objectContaining({
      resource: "cpu",
      kind: "neoview.metadata.video-process",
      priority: "view",
    }), undefined)
    expect(resourceAcquire).toHaveBeenCalledWith(expect.objectContaining({
      kind: "neoview.metadata.video-ffprobe",
    }), undefined)
    expect(runProbe).toHaveBeenCalledWith(expect.objectContaining({ sourcePath: "D:/media/clip.webm" }), {
      executablePath: "D:/tools/ffprobe.exe",
      signal: undefined,
    })
    expect(processLease.release).toHaveBeenCalledOnce()
    expect(resourceLease.release).toHaveBeenCalledOnce()
  })

  it("[neoview.image-information.video-process-budget] shares one process slot with video thumbnail extraction", async () => {
    const thumbnailStarted = Promise.withResolvers<void>()
    const releaseThumbnail = Promise.withResolvers<Uint8Array>()
    const runThumbnail = vi.fn(async () => {
      thumbnailStarted.resolve()
      return releaseThumbnail.promise
    })
    const runProbe = vi.fn(async () => ({ format: { duration: 2 }, streams: [] }))
    const thumbnailProvider = new FfmpegVideoThumbnailProvider({ runThumbnail })
    const metadataProvider = new FfprobePageMediaMetadataProvider({ runProbe })
    const thumbnail = thumbnailProvider.generate({
      sourcePath: "D:/media/clip.mp4",
      maxEdge: 320,
      quality: 80,
      priority: "view",
    })
    await thumbnailStarted.promise
    const metadata = metadataProvider.inspect({ sourcePath: "D:/media/clip.mp4", priority: "view" })
    await Promise.resolve()
    expect(runProbe).not.toHaveBeenCalled()
    releaseThumbnail.resolve(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))
    await thumbnail
    await expect(metadata).resolves.toEqual({ durationSeconds: 2 })
    expect(runProbe).toHaveBeenCalledOnce()
  })

  it("[neoview.image-information.ffprobe-stream] pipes an archive stream to ffprobe stdin", async () => {
    const child = fakeChild()
    const stdinBytes: number[] = []
    child.stdin.on("data", (chunk: Buffer) => stdinBytes.push(...chunk))
    child.stdin.once("end", () => {
      child.stdout.end(JSON.stringify({ format: { duration: 1 }, streams: [] }))
      child.stderr.end()
      queueMicrotask(() => child.emit("close", 0, null))
    })
    const result = await runFfprobeMediaProbe({
      sourceStream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Uint8Array.of(1, 2, 3))
          controller.close()
        },
      }),
    }, {
      executablePath: "ffprobe",
      spawnProcess: vi.fn(() => child),
    })
    expect(stdinBytes).toEqual([1, 2, 3])
    expect(result).toEqual({ format: { duration: 1 }, streams: [] })
  })

  it("[neoview.image-information.ffprobe-abort] kills an active process on abort", async () => {
    const child = fakeChild()
    const streamCancelled = vi.fn()
    const sourceStream = new ReadableStream<Uint8Array>({ cancel: streamCancelled })
    child.kill = vi.fn((signal?: NodeJS.Signals | number) => {
      child.stdout.end()
      child.stderr.end()
      queueMicrotask(() => child.emit("close", null, signal === "SIGKILL" ? "SIGKILL" : null))
      return true
    })
    const controller = new AbortController()
    const reason = new DOMException("Card collapsed", "AbortError")
    const pending = runFfprobeMediaProbe({ sourceStream }, {
      executablePath: "ffprobe",
      signal: controller.signal,
      spawnProcess: vi.fn(() => child),
    })
    controller.abort(reason)
    await expect(pending).rejects.toBe(reason)
    expect(child.kill).toHaveBeenCalledWith("SIGKILL")
    await vi.waitFor(() => expect(streamCancelled).toHaveBeenCalledOnce())
  })
})

function scheduler(acquire: ResourceScheduler["acquire"]): ResourceScheduler {
  return { acquire }
}

function fakeChild(): ChildProcessWithoutNullStreams {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams
  Object.assign(child, {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdio: [],
    pid: 123,
    connected: false,
    exitCode: null,
    signalCode: null,
    killed: false,
    kill: vi.fn(() => true),
  })
  return child
}
