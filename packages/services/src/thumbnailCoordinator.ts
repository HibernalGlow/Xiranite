import type { ResourcePriority } from "@xiranite/contract"

export type ThumbnailLane = "reader-visible" | "library-visible" | "prefetch" | "folder-preview" | "background"

export interface ThumbnailAsset {
  bytes: Uint8Array
  contentType: string
  version?: string
  cacheable?: boolean
}

export interface ThumbnailDemand<TSource = unknown> {
  cacheKey: string
  source: TSource
  lane: ThumbnailLane
  contextId: string
  generation: number
  signal?: AbortSignal
}

export interface ThumbnailResolver<TSource = unknown> {
  resolve(demand: Readonly<ThumbnailDemand<TSource>>, signal: AbortSignal): Promise<ThumbnailAsset>
}

export interface ThumbnailLease extends AsyncDisposable {
  readonly ready: Promise<ThumbnailAsset>
  release(): void
}

export interface ThumbnailCoordinatorOptions<TSource = unknown> {
  resolver: ThumbnailResolver<TSource>
  maxMemoryBytes?: number
  maxEntryBytes?: number
}

export interface ThumbnailCoordinatorSnapshot {
  demands: number
  activeFlights: number
  cachedEntries: number
  cachedBytes: number
  demandsByLane: Readonly<Record<ThumbnailLane, number>>
}

interface CacheEntry {
  asset: ThumbnailAsset
  bytes: number
  pins: number
}

interface Flight<TSource> {
  request: ThumbnailDemand<TSource>
  controller: AbortController
  demandIds: Set<number>
  completed?: ThumbnailAsset
  cached: boolean
}

interface DemandRecord {
  id: number
  cacheKey: string
  contextId: string
  generation: number
  lane: ThumbnailLane
  settled: boolean
  released: boolean
  resolve: (asset: ThumbnailAsset) => void
  reject: (reason: unknown) => void
  removeAbort?: () => void
}

const DEFAULT_MAX_MEMORY_BYTES = 32 * 1024 * 1024
const DEFAULT_MAX_ENTRY_BYTES = 512 * 1024

export class ThumbnailCoordinatorService<TSource = unknown> implements AsyncDisposable {
  readonly #resolver: ThumbnailResolver<TSource>
  readonly #maxMemoryBytes: number
  readonly #maxEntryBytes: number
  readonly #flights = new Map<string, Flight<TSource>>()
  readonly #cache = new Map<string, CacheEntry>()
  readonly #demands = new Map<number, DemandRecord>()
  readonly #contextGenerations = new Map<string, number>()
  #cachedBytes = 0
  #nextDemandId = 1
  #closed = false

  constructor(options: ThumbnailCoordinatorOptions<TSource>) {
    this.#resolver = options.resolver
    this.#maxMemoryBytes = boundedBytes(options.maxMemoryBytes ?? DEFAULT_MAX_MEMORY_BYTES, "maxMemoryBytes")
    this.#maxEntryBytes = boundedBytes(options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES, "maxEntryBytes")
  }

  acquire(demand: ThumbnailDemand<TSource>): ThumbnailLease {
    this.#assertOpen()
    validateDemand(demand)
    demand.signal?.throwIfAborted()
    const currentGeneration = this.#contextGenerations.get(demand.contextId)
    if (currentGeneration !== undefined && demand.generation < currentGeneration) {
      throw abortError(`Thumbnail generation ${demand.generation} is stale for ${demand.contextId}.`)
    }
    if (currentGeneration === undefined || demand.generation > currentGeneration) {
      this.advanceContext(demand.contextId, demand.generation)
    }

    const id = this.#nextDemandId++
    let resolveReady!: (asset: ThumbnailAsset) => void
    let rejectReady!: (reason: unknown) => void
    const ready = new Promise<ThumbnailAsset>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    void ready.catch(() => undefined)
    const record: DemandRecord = {
      id,
      cacheKey: demand.cacheKey,
      contextId: demand.contextId,
      generation: demand.generation,
      lane: demand.lane,
      settled: false,
      released: false,
      resolve: resolveReady,
      reject: rejectReady,
    }
    this.#demands.set(id, record)

    if (demand.signal) {
      const abort = () => this.#releaseDemand(id, demand.signal!.reason ?? abortError("Thumbnail demand aborted."))
      demand.signal.addEventListener("abort", abort, { once: true })
      record.removeAbort = () => demand.signal!.removeEventListener("abort", abort)
    }

    const cached = this.#cache.get(demand.cacheKey)
    if (cached) {
      cached.pins += 1
      this.#touchCache(demand.cacheKey, cached)
      record.settled = true
      record.resolve(cached.asset)
    } else {
      let flight = this.#flights.get(demand.cacheKey)
      if (!flight) {
        flight = {
          request: { ...demand, signal: undefined },
          controller: new AbortController(),
          demandIds: new Set(),
          cached: false,
        }
        this.#flights.set(demand.cacheKey, flight)
        void this.#runFlight(demand.cacheKey, flight)
      }
      flight.demandIds.add(id)
      if (flight.completed) {
        record.settled = true
        record.resolve(flight.completed)
      }
    }

    let released = false
    return {
      ready,
      release: () => {
        if (released) return
        released = true
        this.#releaseDemand(id, abortError("Thumbnail demand released."))
      },
      [Symbol.asyncDispose]: async () => {
        if (released) return
        released = true
        this.#releaseDemand(id, abortError("Thumbnail demand disposed."))
      },
    }
  }

  advanceContext(contextId: string, generation: number): void {
    if (!contextId) throw new Error("Thumbnail contextId cannot be empty.")
    if (!Number.isSafeInteger(generation) || generation < 0) throw new RangeError("Thumbnail generation must be a non-negative integer.")
    const current = this.#contextGenerations.get(contextId)
    if (current !== undefined && generation <= current) return
    this.#contextGenerations.set(contextId, generation)
    for (const record of [...this.#demands.values()]) {
      if (record.contextId === contextId && record.generation < generation) {
        this.#releaseDemand(record.id, abortError(`Thumbnail generation ${record.generation} was superseded by ${generation}.`))
      }
    }
  }

  snapshot(): ThumbnailCoordinatorSnapshot {
    const demandsByLane = emptyLaneCounts()
    for (const demand of this.#demands.values()) demandsByLane[demand.lane] += 1
    return {
      demands: this.#demands.size,
      activeFlights: this.#flights.size,
      cachedEntries: this.#cache.size,
      cachedBytes: this.#cachedBytes,
      demandsByLane,
    }
  }

  async dispose(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    for (const record of [...this.#demands.values()]) {
      this.#releaseDemand(record.id, abortError("Thumbnail coordinator disposed."))
    }
    for (const flight of this.#flights.values()) flight.controller.abort(abortError("Thumbnail coordinator disposed."))
    this.#flights.clear()
    this.#cache.clear()
    this.#cachedBytes = 0
    this.#contextGenerations.clear()
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose()
  }

  async #runFlight(cacheKey: string, flight: Flight<TSource>): Promise<void> {
    try {
      const asset = await this.#resolver.resolve(flight.request, flight.controller.signal)
      validateAsset(asset)
      flight.completed = asset
      const activeDemandIds = [...flight.demandIds].filter((id) => this.#demands.has(id))
      if (asset.cacheable !== false && activeDemandIds.length && asset.bytes.byteLength <= this.#maxEntryBytes) {
        flight.cached = this.#cacheAsset(cacheKey, asset, activeDemandIds.length)
      }
      for (const id of activeDemandIds) {
        const record = this.#demands.get(id)
        if (!record || record.released) continue
        record.settled = true
        record.resolve(asset)
      }
      if (flight.cached || !activeDemandIds.length) this.#flights.delete(cacheKey)
    } catch (error) {
      for (const id of [...flight.demandIds]) {
        const record = this.#demands.get(id)
        if (!record || record.released) continue
        record.settled = true
        record.reject(error)
      }
      this.#flights.delete(cacheKey)
    }
  }

  #cacheAsset(cacheKey: string, asset: ThumbnailAsset, pins: number): boolean {
    const bytes = asset.bytes.byteLength
    if (bytes > this.#maxMemoryBytes) return false
    this.#evictToFit(bytes)
    if (this.#cachedBytes + bytes > this.#maxMemoryBytes) return false
    const entry: CacheEntry = { asset, bytes, pins }
    this.#cache.set(cacheKey, entry)
    this.#cachedBytes += bytes
    return true
  }

  #evictToFit(incomingBytes: number): void {
    for (const [key, entry] of this.#cache) {
      if (this.#cachedBytes + incomingBytes <= this.#maxMemoryBytes) return
      if (entry.pins > 0) continue
      this.#cache.delete(key)
      this.#cachedBytes -= entry.bytes
    }
  }

  #touchCache(key: string, entry: CacheEntry): void {
    this.#cache.delete(key)
    this.#cache.set(key, entry)
  }

  #releaseDemand(id: number, reason: unknown): void {
    const record = this.#demands.get(id)
    if (!record || record.released) return
    record.released = true
    record.removeAbort?.()
    this.#demands.delete(id)

    const cached = this.#cache.get(record.cacheKey)
    if (cached) cached.pins = Math.max(0, cached.pins - 1)
    const flight = this.#flights.get(record.cacheKey)
    if (flight) {
      flight.demandIds.delete(id)
      if (!flight.demandIds.size) {
        if (!flight.completed) flight.controller.abort(reason)
        this.#flights.delete(record.cacheKey)
      }
    }
    if (!record.settled) {
      record.settled = true
      record.reject(reason)
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Thumbnail coordinator is closed.")
  }
}

export function thumbnailLanePriority(lane: ThumbnailLane): ResourcePriority {
  switch (lane) {
    case "reader-visible": return "interactive"
    case "library-visible": return "view"
    case "prefetch": return "ahead"
    case "folder-preview":
    case "background": return "background"
  }
}

function validateDemand<TSource>(demand: ThumbnailDemand<TSource>): void {
  if (!demand.cacheKey || demand.cacheKey.length > 32_768) throw new Error("Thumbnail cacheKey must be 1..32768 characters.")
  if (!demand.contextId || demand.contextId.length > 1_024) throw new Error("Thumbnail contextId must be 1..1024 characters.")
  if (!Number.isSafeInteger(demand.generation) || demand.generation < 0) throw new RangeError("Thumbnail generation must be a non-negative integer.")
  thumbnailLanePriority(demand.lane)
}

function validateAsset(asset: ThumbnailAsset): void {
  if (!(asset.bytes instanceof Uint8Array) || !asset.bytes.byteLength) throw new Error("Thumbnail resolver returned empty bytes.")
  if (!asset.contentType || asset.contentType.length > 256) throw new Error("Thumbnail resolver returned an invalid content type.")
}

function boundedBytes(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2 * 1024 * 1024 * 1024) {
    throw new RangeError(`${name} must be an integer from 1 to 2147483648.`)
  }
  return value
}

function abortError(message: string): DOMException {
  return new DOMException(message, "AbortError")
}

function emptyLaneCounts(): Record<ThumbnailLane, number> {
  return {
    "reader-visible": 0,
    "library-visible": 0,
    prefetch: 0,
    "folder-preview": 0,
    background: 0,
  }
}
