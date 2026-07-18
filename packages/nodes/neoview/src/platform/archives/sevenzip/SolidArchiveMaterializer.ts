import { spawn, type ChildProcessByStdio } from "node:child_process"
import { createReadStream } from "node:fs"
import { mkdir, open, mkdtemp, readFile, rm, type FileHandle } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable, type Writable } from "node:stream"

import type { ArchiveEntry, ArchivePreloadDemand } from "../../../ports/ArchiveProvider.js"
import type { ResourceScheduler } from "../../../ports/ResourceScheduler.js"
import { appendCrc32 } from "./incremental-crc32.js"
import { SolidArchiveMemoryCache } from "./SolidArchiveCache.js"
import type { SevenZipExecutable } from "./SevenZipExecutable.js"
import { assertSevenZipPassword, writeSevenZipPassword } from "./SevenZipExecutable.js"

const MAX_STDERR_BYTES = 256 * 1024
type SevenZipChild = ChildProcessByStdio<Writable, Readable, Readable>

interface DeferredPath {
  promise: Promise<string>
  resolve(path: string): void
  reject(error: unknown): void
  settled: boolean
}

export interface SolidArchiveMaterializerOptions {
  sourcePath: string
  executable: SevenZipExecutable
  entries: readonly ArchiveEntry[]
  resourceScheduler: ResourceScheduler
  tempDirectory?: string
  maxMaterializedBytes?: number
  memoryCacheBytes?: number
  maxMemoryEntryBytes?: number
  memoryCache?: SolidArchiveMemoryCache
  memoryKeyPrefix?: string
  rawPassword?: Uint8Array
}

const DEFAULT_MEMORY_CACHE_BYTES = 0
const DEFAULT_MAX_MEMORY_ENTRY_BYTES = 8 * 1024 * 1024

export class SolidArchiveMaterializer implements AsyncDisposable {
  readonly #sourcePath: string
  readonly #executable: SevenZipExecutable
  readonly #entries: readonly ArchiveEntry[]
  readonly #entriesById: ReadonlyMap<string, ArchiveEntry>
  readonly #resourceScheduler: ResourceScheduler
  readonly #tempDirectory?: string
  readonly #rawPassword?: Uint8Array
  readonly #maxMemoryEntryBytes: number
  readonly #memoryEnabled: boolean
  readonly #memory: SolidArchiveMemoryCache
  readonly #ownsMemory: boolean
  readonly #memoryKeyPrefix: string
  readonly #memoryLoads = new Map<string, Promise<Uint8Array>>()
  readonly #lifecycle = new AbortController()
  readonly #paths = new Map<string, DeferredPath>()
  readonly #awaitingProcessVerification: Array<{ entryId: string; path: string }> = []
  readonly #roots = new Set<string>()
  #run?: Promise<void>
  #root?: string
  readonly #preloadDemands = new Map<string, ArchivePreloadDemand>()
  #requiredEntryIndex = -1
  #child?: SevenZipChild
  #closed = false
  #complete = false

  constructor(options: SolidArchiveMaterializerOptions) {
    this.#sourcePath = options.sourcePath
    this.#executable = options.executable
    this.#entries = options.entries.filter((entry) => entry.kind === "file")
    this.#entriesById = new Map(this.#entries.map((entry) => [entry.id, entry]))
    this.#resourceScheduler = options.resourceScheduler
    this.#tempDirectory = options.tempDirectory
    this.#memoryKeyPrefix = options.memoryKeyPrefix ?? options.sourcePath
    this.#ownsMemory = !options.memoryCache
    const memoryCacheBytes = options.memoryCacheBytes ?? DEFAULT_MEMORY_CACHE_BYTES
    if (!Number.isSafeInteger(memoryCacheBytes) || memoryCacheBytes < 0) {
      throw new RangeError(`Invalid solid archive memory cache byte budget: ${memoryCacheBytes}`)
    }
    const maxMemoryEntryBytes = options.maxMemoryEntryBytes
      ?? Math.min(DEFAULT_MAX_MEMORY_ENTRY_BYTES, memoryCacheBytes)
    if (!Number.isSafeInteger(maxMemoryEntryBytes) || maxMemoryEntryBytes < 0) {
      throw new RangeError(`Invalid solid archive memory entry byte budget: ${maxMemoryEntryBytes}`)
    }
    if (maxMemoryEntryBytes > memoryCacheBytes) {
      throw new RangeError("Solid archive memory entry budget must not exceed the memory budget.")
    }
    this.#memory = options.memoryCache ?? new SolidArchiveMemoryCache(memoryCacheBytes, maxMemoryEntryBytes)
    this.#maxMemoryEntryBytes = this.#memory.maxEntryBytes
    this.#memoryEnabled = this.#memory.maxBytes > 0 && this.#maxMemoryEntryBytes > 0
    if (options.rawPassword) {
      assertSevenZipPassword(options.rawPassword)
      this.#rawPassword = options.rawPassword.slice()
    }
    const maxMaterializedBytes = options.maxMaterializedBytes ?? 64 * 1024 * 1024 * 1024
    if (!Number.isSafeInteger(maxMaterializedBytes) || maxMaterializedBytes < 0) {
      throw new RangeError(`Invalid solid archive materialization budget: ${maxMaterializedBytes}`)
    }
    const totalBytes = this.#entries.reduce((total, entry) => total + entry.uncompressedSize, 0)
    if (totalBytes > maxMaterializedBytes) {
      throw new Error(`Solid archive requires ${totalBytes} materialized bytes, exceeding the ${maxMaterializedBytes} byte budget.`)
    }
    for (const entry of this.#entries) this.#paths.set(entry.id, deferredPath())
  }

  get isComplete(): boolean {
    return this.#complete
  }

  async streamFor(entryId: string, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    this.#assertOpen()
    signal?.throwIfAborted()
    const entry = this.#entriesById.get(entryId)
    if (!entry) throw new Error(`Solid archive entry was not indexed: ${entryId}`)
    const cached = this.#memory.get(this.#memoryKey(entryId))
    if (cached) return byteStream(cached)
    const path = await this.pathFor(entryId, signal)
    signal?.throwIfAborted()
    if (entry.uncompressedSize > this.#maxMemoryEntryBytes || !this.#memoryEnabled) {
      return fileStream(path, signal, this.#lifecycle.signal)
    }
    let loading = this.#memoryLoads.get(entryId)
    if (!loading) {
      loading = this.#loadMemoryEntry(entryId, path, entry.uncompressedSize)
      this.#memoryLoads.set(entryId, loading)
      void loading.then(
        () => { if (this.#memoryLoads.get(entryId) === loading) this.#memoryLoads.delete(entryId) },
        () => { if (this.#memoryLoads.get(entryId) === loading) this.#memoryLoads.delete(entryId) },
      )
    }
    const bytes = await waitWithSignal(loading, signal)
    signal?.throwIfAborted()
    return byteStream(bytes)
  }

  async pathFor(entryId: string, signal?: AbortSignal): Promise<string> {
    this.#assertOpen()
    signal?.throwIfAborted()
    const target = this.#paths.get(entryId)
    if (!target) throw new Error(`Solid archive entry was not indexed: ${entryId}`)
    const entryIndex = this.#entries.findIndex((entry) => entry.id === entryId)
    this.#requiredEntryIndex = Math.max(this.#requiredEntryIndex, entryIndex)
    this.#start()
    return waitWithSignal(target.promise, signal)
  }

  /**
   * Update speculative work without changing the hard entry demands made by
   * pathFor/streamFor. A lower target stops the current sequential extractor
   * at the next verified entry boundary; a later generation can resume from a
   * fresh extractor when another entry is required.
   */
  updatePreloadDemand(demand: ArchivePreloadDemand): void {
    assertPreloadDemand(demand)
    for (const entryId of demand.entryIds) {
      if (!this.#entriesById.has(entryId)) throw new Error(`Solid archive preload entry was not indexed: ${entryId}`)
    }
    const ownerId = demand.ownerId ?? "default"
    const previous = this.#preloadDemands.get(ownerId)
    if (previous && demand.generation < previous.generation) return
    if (demand.entryIds.length) {
      this.#preloadDemands.set(ownerId, { ...demand, ownerId, entryIds: [...demand.entryIds] })
    } else {
      this.#preloadDemands.delete(ownerId)
    }
    if (demand.entryIds.length) this.#start()
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    const reason = new Error(`Solid archive materializer is closed: ${this.#sourcePath}`)
    this.#lifecycle.abort(reason)
    this.#child?.kill()
    this.#rawPassword?.fill(0)
    if (this.#ownsMemory) this.#memory.clear()
    await this.#run?.catch(() => undefined)
    this.#rejectPending(reason)
    await Promise.all([...this.#roots].map((root) => rm(root, { recursive: true, force: true })))
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }

  #start(): void {
    if (this.#run || this.#complete) return
    let run: Promise<void>
    run = this.#extract().catch((error) => {
      this.#rejectPending(error)
      throw error
    }).finally(() => {
      if (this.#run === run) this.#run = undefined
    })
    this.#run = run
    void run.catch(() => undefined)
  }

  async #extract(): Promise<void> {
    const signal = this.#lifecycle.signal
    const lease = await this.#resourceScheduler.acquire({
      resource: "cpu",
      kind: "neoview.archive-solid-extract",
      priority: "interactive",
    }, signal)
    try {
      const parent = this.#tempDirectory ?? tmpdir()
      await mkdir(parent, { recursive: true })
      this.#root = await mkdtemp(join(parent, "xiranite-neoview-solid-"))
      this.#roots.add(this.#root)
      this.#awaitingProcessVerification.length = 0
      signal.throwIfAborted()
      const child = spawn(this.#executable.path, [
        "x", "-so", "-bd", "-bb0", "-sccUTF-8", "-spd", "--", this.#sourcePath,
      ], {
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      })
      const passwordWrite = writeSevenZipPassword(child.stdin, this.#rawPassword)
      this.#rawPassword?.fill(0)
      this.#child = child
      const onAbort = () => child.kill()
      signal.addEventListener("abort", onAbort, { once: true })
      try {
        const demultiplex = this.#demultiplex(child.stdout, signal).then(
          (stoppedEarly) => ({ stoppedEarly } as const),
          (error: unknown) => ({ error } as const),
        )
        const [exit, stderr, demultiplexResult] = await Promise.all([
          processExit(child),
          readStderr(child),
          demultiplex,
          passwordWrite,
        ])
        signal.throwIfAborted()
        if (exit.error) throw exit.error
        if ("error" in demultiplexResult) {
          if (stderr.trim()) throw new Error(stderr.trim())
          throw demultiplexResult.error
        }
        if (demultiplexResult.stoppedEarly) {
          for (const pending of this.#awaitingProcessVerification) this.#resolve(pending.entryId, pending.path)
          this.#awaitingProcessVerification.length = 0
          return
        }
        if (exit.code !== 0 && stderr.trim()) throw new Error(stderr.trim())
        if (exit.code !== 0) throw new Error(`7-Zip solid extraction exited with code ${exit.code}.`)
        for (const pending of this.#awaitingProcessVerification) this.#resolve(pending.entryId, pending.path)
        this.#awaitingProcessVerification.length = 0
        this.#complete = true
      } finally {
        signal.removeEventListener("abort", onAbort)
        this.#child = undefined
      }
    } finally {
      lease.release()
    }
  }

  async #demultiplex(stdout: Readable, signal: AbortSignal): Promise<boolean> {
    let entryIndex = 0
    let handle: FileHandle | undefined
    let remaining = 0
    let crc32 = 0

    const finishEntry = async (): Promise<boolean> => {
      const finishedIndex = entryIndex
      const entry = this.#entries[entryIndex]!
      const path = join(this.#root!, `${entryIndex.toString().padStart(8, "0")}.entry`)
      await handle?.close()
      handle = undefined
      if (entry.crc32 !== undefined) {
        if (crc32 !== entry.crc32) {
          throw new Error(`Solid archive CRC mismatch for ${entry.path}: expected ${hexCrc32(entry.crc32)}, received ${hexCrc32(crc32)}.`)
        }
        this.#resolve(entry.id, path)
      } else {
        this.#awaitingProcessVerification.push({ entryId: entry.id, path })
      }
      entryIndex += 1
      return this.#shouldStopAfter(finishedIndex)
    }

    const prepareEntry = async (): Promise<boolean> => {
      while (entryIndex < this.#entries.length) {
        signal.throwIfAborted()
        const entry = this.#entries[entryIndex]!
        const path = join(this.#root!, `${entryIndex.toString().padStart(8, "0")}.entry`)
        handle = await open(path, "wx")
        remaining = entry.uncompressedSize
        crc32 = 0
        if (remaining > 0) return
        if (await finishEntry()) return true
      }
      return false
    }

    try {
      if (await prepareEntry()) {
        this.#child?.kill()
        return true
      }
      for await (const chunk of stdout) {
        signal.throwIfAborted()
        const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk as Uint8Array
        let offset = 0
        while (offset < bytes.byteLength) {
          if (!handle || entryIndex >= this.#entries.length) {
            throw new Error("7-Zip solid extraction emitted more bytes than its index declares.")
          }
          const length = Math.min(remaining, bytes.byteLength - offset)
          const slice = bytes.subarray(offset, offset + length)
          await writeAll(handle, slice)
          if (this.#entries[entryIndex]!.crc32 !== undefined) crc32 = appendCrc32(slice, crc32)
          offset += length
          remaining -= length
          if (remaining === 0) {
            if (await finishEntry()) {
              this.#child?.kill()
              return true
            }
            if (await prepareEntry()) {
              this.#child?.kill()
              return true
            }
          }
        }
      }
      if (entryIndex !== this.#entries.length || remaining !== 0) {
        throw new Error(`7-Zip solid extraction ended before entry ${entryIndex + 1} of ${this.#entries.length}.`)
      }
      return false
    } catch (error) {
      this.#child?.kill()
      throw error
    } finally {
      await handle?.close().catch(() => undefined)
    }
  }

  #resolve(entryId: string, path: string): void {
    const deferred = this.#paths.get(entryId)
    if (!deferred || deferred.settled) return
    deferred.settled = true
    deferred.resolve(path)
  }

  #rejectPending(error: unknown): void {
    for (const deferred of this.#paths.values()) {
      if (deferred.settled) continue
      deferred.settled = true
      deferred.reject(error)
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error(`Solid archive materializer is closed: ${this.#sourcePath}`)
  }

  async #loadMemoryEntry(entryId: string, path: string, expectedBytes: number): Promise<Uint8Array> {
    const bytes = await readFile(path, { signal: this.#lifecycle.signal })
    if (bytes.byteLength !== expectedBytes) {
      throw new Error(`Solid archive entry ${entryId} changed after materialization.`)
    }
    this.#assertOpen()
    this.#memory.set(this.#memoryKey(entryId), bytes)
    return bytes
  }

  #memoryKey(entryId: string): string {
    return `${this.#memoryKeyPrefix}\0${entryId}`
  }

  #shouldStopAfter(entryIndex: number): boolean {
    if (!this.#preloadDemands.size || this.#complete) return false
    let target = this.#requiredEntryIndex
    for (const demand of this.#preloadDemands.values()) {
      for (const entryId of demand.entryIds) {
        const index = this.#entries.findIndex((entry) => entry.id === entryId)
        target = Math.max(target, index)
      }
    }
    return target < this.#entries.length - 1 && entryIndex >= target
  }
}

function assertPreloadDemand(demand: ArchivePreloadDemand): void {
  if (!Number.isSafeInteger(demand.generation) || demand.generation < 0) {
    throw new RangeError("Solid archive preload generation must be a non-negative safe integer.")
  }
  if (demand.ownerId !== undefined && (typeof demand.ownerId !== "string" || !demand.ownerId)) {
    throw new TypeError("Solid archive preload owner ID must be a non-empty string.")
  }
  if (demand.direction !== "forward" && demand.direction !== "backward") {
    throw new TypeError(`Invalid solid archive preload direction: ${demand.direction}`)
  }
  if (!Number.isFinite(demand.directionConfidence) || demand.directionConfidence < 0 || demand.directionConfidence > 1) {
    throw new RangeError("Solid archive preload direction confidence must be between 0 and 1.")
  }
  if (!Array.isArray(demand.entryIds) || demand.entryIds.length > 256) {
    throw new RangeError("Solid archive preload entry IDs must contain at most 256 entries.")
  }
  if (new Set(demand.entryIds).size !== demand.entryIds.length || demand.entryIds.some((entryId) => typeof entryId !== "string" || !entryId)) {
    throw new TypeError("Solid archive preload entry IDs must be unique, non-empty strings.")
  }
}

function deferredPath(): DeferredPath {
  let resolve!: (path: string) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<string>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  void promise.catch(() => undefined)
  return { promise, resolve, reject, settled: false }
}

function hexCrc32(value: number): string {
  return value.toString(16).toUpperCase().padStart(8, "0")
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset)
    if (bytesWritten <= 0) throw new Error("Solid archive materialization could not make forward write progress.")
    offset += bytesWritten
  }
}

function processExit(child: SevenZipChild): Promise<{ code: number | null; error?: Error }> {
  return new Promise((resolve) => {
    child.once("error", (error) => resolve({ code: null, error }))
    child.once("close", (code) => resolve({ code }))
  })
}

async function readStderr(child: SevenZipChild): Promise<string> {
  const decoder = new TextDecoder()
  let bytes = 0
  let output = ""
  for await (const chunk of child.stderr) {
    const data = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk as Uint8Array
    bytes += data.byteLength
    if (bytes > MAX_STDERR_BYTES) {
      child.kill()
      throw new Error(`7-Zip stderr exceeded ${MAX_STDERR_BYTES} bytes.`)
    }
    output += decoder.decode(data, { stream: true })
  }
  return output + decoder.decode()
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

function byteStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

function fileStream(path: string, signal: AbortSignal | undefined, lifecycle: AbortSignal): ReadableStream<Uint8Array> {
  const combinedSignal = signal ? AbortSignal.any([signal, lifecycle]) : lifecycle
  const file = createReadStream(path, { highWaterMark: 64 * 1024, signal: combinedSignal })
  return Readable.toWeb(file) as ReadableStream<Uint8Array>
}
