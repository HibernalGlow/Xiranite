import { createHash } from "node:crypto"
import { realpath, stat } from "node:fs/promises"
import { LRUCache } from "lru-cache"

import type { ArchiveEntry } from "../../../ports/ArchiveProvider.js"

export interface SevenZipArchiveIndex {
  entries: readonly ArchiveEntry[]
  solid: boolean
}

export interface SevenZipArchiveIndexLoadOptions {
  sourcePath: string
  executablePath: string
  executableVersion: string
  maxListingBytes: number
  signal?: AbortSignal
  load(): Promise<SevenZipArchiveIndex>
}

const DEFAULT_MAX_ENTRIES = 32

/** Host-lifetime cache for verified 7-Zip index descriptors. */
export class SevenZipArchiveIndexCache implements AsyncDisposable {
  readonly #entries: LRUCache<string, SevenZipArchiveIndex>
  readonly #loads = new Map<string, Promise<SevenZipArchiveIndex>>()
  readonly #sourceRevisions = new Map<string, string>()
  readonly #enabled: boolean
  #closed = false

  constructor(maxEntries = DEFAULT_MAX_ENTRIES) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 0) {
      throw new RangeError(`Invalid SevenZip archive index cache entry budget: ${maxEntries}`)
    }
    this.#enabled = maxEntries > 0
    this.#entries = this.#enabled ? new LRUCache({ max: maxEntries }) : new LRUCache({ max: 1 })
  }

  get size(): number {
    return this.#entries.size
  }

  async getOrLoad(options: SevenZipArchiveIndexLoadOptions): Promise<SevenZipArchiveIndex> {
    this.#assertOpen()
    options.signal?.throwIfAborted()
    if (!this.#enabled) return waitWithSignal(options.load(), options.signal)
    const revision = await revisionKey(options).catch(() => undefined)
    options.signal?.throwIfAborted()
    if (!revision) return waitWithSignal(options.load(), options.signal)
    const { key } = revision
    this.#replaceSourceRevision(revision.sourceIdentity, key)
    const cached = this.#entries.get(key)
    if (cached) return cloneIndex(cached)
    let loading = this.#loads.get(key)
    if (!loading) {
      loading = options.load().then((index) => {
        this.#assertOpen()
        const normalized = cloneIndex(index)
        if (this.#sourceRevisions.get(revision.sourceIdentity) === key) this.#entries.set(key, normalized)
        return normalized
      })
      this.#loads.set(key, loading)
      void loading.then(
        () => { if (this.#loads.get(key) === loading) this.#loads.delete(key) },
        () => { if (this.#loads.get(key) === loading) this.#loads.delete(key) },
      )
    }
    return cloneIndex(await waitWithSignal(loading, options.signal))
  }

  clear(): void {
    this.#entries.clear()
    this.#sourceRevisions.clear()
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    this.#entries.clear()
    this.#sourceRevisions.clear()
    this.#loads.clear()
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("SevenZip archive index cache is closed.")
  }

  #replaceSourceRevision(sourceIdentity: string, key: string): void {
    const previous = this.#sourceRevisions.get(sourceIdentity)
    if (previous && previous !== key) this.#entries.delete(previous)
    this.#sourceRevisions.set(sourceIdentity, key)
  }
}

interface ArchiveRevisionKey {
  key: string
  sourceIdentity: string
}

async function revisionKey(options: SevenZipArchiveIndexLoadOptions): Promise<ArchiveRevisionKey> {
  const identity = await realpath(options.sourcePath)
  const source = await stat(identity, { bigint: true })
  const hash = createHash("sha256")
  for (const value of [
    identity,
    source.size,
    source.mtimeNs,
    source.ctimeNs,
    source.ino,
    options.executablePath,
    options.executableVersion,
    options.maxListingBytes,
  ]) {
    hash.update(String(value))
    hash.update("\0")
  }
  return { key: hash.digest("hex"), sourceIdentity: identity }
}

function cloneIndex(index: SevenZipArchiveIndex): SevenZipArchiveIndex {
  return {
    solid: index.solid,
    entries: index.entries.map((entry) => ({ ...entry })),
  }
}

function waitWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => { cleanup(); reject(signal.reason) }
    const cleanup = () => signal.removeEventListener("abort", onAbort)
    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(
      (value) => { cleanup(); resolve(value) },
      (error) => { cleanup(); reject(error) },
    )
  })
}
