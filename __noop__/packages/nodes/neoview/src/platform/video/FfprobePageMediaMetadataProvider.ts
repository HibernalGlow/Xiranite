import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process"
import { Readable } from "node:stream"
import type { ReadableStream as NodeReadableStream } from "node:stream/web"

import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"
import type {
  ReaderPageMediaDetails,
  ReaderPageMediaMetadataProvider,
  ReaderPageMediaMetadataRequest,
} from "../../ports/ReaderPageMediaMetadataProvider.js"
import { videoProcessSlots } from "./VideoProcessScheduler.js"

const MAX_STDOUT_BYTES = 1024 * 1024
const MAX_STDERR_BYTES = 64 * 1024

export interface FfprobePageMediaMetadataProviderOptions {
  executablePath?: string
  resourceScheduler?: ResourceScheduler
  processScheduler?: ResourceScheduler
  runProbe?: typeof runFfprobeMediaProbe
}

export class FfprobePageMediaMetadataProvider implements ReaderPageMediaMetadataProvider {
  readonly #executablePath: string
  readonly #resourceScheduler?: ResourceScheduler
  readonly #processScheduler: ResourceScheduler
  readonly #runProbe: typeof runFfprobeMediaProbe

  constructor(options: FfprobePageMediaMetadataProviderOptions = {}) {
    this.#executablePath = (options.executablePath ?? process.env.XIRANITE_FFPROBE_PATH?.trim()) || "ffprobe"
    this.#resourceScheduler = options.resourceScheduler
    this.#processScheduler = options.processScheduler ?? videoProcessSlots
    this.#runProbe = options.runProbe ?? runFfprobeMediaProbe
  }

  async inspect(request: ReaderPageMediaMetadataRequest, signal?: AbortSignal): Promise<ReaderPageMediaDetails> {
    validateRequest(request)
    signal?.throwIfAborted()
    const processLease = await this.#processScheduler.acquire({
      resource: "cpu",
      kind: "neoview.metadata.video-process",
      priority: request.priority,
      ownerId: request.ownerId,
    }, signal)
    let resourceLease: Awaited<ReturnType<ResourceScheduler["acquire"]>> | undefined
    try {
      resourceLease = await this.#resourceScheduler?.acquire({
        resource: "cpu",
        kind: "neoview.metadata.video-ffprobe",
        priority: request.priority,
        ownerId: request.ownerId,
      }, signal)
      const output = await this.#runProbe(request, {
        executablePath: this.#executablePath,
        signal,
      })
      return parseFfprobeMediaDetails(output)
    } finally {
      resourceLease?.release()
      processLease.release()
    }
  }
}

export interface FfprobeMediaProbeOptions {
  executablePath: string
  signal?: AbortSignal
  spawnProcess?: SpawnProcess
}

type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams

export async function runFfprobeMediaProbe(
  request: Pick<ReaderPageMediaMetadataRequest, "sourcePath" | "sourceStream">,
  options: FfprobeMediaProbeOptions,
): Promise<unknown> {
  options.signal?.throwIfAborted()
  const input = request.sourceStream ? toNodeReadable(request.sourceStream) : undefined
  const args = [
    "-v", "error",
    "-show_entries", "format=duration,bit_rate:stream=codec_type,codec_name,duration,bit_rate,avg_frame_rate,r_frame_rate",
    "-of", "json",
    request.sourcePath ?? "pipe:0",
  ]
  const spawnProcess = options.spawnProcess ?? (spawn as SpawnProcess)
  const child = spawnProcess(options.executablePath, args, { windowsHide: true })
  input?.on("error", () => undefined)
  const abort = () => {
    child.kill("SIGKILL")
    input?.destroy(options.signal?.reason)
  }
  options.signal?.addEventListener("abort", abort, { once: true })
  child.stdin.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE" && error.code !== "ECONNRESET") child.emit("error", error)
  })
  if (input) input.pipe(child.stdin)
  else child.stdin.end()

  try {
    const stdout = readBoundedText(child.stdout, MAX_STDOUT_BYTES, () => child.kill("SIGKILL"))
    const stderr = readBoundedText(child.stderr, MAX_STDERR_BYTES, () => child.kill("SIGKILL"))
    const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once("error", reject)
      child.once("close", (code, signal) => resolve({ code, signal }))
    })
    const [json, errorText, result] = await Promise.all([stdout, stderr, exit])
    options.signal?.throwIfAborted()
    if (result.code !== 0) {
      const suffix = errorText.trim() ? `: ${errorText.trim()}` : ""
      throw new Error(`ffprobe exited with code ${result.code ?? "null"}${suffix}`)
    }
    try {
      return JSON.parse(json) as unknown
    } catch (error) {
      throw new Error("ffprobe returned invalid JSON.", { cause: error })
    }
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason
    throw error
  } finally {
    options.signal?.removeEventListener("abort", abort)
    input?.destroy()
    child.stdin.destroy()
  }
}

export function parseFfprobeMediaDetails(value: unknown): ReaderPageMediaDetails {
  const root = record(value)
  const format = record(root?.format)
  const streams = Array.isArray(root?.streams) ? root.streams.map(record).filter(isRecord) : []
  const video = streams.find((stream) => stream.codec_type === "video")
  const audio = streams.find((stream) => stream.codec_type === "audio")
  const durationSeconds = positiveNumber(format?.duration) ?? positiveNumber(video?.duration)
  const frameRate = ratio(video?.avg_frame_rate) ?? ratio(video?.r_frame_rate)
  const bitRateBps = positiveInteger(format?.bit_rate) ?? positiveInteger(video?.bit_rate)
  const videoCodec = codec(video?.codec_name)
  const audioCodec = codec(audio?.codec_name)
  return {
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
    ...(frameRate === undefined ? {} : { frameRate }),
    ...(bitRateBps === undefined ? {} : { bitRateBps }),
    ...(videoCodec === undefined ? {} : { videoCodec }),
    ...(audioCodec === undefined ? {} : { audioCodec }),
  }
}

function validateRequest(request: ReaderPageMediaMetadataRequest): void {
  if ((!request.sourcePath && !request.sourceStream) || (request.sourcePath && request.sourceStream)) {
    throw new Error("Page media metadata request must provide exactly one sourcePath or sourceStream.")
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function isRecord(value: Record<string, unknown> | undefined): value is Record<string, unknown> {
  return value !== undefined
}

function positiveNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = positiveNumber(value)
  if (parsed === undefined) return undefined
  const rounded = Math.round(parsed)
  return Number.isSafeInteger(rounded) && rounded > 0 ? rounded : undefined
}

function ratio(value: unknown): number | undefined {
  if (typeof value === "number") return positiveNumber(value)
  if (typeof value !== "string") return undefined
  const [left, right, extra] = value.trim().split("/")
  if (extra !== undefined) return undefined
  const numerator = Number(left)
  const denominator = right === undefined ? 1 : Number(right)
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || numerator <= 0 || denominator <= 0) return undefined
  const parsed = numerator / denominator
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 10_000 ? parsed : undefined
}

function codec(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim()
  const lower = normalized.toLowerCase()
  if (!normalized || normalized.length > 128 || lower === "unknown" || lower === "n/a" || lower === "none") return undefined
  return normalized
}

function toNodeReadable(stream: ReadableStream<Uint8Array>): Readable {
  return Readable.fromWeb(stream as NodeReadableStream<Uint8Array>)
}

async function readBoundedText(stream: NodeJS.ReadableStream, maxBytes: number, kill: () => void): Promise<string> {
  const decoder = new TextDecoder()
  let bytes = 0
  let output = ""
  for await (const chunk of stream) {
    const data = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk as Uint8Array
    bytes += data.byteLength
    if (bytes > maxBytes) {
      kill()
      throw new Error(`ffprobe output exceeded ${maxBytes} bytes.`)
    }
    output += decoder.decode(data, { stream: true })
  }
  return output + decoder.decode()
}
