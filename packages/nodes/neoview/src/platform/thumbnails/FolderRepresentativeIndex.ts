import { readdir, stat } from "node:fs/promises"
import { join } from "node:path"

import { pageMediaType } from "../../domain/page/media.js"
import { compareNaturalPath } from "../../domain/sorting/natural-sort.js"

interface DirectoryEntryLike {
  name: string
  isFile(): boolean
}

interface FileStatsLike {
  size: number
  mtimeMs: number
  isFile(): boolean
}

export interface FolderRepresentativeIndexOptions {
  maxEntries?: number
  readDirectory?: (path: string) => Promise<readonly DirectoryEntryLike[]>
  statPath?: (path: string) => Promise<FileStatsLike>
}

interface RepresentativeEntry {
  directoryModifiedAtMs: number
  sources?: readonly RepresentativeSource[]
  version?: string
}

interface RepresentativeSource { name: string; size: number; modifiedAtMs: number }

interface RepresentativeFlight {
  controller: AbortController
  promise: Promise<string | undefined>
  waiters: number
  settled: boolean
}

const DEFAULT_MAX_ENTRIES = 2_048

export class FolderRepresentativeIndex {
  readonly #maxEntries: number
  readonly #readDirectory: (path: string) => Promise<readonly DirectoryEntryLike[]>
  readonly #statPath: (path: string) => Promise<FileStatsLike>
  readonly #cache = new Map<string, RepresentativeEntry>()
  readonly #flights = new Map<string, RepresentativeFlight>()
  readonly #revisions = new Map<string, number>()

  constructor(options: FolderRepresentativeIndexOptions = {}) {
    this.#maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
    if (!Number.isSafeInteger(this.#maxEntries) || this.#maxEntries < 1 || this.#maxEntries > 100_000) {
      throw new RangeError("Folder representative maxEntries must be an integer from 1 to 100000.")
    }
    this.#readDirectory = options.readDirectory ?? defaultReadDirectory
    this.#statPath = options.statPath ?? stat
  }

  describe(path: string, directoryModifiedAtMs: number, signal?: AbortSignal, count = 1): Promise<string | undefined> {
    if (!path) return Promise.reject(new Error("Folder representative path cannot be empty."))
    if (!Number.isSafeInteger(directoryModifiedAtMs) || directoryModifiedAtMs < 0) {
      return Promise.reject(new RangeError("Folder representative directory mtime must be a non-negative integer."))
    }
    if (!Number.isSafeInteger(count) || count < 1 || count > 16) {
      return Promise.reject(new RangeError("Folder representative count must be an integer from 1 to 16."))
    }
    signal?.throwIfAborted()
    const cacheKey = `${path}\0${count}`
    const flightKey = `${cacheKey}\0${directoryModifiedAtMs}`
    let flight = this.#flights.get(flightKey)
    if (!flight) {
      const revision = (this.#revisions.get(cacheKey) ?? 0) + 1
      this.#revisions.set(cacheKey, revision)
      const controller = new AbortController()
      const created: RepresentativeFlight = {
        controller,
        waiters: 0,
        settled: false,
        promise: Promise.resolve(undefined),
      }
      created.promise = this.#resolve(path, cacheKey, directoryModifiedAtMs, count, controller.signal)
        .then((entry) => {
          if (this.#revisions.get(cacheKey) === revision) this.#setCache(cacheKey, entry)
          return entry.version
        })
        .finally(() => {
          created.settled = true
          if (this.#flights.get(flightKey) === created) this.#flights.delete(flightKey)
        })
      void created.promise.catch(() => undefined)
      this.#flights.set(flightKey, created)
      flight = created
    }
    flight.waiters += 1
    return waitForFlight(flight.promise, signal).finally(() => {
      flight!.waiters -= 1
      if (!flight!.waiters && !flight!.settled) flight!.controller.abort(abortError("Folder representative demand released."))
    })
  }

  clear(): void {
    for (const flight of this.#flights.values()) flight.controller.abort(abortError("Folder representative index cleared."))
    this.#flights.clear()
    this.#cache.clear()
    this.#revisions.clear()
  }

  async #resolve(path: string, cacheKey: string, directoryModifiedAtMs: number, count: number, signal: AbortSignal): Promise<RepresentativeEntry> {
    signal.throwIfAborted()
    const cached = this.#cache.get(cacheKey)
    if (cached?.directoryModifiedAtMs === directoryModifiedAtMs) {
      if (!cached.sources?.length) {
        this.#touch(cacheKey, cached)
        return cached
      }
      try {
        const sources = await Promise.all(cached.sources.map(async (source) => {
          const sourceStats = await this.#statPath(join(path, source.name))
          return sourceStats.isFile() ? representativeSource(source.name, sourceStats) : undefined
        }))
        signal.throwIfAborted()
        if (sources.every((source): source is RepresentativeSource => Boolean(source))) {
          const entry = representativeEntry(directoryModifiedAtMs, sources)
          this.#touch(cacheKey, entry)
          return entry
        }
      } catch (error) {
        if (!isMissingFile(error)) throw error
      }
    }
    return this.#scan(path, directoryModifiedAtMs, count, signal, true)
  }

  async #scan(
    path: string,
    directoryModifiedAtMs: number,
    count: number,
    signal: AbortSignal,
    retryMissing: boolean,
  ): Promise<RepresentativeEntry> {
    signal.throwIfAborted()
    const entries = await this.#readDirectory(path)
    signal.throwIfAborted()
    const representatives = entries
      .filter((entry) => entry.isFile() && Boolean(pageMediaType(entry.name)))
      .map((entry) => entry.name)
      .sort((left, right) => compareNaturalPath(left, right))
      .slice(0, count)
    if (!representatives.length) return { directoryModifiedAtMs }
    try {
      const sources = await Promise.all(representatives.map(async (name) => {
        const sourceStats = await this.#statPath(join(path, name))
        return sourceStats.isFile() ? representativeSource(name, sourceStats) : undefined
      }))
      signal.throwIfAborted()
      const present = sources.filter((source): source is RepresentativeSource => Boolean(source))
      if (present.length) return representativeEntry(directoryModifiedAtMs, present)
    } catch (error) {
      if (!isMissingFile(error)) throw error
      if (retryMissing) return this.#scan(path, directoryModifiedAtMs, count, signal, false)
    }
    return { directoryModifiedAtMs }
  }

  #setCache(path: string, entry: RepresentativeEntry): void {
    this.#cache.delete(path)
    this.#cache.set(path, entry)
    while (this.#cache.size > this.#maxEntries) {
      const oldest = this.#cache.keys().next().value as string | undefined
      if (!oldest) break
      this.#cache.delete(oldest)
      this.#revisions.delete(oldest)
    }
  }

  #touch(path: string, entry: RepresentativeEntry): void {
    this.#cache.delete(path)
    this.#cache.set(path, entry)
  }
}

function representativeSource(name: string, sourceStats: FileStatsLike): RepresentativeSource {
  return { name, size: sourceStats.size, modifiedAtMs: Math.trunc(sourceStats.mtimeMs) }
}

function representativeEntry(directoryModifiedAtMs: number, sources: readonly RepresentativeSource[]): RepresentativeEntry {
  return {
    directoryModifiedAtMs,
    sources,
    version: sources.map((source) => `${source.name}:${source.size}:${source.modifiedAtMs}`).join("|"),
  }
}

async function defaultReadDirectory(path: string): Promise<readonly DirectoryEntryLike[]> {
  return readdir(path, { withFileTypes: true })
}

function waitForFlight<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason) }
    const cleanup = () => signal.removeEventListener("abort", abort)
    signal.addEventListener("abort", abort, { once: true })
    promise.then(
      (value) => { cleanup(); resolve(value) },
      (error) => { cleanup(); reject(error) },
    )
  })
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT")
}

function abortError(message: string): DOMException {
  return new DOMException(message, "AbortError")
}
