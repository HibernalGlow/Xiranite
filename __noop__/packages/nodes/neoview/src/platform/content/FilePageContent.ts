import { open, type FileHandle } from "node:fs/promises"

import type { PageByteRange, PageContent, PageSource } from "../../domain/page/page-content.js"

const DEFAULT_CHUNK_SIZE = 64 * 1024

export class FilePageContent implements PageContent {
  constructor(
    readonly path: string,
    readonly byteLength: number,
    readonly contentType: string,
  ) {}

  async load(signal?: AbortSignal): Promise<PageSource> {
    signal?.throwIfAborted()
    return new FilePageSource(this.path, this.byteLength, this.contentType)
  }
}

class FilePageSource implements PageSource {
  readonly byteLength: number
  readonly contentType: string
  readonly rangeSupported = true
  readonly #path: string
  #handle: FileHandle | null = null
  #opened = false
  #closed = false
  #closing: Promise<void> | undefined
  #cancelActive: ((reason: unknown) => Promise<void>) | undefined
  #activeFinish: Promise<void> | undefined

  constructor(path: string, byteLength: number, contentType: string) {
    this.#path = path
    this.byteLength = byteLength
    this.contentType = contentType
  }

  async open(signal?: AbortSignal, range?: PageByteRange): Promise<ReadableStream<Uint8Array>> {
    if (this.#closed) throw new Error(`Page source is closed: ${this.#path}`)
    if (this.#opened) throw new Error(`Page source can only be opened once: ${this.#path}`)
    signal?.throwIfAborted()
    const byteLength = this.byteLength
    const boundedRange = normalizeRange(range, byteLength)
    this.#opened = true
    const handle = await open(this.#path, "r")
    if (signal?.aborted || this.#closed) {
      await handle.close()
      signal?.throwIfAborted()
      throw new Error(`Page source is closed: ${this.#path}`)
    }
    this.#handle = handle
    let position = boundedRange?.start ?? 0
    const end = boundedRange?.end ?? byteLength - 1
    const finish = (): Promise<void> => {
      this.#activeFinish ??= Promise.resolve().then(async () => {
        this.#cancelActive = undefined
        signal?.removeEventListener("abort", onAbort)
        const activeHandle = this.#handle
        this.#handle = null
        await activeHandle?.close()
      })
      return this.#activeFinish
    }
    let outputController: ReadableStreamDefaultController<Uint8Array> | undefined
    const errorOutput = (reason: unknown) => {
      try {
        outputController?.error(reason)
      } catch {
        // The consumer may already have closed the stream.
      }
      outputController = undefined
    }
    this.#cancelActive = async (reason) => {
      await finish()
      errorOutput(reason)
    }
    const onAbort = () => {
      void this.#cancelActive?.(signal?.reason).catch(() => undefined)
    }
    signal?.addEventListener("abort", onAbort, { once: true })

    return new ReadableStream<Uint8Array>({
      start(controller) {
        outputController = controller
      },
      async pull(controller) {
        try {
          signal?.throwIfAborted()
          const remaining = end - position + 1
          if (remaining <= 0) {
            await finish()
            controller.close()
            return
          }
          const chunk = new Uint8Array(Math.min(DEFAULT_CHUNK_SIZE, remaining))
          const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, position)
          if (bytesRead === 0) {
            await finish()
            controller.close()
            return
          }
          position += bytesRead
          controller.enqueue(bytesRead === chunk.byteLength ? chunk : chunk.subarray(0, bytesRead))
        } catch (error) {
          await finish().catch(() => undefined)
          errorOutput(error)
        }
      },
      async cancel() {
        await finish()
      },
    })
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing
    this.#closed = true
    this.#closing = Promise.resolve().then(async () => {
      const cancelActive = this.#cancelActive
      if (cancelActive) {
        await cancelActive(new Error(`Page source is closed: ${this.#path}`))
        return
      }
      if (this.#activeFinish) {
        await this.#activeFinish
        return
      }
      const handle = this.#handle
      this.#handle = null
      await handle?.close()
    })
    return this.#closing
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }
}

function normalizeRange(range: PageByteRange | undefined, byteLength: number): PageByteRange | undefined {
  if (!range) return undefined
  if (
    !Number.isSafeInteger(range.start)
    || !Number.isSafeInteger(range.end)
    || range.start < 0
    || range.end < range.start
    || range.end >= byteLength
  ) {
    throw new RangeError(`Invalid page byte range: ${range.start}-${range.end}/${byteLength}`)
  }
  return range
}
