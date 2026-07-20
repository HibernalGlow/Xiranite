import { imageTransformContentType } from "../../domain/image/image-transform.js"
import type {
  ImageTransformer,
  ImageTransformExecution,
  ImageTransformResult,
} from "../../ports/ImageTransformer.js"
import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"
import { defaultImageTransformScheduler } from "../scheduler/PriorityResourceScheduler.js"

const SNIFF_BYTES = 12
const MAX_WIC_INPUT_BYTES = 32 * 1024 * 1024
const MAX_WIC_DIMENSION = 8192
const JXL_CONTAINER_SIGNATURE = Uint8Array.of(0, 0, 0, 12, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a)

type WicFormat = "avif" | "jxl"

export interface WicEncodedThumbnail {
  data: Uint8Array
  width: number
  height: number
  mimeType: string
}

export interface WicImageApi {
  createWicImageThumbnailEncoded(options: {
    data: Uint8Array
    maxDimension: number
    format: "jpeg" | "png" | "webp"
    lossless: boolean
    quality: number
  }): Promise<WicEncodedThumbnail>
}

export interface WindowsWicImageTransformerOptions {
  resourceScheduler?: ResourceScheduler
  loadWic?: () => Promise<WicImageApi>
  preferFallbackForLossless?: boolean
}

export class WindowsWicImageTransformer implements ImageTransformer {
  readonly #fallback: ImageTransformer
  readonly #resourceScheduler: ResourceScheduler
  readonly #loadWic: () => Promise<WicImageApi>
  readonly #preferFallbackForLossless: boolean
  #wic?: Promise<WicImageApi>

  constructor(fallback: ImageTransformer, options: WindowsWicImageTransformerOptions = {}) {
    this.#fallback = fallback
    this.#resourceScheduler = options.resourceScheduler ?? defaultImageTransformScheduler
    this.#loadWic = options.loadWic ?? loadWicImageApi
    this.#preferFallbackForLossless = options.preferFallbackForLossless === true
  }

  async transform(
    input: ReadableStream<Uint8Array>,
    request: Parameters<ImageTransformer["transform"]>[1],
    signal?: AbortSignal,
    execution: ImageTransformExecution = {},
  ): Promise<ImageTransformResult> {
    signal?.throwIfAborted()
    const peeked = await peekInput(input, signal)
    const format = detectWicFormat(peeked.prefix)
    if (!format) return this.#fallback.transform(replayInput(peeked), request, signal, execution)
    if (request.format === "avif") return this.#fallback.transform(replayInput(peeked), request, signal, execution)
    if (request.lossless === true && this.#preferFallbackForLossless) {
      return this.#fallback.transform(replayInput(peeked), request, signal, execution)
    }

    const bytes = await collectInput(peeked, MAX_WIC_INPUT_BYTES, signal)
    const maxDimension = transformedMaxDimension(request)
    if (maxDimension > MAX_WIC_DIMENSION) {
      return this.#fallback.transform(byteStream(bytes), request, signal, execution)
    }

    const ownsLease = !execution.resourceLease
    const lease = execution.resourceLease ?? await this.#resourceScheduler.acquire({
      resource: "cpu",
      kind: execution.kind ?? "neoview.image-transform.wic",
      priority: execution.priority ?? "interactive",
      ownerId: execution.ownerId,
    }, signal)
    let failure: unknown
    try {
      const thumbnail = await (await this.#getWic()).createWicImageThumbnailEncoded({
        data: bytes,
        maxDimension,
        format: request.format,
        lossless: request.lossless === true,
        quality: request.quality,
      })
      signal?.throwIfAborted()
      validateThumbnail(thumbnail, maxDimension)
      const expectedContentType = imageTransformContentType(request.format)
      if (thumbnail.mimeType !== expectedContentType) {
        throw new Error(`WIC encoded thumbnail returned ${thumbnail.mimeType}; expected ${expectedContentType}.`)
      }
      return {
        stream: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(thumbnail.data); controller.close() } }),
        contentType: thumbnail.mimeType,
      }
    } catch (error) {
      failure = error
    } finally {
      if (ownsLease) lease.release()
    }
    try {
      return await this.#fallback.transform(byteStream(bytes), request, signal, execution)
    } catch (fallbackError) {
      throw new AggregateError([failure, fallbackError], `${format.toUpperCase()} failed in both WIC and sharp.`)
    }
  }

  #getWic(): Promise<WicImageApi> {
    if (!this.#wic) {
      const pending = this.#loadWic()
      const guarded = pending.catch((error) => {
        if (this.#wic === guarded) this.#wic = undefined
        throw error
      })
      this.#wic = guarded
    }
    return this.#wic
  }
}

interface PeekedInput {
  chunks: Uint8Array[]
  prefix: Uint8Array
  reader?: ReadableStreamDefaultReader<Uint8Array>
  ended: boolean
}

async function peekInput(input: ReadableStream<Uint8Array>, signal?: AbortSignal): Promise<PeekedInput> {
  const reader = input.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  let ended = false
  try {
    while (bytes < SNIFF_BYTES) {
      signal?.throwIfAborted()
      const result = await reader.read()
      if (result.done) { ended = true; reader.releaseLock(); break }
      chunks.push(result.value)
      bytes += result.value.byteLength
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined)
    reader.releaseLock()
    throw error
  }
  const prefix = new Uint8Array(Math.min(bytes, SNIFF_BYTES))
  let offset = 0
  for (const chunk of chunks) {
    const length = Math.min(chunk.byteLength, prefix.byteLength - offset)
    prefix.set(chunk.subarray(0, length), offset)
    offset += length
    if (offset === prefix.byteLength) break
  }
  return { chunks, prefix, reader: ended ? undefined : reader, ended }
}

function replayInput(input: PeekedInput): ReadableStream<Uint8Array> {
  let index = 0
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index < input.chunks.length) {
        controller.enqueue(input.chunks[index++]!)
        return
      }
      if (input.ended) { controller.close(); return }
      const result = await input.reader!.read()
      if (result.done) {
        input.ended = true
        input.reader!.releaseLock()
        input.reader = undefined
        controller.close()
      } else {
        controller.enqueue(result.value)
      }
    },
    async cancel(reason) {
      if (!input.reader) return
      try {
        await input.reader.cancel(reason)
      } finally {
        input.reader.releaseLock()
        input.reader = undefined
      }
    },
  })
}

async function collectInput(input: PeekedInput, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
  let total = input.chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  if (total > maxBytes) throw new RangeError(`WIC input exceeds ${maxBytes} bytes.`)
  while (!input.ended) {
    signal?.throwIfAborted()
    const result = await input.reader!.read()
    if (result.done) {
      input.ended = true
      input.reader!.releaseLock()
      input.reader = undefined
      break
    }
    total += result.value.byteLength
    if (total > maxBytes) {
      await input.reader!.cancel("WIC input exceeds its byte budget").catch(() => undefined)
      input.reader!.releaseLock()
      input.reader = undefined
      throw new RangeError(`WIC input exceeds ${maxBytes} bytes.`)
    }
    input.chunks.push(result.value)
  }
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of input.chunks) { output.set(chunk, offset); offset += chunk.byteLength }
  return output
}

function detectWicFormat(bytes: Uint8Array): WicFormat | undefined {
  if (bytes.byteLength >= 2 && bytes[0] === 0xff && bytes[1] === 0x0a) return "jxl"
  if (startsWith(bytes, JXL_CONTAINER_SIGNATURE)) return "jxl"
  if (ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12)
    if (brand === "avif" || brand === "avis") return "avif"
  }
  return undefined
}

function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  if (bytes.byteLength < prefix.byteLength) return false
  return prefix.every((value, index) => bytes[index] === value)
}

function transformedMaxDimension(request: Parameters<ImageTransformer["transform"]>[1]): number {
  if (request.width === undefined && request.height === undefined) return 0
  if (request.width !== undefined && request.height !== undefined
    && (request.fit === "cover" || request.fit === "fill" || request.fit === "outside")) return 0
  return Math.max(
    request.width === undefined ? 0 : Math.round(request.width * request.dpr),
    request.height === undefined ? 0 : Math.round(request.height * request.dpr),
  )
}

async function loadWicImageApi(): Promise<WicImageApi> {
  return import("@xiranite/arcthumb-native")
}

function validateThumbnail(image: WicEncodedThumbnail, maxDimension: number): void {
  if (!image.width || !image.height || (maxDimension > 0 && (image.width > maxDimension || image.height > maxDimension))) {
    throw new RangeError(`WIC returned invalid dimensions ${image.width}x${image.height}.`)
  }
  if (!image.data.byteLength) throw new RangeError("WIC encoded thumbnail is empty.")
  if (!image.mimeType.startsWith("image/")) throw new Error(`WIC encoded thumbnail has invalid MIME type: ${image.mimeType}`)
}

function byteStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close() } })
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  if (bytes.byteLength < end) return ""
  return String.fromCharCode(...bytes.subarray(start, end))
}
