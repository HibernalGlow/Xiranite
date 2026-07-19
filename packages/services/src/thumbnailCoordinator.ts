import type { ResourcePriority } from "@xiranite/contract"
import PQueue from "p-queue"

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
  maxConcurrent?: number
  maxMemoryBytes?: number
  maxEntryBytes?: number
  now?: () => number
  onFlightEvent?: (event: ThumbnailCoordinatorFlightEvent<TSource>) => void
}

export interface ThumbnailCoordinatorFlightEvent<TSource = unknown> {
  flightId: string
  state: "started" | "cancellation-requested" | "settled"
  demand: Readonly<ThumbnailDemand<TSource>>
  atMs: number
  outcome?: "completed" | "cancelled" | "failed"
}

export interface ThumbnailCoordinatorSnapshot {
  demands: number
  activeFlights: number
  queuedFlights: number
  runningFlights: number
  cachedEntries: number
  cachedBytes: number
  demandsByLane: Readonly<Record<ThumbnailLane, number>>
  telemetry: ThumbnailCoordinatorTelemetrySnapshot
}

export interface ThumbnailCoordinatorLaneTelemetry {
  demands: number
  cacheHits: number
  cacheMisses: number
  completed: number
  failed: number
  cancelled: number
}

export interface ThumbnailCoordinatorTelemetrySnapshot {
  cacheHits: number
  cacheMisses: number
  completed: number
  failed: number
  cancelled: number
  evictions: number
  byLane: Readonly<Record<ThumbnailLane, ThumbnailCoordinatorLaneTelemetry>>
}

export interface ThumbnailEvictionResult {
  entries: number
  bytes: number
}

interface CacheEntry {
  asset: ThumbnailAsset
  bytes: number
  pins: number
  expiresAt?: number
}

interface Flight<TSource> {
  request: ThumbnailDemand<TSource>
  controller: AbortController
  demandIds: Set<number>
  queueTaskId: string
  priority: number
  started: boolean
  cancellationRequested: boolean
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
const DEFAULT_MAX_CONCURRENT = 8

export class ThumbnailCoordinatorService<TSource = unknown> implements AsyncDisposable {
  readonly #resolver: ThumbnailResolver<TSource>
  readonly #queue: PQueue
  readonly #maxMemoryBytes: number
  readonly #maxEntryBytes: number
  readonly #now: () => number
  readonly #onFlightEvent?: ThumbnailCoordinatorOptions<TSource>["onFlightEvent"]
  readonly #flights = new Map<string, Flight<TSource>>()
  readonly #cache = new Map<string, CacheEntry>()
  readonly #demands = new Map<number, DemandRecord>()
  readonly #contextGenerations = new Map<string, number>()
  #cachedBytes = 0
  #nextDemandId = 1
  #nextQueueTaskId = 1
  #closed = false
  readonly #telemetry = emptyTelemetry()

  constructor(options: ThumbnailCoordinatorOptions<TSource>) {
    this.#resolver = options.resolver
    this.#queue = new PQueue({ concurrency: boundedConcurrency(options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT) })
    this.#maxMemoryBytes = boundedBytes(options.maxMemoryBytes ?? DEFAULT_MAX_MEMORY_BYTES, "maxMemoryBytes")
    this.#maxEntryBytes = boundedBytes(options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES, "maxEntryBytes")
    this.#now = options.now ?? Date.now
    this.#onFlightEvent = options.onFlightEvent
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

    let cached = this.#cache.get(demand.cacheKey)
    if (cached?.expiresAt !== undefined && cached.expiresAt <= this.#now() && cached.pins === 0) {
      this.#deleteCacheEntry(demand.cacheKey, cached)
      cached = undefined
    }
    this.#telemetry.byLane[demand.lane].demands += 1
    if (cached) {
      this.#telemetry.cacheHits += 1
      this.#telemetry.byLane[demand.lane].cacheHits += 1
      cached.pins += 1
      this.#touchCache(demand.cacheKey, cached)
      record.settled = true
      record.resolve(cached.asset)
    } else {
      this.#telemetry.cacheMisses += 1
      this.#telemetry.byLane[demand.lane].cacheMisses += 1
      let flight = this.#flights.get(demand.cacheKey)
      let created = false
      if (!flight) {
        flight = {
          request: { ...demand, signal: undefined },
          controller: new AbortController(),
          demandIds: new Set(),
          queueTaskId: `thumbnail-${this.#nextQueueTaskId++}`,
          priority: thumbnailQueuePriority(demand.lane),
          started: false,
          cancellationRequested: false,
          cached: false,
        }
        this.#flights.set(demand.cacheKey, flight)
        created = true
      } else {
        const priority = thumbnailQueuePriority(demand.lane)
        if (!flight.started && priority > flight.priority) {
          flight.request.lane = demand.lane
          flight.priority = priority
          this.#queue.setPriority(flight.queueTaskId, priority)
        }
      }
      flight.demandIds.add(id)
      if (created) this.#scheduleFlight(demand.cacheKey, flight)
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
    for (const record of this.#demands.values()) {
      if (record.contextId === contextId && record.generation < generation) {
        this.#releaseDemand(record.id, abortError(`Thumbnail generation ${record.generation} was superseded by ${generation}.`))
      }
    }
  }

  releaseContext(contextId: string, reason: unknown = abortError(`Thumbnail context ${contextId} was released.`)): void {
    if (!contextId) throw new Error("Thumbnail contextId cannot be empty.")
    for (const record of this.#demands.values()) {
      if (record.contextId === contextId) this.#releaseDemand(record.id, reason)
    }
    this.#contextGenerations.delete(contextId)
  }

  async whenIdle(): Promise<void> {
    await this.#queue.onIdle()
  }

  prime(cacheKey: string, asset: ThumbnailAsset, options: { ttlMs?: number } = {}): boolean {
    this.#assertOpen()
    validateCacheKey(cacheKey)
    validateAsset(asset)
    const ttlMs = options.ttlMs
    if (ttlMs !== undefined && (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 60_000)) {
      throw new RangeError("Thumbnail prime ttlMs must be an integer from 1 to 60000.")
    }
    if (asset.bytes.byteLength > this.#maxEntryBytes) return false
    if (this.#flights.has(cacheKey)) return false
    const current = this.#cache.get(cacheKey)
    if (current?.pins) return false
    if (current) this.#deleteCacheEntry(cacheKey, current)
    return this.#cacheAsset(cacheKey, asset, 0, ttlMs === undefined ? undefined : this.#now() + ttlMs)
  }

  snapshot(): ThumbnailCoordinatorSnapshot {
    const demandsByLane = emptyLaneCounts()
    for (const demand of this.#demands.values()) demandsByLane[demand.lane] += 1
    return {
      demands: this.#demands.size,
      activeFlights: this.#flights.size,
      queuedFlights: this.#queue.size,
      runningFlights: this.#queue.pending,
      cachedEntries: this.#cache.size,
      cachedBytes: this.#cachedBytes,
      demandsByLane,
      telemetry: telemetrySnapshot(this.#telemetry),
    }
  }

  evictUnpinned(matches: (cacheKey: string) => boolean = () => true): ThumbnailEvictionResult {
    this.#assertOpen()
    let entries = 0
    let bytes = 0
    for (const [key, entry] of this.#cache) {
      if (entry.pins > 0 || !matches(key)) continue
      entries += 1
      bytes += entry.bytes
      this.#deleteCacheEntry(key, entry)
    }
    return { entries, bytes }
  }

  async dispose(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    for (const record of this.#demands.values()) {
      this.#releaseDemand(record.id, abortError("Thumbnail coordinator disposed."))
    }
    for (const flight of this.#flights.values()) this.#requestFlightCancellation(flight, abortError("Thumbnail coordinator disposed."))
    await this.#queue.onIdle()
    this.#flights.clear()
    this.#cache.clear()
    this.#cachedBytes = 0
    this.#contextGenerations.clear()
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose()
  }

  #scheduleFlight(cacheKey: string, flight: Flight<TSource>): void {
    void this.#queue.add(
      async () => {
        flight.started = true
        this.#emitFlightEvent(flight, "started")
        await this.#runFlight(cacheKey, flight)
      },
      {
        id: flight.queueTaskId,
        priority: flight.priority,
        signal: flight.controller.signal,
      },
    ).catch(() => {
      if (!flight.started && flight.controller.signal.aborted) {
        this.#telemetry.cancelled += 1
        this.#telemetry.byLane[flight.request.lane].cancelled += 1
      }
    })
  }

  async #runFlight(cacheKey: string, flight: Flight<TSource>): Promise<void> {
    try {
      const asset = await this.#resolver.resolve(flight.request, flight.controller.signal)
      validateAsset(asset)
      this.#telemetry.completed += 1
      this.#telemetry.byLane[flight.request.lane].completed += 1
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
      this.#emitFlightEvent(flight, "settled", "completed")
    } catch (error) {
      const outcome = isAbortError(error) ? "cancelled" : "failed"
      this.#telemetry[outcome] += 1
      this.#telemetry.byLane[flight.request.lane][outcome] += 1
      for (const id of flight.demandIds) {
        const record = this.#demands.get(id)
        if (!record || record.released) continue
        record.settled = true
        record.reject(error)
      }
      this.#flights.delete(cacheKey)
      this.#emitFlightEvent(flight, "settled", outcome)
    }
  }

  #cacheAsset(cacheKey: string, asset: ThumbnailAsset, pins: number, expiresAt?: number): boolean {
    const bytes = asset.bytes.byteLength
    if (bytes > this.#maxMemoryBytes) return false
    const current = this.#cache.get(cacheKey)
    if (current?.pins) return false
    if (current) this.#deleteCacheEntry(cacheKey, current)
    this.#evictToFit(bytes)
    if (this.#cachedBytes + bytes > this.#maxMemoryBytes) return false
    const entry: CacheEntry = { asset, bytes, pins, expiresAt }
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

  #deleteCacheEntry(key: string, entry: CacheEntry): void {
    if (!this.#cache.delete(key)) return
    this.#cachedBytes -= entry.bytes
    this.#telemetry.evictions += 1
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
        if (!flight.completed) this.#requestFlightCancellation(flight, reason)
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

  #requestFlightCancellation(flight: Flight<TSource>, reason: unknown): void {
    if (flight.cancellationRequested || flight.controller.signal.aborted) return
    flight.cancellationRequested = true
    this.#emitFlightEvent(flight, "cancellation-requested")
    flight.controller.abort(reason)
  }

  #emitFlightEvent(
    flight: Flight<TSource>,
    state: ThumbnailCoordinatorFlightEvent<TSource>["state"],
    outcome?: ThumbnailCoordinatorFlightEvent<TSource>["outcome"],
  ): void {
    try {
      this.#onFlightEvent?.({ flightId: flight.queueTaskId, state, demand: flight.request, atMs: this.#now(), outcome })
    } catch {
      // Observability must not change thumbnail scheduling or completion semantics.
    }
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

export function thumbnailQueuePriority(lane: ThumbnailLane): number {
  switch (lane) {
    case "reader-visible": return 4
    case "library-visible": return 3
    case "prefetch": return 2
    case "folder-preview": return 1
    case "background": return 0
  }
}

function validateDemand<TSource>(demand: ThumbnailDemand<TSource>): void {
  validateCacheKey(demand.cacheKey)
  if (!demand.contextId || demand.contextId.length > 1_024) throw new Error("Thumbnail contextId must be 1..1024 characters.")
  if (!Number.isSafeInteger(demand.generation) || demand.generation < 0) throw new RangeError("Thumbnail generation must be a non-negative integer.")
  thumbnailLanePriority(demand.lane)
}

function validateCacheKey(cacheKey: string): void {
  if (!cacheKey || cacheKey.length > 32_768) throw new Error("Thumbnail cacheKey must be 1..32768 characters.")
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

function boundedConcurrency(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 64) {
    throw new RangeError("maxConcurrent must be an integer from 1 to 64.")
  }
  return value
}

function abortError(message: string): DOMException {
  return new DOMException(message, "AbortError")
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
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

function emptyTelemetry(): {
  cacheHits: number
  cacheMisses: number
  completed: number
  failed: number
  cancelled: number
  evictions: number
  byLane: Record<ThumbnailLane, ThumbnailCoordinatorLaneTelemetry>
} {
  const lane = (): ThumbnailCoordinatorLaneTelemetry => ({ demands: 0, cacheHits: 0, cacheMisses: 0, completed: 0, failed: 0, cancelled: 0 })
  return {
    cacheHits: 0,
    cacheMisses: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    evictions: 0,
    byLane: {
      "reader-visible": lane(),
      "library-visible": lane(),
      prefetch: lane(),
      "folder-preview": lane(),
      background: lane(),
    },
  }
}

function telemetrySnapshot(value: ReturnType<typeof emptyTelemetry>): ThumbnailCoordinatorTelemetrySnapshot {
  return {
    cacheHits: value.cacheHits,
    cacheMisses: value.cacheMisses,
    completed: value.completed,
    failed: value.failed,
    cancelled: value.cancelled,
    evictions: value.evictions,
    byLane: Object.fromEntries(Object.entries(value.byLane).map(([lane, counts]) => [lane, { ...counts }])) as Record<ThumbnailLane, ThumbnailCoordinatorLaneTelemetry>,
  }
}
