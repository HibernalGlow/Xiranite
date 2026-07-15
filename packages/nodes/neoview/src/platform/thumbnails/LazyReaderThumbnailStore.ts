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
  #closing?: Promise<void>
  #closed = false
  #disposed = false

  constructor(options: LazyReaderThumbnailStoreOptions) {
    this.#loadStore = options.load
    this.#disposeStore = options.dispose
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

  async maintenanceSnapshot(): Promise<ReaderThumbnailMaintenanceSnapshot> {
    const store = await this.#require("statistics")
    if (!store.maintenanceSnapshot) throw unavailable("statistics")
    return store.maintenanceSnapshot()
  }

  async clearFailures(options: { reason?: string; limit: number }): Promise<number> {
    const store = await this.#require("failure cleanup")
    if (!store.clearFailures) throw unavailable("failure cleanup")
    return store.clearFailures(options)
  }

  async cleanup(request: ReaderThumbnailCleanupRequest): Promise<number> {
    const store = await this.#require("cleanup")
    if (!store.cleanup) throw unavailable("cleanup")
    return store.cleanup(request)
  }

  async cleanupInvalid(options: { scanLimit: number; deleteLimit: number }): Promise<ReaderThumbnailInvalidCleanupResult> {
    const store = await this.#require("invalid-path cleanup")
    if (!store.cleanupInvalid) throw unavailable("invalid-path cleanup")
    return store.cleanupInvalid(options)
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
        if (!this.#closed) return store
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
    await this.#disposeStore?.(store)
  }
}

function unavailable(capability: string): Error {
  return new Error(`Thumbnail store ${capability} is unavailable.`)
}
