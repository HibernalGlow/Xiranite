import { ZipReader, type Entry, type FileEntry } from "@zip.js/zip.js/index-native.js"

import { normalizeArchivePath } from "../../../domain/archive/archive-path.js"
import type {
  ArchiveCapabilities,
  ArchiveEntry,
  ArchiveProvider,
  OpenArchiveEntryOptions,
} from "../../../ports/ArchiveProvider.js"
import { NodeFileReader, type NodeFileReaderOptions } from "./NodeFileReader.js"

export interface ZipArchiveProviderOptions extends NodeFileReaderOptions {
  checkSignature?: boolean
  useCompressionStream?: boolean
}

interface StoredZipEntry {
  descriptor: ArchiveEntry
  entry: Entry
}

interface ActiveExtraction {
  controller: AbortController
  completion: Promise<void>
  cancel(reason: unknown): Promise<void>
}

export class ZipArchiveProvider implements ArchiveProvider {
  readonly sourcePath: string
  readonly capabilities: ArchiveCapabilities = {
    solid: false,
    randomAccess: true,
    entryRange: false,
    materialization: "never",
  }

  readonly #fileReader: NodeFileReader
  readonly #checkSignature: boolean
  readonly #useCompressionStream: boolean
  #zipReader: ZipReader<string> | null = null
  #entries: StoredZipEntry[] = []
  #entriesById = new Map<string, StoredZipEntry>()
  #initializing: Promise<void> | null = null
  #active = new Map<number, ActiveExtraction>()
  #nextExtractionId = 1
  #closed = false

  constructor(sourcePath: string, options: ZipArchiveProviderOptions = {}) {
    this.sourcePath = sourcePath
    this.#checkSignature = options.checkSignature ?? true
    this.#useCompressionStream = options.useCompressionStream ?? true
    this.#fileReader = new NodeFileReader(sourcePath, { onRead: options.onRead })
  }

  async list(signal?: AbortSignal): Promise<readonly ArchiveEntry[]> {
    this.#assertOpen()
    signal?.throwIfAborted()
    await this.#ensureInitialized()
    signal?.throwIfAborted()
    this.#assertOpen()
    return this.#entries.map(({ descriptor }) => ({ ...descriptor }))
  }

  async openEntry(entryId: string, options: OpenArchiveEntryOptions = {}): Promise<ReadableStream<Uint8Array>> {
    this.#assertOpen()
    options.signal?.throwIfAborted()
    if (options.range) throw new Error("ZIP archive provider does not support decompressed entry ranges.")
    await this.#ensureInitialized()
    this.#assertOpen()
    options.signal?.throwIfAborted()
    const stored = this.#entriesById.get(entryId)
    if (!stored) throw new Error(`Archive entry not found: ${entryId}`)
    if (stored.entry.directory) throw new Error(`Archive entry is not a file: ${stored.descriptor.path}`)
    return this.#streamEntry(stored.entry, options)
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    await this.#initializing?.catch(() => undefined)
    const active = [...this.#active.values()]
    const reason = new Error(`ZIP archive provider is closed: ${this.sourcePath}`)
    for (const extraction of active) extraction.controller.abort(reason)
    await Promise.allSettled(active.map((extraction) => extraction.cancel(reason)))
    await Promise.allSettled(active.map((extraction) => extraction.completion))
    this.#active.clear()
    const zipReader = this.#zipReader
    this.#zipReader = null
    this.#entries = []
    this.#entriesById.clear()
    await zipReader?.close().catch(() => undefined)
    await this.#fileReader.close()
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }

  async #ensureInitialized(): Promise<void> {
    if (this.#zipReader) return
    if (this.#initializing) return this.#initializing
    this.#initializing = (async () => {
      this.#assertOpen()
      const zipReader = new ZipReader(this.#fileReader, {
        useCompressionStream: this.#useCompressionStream,
        useWebWorkers: false,
      })
      try {
        const rawEntries = await zipReader.getEntries()
        this.#assertOpen()
        const entries = rawEntries.map((entry, index): StoredZipEntry => {
          const path = normalizeArchivePath(entry.filename)
          const descriptor: ArchiveEntry = {
            id: `zip-${index}-${entry.offset}`,
            path,
            kind: entry.directory ? "directory" : "file",
            uncompressedSize: entry.uncompressedSize,
            compressedSize: entry.compressedSize,
            compressionMethod: compressionMethodName(entry.compressionMethod),
            crc32: entry.signature >>> 0,
            modifiedAt: validDate(entry.lastModDate)?.toISOString(),
            encrypted: Boolean(entry.encrypted),
            zip64: Boolean(entry.zip64),
          }
          return { descriptor, entry }
        })
        this.#entries = entries
        this.#entriesById = new Map(entries.map((entry) => [entry.descriptor.id, entry]))
        this.#zipReader = zipReader
      } catch (error) {
        await zipReader.close().catch(() => undefined)
        await this.#fileReader.close()
        throw error
      }
    })()
    try {
      await this.#initializing
    } finally {
      this.#initializing = null
    }
  }

  #streamEntry(entry: FileEntry, options: OpenArchiveEntryOptions): ReadableStream<Uint8Array> {
    const externalSignal = options.signal
    const controller = new AbortController()
    const transform = new TransformStream<Uint8Array, Uint8Array>()
    const reader = transform.readable.getReader()
    const onAbort = () => {
      const reason = externalSignal?.reason
      controller.abort(reason)
      void reader.cancel(reason).catch(() => undefined)
    }
    externalSignal?.addEventListener("abort", onAbort, { once: true })
    if (externalSignal?.aborted) onAbort()
    let failure: unknown
    const extractionId = this.#nextExtractionId++
    const completion = entry.getData(transform.writable, {
      checkSignature: this.#checkSignature,
      password: options.password,
      rawPassword: options.rawPassword,
      signal: controller.signal,
      useCompressionStream: this.#useCompressionStream,
      useWebWorkers: false,
    }).then(() => undefined, (error: unknown) => {
      failure = controller.signal.aborted ? controller.signal.reason : error
      void reader.cancel(error).catch(() => undefined)
    }).finally(() => {
      externalSignal?.removeEventListener("abort", onAbort)
      this.#active.delete(extractionId)
    })
    this.#active.set(extractionId, {
      controller,
      completion,
      cancel: async (reason) => {
        await reader.cancel(reason).catch(() => undefined)
      },
    })

    return new ReadableStream<Uint8Array>({
      async pull(output) {
        try {
          const result = await reader.read()
          if (result.done) {
            await completion
            if (failure) throw failure
            output.close()
          } else {
            output.enqueue(result.value)
          }
        } catch (error) {
          output.error(error)
        }
      },
      async cancel(reason) {
        controller.abort(reason)
        await reader.cancel(reason).catch(() => undefined)
        await completion
      },
    })
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error(`ZIP archive provider is closed: ${this.sourcePath}`)
  }
}

function compressionMethodName(method: number): string {
  if (method === 0) return "store"
  if (method === 8) return "deflate"
  if (method === 9) return "deflate64"
  if (method === 99) return "aes"
  return `zip-method-${method}`
}

function validDate(value: Date): Date | undefined {
  return Number.isFinite(value.getTime()) ? value : undefined
}
