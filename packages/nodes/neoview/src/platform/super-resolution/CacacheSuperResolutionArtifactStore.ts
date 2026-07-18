import { createReadStream } from "node:fs"
import { open, stat, statfs } from "node:fs/promises"
import { join } from "node:path"
import { pipeline } from "node:stream/promises"
import type { Readable } from "node:stream"

import type {
  SuperResolutionArtifactCleanupResult,
  SuperResolutionArtifactLease,
  SuperResolutionArtifactMetadata,
  SuperResolutionArtifactProducer,
  SuperResolutionArtifactStore,
  SuperResolutionArtifactStoreSnapshot,
} from "../../ports/SuperResolutionArtifactStore.js"

type CacacheApi = typeof import("cacache")

interface StoredMetadata extends SuperResolutionArtifactMetadata {
  schemaVersion: 1
  createdAt: number
}

interface CacheEntry {
  key: string
  integrity: string
  size: number
  time: number
  metadata: StoredMetadata
}

interface LeaseState {
  count: number
  invalidated: boolean
}

export interface CacacheSuperResolutionArtifactStoreOptions {
  root: string
  maxBytes?: number
  maxEntryBytes?: number
  maxAgeMs?: number
  trimRatio?: number
  minFreeBytes?: number
  minimumRetentionMs?: number
  now?: () => number
  loadCacache?: () => Promise<CacacheApi>
  availableBytes?: (path: string) => Promise<number | undefined>
}

const KEY_PATTERN = /^neoview:super-resolution:v1:[A-Za-z0-9_-]{43}$/
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024 * 1024
const DEFAULT_MAX_ENTRY_BYTES = 512 * 1024 * 1024
const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024
const DEFAULT_MINIMUM_RETENTION_MS = 60 * 1000

export class CacacheSuperResolutionArtifactStore implements SuperResolutionArtifactStore {
  readonly #root: string
  readonly #maxBytes: number
  readonly #maxEntryBytes: number
  readonly #maxAgeMs: number
  readonly #trimTargetBytes: number
  readonly #minFreeBytes: number
  readonly #minimumRetentionMs: number
  readonly #now: () => number
  readonly #loadCacache: () => Promise<CacacheApi>
  readonly #availableBytes: (path: string) => Promise<number | undefined>
  readonly #leases = new Map<string, LeaseState>()
  readonly #publishFlights = new Map<string, Promise<boolean>>()
  readonly #pendingRemovals = new Set<Promise<void>>()
  #apiPromise?: Promise<CacacheApi>
  #maintenance?: Promise<SuperResolutionArtifactCleanupResult>
  #vacuum?: Promise<void>
  #activeStaging = 0
  #vacuumPending = false
  #closed = false
  #hits = 0
  #misses = 0
  #writes = 0
  #rejectedWrites = 0
  #evictions = 0
  #integrityFailures = 0

  constructor(options: CacacheSuperResolutionArtifactStoreOptions) {
    if (!options.root) throw new TypeError("root must be a non-empty path")
    this.#root = options.root
    this.#maxBytes = positiveInteger(options.maxBytes ?? DEFAULT_MAX_BYTES, "maxBytes")
    this.#maxEntryBytes = positiveInteger(options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES, "maxEntryBytes")
    if (this.#maxEntryBytes > this.#maxBytes) throw new RangeError("maxEntryBytes must not exceed maxBytes")
    this.#maxAgeMs = positiveInteger(options.maxAgeMs ?? DEFAULT_MAX_AGE_MS, "maxAgeMs")
    this.#minFreeBytes = nonNegativeInteger(options.minFreeBytes ?? DEFAULT_MIN_FREE_BYTES, "minFreeBytes")
    this.#minimumRetentionMs = nonNegativeInteger(options.minimumRetentionMs ?? DEFAULT_MINIMUM_RETENTION_MS, "minimumRetentionMs")
    const trimRatio = options.trimRatio ?? 0.8
    if (!Number.isFinite(trimRatio) || trimRatio <= 0 || trimRatio > 1) throw new RangeError("trimRatio must be in (0, 1]")
    this.#trimTargetBytes = Math.max(1, Math.floor(this.#maxBytes * trimRatio))
    this.#now = options.now ?? Date.now
    this.#loadCacache = options.loadCacache ?? (() => import("cacache"))
    this.#availableBytes = options.availableBytes ?? availableBytes
  }

  async acquire(key: string, signal?: AbortSignal): Promise<SuperResolutionArtifactLease | undefined> {
    requireKey(key)
    signal?.throwIfAborted()
    if (this.#closed) return undefined
    const api = await this.#api()
    const info = await api.get.info(this.#root, key, { memoize: false }).catch(() => null)
    const metadata = parseMetadata(info?.metadata)
    const size = info?.size
    if (!info || !metadata || typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0 || size > this.#maxEntryBytes) {
      this.#misses += 1
      if (info) this.#integrityFailures += 1
      return undefined
    }
    const state = this.#leases.get(key) ?? { count: 0, invalidated: false }
    if (state.invalidated) {
      this.#misses += 1
      return undefined
    }
    state.count += 1
    this.#leases.set(key, state)
    this.#hits += 1
    let released = false
    const release = () => {
      if (released) return
      released = true
      this.#release(key, state)
    }
    return {
      key,
      size,
      integrity: info.integrity,
      metadata,
      openStream: (streamSignal) => {
        if (released) throw new Error("Super-resolution artifact lease is no longer active.")
        streamSignal?.throwIfAborted()
        const stream = api.get.stream(this.#root, key, { memoize: false, size }) as unknown as Readable
        if (streamSignal) {
          const abort = () => stream.destroy(streamSignal.reason instanceof Error ? streamSignal.reason : abortError("Artifact read cancelled."))
          streamSignal.addEventListener("abort", abort, { once: true })
          stream.once("close", () => streamSignal.removeEventListener("abort", abort))
        }
        stream.once("error", (error) => {
          const code = (error as NodeJS.ErrnoException).code
          if (code === "EINTEGRITY" || code === "EBADSIZE") {
            state.invalidated = true
            this.#integrityFailures += 1
          }
        })
        return stream
      },
      release,
      [Symbol.dispose]: release,
    }
  }

  publish(key: string, metadata: SuperResolutionArtifactMetadata, producer: SuperResolutionArtifactProducer, signal?: AbortSignal): Promise<boolean> {
    requireKey(key)
    requireMetadata(metadata)
    signal?.throwIfAborted()
    if (this.#closed) {
      this.#rejectedWrites += 1
      return Promise.resolve(false)
    }
    const active = this.#publishFlights.get(key)
    if (active) return waitForFlight(active, signal)
    const flight = this.#publishOne(key, metadata, producer).finally(() => {
      if (this.#publishFlights.get(key) === flight) this.#publishFlights.delete(key)
    })
    this.#publishFlights.set(key, flight)
    return waitForFlight(flight, signal)
  }

  async invalidate(key: string): Promise<void> {
    requireKey(key)
    const state = this.#leases.get(key)
    if (state?.count) {
      state.invalidated = true
      return
    }
    if (await this.#remove(key)) await this.#verify()
  }

  clearBook(bookKey: string): Promise<SuperResolutionArtifactCleanupResult> {
    if (!bookKey || bookKey.length > 2_048) throw new TypeError("bookKey must contain 1..2048 characters")
    return this.#cleanupSerialized("book", bookKey)
  }

  cleanup(reason: "age" | "budget" | "explicit" | "low-disk" = "explicit"): Promise<SuperResolutionArtifactCleanupResult> {
    return this.#cleanupSerialized(reason)
  }

  clear(): Promise<SuperResolutionArtifactCleanupResult> {
    return this.#cleanupSerialized("explicit", undefined, true)
  }

  async snapshot(): Promise<SuperResolutionArtifactStoreSnapshot> {
    return this.#snapshot(await this.#entries())
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    await Promise.allSettled([
      ...this.#publishFlights.values(),
      ...this.#pendingRemovals,
      ...(this.#maintenance ? [this.#maintenance] : []),
      ...(this.#vacuum ? [this.#vacuum] : []),
    ])
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close()
  }

  async #publishOne(key: string, metadata: SuperResolutionArtifactMetadata, producer: SuperResolutionArtifactProducer): Promise<boolean> {
    const api = await this.#api()
    this.#activeStaging += 1
    let producerCompleted = false
    try {
      return await (api.tmp.withTmp as unknown as (
        root: string,
        options: { tmpPrefix: string },
        callback: (directory: string) => Promise<boolean>,
      ) => Promise<boolean>)(this.#root, { tmpPrefix: "xr-upscale-" }, async (directory) => {
        const destinationPath = join(directory, `artifact.${metadata.extension}`)
        await producer(destinationPath, new AbortController().signal)
        producerCompleted = true
        const file = await stat(destinationPath)
        if (!file.isFile() || file.size <= 0 || file.size > this.#maxEntryBytes) {
          this.#rejectedWrites += 1
          return false
        }
        await validateImage(destinationPath, metadata.contentType)
        if (!await this.#ensureCapacity(file.size)) {
          this.#rejectedWrites += 1
          return false
        }
        const storedMetadata: StoredMetadata = { ...metadata, schemaVersion: 1, createdAt: this.#now() }
        const sink = api.put.stream(this.#root, key, { memoize: false, size: file.size, metadata: storedMetadata })
        await pipeline(createReadStream(destinationPath), sink as unknown as NodeJS.WritableStream)
        this.#writes += 1
        return true
      })
    } catch (error) {
      this.#rejectedWrites += 1
      if (!producerCompleted) throw error
      return false
    } finally {
      this.#activeStaging = Math.max(0, this.#activeStaging - 1)
      if (this.#activeStaging === 0 && this.#vacuumPending) {
        this.#vacuumPending = false
        await this.#verify()
      }
    }
  }

  async #ensureCapacity(incomingBytes: number): Promise<boolean> {
    const free = await this.#availableBytes(this.#root)
    if (free !== undefined && free < this.#minFreeBytes + incomingBytes) {
      await this.#cleanupSerialized("low-disk")
      const refreshed = await this.#availableBytes(this.#root)
      if (refreshed !== undefined && refreshed < this.#minFreeBytes + incomingBytes) return false
    }
    let snapshot = await this.snapshot()
    if (snapshot.bytes + incomingBytes <= this.#maxBytes) return true
    await this.#cleanupSerialized("budget", undefined, false, Math.max(0, this.#maxBytes - incomingBytes))
    snapshot = await this.snapshot()
    return snapshot.bytes + incomingBytes <= this.#maxBytes
  }

  async #cleanupSerialized(
    reason: SuperResolutionArtifactCleanupResult["reason"],
    bookKey?: string,
    forceAll = false,
    targetBytes = this.#trimTargetBytes,
  ): Promise<SuperResolutionArtifactCleanupResult> {
    while (this.#maintenance) await this.#maintenance
    const operation = this.#cleanup(reason, bookKey, forceAll, targetBytes).finally(() => {
      if (this.#maintenance === operation) this.#maintenance = undefined
    })
    this.#maintenance = operation
    return operation
  }

  async #cleanup(
    reason: SuperResolutionArtifactCleanupResult["reason"],
    bookKey: string | undefined,
    forceAll: boolean,
    targetBytes: number,
  ): Promise<SuperResolutionArtifactCleanupResult> {
    const entries = await this.#entries()
    const before = this.#snapshot(entries)
    const now = this.#now()
    const ordered = [...entries].sort((left, right) => left.time - right.time || left.key.localeCompare(right.key))
    const contentRefs = new Map<string, { count: number; size: number }>()
    for (const entry of entries) {
      const reference = contentRefs.get(entry.integrity)
      if (reference) reference.count += 1
      else contentRefs.set(entry.integrity, { count: 1, size: entry.size })
    }
    let retained = before.bytes
    let removedEntries = 0
    for (const entry of ordered) {
      const matches = forceAll
        || (reason === "book" && entry.metadata.bookKey === bookKey)
        || (reason === "age" && now - entry.metadata.createdAt > this.#maxAgeMs)
        || ((reason === "budget" || reason === "low-disk") && retained > targetBytes)
      if (!matches) continue
      const state = this.#leases.get(entry.key)
      if (state?.count) {
        if (forceAll || reason === "book" || reason === "age") state.invalidated = true
        continue
      }
      if (!forceAll && reason !== "book" && now - entry.metadata.createdAt < this.#minimumRetentionMs) continue
      if (await this.#remove(entry.key)) {
        const reference = contentRefs.get(entry.integrity)
        if (reference && --reference.count === 0) retained = Math.max(0, retained - reference.size)
        removedEntries += 1
      }
    }
    if (removedEntries) await this.#verify()
    this.#evictions += removedEntries
    const after = this.#snapshot(await this.#entries())
    return { ...after, reason, removedEntries, removedBytes: Math.max(0, before.bytes - after.bytes) }
  }

  async #entries(): Promise<CacheEntry[]> {
    if (this.#closed && !this.#apiPromise) return []
    const api = await this.#api()
    const output: CacheEntry[] = []
    const stream = api.ls.stream(this.#root) as unknown as AsyncIterable<Record<string, unknown>>
    try {
      for await (const value of stream) {
        const metadata = parseMetadata(value.metadata)
        if (typeof value.key !== "string" || !KEY_PATTERN.test(value.key) || !metadata
          || typeof value.integrity !== "string" || !Number.isSafeInteger(value.size) || Number(value.size) <= 0) continue
        output.push({
          key: value.key,
          integrity: value.integrity,
          size: Number(value.size),
          time: typeof value.time === "number" ? value.time : metadata.createdAt,
          metadata,
        })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
    return output
  }

  #snapshot(entries: readonly CacheEntry[]): SuperResolutionArtifactStoreSnapshot {
    const content = new Map<string, number>()
    for (const entry of entries) content.set(entry.integrity, entry.size)
    return {
      entries: entries.length,
      bytes: [...content.values()].reduce((sum, size) => sum + size, 0),
      maxBytes: this.#maxBytes,
      maxEntryBytes: this.#maxEntryBytes,
      activeLeases: [...this.#leases.values()].reduce((sum, state) => sum + state.count, 0),
      hits: this.#hits,
      misses: this.#misses,
      writes: this.#writes,
      rejectedWrites: this.#rejectedWrites,
      evictions: this.#evictions,
      integrityFailures: this.#integrityFailures,
    }
  }

  async #remove(key: string): Promise<boolean> {
    try {
      const api = await this.#api()
      await api.rm.entry(this.#root, key)
      this.#leases.delete(key)
      return true
    } catch {
      const state = this.#leases.get(key)
      if (state) state.invalidated = true
      return false
    }
  }

  async #verify(): Promise<void> {
    if (this.#activeStaging > 0) {
      this.#vacuumPending = true
      return
    }
    if (this.#vacuum) return this.#vacuum
    const vacuum = this.#api()
      .then((api) => api.verify(this.#root, { concurrency: 2 }))
      .then(() => undefined)
      .finally(() => {
        if (this.#vacuum === vacuum) this.#vacuum = undefined
      })
    this.#vacuum = vacuum
    return vacuum
  }

  #release(key: string, state: LeaseState): void {
    state.count = Math.max(0, state.count - 1)
    if (state.count) return
    if (!state.invalidated) {
      this.#leases.delete(key)
      return
    }
    const removal = this.#remove(key).then(async (removed) => {
      if (removed) await this.#verify()
    }).finally(() => this.#pendingRemovals.delete(removal))
    this.#pendingRemovals.add(removal)
  }

  #api(): Promise<CacacheApi> {
    this.#apiPromise ??= this.#loadCacache()
    return this.#apiPromise
  }
}

function parseMetadata(value: unknown): StoredMetadata | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== 1 || typeof record.createdAt !== "number" || !Number.isFinite(record.createdAt)) return undefined
  try {
    requireMetadata(record as unknown as SuperResolutionArtifactMetadata)
    return record as unknown as StoredMetadata
  } catch {
    return undefined
  }
}

function requireMetadata(value: SuperResolutionArtifactMetadata): void {
  if (!value.bookKey || value.bookKey.length > 2_048 || value.bookKey.includes("\0")) throw new TypeError("bookKey must contain 1..2048 characters without NUL")
  const expected = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const
  if (expected[value.extension] !== value.contentType) throw new TypeError("artifact extension and contentType do not match")
}

async function validateImage(path: string, contentType: SuperResolutionArtifactMetadata["contentType"]): Promise<void> {
  const handle = await open(path, "r")
  try {
    const bytes = Buffer.alloc(16)
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
    const valid = contentType === "image/png"
      ? bytesRead >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : contentType === "image/jpeg"
        ? bytesRead >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        : bytesRead >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP"
    if (!valid) throw new Error(`Super-resolution output is not valid ${contentType}.`)
  } finally {
    await handle.close()
  }
}

function requireKey(key: string): void {
  if (!KEY_PATTERN.test(key)) throw new TypeError("artifact key must be an opaque typed v1 key")
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`)
  return value
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer`)
  return value
}

async function availableBytes(path: string): Promise<number | undefined> {
  try {
    const value = await statfs(path)
    return Number(value.bavail) * Number(value.bsize)
  } catch {
    return undefined
  }
}

async function waitForFlight<T>(flight: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return flight
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason) }
    const cleanup = () => signal.removeEventListener("abort", abort)
    signal.addEventListener("abort", abort, { once: true })
    void flight.then(
      (value) => { cleanup(); resolve(value) },
      (error) => { cleanup(); reject(error) },
    )
  })
}

function abortError(message: string): DOMException {
  return new DOMException(message, "AbortError")
}
