import type {
  ReaderPresentationDiskCache,
  ReaderPresentationDiskCacheCleanupResult,
  ReaderPresentationDiskCacheSnapshot,
} from "../../ports/ReaderPresentationDiskCache.js"

export type ReaderCacheMaintenanceReason = "age" | "budget" | "explicit"
export type ReaderCacheStatus = { enabled: false } | ({ enabled: true } & ReaderPresentationDiskCacheSnapshot)
export type ReaderCacheMaintenanceResult = { enabled: false } | ({ enabled: true } & ReaderPresentationDiskCacheCleanupResult)

export class ReaderCacheService implements AsyncDisposable {
  readonly #presentationCache?: ReaderPresentationDiskCache
  readonly #ownsPresentationCache: boolean
  #closed = false

  constructor(presentationCache?: ReaderPresentationDiskCache, options: { ownsPresentationCache?: boolean } = {}) {
    this.#presentationCache = presentationCache
    this.#ownsPresentationCache = options.ownsPresentationCache ?? false
  }

  async status(): Promise<ReaderCacheStatus> {
    this.#assertOpen()
    return this.#presentationCache
      ? { enabled: true, ...(await this.#presentationCache.snapshot()) }
      : { enabled: false }
  }

  async cleanup(reason: ReaderCacheMaintenanceReason = "age"): Promise<ReaderCacheMaintenanceResult> {
    this.#assertOpen()
    return this.#presentationCache
      ? { enabled: true, ...(await this.#presentationCache.cleanup(reason)) }
      : { enabled: false }
  }

  async clear(): Promise<ReaderCacheMaintenanceResult> {
    this.#assertOpen()
    return this.#presentationCache
      ? { enabled: true, ...(await this.#presentationCache.clear()) }
      : { enabled: false }
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    if (this.#ownsPresentationCache) await this.#presentationCache?.close()
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close()
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Reader cache service is closed")
  }
}
