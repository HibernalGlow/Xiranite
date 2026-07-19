import { parseImageDimensions } from "../../domain/image/image-dimensions.js"
import type { PageContent } from "../../domain/page/page-content.js"
import type { ImageMetadataProbe, ProbedImageMetadata } from "../../ports/ImageMetadataProbe.js"

export interface StreamingImageMetadataProbeOptions {
  maxHeaderBytes?: number
}

export class StreamingImageMetadataProbe implements ImageMetadataProbe {
  readonly #maxHeaderBytes: number

  constructor(options: StreamingImageMetadataProbeOptions = {}) {
    const maxHeaderBytes = options.maxHeaderBytes ?? 256 * 1024
    if (!Number.isSafeInteger(maxHeaderBytes) || maxHeaderBytes < 32) {
      throw new RangeError(`Invalid image probe header budget: ${maxHeaderBytes}`)
    }
    this.#maxHeaderBytes = maxHeaderBytes
  }

  async probe(content: PageContent, mimeType?: string, signal?: AbortSignal): Promise<ProbedImageMetadata | undefined> {
    signal?.throwIfAborted()
    const initial = parseImageDimensions(new Uint8Array(), mimeType)
    if (initial.status === "unsupported") return undefined
    const source = await waitWithAbort(content.load(signal), signal, (lateSource) => lateSource.close())
    const capacity = Math.min(source.byteLength ?? this.#maxHeaderBytes, this.#maxHeaderBytes)
    const header = new Uint8Array(capacity)
    let bytesRead = 0
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      signal?.throwIfAborted()
      const stream = await waitWithAbort(
        source.open(signal, source.rangeSupported && capacity > 0 ? { start: 0, end: capacity - 1 } : undefined),
        signal,
        (lateStream) => lateStream.cancel(signal?.reason),
      )
      reader = stream.getReader()
      while (bytesRead < capacity) {
        const chunk = await readWithAbort(reader, signal)
        if (chunk.done) break
        const copyLength = Math.min(chunk.value.byteLength, capacity - bytesRead)
        header.set(chunk.value.subarray(0, copyLength), bytesRead)
        bytesRead += copyLength
        signal?.throwIfAborted()
        const parsed = parseImageDimensions(header.subarray(0, bytesRead), mimeType)
        if (parsed.status === "found") {
          return {
            format: parsed.format,
            dimensions: parsed.dimensions,
            orientation: parsed.orientation,
            bytesRead,
          }
        }
        if (parsed.status === "invalid") throw new Error(parsed.message)
        if (parsed.status === "unsupported") return undefined
      }
      const parsed = parseImageDimensions(header.subarray(0, bytesRead), mimeType)
      if (parsed.status === "found") {
        return {
          format: parsed.format,
          dimensions: parsed.dimensions,
          orientation: parsed.orientation,
          bytesRead,
        }
      }
      if (parsed.status === "invalid") throw new Error(parsed.message)
      return undefined
    } finally {
      await reader?.cancel("image metadata probe finished").catch(() => undefined)
      reader?.releaseLock()
      await source.close().catch(() => undefined)
    }
  }
}

async function waitWithAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
  disposeLateResult?: (result: T) => Promise<unknown> | unknown,
): Promise<T> {
  if (!signal) return operation
  if (signal.aborted) {
    void operation.then(
      (result) => void Promise.resolve(disposeLateResult?.(result)).catch(() => undefined),
      () => undefined,
    )
    signal.throwIfAborted()
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = () => {
      signal.removeEventListener("abort", onAbort)
    }
    const onAbort = () => {
      if (settled) return
      settled = true
      finish()
      reject(signal.reason)
    }
    signal.addEventListener("abort", onAbort, { once: true })
    void operation.then(
      (result) => {
        if (settled) {
          void Promise.resolve(disposeLateResult?.(result)).catch(() => undefined)
          return
        }
        settled = true
        finish()
        resolve(result)
      },
      (error) => {
        if (settled) return
        settled = true
        finish()
        reject(error)
      },
    )
  })
}

async function readWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): Promise<Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>>> {
  signal?.throwIfAborted()
  if (!signal) return reader.read()
  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      void reader.cancel(signal.reason).catch(() => undefined)
      reject(signal.reason)
    }
    signal.addEventListener("abort", onAbort, { once: true })
  })
  try {
    return await Promise.race([reader.read(), aborted])
  } finally {
    signal.removeEventListener("abort", onAbort!)
  }
}
