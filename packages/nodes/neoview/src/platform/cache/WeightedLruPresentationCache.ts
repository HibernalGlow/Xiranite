import type {
  CachedPresentation,
  ReaderPresentationCache,
  ReaderPresentationCacheSnapshot,
} from "../../ports/ReaderPresentationCache.js"

interface CacheEntry extends CachedPresentation {
  readonly weight: number
}

export interface WeightedLruPresentationCacheOptions {
  maxBytes?: number
  maxEntryBytes?: number
  trimRatio?: number
}

export class WeightedLruPresentationCache implements ReaderPresentationCache {
  readonly maxEntryBytes: number
  readonly #maxBytes: number
  readonly #trimTargetBytes: number
  readonly #entries = new Map<string, CacheEntry>()
  #bytes = 0
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
  }

  get(key: string): CachedPresentation | undefined {
    const entry = this.#entries.get(key)
    if (!entry) {
      this.#misses += 1
      return undefined
    }
    this.#hits += 1
    this.#entries.delete(key)
    this.#entries.set(key, entry)
    return entry
  }

  set(key: string, value: CachedPresentation): boolean {
    const weight = value.bytes.byteLength
    if (weight <= 0 || weight > this.maxEntryBytes || weight > this.#maxBytes) return false
    const previous = this.#entries.get(key)
    if (previous) {
      this.#entries.delete(key)
      this.#bytes -= previous.weight
    }
    const entry: CacheEntry = { bytes: value.bytes, contentType: value.contentType, weight }
    this.#entries.set(key, entry)
    this.#bytes += weight
    if (this.#bytes > this.#maxBytes) this.#trim()
    return this.#entries.has(key)
  }

  clear(): void {
    this.#entries.clear()
    this.#bytes = 0
  }

  snapshot(): ReaderPresentationCacheSnapshot {
    return {
      entries: this.#entries.size,
      bytes: this.#bytes,
      maxBytes: this.#maxBytes,
      maxEntryBytes: this.maxEntryBytes,
      hits: this.#hits,
      misses: this.#misses,
      evictions: this.#evictions,
    }
  }

  #trim(): void {
    for (const [key, entry] of this.#entries) {
      if (this.#bytes <= this.#trimTargetBytes) break
      this.#entries.delete(key)
      this.#bytes -= entry.weight
      this.#evictions += 1
    }
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`)
  return value
}
