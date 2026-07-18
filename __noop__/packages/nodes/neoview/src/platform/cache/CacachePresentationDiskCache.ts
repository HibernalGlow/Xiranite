import { mkdir, statfs } from "node:fs/promises"
import { performance } from "node:perf_hooks"
import { createHash } from "node:crypto"
import { join } from "node:path"
import { lock } from "proper-lockfile"

import type {
  ReaderPresentationDiskCache,
  ReaderPresentationDiskCacheCleanupResult,
  ReaderPresentationDiskCacheLease,
  ReaderPresentationDiskCacheSnapshot,
} from "../../ports/ReaderPresentationDiskCache.js"
import type { CachedPresentation } from "../../ports/ReaderPresentationCache.js"

type CacacheApi = typeof import("cacache")

interface PresentationMetadata {
  schemaVersion: 1
  contentType: string
  createdAt: number
}

interface LeaseState {
  leases: number
  invalidated: boolean
}

interface CacheEntry {
  key: string
  integrity: string
  size: number
  time: number
  metadata: PresentationMetadata
}

export interface CacachePresentationDiskCacheOptions {
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

const KEY_PATTERN = /^neoview:presentation:v1:[A-Za-z0-9_-]{43}$/
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024
const DEFAULT_MAX_ENTRY_BYTES = 24 * 1024 * 1024
const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_MIN_FREE_BYTES = 512 * 1024 * 1024
const DEFAULT_MINIMUM_RETENTION_MS = 60 * 1000
const ENTRY_LOCK_STALE_MS = 30_000
const ENTRY_LOCK_UPDATE_MS = 10_000

export class CacachePresentationDiskCache implements ReaderPresentationDiskCache {
  readonly maxEntryBytes: number
  readonly #root: string
  readonly #maxBytes: number
  readonly #trimTargetBytes: number
  readonly #maxAgeMs: number
  readonly #minFreeBytes: number
  readonly #minimumRetentionMs: number
  readonly #now: () => number
  readonly #loadCacache: () => Promise<CacacheApi>
  readonly #availableBytes: (path: string) => Promise<number | undefined>
  readonly #entryLockRoot: string
  readonly #leases = new Map<string, LeaseState>()
  readonly #putFlights = new Map<string, Promise<boolean>>()
  readonly #pendingRemovals = new Set<Promise<void>>()
  #cacache?: Promise<CacacheApi>
  #entryLockRootReady?: Promise<void>
  #maintenance?: Promise<ReaderPresentationDiskCacheCleanupResult>
  #vacuum?: Promise<void>
  #mutationVersion = 0
  #verifiedMutationVersion = 0
  #closed = false
  #hits = 0
  #misses = 0
  #writes = 0
  #rejectedWrites = 0
  #evictions = 0
  #integrityFailures = 0

  constructor(options: CacachePresentationDiskCacheOptions) {
    if (!options.root) throw new TypeError("root must be a non-empty path")
    this.#root = options.root
    this.#entryLockRoot = join(this.#root, ".xr-entry-locks")
    this.#maxBytes = positiveInteger(options.maxBytes ?? DEFAULT_MAX_BYTES, "maxBytes")
    this.maxEntryBytes = positiveInteger(options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES, "maxEntryBytes")
    if (this.maxEntryBytes > this.#maxBytes) throw new RangeError("maxEntryBytes must not exceed maxBytes")
    this.#maxAgeMs = positiveInteger(options.maxAgeMs ?? DEFAULT_MAX_AGE_MS, "maxAgeMs")
    this.#minFreeBytes = nonNegativeInteger(options.minFreeBytes ?? DEFAULT_MIN_FREE_BYTES, "minFreeBytes")
    this.#minimumRetentionMs = nonNegativeInteger(
      options.minimumRetentionMs ?? DEFAULT_MINIMUM_RETENTION_MS,
      "minimumRetentionMs",
    )
    const trimRatio = options.trimRatio ?? 0.8
    if (!Number.isFinite(trimRatio) || trimRatio <= 0 || trimRatio > 1) {
      throw new RangeError("trimRatio must be greater than 0 and at most 1")
    }
    this.#trimTargetBytes = Math.max(1, Math.floor(this.#maxBytes * trimRatio))
    this.#now = options.now ?? Date.now
    this.#loadCacache = options.loadCacache ?? (() => import("cacache"))
    this.#availableBytes = options.availableBytes ?? availableBytes
  }

  async acquire(key: string, signal?: AbortSignal): Promise<ReaderPresentationDiskCacheLease | undefined> {
    requireKey(key)
    signal?.throwIfAborted()
    if (this.#closed) return undefined
    const state = this.#leases.get(key) ?? { leases: 0, invalidated: false }
    if (state.invalidated) {
      this.#misses += 1
      return undefined
    }
    state.leases += 1
    this.#leases.set(key, state)
    let transferred = false
    let releaseEntryLock: (() => Promise<void>) | undefined
    try {
      releaseEntryLock = await this.#tryEntryLock(key)
      if (!releaseEntryLock) {
        this.#misses += 1
        return undefined
      }
      const api = await this.#api()
      const result = await api.get(this.#root, key, { memoize: false })
      signal?.throwIfAborted()
      if (state.invalidated) return undefined
      const metadata = parseMetadata(result.metadata)
      if (!metadata || result.data.byteLength <= 0 || result.data.byteLength > this.maxEntryBytes) {
        state.invalidated = true
        this.#misses += 1
        return undefined
      }
      this.#hits += 1
      transferred = true
      let released = false
      const release = () => {
        if (released) return
        released = true
        this.#releaseLease(key, state)
      }
      return {
        key,
        bytes: new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength),
        contentType: metadata.contentType,
        release,
        [Symbol.dispose]: release,
      }
    } catch (error) {
      if (signal?.aborted) throw signal.reason
      const code = (error as NodeJS.ErrnoException).code
      if (code === "EINTEGRITY" || code === "EBADSIZE") {
        state.invalidated = true
        this.#integrityFailures += 1
      }
      this.#misses += 1
      return undefined
    } finally {
      await releaseEntryLock?.().catch(() => undefined)
      if (!transferred) this.#releaseLease(key, state)
    }
  }

  put(key: string, value: CachedPresentation, signal?: AbortSignal): Promise<boolean> {
    requireKey(key)
    signal?.throwIfAborted()
    if (this.#closed || value.bytes.byteLength <= 0 || value.bytes.byteLength > this.maxEntryBytes) {
      this.#rejectedWrites += 1
      return Promise.resolve(false)
    }
    const active = this.#putFlights.get(key)
    if (active) return waitForFlight(active, signal)
    const flight = this.#putOne(key, value, signal).finally(() => {
      if (this.#putFlights.get(key) === flight) this.#putFlights.delete(key)
    })
    this.#putFlights.set(key, flight)
    return waitForFlight(flight, signal)
  }

  async invalidate(key: string): Promise<void> {
    requireKey(key)
    const state = this.#leases.get(key)
    if (state?.leases) {
      state.invalidated = true
      return
    }
    await this.#removeEntry(key)
  }

  clear(): Promise<ReaderPresentationDiskCacheCleanupResult> {
    return this.#cleanupSerialized("explicit", 0, true)
  }

  cleanup(reason: ReaderPresentationDiskCacheCleanupResult["reason"] = "explicit"): Promise<ReaderPresentationDiskCacheCleanupResult> {
    return this.#cleanupSerialized(reason)
  }

  async snapshot(): Promise<ReaderPresentationDiskCacheSnapshot> {
    const entries = this.#closed && !this.#cacache ? [] : await this.#entries()
    return this.#snapshotFrom(entries)
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    await Promise.allSettled([
      ...this.#putFlights.values(),
      ...this.#pendingRemovals,
      ...(this.#maintenance ? [this.#maintenance] : []),
      ...(this.#vacuum ? [this.#vacuum] : []),
    ])
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close()
  }

  async #putOne(key: string, value: CachedPresentation, signal?: AbortSignal): Promise<boolean> {
    const releaseEntryLock = await this.#tryEntryLock(key)
    if (!releaseEntryLock) {
      this.#rejectedWrites += 1
      return false
    }
    try {
      const integrity = sha256Integrity(value.bytes)
      if (!await this.#ensureCapacity(value.bytes.byteLength, integrity)) {
        this.#rejectedWrites += 1
        return false
      }
      signal?.throwIfAborted()
      const api = await this.#api()
      await api.put(this.#root, key, value.bytes, {
        integrity,
        memoize: false,
        metadata: {
          schemaVersion: 1,
          contentType: value.contentType,
          createdAt: this.#now(),
        } satisfies PresentationMetadata,
      })
      if (signal?.aborted) {
        await this.#removeEntry(key, true)
        this.#rejectedWrites += 1
        return false
      }
      this.#writes += 1
      return true
    } catch (error) {
      if (signal?.aborted) return false
      this.#rejectedWrites += 1
      return false
    } finally {
      await releaseEntryLock().catch(() => undefined)
    }
  }

  async #ensureCapacity(incomingBytes: number, integrity: string): Promise<boolean> {
    await mkdir(this.#root, { recursive: true })
    const api = await this.#api()
    const contentExists = Boolean(await api.get.hasContent(this.#root, integrity))
    const allocatedIncomingBytes = contentExists ? 0 : incomingBytes
    const freeBytes = await this.#availableBytes(this.#root)
    let snapshot = await this.snapshot()
    if (freeBytes !== undefined && freeBytes < this.#minFreeBytes + allocatedIncomingBytes) {
      snapshot = await this.#cleanupSerialized("low-disk", 0)
      const refreshedFreeBytes = await this.#availableBytes(this.#root)
      if (refreshedFreeBytes !== undefined && refreshedFreeBytes < this.#minFreeBytes + allocatedIncomingBytes) return false
    }
    if (snapshot.bytes + allocatedIncomingBytes <= this.#maxBytes) return true
    snapshot = await this.#cleanupSerialized(
      "budget",
      Math.max(0, Math.min(this.#trimTargetBytes, this.#maxBytes - allocatedIncomingBytes)),
    )
    return snapshot.bytes + allocatedIncomingBytes <= this.#maxBytes
  }

  async #cleanupSerialized(
    reason: ReaderPresentationDiskCacheCleanupResult["reason"],
    pressureTargetBytes?: number,
    forceAll = false,
  ): Promise<ReaderPresentationDiskCacheCleanupResult> {
    while (this.#maintenance) await this.#maintenance
    const maintenance = this.#cleanup(reason, pressureTargetBytes, forceAll).finally(() => {
      if (this.#maintenance === maintenance) this.#maintenance = undefined
    })
    this.#maintenance = maintenance
    return maintenance
  }

  async #cleanup(
    reason: ReaderPresentationDiskCacheCleanupResult["reason"],
    requestedPressureTargetBytes?: number,
    forceAll = false,
  ): Promise<ReaderPresentationDiskCacheCleanupResult> {
    const started = performance.now()
    const api = await this.#api()
    const entries = await this.#entries()
    const now = this.#now()
    const recentCutoff = now - this.#minimumRetentionMs
    const contentRefs = new Map<string, { count: number; size: number }>()
    for (const entry of entries) {
      const current = contentRefs.get(entry.integrity)
      if (current) current.count += 1
      else contentRefs.set(entry.integrity, { count: 1, size: entry.size })
    }
    let retainedBytes = [...contentRefs.values()].reduce((sum, value) => sum + value.size, 0)
    const removedKeys = new Set<string>()
    const ordered = [...entries].sort((left, right) => left.time - right.time || left.key.localeCompare(right.key))
    const remove = (entry: CacheEntry, ignoreRetention = false) => {
      if (removedKeys.has(entry.key) || this.#leases.get(entry.key)?.leases
        || (!ignoreRetention && this.#minimumRetentionMs > 0 && entry.time >= recentCutoff)) return false
      removedKeys.add(entry.key)
      const ref = contentRefs.get(entry.integrity)
      if (ref && --ref.count === 0) {
        retainedBytes -= ref.size
      }
      return true
    }
    if (forceAll) {
      for (const entry of ordered) {
        const active = this.#leases.get(entry.key)
        if (active?.leases) active.invalidated = true
        else remove(entry, true)
      }
    }
    for (const entry of ordered) {
      if (!forceAll && now - entry.metadata.createdAt > this.#maxAgeMs) remove(entry)
    }
    const pressureTarget = requestedPressureTargetBytes ?? (reason === "low-disk" ? 0 : this.#trimTargetBytes)
    if (!forceAll && (reason === "budget" || reason === "low-disk") && retainedBytes > pressureTarget) {
      for (const entry of ordered) {
        if (retainedBytes <= pressureTarget) break
        remove(entry)
      }
    }
    const removed = new Set<string>()
    for (const key of removedKeys) {
      const releaseEntryLock = await this.#tryEntryLock(key)
      if (!releaseEntryLock) continue
      try {
        await api.rm.entry(this.#root, key)
        removed.add(key)
        this.#leases.delete(key)
        this.#mutationVersion += 1
      } catch {
        // A failed tombstone is not counted as an eviction.
      } finally {
        await releaseEntryLock().catch(() => undefined)
      }
    }
    if (removed.size) await this.#verify()
    this.#evictions += removed.size
    const remaining = removed.size ? await this.#entries() : entries
    const remainingSnapshot = this.#snapshotFrom(remaining)
    const initialBytes = this.#snapshotFrom(entries).bytes
    return {
      ...remainingSnapshot,
      reason,
      removedEntries: removed.size,
      removedBytes: Math.max(0, initialBytes - remainingSnapshot.bytes),
      durationMs: performance.now() - started,
    }
  }

  async #entries(): Promise<CacheEntry[]> {
    const api = await this.#api()
    const listed = await api.ls(this.#root).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return {}
      throw error
    })
    const entries: CacheEntry[] = []
    for (const [key, value] of Object.entries(listed)) {
      const metadata = parseMetadata(value.metadata)
      if (!KEY_PATTERN.test(key) || !metadata || !Number.isSafeInteger(value.size) || value.size <= 0) continue
      entries.push({ key, integrity: value.integrity, size: value.size, time: metadata.createdAt, metadata })
    }
    return entries
  }

  #snapshotFrom(entries: readonly CacheEntry[]): ReaderPresentationDiskCacheSnapshot {
    const contents = new Map<string, number>()
    for (const entry of entries) contents.set(entry.integrity, entry.size)
    return {
      entries: entries.length,
      bytes: [...contents.values()].reduce((sum, size) => sum + size, 0),
      maxBytes: this.#maxBytes,
      maxEntryBytes: this.maxEntryBytes,
      activeLeases: [...this.#leases.values()].reduce((sum, state) => sum + state.leases, 0),
      hits: this.#hits,
      misses: this.#misses,
      writes: this.#writes,
      rejectedWrites: this.#rejectedWrites,
      evictions: this.#evictions,
      integrityFailures: this.#integrityFailures,
    }
  }

  async #removeEntry(key: string, entryLockHeld = false): Promise<void> {
    const releaseEntryLock = entryLockHeld ? undefined : await this.#tryEntryLock(key, true)
    if (!entryLockHeld && !releaseEntryLock) return
    const api = await this.#api()
    try {
      await api.rm.entry(this.#root, key)
      this.#mutationVersion += 1
    } catch {
      const state = this.#leases.get(key)
      if (state) state.invalidated = true
      return
    } finally {
      await releaseEntryLock?.().catch(() => undefined)
    }
    this.#leases.delete(key)
    await this.#verify()
  }

  async #verify(): Promise<void> {
    const requiredVersion = this.#mutationVersion
    if (this.#verifiedMutationVersion >= requiredVersion) return
    if (this.#vacuum) {
      await this.#vacuum
      if (this.#verifiedMutationVersion >= requiredVersion) return
    }
    const startedVersion = this.#mutationVersion
    const vacuum = this.#api()
      .then((api) => api.verify(this.#root, { concurrency: 4 }))
      .then(() => { this.#verifiedMutationVersion = Math.max(this.#verifiedMutationVersion, startedVersion) })
      .finally(() => {
        if (this.#vacuum === vacuum) this.#vacuum = undefined
      })
    this.#vacuum = vacuum
    await vacuum
    if (this.#verifiedMutationVersion < requiredVersion) await this.#verify()
  }

  #releaseLease(key: string, state: LeaseState): void {
    state.leases = Math.max(0, state.leases - 1)
    if (state.leases > 0) return
    if (state.invalidated) this.#scheduleRemove(key)
    else this.#leases.delete(key)
  }

  #scheduleRemove(key: string): void {
    const removal = this.#removeEntry(key).catch(() => undefined).finally(() => this.#pendingRemovals.delete(removal))
    this.#pendingRemovals.add(removal)
  }

  #api(): Promise<CacacheApi> {
    this.#cacache ??= this.#loadCacache()
    return this.#cacache
  }

  async #tryEntryLock(key: string, wait = false): Promise<(() => Promise<void>) | undefined> {
    await this.#prepareEntryLockRoot()
    const target = join(this.#entryLockRoot, createHash("sha256").update(key).digest("hex"))
    try {
      return await lock(target, {
        lockfilePath: `${target}.lock`,
        realpath: false,
        retries: wait ? { retries: 5, factor: 1, minTimeout: 10, maxTimeout: 50 } : 0,
        stale: ENTRY_LOCK_STALE_MS,
        update: ENTRY_LOCK_UPDATE_MS,
      })
    } catch (error) {
      if (isAlreadyLocked(error)) return undefined
      throw error
    }
  }

  #prepareEntryLockRoot(): Promise<void> {
    if (!this.#entryLockRootReady) {
      const pending = mkdir(this.#entryLockRoot, { recursive: true }).then(() => undefined).catch((error) => {
        if (this.#entryLockRootReady === pending) this.#entryLockRootReady = undefined
        throw error
      })
      this.#entryLockRootReady = pending
    }
    return this.#entryLockRootReady
  }
}

function parseMetadata(value: unknown): PresentationMetadata | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  return record.schemaVersion === 1
    && typeof record.contentType === "string"
    && /^[-\w.+]+\/[-\w.+]+$/.test(record.contentType)
    && typeof record.createdAt === "number"
    && Number.isFinite(record.createdAt)
    ? { schemaVersion: 1, contentType: record.contentType, createdAt: record.createdAt }
    : undefined
}

function sha256Integrity(bytes: Uint8Array): string {
  return `sha256-${createHash("sha256").update(bytes).digest("base64")}`
}

async function availableBytes(path: string): Promise<number | undefined> {
  try {
    const stats = await statfs(path)
    return Number(stats.bavail) * Number(stats.bsize)
  } catch {
    return undefined
  }
}

function requireKey(key: string): void {
  if (!KEY_PATTERN.test(key)) throw new TypeError("presentation cache key must be an opaque typed v1 key")
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`)
  return value
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer`)
  return value
}

function isAlreadyLocked(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ELOCKED"
}

async function waitForFlight(flight: Promise<boolean>, signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted()
  if (!signal) return flight
  return new Promise<boolean>((resolve, reject) => {
    const onAbort = () => { cleanup(); reject(signal.reason) }
    const cleanup = () => signal.removeEventListener("abort", onAbort)
    signal.addEventListener("abort", onAbort, { once: true })
    flight.then(
      (value) => { cleanup(); resolve(value) },
      (error) => { cleanup(); reject(error) },
    )
  })
}
