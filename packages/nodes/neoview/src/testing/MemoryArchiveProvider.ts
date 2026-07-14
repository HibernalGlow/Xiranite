import { normalizeArchivePath } from "../domain/archive/archive-path.js"
import { normalizeArchiveRange } from "../domain/archive/archive-range.js"
import {
  type ArchiveCapabilities,
  type ArchiveEntry,
  type ArchiveEntryKind,
  type ArchiveProvider,
  type OpenArchiveEntryOptions,
} from "../ports/ArchiveProvider.js"

export interface MemoryArchiveEntryInput {
  path: string
  bytes?: Uint8Array
  kind?: ArchiveEntryKind
  compressedSize?: number
  compressionMethod?: string
  crc32?: number
  modifiedAt?: string
}

interface StoredEntry {
  descriptor: ArchiveEntry
  bytes: Uint8Array
}

export interface MemoryArchiveProviderOptions {
  sourcePath?: string
  chunkSize?: number
  range?: boolean
}

export class MemoryArchiveProvider implements ArchiveProvider {
  readonly sourcePath: string
  readonly capabilities: ArchiveCapabilities
  #entries: StoredEntry[]
  #entriesById = new Map<string, StoredEntry>()
  #closed = false
  #chunkSize: number

  constructor(entries: readonly MemoryArchiveEntryInput[], options: MemoryArchiveProviderOptions = {}) {
    this.sourcePath = options.sourcePath ?? "memory://archive"
    this.#chunkSize = Math.max(1, Math.trunc(options.chunkSize ?? 64 * 1024))
    this.capabilities = {
      solid: false,
      randomAccess: true,
      entryRange: options.range ?? true,
      materialization: "never",
    }
    const paths = new Set<string>()
    this.#entries = entries.map((entry, index) => {
      const path = normalizeArchivePath(entry.path)
      if (paths.has(path)) throw new Error(`Duplicate archive entry path: ${path}`)
      paths.add(path)
      const kind = entry.kind ?? "file"
      const bytes = kind === "directory" ? new Uint8Array() : new Uint8Array(entry.bytes ?? [])
      const stored: StoredEntry = {
        descriptor: {
          id: `entry-${index}`,
          path,
          kind,
          uncompressedSize: bytes.byteLength,
          compressedSize: entry.compressedSize,
          compressionMethod: entry.compressionMethod,
          crc32: entry.crc32,
          modifiedAt: entry.modifiedAt,
        },
        bytes,
      }
      this.#entriesById.set(stored.descriptor.id, stored)
      return stored
    })
  }

  async list(signal?: AbortSignal): Promise<readonly ArchiveEntry[]> {
    this.#assertOpen()
    signal?.throwIfAborted()
    return this.#entries.map((entry) => ({ ...entry.descriptor }))
  }

  async openEntry(entryId: string, options: OpenArchiveEntryOptions = {}): Promise<ReadableStream<Uint8Array>> {
    this.#assertOpen()
    options.signal?.throwIfAborted()
    const entry = this.#entriesById.get(entryId)
    if (!entry) throw new Error(`Archive entry not found: ${entryId}`)
    if (entry.descriptor.kind !== "file") throw new Error(`Archive entry is not a file: ${entry.descriptor.path}`)
    if (options.range && !this.capabilities.entryRange) throw new Error("Archive provider does not support entry ranges.")
    const { start, endExclusive } = normalizeArchiveRange(options.range, entry.bytes.byteLength)
    const bytes = entry.bytes.subarray(start, endExclusive)
    const chunkSize = this.#chunkSize
    const signal = options.signal
    let offset = 0
    let stopped = false
    let removeAbortListener = () => {}
    return new ReadableStream<Uint8Array>({
      start(controller) {
        if (!signal) return
        const abort = () => {
          if (stopped) return
          stopped = true
          controller.error(signal.reason ?? new DOMException("Archive entry read aborted.", "AbortError"))
        }
        signal.addEventListener("abort", abort, { once: true })
        removeAbortListener = () => signal.removeEventListener("abort", abort)
        if (signal.aborted) abort()
      },
      pull(controller) {
        try {
          if (stopped) return
          signal?.throwIfAborted()
          if (offset >= bytes.byteLength) {
            stopped = true
            removeAbortListener()
            controller.close()
            return
          }
          const next = Math.min(offset + chunkSize, bytes.byteLength)
          controller.enqueue(bytes.slice(offset, next))
          offset = next
        } catch (error) {
          stopped = true
          removeAbortListener()
          controller.error(error)
        }
      },
      cancel() {
        stopped = true
        removeAbortListener()
      },
    })
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    this.#entries = []
    this.#entriesById.clear()
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error(`Archive provider is closed: ${this.sourcePath}`)
  }
}
