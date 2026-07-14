import { spawn, type ChildProcessByStdio } from "node:child_process"
import { createReadStream } from "node:fs"
import { Readable } from "node:stream"

import type {
  ArchiveCapabilities,
  ArchiveEntry,
  ArchiveProvider,
  MaterializedEntryLease,
  OpenArchiveEntryOptions,
} from "../../../ports/ArchiveProvider.js"
import type { ResourceLease, ResourceScheduler } from "../../../ports/ResourceScheduler.js"
import { defaultImageTransformScheduler } from "../../scheduler/PriorityResourceScheduler.js"
import { materializeArchiveEntry } from "../materialize-entry.js"
import { SolidArchiveMaterializer } from "./SolidArchiveMaterializer.js"
import {
  resolveSevenZipExecutable,
  runSevenZipTextCommand,
  type SevenZipExecutable,
} from "./SevenZipExecutable.js"
import { parseSevenZipSlt } from "./sevenzip-slt.js"

const MAX_STDERR_BYTES = 256 * 1024
type SevenZipChild = ChildProcessByStdio<null, Readable, Readable>

export interface SevenZipArchiveProviderOptions {
  executable?: SevenZipExecutable
  resolveExecutable?: () => Promise<SevenZipExecutable>
  maxListingBytes?: number
  resourceScheduler?: ResourceScheduler
  tempDirectory?: string
  maxMaterializedBytes?: number
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

  readonly #resolveExecutable: () => Promise<SevenZipExecutable>
  readonly #maxListingBytes: number
  readonly #resourceScheduler: ResourceScheduler
  readonly #tempDirectory?: string
  readonly #maxMaterializedBytes?: number
  readonly #lifecycle = new AbortController()
  readonly #active = new Map<number, ActiveExtraction>()
  readonly #activeFileReads = new Set<Promise<void>>()
  #nextExtractionId = 1
  #entries: ArchiveEntry[] = []
  #entriesById = new Map<string, ArchiveEntry>()
  #executable?: SevenZipExecutable
  #initializing?: Promise<void>
  #solidMaterializer?: SolidArchiveMaterializer
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
    if (this.capabilities.solid) {
      if (this.#entries.some((candidate) => candidate.encrypted)) {
        options.rawPassword?.fill(0)
        throw new Error("Encrypted solid RAR/7z extraction is not available until secure password transport is implemented.")
      }
      return this.#openSolidEntry(entry, options.signal)
    }
    if (entry.encrypted) {
      options.rawPassword?.fill(0)
      throw new Error("Encrypted RAR/7z streaming is not available until secure password transport is implemented.")
    }
    const lease = await this.#resourceScheduler.acquire({
      resource: "cpu",
      kind: "neoview.archive-extract",
      priority: "interactive",
    }, options.signal)
    try {
      return this.#streamEntry(entry, options.signal, lease)
    } catch (error) {
      lease.release()
      throw error
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
    if (entry.encrypted || (this.capabilities.solid && this.#entries.some((candidate) => candidate.encrypted))) {
      options.rawPassword?.fill(0)
      throw new Error("Encrypted RAR/7z materialization is not available until secure password transport is implemented.")
    }
    if (this.capabilities.solid) {
      const combinedSignal = combineSignals(signal, this.#lifecycle.signal)
      const materializer = this.#solidMaterializerInstance()
      const path = await materializer.pathFor(entry.id, combinedSignal)
      const released = Promise.resolve()
      const release = () => released
      return {
        path,
        release,
        [Symbol.asyncDispose]: release,
      }
    }
    return materializeArchiveEntry(this, entry, {
      signal: combineSignals(signal, this.#lifecycle.signal),
      tempDirectory: this.#tempDirectory,
      maxBytes: this.#maxMaterializedBytes,
      resourceScheduler: this.#resourceScheduler,
      rawPassword: options.rawPassword,
    })
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
    await this.#solidMaterializer?.close()
    await this.#initializing?.catch(() => undefined)
    this.#entries = []
    this.#entriesById.clear()
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
      const result = await runSevenZipTextCommand(executable.path, [
        "l", "-slt", "-sccUTF-8", "-spd", "--", this.sourcePath,
      ], {
        signal: this.#lifecycle.signal,
        maxOutputBytes: this.#maxListingBytes,
      }).finally(() => lease.release())
      const index = parseSevenZipSlt(result.stdout)
      this.#assertOpen()
      this.#executable = executable
      this.#entries = [...index.entries]
      this.#entriesById = new Map(this.#entries.map((entry) => [entry.id, entry]))
      this.capabilities.solid = index.solid
      this.capabilities.randomAccess = !index.solid
      this.capabilities.materialization = index.solid ? "required" : "optional"
      this.#initialized = true
    })()
    try {
      await this.#initializing
    } finally {
      this.#initializing = undefined
    }
  }

  async #openSolidEntry(entry: ArchiveEntry, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const combinedSignal = combineSignals(signal, this.#lifecycle.signal)
    const path = await this.#solidMaterializerInstance().pathFor(entry.id, combinedSignal)
    combinedSignal.throwIfAborted()
    const file = createReadStream(path, { highWaterMark: 64 * 1024, signal: combinedSignal })
    const completion = new Promise<void>((resolve) => file.once("close", resolve))
    this.#activeFileReads.add(completion)
    void completion.finally(() => this.#activeFileReads.delete(completion))
    return Readable.toWeb(file) as ReadableStream<Uint8Array>
  }

  #solidMaterializerInstance(): SolidArchiveMaterializer {
    this.#solidMaterializer ??= new SolidArchiveMaterializer({
      sourcePath: this.sourcePath,
      executable: this.#executable!,
      entries: this.#entries,
      resourceScheduler: this.#resourceScheduler,
      tempDirectory: this.#tempDirectory,
      maxMaterializedBytes: this.#maxMaterializedBytes,
    })
    return this.#solidMaterializer
  }

  #streamEntry(entry: ArchiveEntry, signal: AbortSignal | undefined, lease: ResourceLease): ReadableStream<Uint8Array> {
    const executable = this.#executable!
    const child = spawn(executable.path, [
      "x", "-so", "-bd", "-bb0", "-sccUTF-8", "-spd", "--", this.sourcePath, entry.path,
    ], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
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
    ]).then(([exit]) => {
      if (signal?.aborted) throw signal.reason
      if (exit.error) throw exit.error
      if (exit.code !== 0) throw new Error(stderr.trim() || `7-Zip extraction exited with code ${exit.code}.`)
    }).finally(() => {
      lease.release()
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
