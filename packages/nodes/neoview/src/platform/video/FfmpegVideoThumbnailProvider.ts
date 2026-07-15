import { PassThrough } from "node:stream"
import ffmpeg, { type FfmpegCommand } from "fluent-ffmpeg"

import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"
import type { VideoThumbnailProvider, VideoThumbnailRequest, VideoThumbnailResult } from "../../ports/VideoThumbnailProvider.js"
import { PriorityResourceScheduler } from "../scheduler/PriorityResourceScheduler.js"
import { detectImageContentType } from "../thumbnails/ThumbnailBlobCodec.js"

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024
const processSlots = new PriorityResourceScheduler({ maxConcurrent: 1, reservedInteractive: 0 })

export interface FfmpegVideoThumbnailProviderOptions {
  executablePath?: string
  resourceScheduler?: ResourceScheduler
  processScheduler?: ResourceScheduler
  runThumbnail?: typeof runFluentFfmpegThumbnail
}

export class FfmpegVideoThumbnailProvider implements VideoThumbnailProvider {
  readonly #executablePath: string
  readonly #resourceScheduler?: ResourceScheduler
  readonly #processScheduler: ResourceScheduler
  readonly #runThumbnail: typeof runFluentFfmpegThumbnail

  constructor(options: FfmpegVideoThumbnailProviderOptions = {}) {
    this.#executablePath = (options.executablePath ?? process.env.XIRANITE_FFMPEG_PATH?.trim()) || "ffmpeg"
    this.#resourceScheduler = options.resourceScheduler
    this.#processScheduler = options.processScheduler ?? processSlots
    this.#runThumbnail = options.runThumbnail ?? runFluentFfmpegThumbnail
  }

  async generate(request: VideoThumbnailRequest, signal?: AbortSignal): Promise<VideoThumbnailResult> {
    validateRequest(request)
    signal?.throwIfAborted()
    const processLease = await this.#processScheduler.acquire({
      resource: "cpu",
      kind: "neoview.thumbnail.video-process",
      priority: request.priority,
      ownerId: request.ownerId,
    }, signal)
    let resourceLease: Awaited<ReturnType<ResourceScheduler["acquire"]>> | undefined
    try {
      resourceLease = await this.#resourceScheduler?.acquire({
        resource: "cpu",
        kind: "neoview.thumbnail.video-ffmpeg",
        priority: request.priority,
        ownerId: request.ownerId,
      }, signal)
      const bytes = await this.#runThumbnail(request, {
        executablePath: this.#executablePath,
        signal,
        maxOutputBytes: MAX_OUTPUT_BYTES,
      })
      if (detectImageContentType(bytes) !== "image/webp") throw new Error("ffmpeg returned a non-WebP thumbnail.")
      return { bytes, contentType: "image/webp" }
    } finally {
      resourceLease?.release()
      processLease.release()
    }
  }
}

export interface FluentFfmpegThumbnailOptions {
  executablePath: string
  signal?: AbortSignal
  maxOutputBytes: number
}

export function createFfmpegThumbnailCommand(
  request: Pick<VideoThumbnailRequest, "sourcePath" | "maxEdge" | "quality">,
  executablePath = "ffmpeg",
): FfmpegCommand {
  const scale = `scale=${request.maxEdge}:${request.maxEdge}:force_original_aspect_ratio=decrease:force_divisible_by=2`
  return ffmpeg(request.sourcePath)
    .setFfmpegPath(executablePath)
    .inputOptions(["-nostdin"])
    .outputOptions([
      "-map 0:v:0",
      "-an", "-sn", "-dn",
      "-frames:v 1",
      "-c:v libwebp",
      `-q:v ${request.quality}`,
      "-compression_level 2",
    ])
    .videoFilters([`thumbnail=30`, scale])
    .format("image2pipe")
}

export async function runFluentFfmpegThumbnail(
  request: VideoThumbnailRequest,
  options: FluentFfmpegThumbnailOptions,
): Promise<Uint8Array> {
  options.signal?.throwIfAborted()
  const command = createFfmpegThumbnailCommand(request, options.executablePath)
  // fluent-ffmpeg treats an output stream's `close` as a failed process after
  // only 20 ms. Keep it alive through the process `exit` event under load.
  const output = new PassThrough({ autoDestroy: false })
  const onAbort = () => command.kill("SIGKILL")
  options.signal?.addEventListener("abort", onAbort, { once: true })
  try {
    const completion = new Promise<void>((resolve, reject) => {
      command.once("end", resolve)
      command.once("error", (error, _stdout, stderr) => reject(new Error(String(stderr || error.message), { cause: error })))
    })
    const bytes = readBoundedBytes(output, options.maxOutputBytes, () => command.kill("SIGKILL"))
    command.pipe(output, { end: true })
    const [result] = await Promise.all([bytes, completion])
    options.signal?.throwIfAborted()
    if (!result.byteLength) throw new Error("ffmpeg produced an empty thumbnail.")
    return result
  } finally {
    options.signal?.removeEventListener("abort", onAbort)
    output.destroy()
  }
}

async function readBoundedBytes(stream: NodeJS.ReadableStream, maxBytes: number, kill: () => void): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let bytes = 0
  for await (const chunk of stream) {
    const data = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk as Uint8Array
    bytes += data.byteLength
    if (bytes > maxBytes) {
      kill()
      throw new Error(`ffmpeg output exceeded ${maxBytes} bytes.`)
    }
    chunks.push(data)
  }
  const output = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength }
  return output
}

function validateRequest(request: VideoThumbnailRequest): void {
  if (!request.sourcePath) throw new Error("Video thumbnail sourcePath cannot be empty.")
  if (!Number.isSafeInteger(request.maxEdge) || request.maxEdge < 32 || request.maxEdge > 2_048) {
    throw new RangeError("Video thumbnail maxEdge must be an integer from 32 to 2048.")
  }
  if (!Number.isSafeInteger(request.quality) || request.quality < 1 || request.quality > 100) {
    throw new RangeError("Video thumbnail quality must be an integer from 1 to 100.")
  }
}
