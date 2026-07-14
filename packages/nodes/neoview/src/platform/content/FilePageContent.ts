import { open, type FileHandle } from "node:fs/promises"

import type { PageContent, PageSource } from "../../domain/page/page-content.js"

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
  readonly #path: string
  #handle: FileHandle | null = null
  #opened = false
  #closed = false
  #cancelActive: ((reason: unknown) => Promise<void>) | undefined

  constructor(path: string, byteLength: number, contentType: string) {
    this.#path = path
    this.byteLength = byteLength
    this.contentType = contentType
  }

  async open(signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    if (this.#closed) throw new Error(`Page source is closed: ${this.#path}`)
    if (this.#opened) throw new Error(`Page source can only be opened once: ${this.#path}`)
    signal?.throwIfAborted()
    this.#opened = true
    const handle = await open(this.#path, "r")
    if (signal?.aborted || this.#closed) {
      await handle.close()
      signal?.throwIfAborted()
      throw new Error(`Page source is closed: ${this.#path}`)
    }
    this.#handle = handle
    const byteLength = this.byteLength
    let position = 0
    let finished = false
    const finish = async () => {
      if (finished) return
      finished = true
      this.#cancelActive = undefined
      signal?.removeEventListener("abort", onAbort)
      const activeHandle = this.#handle
      this.#handle = null
      await activeHandle?.close()
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
          const remaining = byteLength - position
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

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    const cancelActive = this.#cancelActive
    if (cancelActive) {
      await cancelActive(new Error(`Page source is closed: ${this.#path}`))
      return
    }
    const handle = this.#handle
    this.#handle = null
    await handle?.close()
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }
}
