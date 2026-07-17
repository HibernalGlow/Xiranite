import type { ReaderDirectoryMetadataProvider } from "../../ports/ReaderDirectoryMetadataProvider.js"
import type { ReaderFileTreeEntry, ReaderFileTreeScanOptions, ReaderFileTreeScanner } from "../../ports/ReaderFileTreeScanner.js"

const DEFAULT_BATCH_SIZE = 128

export class ReaderMetadataHydratingScanner implements ReaderFileTreeScanner {
  constructor(
    private readonly scanner: ReaderFileTreeScanner,
    private readonly metadata: ReaderDirectoryMetadataProvider,
    private readonly batchSize = DEFAULT_BATCH_SIZE,
  ) {
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 512) {
      throw new RangeError("Reader metadata hydration batch size must be from 1 to 512.")
    }
  }

  async *scan(rootPath: string, options?: ReaderFileTreeScanOptions, signal?: AbortSignal): AsyncIterable<ReaderFileTreeEntry> {
    let batch: ReaderFileTreeEntry[] = []
    for await (const entry of this.scanner.scan(rootPath, options, signal)) {
      signal?.throwIfAborted()
      batch.push(entry)
      if (batch.length >= this.batchSize) {
        yield* this.#hydrate(batch, signal)
        batch = []
      }
    }
    if (batch.length) yield* this.#hydrate(batch, signal)
  }

  async *#hydrate(entries: readonly ReaderFileTreeEntry[], signal?: AbortSignal): AsyncIterable<ReaderFileTreeEntry> {
    const hydrated = await this.metadata.hydrate(entries.map((entry) => ({
      name: entry.name,
      path: entry.path,
      kind: entry.kind,
      readerSupported: false,
    })), new Set(["tags"]), signal)
    signal?.throwIfAborted()
    for (let index = 0; index < entries.length; index += 1) {
      yield { ...entries[index]!, tags: hydrated[index]?.tags ?? [] }
    }
  }
}
