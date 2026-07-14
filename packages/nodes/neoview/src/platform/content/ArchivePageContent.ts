import type { PageByteRange, PageContent, PageSource } from "../../domain/page/page-content.js"
import type { ArchiveProvider } from "../../ports/ArchiveProvider.js"
import type { ArchiveCredentialStore } from "../../application/reader/ArchiveCredentialStore.js"

export class ArchivePageContent implements PageContent {
  constructor(
    readonly provider: ArchiveProvider,
    readonly entryId: string,
    readonly byteLength: number,
    readonly contentType: string,
    readonly credentials?: ArchiveCredentialStore,
    readonly entryPaths: readonly string[] = [],
  ) {}

  async load(signal?: AbortSignal): Promise<PageSource> {
    signal?.throwIfAborted()
    return new ArchivePageSource(
      this.provider,
      this.entryId,
      this.byteLength,
      this.contentType,
      this.credentials,
      this.entryPaths,
    )
  }
}

class ArchivePageSource implements PageSource {
  readonly byteLength: number
  readonly contentType: string
  readonly rangeSupported = false
  readonly #provider: ArchiveProvider
  readonly #entryId: string
  readonly #credentials?: ArchiveCredentialStore
  readonly #entryPaths: readonly string[]
  #opened = false
  #closed = false
  #active?: { reader: ReadableStreamDefaultReader<Uint8Array>; clear(): void }

  constructor(
    provider: ArchiveProvider,
    entryId: string,
    byteLength: number,
    contentType: string,
    credentials?: ArchiveCredentialStore,
    entryPaths: readonly string[] = [],
  ) {
    this.#provider = provider
    this.#entryId = entryId
    this.byteLength = byteLength
    this.contentType = contentType
    this.#credentials = credentials
    this.#entryPaths = entryPaths
  }

  async open(signal?: AbortSignal, range?: PageByteRange): Promise<ReadableStream<Uint8Array>> {
    if (this.#closed) throw new Error(`Archive page source is closed: ${this.#entryId}`)
    if (this.#opened) throw new Error(`Archive page source can only be opened once: ${this.#entryId}`)
    if (range) throw new Error("Archive page source does not support decompressed byte ranges.")
    this.#opened = true
    const rawPassword = this.#credentials?.copyRawPassword(this.#entryPaths)
    let stream: ReadableStream<Uint8Array>
    try {
      stream = await this.#provider.openEntry(this.#entryId, { signal, rawPassword })
    } catch (error) {
      this.#credentials?.clearRawPassword(rawPassword)
      if (!this.#credentials) rawPassword?.fill(0)
      throw error
    }
    const reader = stream.getReader()
    let cleared = false
    const clear = () => {
      if (cleared) return
      cleared = true
      this.#credentials?.clearRawPassword(rawPassword)
      if (!this.#credentials) rawPassword?.fill(0)
      this.#active = undefined
    }
    this.#active = { reader, clear }
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const result = await reader.read()
          if (result.done) {
            clear()
            controller.close()
          } else {
            controller.enqueue(result.value)
          }
        } catch (error) {
          clear()
          controller.error(error)
        }
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason)
        } finally {
          clear()
        }
      },
    })
  }

  async close(): Promise<void> {
    this.#closed = true
    const active = this.#active
    if (active) {
      try {
        await active.reader.cancel("archive page source closed")
      } finally {
        active.clear()
      }
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }
}
