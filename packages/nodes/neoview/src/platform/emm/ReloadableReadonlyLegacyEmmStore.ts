import type { ReaderDirectoryEmmReadOptions, ReaderDirectoryEmmRecord } from "../../ports/ReaderDirectoryEmmRecordStore.js"
import type { ReaderEmmCatalogTag } from "../../ports/ReaderEmmTagCatalogStore.js"
import type { ExternalEmmStore } from "./ReadonlyLegacyEmmRecordStore.js"

interface StoreSlot {
  readonly store?: ExternalEmmStore
  readers: number
  retired: boolean
  readonly drained: { promise: Promise<void>; resolve(): void }
}

/** Stable EMM port whose backing read-only SQLite connections can be replaced off the Reader hot path. */
export class ReloadableReadonlyLegacyEmmStore implements AsyncDisposable {
  readonly directoryEmmAvailable = true
  #current: StoreSlot
  #closed = false

  constructor(initial?: ExternalEmmStore) {
    this.#current = slot(initial)
  }

  async readDirectoryEmmRecords(
    paths: readonly string[],
    signal?: AbortSignal,
    options?: ReaderDirectoryEmmReadOptions,
  ): Promise<ReadonlyMap<string, ReaderDirectoryEmmRecord>> {
    return this.#withStore(
      (store) => store?.readDirectoryEmmRecords(paths, signal, options)
        ?? Promise.resolve<ReadonlyMap<string, ReaderDirectoryEmmRecord>>(new Map()),
    )
  }

  async sampleEmmTags(count: number, signal?: AbortSignal): Promise<readonly ReaderEmmCatalogTag[]> {
    return this.#withStore((store) => store?.sampleEmmTags(count, signal) ?? Promise.resolve([]))
  }

  async replace(next?: ExternalEmmStore): Promise<void> {
    if (this.#closed) {
      next?.close()
      throw new Error("Reader EMM store is closed.")
    }
    const previous = this.#current
    this.#current = slot(next)
    await retire(previous)
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    const previous = this.#current
    this.#current = slot()
    await retire(previous)
  }

  async #withStore<T>(operation: (store: ExternalEmmStore | undefined) => Promise<T>): Promise<T> {
    if (this.#closed) throw new Error("Reader EMM store is closed.")
    const current = this.#current
    current.readers += 1
    try {
      return await operation(current.store)
    } finally {
      current.readers -= 1
      if (current.retired && current.readers === 0) current.drained.resolve()
    }
  }
}

function slot(store?: ExternalEmmStore): StoreSlot {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((complete) => { resolve = complete })
  return { store, readers: 0, retired: false, drained: { promise, resolve } }
}

async function retire(value: StoreSlot): Promise<void> {
  value.retired = true
  if (value.readers > 0) await value.drained.promise
  value.store?.close()
}
