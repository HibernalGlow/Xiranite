import type { ReaderDirectoryEntry } from "../../ports/ReaderDirectoryListingProvider.js"
import type {
  ReaderDirectoryMetadataField,
  ReaderDirectoryMetadataProvider,
} from "../../ports/ReaderDirectoryMetadataProvider.js"

export class LazyReaderDirectoryMetadataProvider implements ReaderDirectoryMetadataProvider {
  readonly supportedFields: ReadonlySet<ReaderDirectoryMetadataField>
  readonly #load: () => Promise<ReaderDirectoryMetadataProvider>
  #provider?: Promise<ReaderDirectoryMetadataProvider>

  constructor(
    supportedFields: ReadonlySet<ReaderDirectoryMetadataField>,
    load: () => Promise<ReaderDirectoryMetadataProvider>,
  ) {
    this.supportedFields = new Set(supportedFields)
    this.#load = load
  }

  async hydrate(
    entries: readonly ReaderDirectoryEntry[],
    fields: ReadonlySet<ReaderDirectoryMetadataField>,
    signal?: AbortSignal,
  ): Promise<readonly ReaderDirectoryEntry[]> {
    signal?.throwIfAborted()
    if (!entries.length || !fields.size) return entries
    const provider = await this.#getProvider()
    signal?.throwIfAborted()
    const available = new Set([...fields].filter((field) => provider.supportedFields.has(field)))
    return available.size ? provider.hydrate(entries, available, signal) : entries
  }

  #getProvider(): Promise<ReaderDirectoryMetadataProvider> {
    if (this.#provider) return this.#provider
    const pending = this.#load()
    const guarded = pending.catch((error) => {
      if (this.#provider === guarded) this.#provider = undefined
      throw error
    })
    this.#provider = guarded
    return guarded
  }
}
