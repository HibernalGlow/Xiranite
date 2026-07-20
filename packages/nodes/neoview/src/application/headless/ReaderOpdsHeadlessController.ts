import type { ReaderOpdsCatalog } from "../../platform/opds/ReaderOpdsClient.js"

export interface ReaderOpdsCatalogReader {
  read(url: string, signal?: AbortSignal): Promise<ReaderOpdsCatalog>
}

/** Presentation-neutral OPDS facade shared by CLI/TUI and HTTP adapters. */
export class ReaderOpdsHeadlessController implements AsyncDisposable {
  #closed = false

  constructor(private readonly reader: ReaderOpdsCatalogReader) {}

  readCatalog(url: string, signal?: AbortSignal): Promise<ReaderOpdsCatalog> {
    this.#assertOpen()
    return this.reader.read(url, signal)
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    const disposable = this.reader as ReaderOpdsCatalogReader & Partial<AsyncDisposable>
    await disposable[Symbol.asyncDispose]?.()
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close()
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Reader OPDS headless controller is closed.")
  }
}
