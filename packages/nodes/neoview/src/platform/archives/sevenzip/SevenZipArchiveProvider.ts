import { spawn, type ChildProcessByStdio } from "node:child_process"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { realpath, stat } from "node:fs/promises"
import { Readable, type Writable } from "node:stream"

import type {
  ArchiveCapabilities,
  ArchiveEntry,
  ArchiveProvider,
  ArchiveProviderSnapshot,
  MaterializedEntryLease,
  OpenArchiveEntryOptions,
} from "../../../ports/ArchiveProvider.js"
import type { ResourceLease, ResourceScheduler } from "../../../ports/ResourceScheduler.js"
import { defaultImageTransformScheduler } from "../../scheduler/PriorityResourceScheduler.js"
import { materializeArchiveEntry } from "../materialize-entry.js"
import type { CacheableSolidArchiveMaterializer, SolidArchiveCacheLease } from "./SolidArchiveCache.js"
import { SolidArchiveCache } from "./SolidArchiveCache.js"
import { SolidArchiveMaterializer } from "./SolidArchiveMaterializer.js"
import {
  resolveSevenZipExecutable,
  runSevenZipTextCommand,
  assertSevenZipPassword,
  writeSevenZipPassword,
  type SevenZipExecutable,
} from "./SevenZipExecutable.js"
import { parseSevenZipSlt } from "./sevenzip-slt.js"
import { archiveIndexPayloadBytes } from "../ArchiveIndexMetrics.js"

const MAX_STDERR_BYTES = 256 * 1024
type SevenZipChild = ChildProcessByStdio<Writable, Readable, Readable>

export interface SevenZipArchiveProviderOptions {
  executable?: SevenZipExecutable
  resolveExecutable?: () => Promise<SevenZipExecutable>
  maxListingBytes?: number
  resourceScheduler?: ResourceScheduler
  tempDirectory?: string
  maxMaterializedBytes?: number
  solidArchiveCache?: SolidArchiveCache
  rawPassword?: Uint8Array
  /** @deprecated Use tempDirectory. */
  solidTempDirectory?: string
  /** @deprecated Use maxMaterializedBytes. */
  maxSolidMaterializedBytes?: number
}

interface ActiveExtraction {
  child: SevenZipChild
  reader: ReadableStreamDefaultReader<Uint8Array>
  completion: Promise<void>
  cancel(reason: unknown): Promise<void>
}

export class SevenZipArchiveProvider implements ArchiveProvider {
  readonly sourcePath: string
  readonly capabilities: ArchiveCapabilities = {
    solid: false,
    randomAccess: true,
    entryRange: false,
    materialization: "optional",
  }

  get entryStreamResource(): "cpu" | undefined {
    return this.#initialized && !this.capabilities.solid ? "cpu" : undefined
  }

  readonly #resolveExecutable: () => Promise<SevenZipExecutable>
  readonly #maxListingBytes: number
  readonly #resourceScheduler: ResourceScheduler
  readonly #tempDirectory?: string
  readonly #maxMaterializedBytes?: number
  readonly #solidArchiveCache?: SolidArchiveCache
  readonly #rawPassword?: Uint8Array
  readonly #lifecycle = new AbortController()
  readonly #active = new Map<number, ActiveExtraction>()
  readonly #activeFileReads = new Set<Promise<void>>()
  #nextExtractionId = 1
  #entries: ArchiveEntry[] = []
  #entriesById = new Map<string, ArchiveEntry>()
  #executable?: SevenZipExecutable
  #initializing?: Promise<void>
  #solidMaterializer?: CacheableSolidArchiveMaterializer
  #solidMaterializerLoading?: Promise<CacheableSolidArchiveMaterializer>
  #solidCacheLease?: SolidArchiveCacheLease
  #solidFingerprint?: { fingerprint: string; sourceIdentity: string; materializedBytes: number }
  #initialized = false
  #closed = false

  constructor(sourcePath: string, options: SevenZipArchiveProviderOptions = {}) {
    this.sourcePath = sourcePath
    this.#resolveExecutable = options.executable
      ? async () => options.executable!
      : options.resolveExecutable ?? (() => resolveSevenZipExecutable())
    this.#maxListingBytes = options.maxListingBytes ?? 64 * 1024 * 1024
    this.#resourceScheduler = options.resourceScheduler ?? defaultImageTransformScheduler
    this.#tempDirectory = options.tempDirectory ?? options.solidTempDirectory
    this.#maxMaterializedBytes = options.maxMaterializedBytes ?? options.maxSolidMaterializedBytes
    this.#solidArchiveCache = options.solidArchiveCache
    if (options.rawPassword) {
      assertSevenZipPassword(options.rawPassword)
      this.#rawPassword = options.rawPassword.slice()
    }
  }

  async list(signal?: AbortSignal): Promise<readonly ArchiveEntry[]> {
    this.#assertOpen()
    signal?.throwIfAborted()
    await waitWithSignal(this.#ensureInitialized(), signal)
    this.#assertOpen()
    return this.#entries.map((entry) => ({ ...entry }))
  }

  async openEntry(entryId: string, options: OpenArchiveEntryOptions = {}): Promise<ReadableStream<Uint8Array>> {
    this.#assertOpen()
    options.signal?.throwIfAborted()
    if (options.range) throw new Error("7-Zip archive provider does not support decompressed entry ranges.")
    await waitWithSignal(this.#ensureInitialized(), options.signal)
    this.#assertOpen()
    options.signal?.throwIfAborted()
    const entry = this.#entriesById.get(entryId)
    if (!entry) throw new Error(`Archive entry not found: ${entryId}`)
    if (entry.kind !== "file") throw new Error(`Archive entry is not a file: ${entry.path}`)
    const requiresPassword = entry.encrypted || (this.capabilities.solid && this.#entries.some((candidate) => candidate.encrypted))
    const password = resolvePassword(options, this.#rawPassword)
    try {
      if (requiresPassword && !password.bytes) throw new Error("Encrypted RAR/7z entry requires a password.")
      if (this.capabilities.solid) return await this.#openSolidEntry(entry, options.signal, password.bytes)
      const ownsLease = !options.resourceLease
      const lease = options.resourceLease ?? await this.#resourceScheduler.acquire({
        resource: "cpu",
        kind: "neoview.archive-extract",
        priority: "interactive",
      }, options.signal)
      try {
        return this.#streamEntry(entry, options.signal, lease, ownsLease, requiresPassword ? password.bytes : undefined)
      } catch (error) {
        if (ownsLease) lease.release()
        throw error
      }
    } finally {
      password.release()
    }
  }

  async materializeEntry(
    entryId: string,
    options: Pick<OpenArchiveEntryOptions, "signal" | "password" | "rawPassword"> = {},
  ): Promise<MaterializedEntryLease> {
    const signal = options.signal
    this.#assertOpen()
    signal?.throwIfAborted()
    await waitWithSignal(this.#ensureInitialized(), signal)
    this.#assertOpen()
    const entry = this.#entriesById.get(entryId)
    if (!entry) throw new Error(`Archive entry not found: ${entryId}`)
    if (entry.kind !== "file") throw new Error(`Archive entry is not a file: ${entry.path}`)
    const requiresPassword = entry.encrypted || (this.capabilities.solid && this.#entries.some((candidate) => candidate.encrypted))
    const password = resolvePassword(options, this.#rawPassword)
    try {
      if (requiresPassword && !password.bytes) throw new Error("Encrypted RAR/7z entry requires a password.")
      if (this.capabilities.solid) {
        const combinedSignal = combineSignals(signal, this.#lifecycle.signal)
        const materializer = await this.#solidMaterializerInstance(password.bytes)
        const path = await this.#pathForSolidEntry(materializer, entry.id, combinedSignal)
        const released = Promise.resolve()
        const release = () => released
        return {
          path,
          release,
          [Symbol.asyncDispose]: release,
        }
      }
      return await materializeArchiveEntry(this, entry, {
        signal: combineSignals(signal, this.#lifecycle.signal),
        tempDirectory: this.#tempDirectory,
        maxBytes: this.#maxMaterializedBytes,
        resourceScheduler: this.#resourceScheduler,
        rawPassword: requiresPassword ? password.bytes : undefined,
      })
    } finally {
      password.release()
    }
  }

  snapshot(): ArchiveProviderSnapshot {
    return {
      initialized: this.#initialized,
      indexEntries: this.#entries.length,
      indexPayloadBytes: archiveIndexPayloadBytes(this.#entries),
      activeExtractions: this.#active.size + this.#activeFileReads.size,
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    const reason = new Error(`7-Zip archive provider is closed: ${this.sourcePath}`)
    this.#lifecycle.abort(reason)
    const active = [...this.#active.values()]
    await Promise.allSettled(active.map((extraction) => extraction.cancel(reason)))
    await Promise.allSettled(active.map((extraction) => extraction.completion))
    this.#active.clear()
    await Promise.allSettled(this.#activeFileReads)
    await this.#solidMaterializerLoading?.catch(() => undefined)
    await this.#releaseSolidMaterializer()
    await this.#initializing?.catch(() => undefined)
    this.#entries = []
    this.#entriesById.clear()
    this.#rawPassword?.fill(0)
    this.#initialized = false
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }

  async #ensureInitialized(): Promise<void> {
    if (this.#initialized) return
    if (this.#initializing) return this.#initializing
    this.#initializing = (async () => {
      const executable = await this.#resolveExecutable()
      this.#assertOpen()
      const lease = await this.#resourceScheduler.acquire({
        resource: "io",
        kind: "neoview.archive-index",
        priority: "interactive",
      }, this.#lifecycle.signal)
      let result: { stdout: string; stderr: string }
      try {
        result = await runSevenZipTextCommand(executable.path, [
          "l", "-slt", "-sccUTF-8", "-spd", "--", this.sourcePath,
        ], {
          signal: this.#lifecycle.signal,
          maxOutputBytes: this.#maxListingBytes,
          password: this.#rawPassword,
        })
      } catch (error) {
        if (!this.#rawPassword && !this.#lifecycle.signal.aborted) {
          throw new Error("7-Zip archive listing failed; encrypted headers may require a password.", { cause: error })
        }
        throw error
      } finally {
        lease.release()
      }
      const index = parseSevenZipSlt(result.stdout)
      this.#assertOpen()
      this.#executable = executable
      this.#entries = [...index.entries]
      this.#entriesById = new Map(this.#entries.map((entry) => [entry.id, entry]))
      this.capabilities.solid = index.solid
      this.capabilities.randomAccess = !index.solid
      this.capabilities.materialization = index.solid ? "required" : "optional"
      if (index.solid && this.#solidArchiveCache && !this.#entries.some((entry) => entry.encrypted)) {
        this.#solidFingerprint = await solidArchiveFingerprint(
          this.sourcePath,
          executable.version,
          this.#entries,
        )
      }
      this.#initialized = true
    })()
    try {
      await this.#initializing
    } finally {
      this.#initializing = undefined
    }
  }

  async #openSolidEntry(entry: ArchiveEntry, signal?: AbortSignal, password?: Uint8Array): Promise<ReadableStream<Uint8Array>> {
    const combinedSignal = combineSignals(signal, this.#lifecycle.signal)
    const materializer = await this.#solidMaterializerInstance(password)
    if (materializer.streamFor) {
      try {
        return await materializer.streamFor(entry.id, combinedSignal)
      } catch (error) {
        if (!combinedSignal.aborted && !this.#lifecycle.signal.aborted) await this.#invalidateSolidMaterializer()
        throw error
      }
    }
    const path = await this.#pathForSolidEntry(materializer, entry.id, combinedSignal)
    combinedSignal.throwIfAborted()
    const file = createReadStream(path, { highWaterMark: 64 * 1024, signal: combinedSignal })
    const completion = new Promise<void>((resolve) => file.once("close", resolve))
    this.#activeFileReads.add(completion)
    void completion.finally(() => this.#activeFileReads.delete(completion))
    return Readable.toWeb(file) as ReadableStream<Uint8Array>
  }

  #solidMaterializerInstance(password?: Uint8Array): Promise<CacheableSolidArchiveMaterializer> {
    if (this.#solidMaterializer) return Promise.resolve(this.#solidMaterializer)
    if (this.#solidMaterializerLoading) return this.#solidMaterializerLoading
    this.#solidMaterializerLoading = (async () => {
      const create = () => new SolidArchiveMaterializer({
        sourcePath: this.sourcePath,
        executable: this.#executable!,
        entries: this.#entries,
        resourceScheduler: this.#resourceScheduler,
        tempDirectory: this.#tempDirectory,
        maxMaterializedBytes: this.#maxMaterializedBytes,
        memoryCacheBytes: this.#solidArchiveCache?.maxMemoryBytes,
        maxMemoryEntryBytes: this.#solidArchiveCache?.maxMemoryEntryBytes,
        rawPassword: password,
      })
      const encrypted = this.#entries.some((entry) => entry.encrypted)
      if (this.#solidArchiveCache && this.#solidFingerprint && !encrypted) {
        const lease = await this.#solidArchiveCache.acquire({ ...this.#solidFingerprint, create })
        if (this.#closed) {
          await lease.release()
          throw new Error(`7-Zip archive provider is closed: ${this.sourcePath}`)
        }
        this.#solidCacheLease = lease
        this.#solidMaterializer = lease.materializer
      } else {
        this.#solidMaterializer = create()
      }
      return this.#solidMaterializer
    })()
    return this.#solidMaterializerLoading.finally(() => {
      this.#solidMaterializerLoading = undefined
    })
  }

  async #pathForSolidEntry(
    materializer: CacheableSolidArchiveMaterializer,
    entryId: string,
    signal: AbortSignal,
  ): Promise<string> {
    try {
      return await materializer.pathFor(entryId, signal)
    } catch (error) {
      if (!signal.aborted && !this.#lifecycle.signal.aborted) await this.#invalidateSolidMaterializer()
      throw error
    }
  }

  async #invalidateSolidMaterializer(): Promise<void> {
    const lease = this.#solidCacheLease
    if (lease) await lease.invalidate()
    await this.#releaseSolidMaterializer()
  }

  async #releaseSolidMaterializer(): Promise<void> {
    const lease = this.#solidCacheLease
    const materializer = this.#solidMaterializer
    this.#solidCacheLease = undefined
    this.#solidMaterializer = undefined
    if (lease) await lease.release()
    else await materializer?.close()
  }

  #streamEntry(
    entry: ArchiveEntry,
    signal: AbortSignal | undefined,
    lease: ResourceLease,
    ownsLease: boolean,
    password?: Uint8Array,
  ): ReadableStream<Uint8Array> {
    const executable = this.#executable!
    const child = spawn(executable.path, [
      "x", "-so", "-bd", "-bb0", "-sccUTF-8", "-spd", "--", this.sourcePath, entry.path,
    ], {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    })
    const passwordWrite = writeSevenZipPassword(child.stdin, password)
    const stdout = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
    const reader = stdout.getReader()
    const extractionId = this.#nextExtractionId++
    let stderr = ""
    const onAbort = () => {
      child.kill()
      void reader.cancel(signal?.reason).catch(() => undefined)
    }
    signal?.addEventListener("abort", onAbort, { once: true })
    const completion = Promise.all([
      processExit(child),
      readStderr(child, (value) => { stderr = value }),
      passwordWrite,
    ]).then(([exit]) => {
      if (signal?.aborted) throw signal.reason
      if (exit.error) throw exit.error
      if (exit.code !== 0) throw new Error(stderr.trim() || `7-Zip extraction exited with code ${exit.code}.`)
    }).finally(() => {
      if (ownsLease) lease.release()
      signal?.removeEventListener("abort", onAbort)
      this.#active.delete(extractionId)
    })
    void completion.catch(() => undefined)
    const active: ActiveExtraction = {
      child,
      reader,
      completion,
      cancel: async (reason) => {
        child.kill()
        await reader.cancel(reason).catch(() => undefined)
      },
    }
    this.#active.set(extractionId, active)

    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const result = await reader.read()
          if (result.done) {
            await completion
            controller.close()
          } else {
            controller.enqueue(result.value)
          }
        } catch (error) {
          controller.error(error)
        }
      },
      async cancel(reason) {
        await active.cancel(reason)
        await completion.catch(() => undefined)
      },
    })
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error(`7-Zip archive provider is closed: ${this.sourcePath}`)
  }
}

async function solidArchiveFingerprint(
  sourcePath: string,
  executableVersion: string,
  entries: readonly ArchiveEntry[],
): Promise<{ fingerprint: string; sourceIdentity: string; materializedBytes: number }> {
  const sourceIdentity = await realpath(sourcePath)
  const sourceStats = await stat(sourceIdentity, { bigint: true })
  const hash = createHash("sha256")
  const append = (value: string | number | bigint | undefined) => {
    hash.update(String(value ?? ""))
    hash.update("\0")
  }
  append(sourceIdentity)
  append(sourceStats.size)
  append(sourceStats.mtimeNs)
  append(sourceStats.ctimeNs)
  append(sourceStats.ino)
  append(executableVersion)
  let materializedBytes = 0
  for (const entry of entries) {
    if (entry.kind !== "file") continue
    materializedBytes += entry.uncompressedSize
    if (!Number.isSafeInteger(materializedBytes)) throw new Error("Solid archive size exceeds the safe integer range.")
    append(entry.id)
    append(entry.path)
    append(entry.uncompressedSize)
    append(entry.crc32)
  }
  return {
    fingerprint: hash.digest("hex"),
    sourceIdentity,
    materializedBytes,
  }
}

function processExit(child: SevenZipChild): Promise<{ code: number | null; error?: Error }> {
  return new Promise((resolve) => {
    child.once("error", (error) => resolve({ code: null, error }))
    child.once("close", (code) => resolve({ code }))
  })
}

async function readStderr(child: SevenZipChild, assign: (value: string) => void): Promise<void> {
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
  assign(output + decoder.decode())
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

function combineSignals(first: AbortSignal | undefined, second: AbortSignal): AbortSignal {
  return first ? AbortSignal.any([first, second]) : second
}

function resolvePassword(
  options: Pick<OpenArchiveEntryOptions, "password" | "rawPassword">,
  fallback?: Uint8Array,
): { bytes?: Uint8Array; release(): void } {
  if (options.password !== undefined && options.rawPassword !== undefined) {
    options.rawPassword.fill(0)
    throw new Error("7-Zip extraction accepts exactly one of password or rawPassword.")
  }
  const encoded = options.password !== undefined ? new TextEncoder().encode(options.password) : undefined
  const bytes = options.rawPassword ?? encoded ?? fallback
  try {
    if (bytes) assertSevenZipPassword(bytes)
  } catch (error) {
    options.rawPassword?.fill(0)
    encoded?.fill(0)
    throw error
  }
  let released = false
  return {
    bytes,
    release: () => {
      if (released) return
      released = true
      options.rawPassword?.fill(0)
      encoded?.fill(0)
    },
  }
}
