import type {
  CachedPresentation,
  ReaderPresentationCache,
  ReaderPresentationCacheSnapshot,
} from "../../ports/ReaderPresentationCache.js"
import { LRUCache } from "lru-cache"

export interface WeightedLruPresentationCacheOptions {
  maxBytes?: number
  maxEntryBytes?: number
  trimRatio?: number
}

export class WeightedLruPresentationCache implements ReaderPresentationCache {
  readonly maxEntryBytes: number
  readonly #maxBytes: number
  readonly #trimTargetBytes: number
  readonly #entries: LRUCache<string, CachedPresentation>
  #hits = 0
  #misses = 0
  #evictions = 0

  constructor(options: WeightedLruPresentationCacheOptions = {}) {
    this.#maxBytes = positiveInteger(options.maxBytes ?? 96 * 1024 * 1024, "maxBytes")
    this.maxEntryBytes = positiveInteger(options.maxEntryBytes ?? 24 * 1024 * 1024, "maxEntryBytes")
    if (this.maxEntryBytes > this.#maxBytes) throw new RangeError("maxEntryBytes must not exceed maxBytes")
    const trimRatio = options.trimRatio ?? 0.8
    if (!Number.isFinite(trimRatio) || trimRatio <= 0 || trimRatio > 1) {
      throw new RangeError("trimRatio must be greater than 0 and at most 1")
    }
    this.#trimTargetBytes = Math.max(1, Math.floor(this.#maxBytes * trimRatio))
    this.#entries = new LRUCache({
      maxSize: this.#maxBytes,
      maxEntrySize: this.maxEntryBytes,
      sizeCalculation: (entry) => entry.bytes.byteLength,
      dispose: (_entry, _key, reason) => {
        if (reason === "evict") this.#evictions += 1
      },
    })
  }

  get(key: string): CachedPresentation | undefined {
    const entry = this.#entries.get(key)
    if (!entry) {
      this.#misses += 1
      return undefined
    }
    this.#hits += 1
    return entry
  }

  set(key: string, value: CachedPresentation): boolean {
    const size = value.bytes.byteLength
    if (size <= 0 || size > this.maxEntryBytes || size > this.#maxBytes) return false
    const previousSize = this.#entries.peek(key)?.bytes.byteLength ?? 0
    const exceedsHardLimit = this.#entries.calculatedSize - previousSize + size > this.#maxBytes
    this.#entries.set(key, { bytes: value.bytes, contentType: value.contentType })
    if (exceedsHardLimit) {
      while (this.#entries.calculatedSize > this.#trimTargetBytes) this.#entries.pop()
    }
    return this.#entries.has(key)
  }

  clear(): void {
    this.#entries.clear()
  }

  trimTo(maxBytes: number): void {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError("maxBytes must be a non-negative safe integer")
    while (this.#entries.calculatedSize > maxBytes) this.#entries.pop()
  }

  snapshot(): ReaderPresentationCacheSnapshot {
    return {
      entries: this.#entries.size,
      bytes: this.#entries.calculatedSize,
      maxBytes: this.#maxBytes,
      maxEntryBytes: this.maxEntryBytes,
      hits: this.#hits,
      misses: this.#misses,
      evictions: this.#evictions,
    }
  }

}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`)
  return value
}
