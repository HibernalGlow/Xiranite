import type {
  CachedPresentation,
  ReaderPresentationCache,
  ReaderPresentationCacheLease,
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
  readonly #pinned = new Map<string, { value: CachedPresentation; leases: number; retainAfterRelease: boolean }>()
  #pinnedBytes = 0
  #activeLeases = 0
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
    const entry = this.#pinned.get(key)?.value ?? this.#entries.get(key)
    if (!entry) {
      this.#misses += 1
      return undefined
    }
    this.#hits += 1
    return entry
  }

  pin(key: string): ReaderPresentationCacheLease | undefined {
    let pinned = this.#pinned.get(key)
    if (!pinned) {
      const value = this.#entries.peek(key)
      if (!value) {
        this.#misses += 1
        return undefined
      }
      this.#entries.delete(key)
      pinned = { value, leases: 0, retainAfterRelease: true }
      this.#pinned.set(key, pinned)
      this.#pinnedBytes += value.bytes.byteLength
    }
    this.#hits += 1
    pinned.leases += 1
    this.#activeLeases += 1
    let released = false
    const release = () => {
      if (released) return
      released = true
      this.#activeLeases -= 1
      pinned!.leases -= 1
      if (pinned!.leases > 0) return
      this.#pinned.delete(key)
      this.#pinnedBytes -= pinned!.value.bytes.byteLength
      if (pinned!.retainAfterRelease) this.#insertUnpinned(key, pinned!.value)
    }
    return { value: pinned.value, release, [Symbol.dispose]: release }
  }

  set(key: string, value: CachedPresentation): boolean {
    const size = value.bytes.byteLength
    if (size <= 0 || size > this.maxEntryBytes || size > this.#maxBytes) return false
    const pinned = this.#pinned.get(key)
    if (pinned) {
      const previousSize = pinned.value.bytes.byteLength
      this.#evictToFit(size - previousSize)
      if (this.#entries.calculatedSize + this.#pinnedBytes - previousSize + size > this.#maxBytes) return false
      pinned.value = { bytes: value.bytes, contentType: value.contentType }
      this.#pinnedBytes += size - previousSize
      return true
    }
    return this.#insertUnpinned(key, value)
  }

  #insertUnpinned(key: string, value: CachedPresentation): boolean {
    const size = value.bytes.byteLength
    const previousSize = this.#entries.peek(key)?.bytes.byteLength ?? 0
    const exceedsHardLimit = this.#entries.calculatedSize + this.#pinnedBytes - previousSize + size > this.#maxBytes
    this.#evictToFit(size - previousSize)
    if (this.#entries.calculatedSize + this.#pinnedBytes - previousSize + size > this.#maxBytes) return false
    this.#entries.set(key, { bytes: value.bytes, contentType: value.contentType })
    if (exceedsHardLimit) {
      while (this.#entries.calculatedSize + this.#pinnedBytes > this.#trimTargetBytes && this.#entries.size) this.#entries.pop()
    }
    return this.#entries.has(key)
  }

  clear(): void {
    this.#entries.clear()
    for (const pinned of this.#pinned.values()) pinned.retainAfterRelease = false
  }

  trimTo(maxBytes: number): void {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError("maxBytes must be a non-negative safe integer")
    while (this.#entries.calculatedSize + this.#pinnedBytes > maxBytes && this.#entries.size) this.#entries.pop()
    if (this.#entries.calculatedSize + this.#pinnedBytes > maxBytes) {
      for (const pinned of this.#pinned.values()) pinned.retainAfterRelease = false
    }
  }

  snapshot(): ReaderPresentationCacheSnapshot {
    return {
      entries: this.#entries.size + this.#pinned.size,
      bytes: this.#entries.calculatedSize + this.#pinnedBytes,
      pinnedEntries: this.#pinned.size,
      pinnedBytes: this.#pinnedBytes,
      activeLeases: this.#activeLeases,
      maxBytes: this.#maxBytes,
      maxEntryBytes: this.maxEntryBytes,
      hits: this.#hits,
      misses: this.#misses,
      evictions: this.#evictions,
    }
  }

  #evictToFit(incomingBytes: number): void {
    while (this.#entries.calculatedSize + this.#pinnedBytes + incomingBytes > this.#maxBytes && this.#entries.size) {
      this.#entries.pop()
    }
  }

}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`)
  return value
}
