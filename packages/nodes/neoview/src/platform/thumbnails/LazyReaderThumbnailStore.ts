import type {
  ReaderThumbnailAsset,
  ReaderThumbnailCategory,
  ReaderThumbnailCleanupRequest,
  ReaderThumbnailFailure,
  ReaderThumbnailInvalidCleanupResult,
  ReaderThumbnailMaintenanceSnapshot,
  ReaderThumbnailStore,
  ReaderThumbnailWrite,
} from "../../ports/ReaderThumbnailStore.js"

export interface LazyReaderThumbnailStoreOptions {
  load(): Promise<ReaderThumbnailStore>
  dispose?(store: ReaderThumbnailStore): void | Promise<void>
}

export class LazyReaderThumbnailStore implements ReaderThumbnailStore, AsyncDisposable {
  readonly #loadStore: () => Promise<ReaderThumbnailStore>
  readonly #disposeStore?: (store: ReaderThumbnailStore) => void | Promise<void>
  #store?: Promise<ReaderThumbnailStore | undefined>
  #loadedStore?: ReaderThumbnailStore
  #closing?: Promise<void>
  #closed = false
  #disposed = false

  constructor(options: LazyReaderThumbnailStoreOptions) {
    this.#loadStore = options.load
    this.#disposeStore = options.dispose
  }

  revision(): number {
    return this.#loadedStore?.revision?.() ?? 0
  }

  async get(key: string, category: ReaderThumbnailCategory): Promise<ReaderThumbnailAsset | undefined> {
    return (await this.#load())?.get(key, category)
  }

  async getMany(keys: readonly string[], category: ReaderThumbnailCategory): Promise<ReadonlyMap<string, ReaderThumbnailAsset>> {
    const store = await this.#load()
    if (!store) return new Map()
    if (store.getMany) return store.getMany(keys, category)
    const records = await Promise.all([...new Set(keys)].map(async (key) => [key, await store.get(key, category)] as const))
    return new Map(records.filter((record): record is readonly [string, ReaderThumbnailAsset] => record[1] !== undefined))
  }

  async put(thumbnail: ReaderThumbnailWrite): Promise<void> {
    await (await this.#load())?.put?.(thumbnail)
  }

  async getFailure(key: string): Promise<ReaderThumbnailFailure | undefined> {
    return (await this.#load())?.getFailure?.(key)
  }

  async recordFailure(failure: Omit<ReaderThumbnailFailure, "retryCount">): Promise<void> {
    await (await this.#load())?.recordFailure?.(failure)
  }

  async maintenanceSnapshot(signal?: AbortSignal): Promise<ReaderThumbnailMaintenanceSnapshot> {
    signal?.throwIfAborted()
    const store = await this.#require("statistics")
    if (!store.maintenanceSnapshot) throw unavailable("statistics")
    return store.maintenanceSnapshot(signal)
  }

  async clearFailures(options: { reason?: string; limit: number }, signal?: AbortSignal): Promise<number> {
    signal?.throwIfAborted()
    const store = await this.#require("failure cleanup")
    if (!store.clearFailures) throw unavailable("failure cleanup")
    return store.clearFailures(options, signal)
  }

  async cleanup(request: ReaderThumbnailCleanupRequest, signal?: AbortSignal): Promise<number> {
    signal?.throwIfAborted()
    const store = await this.#require("cleanup")
    if (!store.cleanup) throw unavailable("cleanup")
    return store.cleanup(request, signal)
  }

  async cleanupInvalid(options: { scanLimit: number; deleteLimit: number }, signal?: AbortSignal): Promise<ReaderThumbnailInvalidCleanupResult> {
    signal?.throwIfAborted()
    const store = await this.#require("invalid-path cleanup")
    if (!store.cleanupInvalid) throw unavailable("invalid-path cleanup")
    return store.cleanupInvalid(options, signal)
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing
    this.#closed = true
    this.#closing = (async () => {
      const store = await this.#store
      if (store) await this.#dispose(store)
    })()
    return this.#closing
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }

  #load(): Promise<ReaderThumbnailStore | undefined> {
    if (this.#closed) return Promise.reject(new Error("Lazy thumbnail store is closed."))
    if (!this.#store) {
      this.#store = this.#loadStore().then(async (store) => {
        if (!this.#closed) {
          this.#loadedStore = store
          return store
        }
        await this.#dispose(store)
        return undefined
      }, () => undefined)
    }
    return this.#store
  }

  async #require(capability: string): Promise<ReaderThumbnailStore> {
    const store = await this.#load()
    if (!store) throw unavailable(capability)
    return store
  }

  async #dispose(store: ReaderThumbnailStore): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    if (this.#loadedStore === store) this.#loadedStore = undefined
    await this.#disposeStore?.(store)
  }
}

function unavailable(capability: string): Error {
  return new Error(`Thumbnail store ${capability} is unavailable.`)
}
