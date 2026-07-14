import type { PageByteRange, PageContent, PageSource } from "../../domain/page/page-content.js"
import type { ArchiveProvider } from "../../ports/ArchiveProvider.js"

export class ArchivePageContent implements PageContent {
  constructor(
    readonly provider: ArchiveProvider,
    readonly entryId: string,
    readonly byteLength: number,
    readonly contentType: string,
  ) {}

  async load(signal?: AbortSignal): Promise<PageSource> {
    signal?.throwIfAborted()
    return new ArchivePageSource(this.provider, this.entryId, this.byteLength, this.contentType)
  }
}

class ArchivePageSource implements PageSource {
  readonly byteLength: number
  readonly contentType: string
  readonly rangeSupported = false
  readonly #provider: ArchiveProvider
  readonly #entryId: string
  #opened = false
  #closed = false

  constructor(provider: ArchiveProvider, entryId: string, byteLength: number, contentType: string) {
    this.#provider = provider
    this.#entryId = entryId
    this.byteLength = byteLength
    this.contentType = contentType
  }

  async open(signal?: AbortSignal, range?: PageByteRange): Promise<ReadableStream<Uint8Array>> {
    if (this.#closed) throw new Error(`Archive page source is closed: ${this.#entryId}`)
    if (this.#opened) throw new Error(`Archive page source can only be opened once: ${this.#entryId}`)
    if (range) throw new Error("Archive page source does not support decompressed byte ranges.")
    this.#opened = true
    return this.#provider.openEntry(this.#entryId, { signal })
  }

  async close(): Promise<void> {
    this.#closed = true
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }
}
