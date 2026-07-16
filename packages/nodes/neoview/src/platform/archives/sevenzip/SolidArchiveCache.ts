export interface CacheableSolidArchiveMaterializer extends AsyncDisposable {
  readonly isComplete: boolean
  pathFor(entryId: string, signal?: AbortSignal): Promise<string>
  close(): Promise<void>
}

export interface SolidArchiveCacheAcquireOptions {
  fingerprint: string
  sourceIdentity: string
  materializedBytes: number
  create(): CacheableSolidArchiveMaterializer
}

export interface SolidArchiveCacheLease extends AsyncDisposable {
  readonly materializer: CacheableSolidArchiveMaterializer
  invalidate(): Promise<void>
  release(): Promise<void>
}

export interface SolidArchiveCacheOptions {
  maxBytes?: number
}

interface CacheEntry {
  fingerprint: string
  sourceIdentity: string
  materializedBytes: number
  materializer: CacheableSolidArchiveMaterializer
  references: number
  lastUsed: number
  stale: boolean
  closing?: Promise<void>
}

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024

/** Host-lifetime cache for fully verified solid archive materializations. */
export class SolidArchiveCache implements AsyncDisposable {
  readonly #maxBytes: number
  readonly #entries = new Map<string, CacheEntry>()
  #clock = 0
  #closed = false
  #closing?: Promise<void>

  constructor(options: SolidArchiveCacheOptions = {}) {
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
      throw new RangeError(`Invalid solid archive cache byte budget: ${maxBytes}`)
    }
    this.#maxBytes = maxBytes
  }

  get entryCount(): number {
    return this.#entries.size
  }

  get retainedBytes(): number {
    let total = 0
    for (const entry of this.#entries.values()) total += entry.materializedBytes
    return total
  }

  snapshot(): { entries: number; retainedBytes: number; maxBytes: number } {
    return { entries: this.entryCount, retainedBytes: this.retainedBytes, maxBytes: this.#maxBytes }
  }

  async trimTo(maxBytes: number): Promise<{ evictedEntries: number; retainedBytes: number; activeEntries: number }> {
    this.#assertOpen()
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError(`Invalid solid archive cache trim target: ${maxBytes}`)
    const evictedEntries = await this.#evictToBudget(maxBytes)
    return {
      evictedEntries,
      retainedBytes: this.retainedBytes,
      activeEntries: [...this.#entries.values()].filter((entry) => entry.references > 0).length,
    }
  }

  async acquire(options: SolidArchiveCacheAcquireOptions): Promise<SolidArchiveCacheLease> {
    this.#assertOpen()
    assertAcquireOptions(options)
    await this.#invalidateChangedSource(options.sourceIdentity, options.fingerprint)
    this.#assertOpen()

    let entry = this.#entries.get(options.fingerprint)
    let created = false
    if (!entry) {
      created = true
      entry = {
        fingerprint: options.fingerprint,
        sourceIdentity: options.sourceIdentity,
        materializedBytes: options.materializedBytes,
        materializer: options.create(),
        references: 0,
        lastUsed: ++this.#clock,
        stale: false,
      }
      this.#entries.set(entry.fingerprint, entry)
    }
    entry.references += 1
    entry.lastUsed = ++this.#clock
    try {
      await this.#evictToBudget()
    } catch (error) {
      entry.references -= 1
      if (created) {
        this.#entries.delete(entry.fingerprint)
        await this.#closeEntry(entry).catch(() => undefined)
      }
      throw error
    }
    let released = false
    return {
      materializer: entry.materializer,
      invalidate: async () => {
        if (released) return
        entry!.stale = true
        this.#entries.delete(entry!.fingerprint)
      },
      release: async () => {
        if (released) return
        released = true
        await this.#releaseEntry(entry!)
      },
      [Symbol.asyncDispose]: async () => {
        if (released) return
        released = true
        await this.#releaseEntry(entry!)
      },
    }
  }

  async close(): Promise<void> {
    if (this.#closing) return this.#closing
    this.#closed = true
    const entries = [...this.#entries.values()]
    this.#entries.clear()
    for (const entry of entries) entry.stale = true
    this.#closing = Promise.resolve().then(async () => {
      const results = await Promise.allSettled(entries.map((entry) => this.#closeEntry(entry)))
      const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : [])
      if (errors.length) throw new AggregateError(errors, "Failed to close the solid archive cache.")
    })
    return this.#closing
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }

  async #invalidateChangedSource(sourceIdentity: string, fingerprint: string): Promise<void> {
    const stale = [...this.#entries.values()].filter((entry) => (
      entry.sourceIdentity === sourceIdentity && entry.fingerprint !== fingerprint
    ))
    for (const entry of stale) {
      entry.stale = true
      this.#entries.delete(entry.fingerprint)
    }
    await Promise.all(stale.filter((entry) => entry.references === 0).map((entry) => this.#closeEntry(entry)))
  }

  async #releaseEntry(entry: CacheEntry): Promise<void> {
    entry.references = Math.max(0, entry.references - 1)
    entry.lastUsed = ++this.#clock
    if (entry.references > 0) return
    if (entry.stale || !entry.materializer.isComplete || entry.materializedBytes > this.#maxBytes) {
      this.#entries.delete(entry.fingerprint)
      await this.#closeEntry(entry)
      return
    }
    await this.#evictToBudget()
  }

  async #evictToBudget(maxBytes = this.#maxBytes): Promise<number> {
    let retainedBytes = this.retainedBytes
    if (retainedBytes <= maxBytes) return 0
    const candidates = [...this.#entries.values()]
      .filter((entry) => entry.references === 0)
      .sort((left, right) => left.lastUsed - right.lastUsed)
    let evictedEntries = 0
    for (const entry of candidates) {
      if (retainedBytes <= maxBytes) break
      this.#entries.delete(entry.fingerprint)
      retainedBytes -= entry.materializedBytes
      evictedEntries += 1
      await this.#closeEntry(entry)
    }
    return evictedEntries
  }

  #closeEntry(entry: CacheEntry): Promise<void> {
    entry.closing ??= entry.materializer.close()
    return entry.closing
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Solid archive cache is closed.")
  }
}

function assertAcquireOptions(options: SolidArchiveCacheAcquireOptions): void {
  if (!options.fingerprint) throw new Error("Solid archive cache fingerprint must not be empty.")
  if (!options.sourceIdentity) throw new Error("Solid archive cache source identity must not be empty.")
  if (!Number.isSafeInteger(options.materializedBytes) || options.materializedBytes < 0) {
    throw new RangeError(`Invalid solid archive cache entry size: ${options.materializedBytes}`)
  }
}
