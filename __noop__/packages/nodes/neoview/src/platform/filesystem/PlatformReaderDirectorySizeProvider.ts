import readdirp, { type ReaddirpStream } from "readdirp"

import type { ReaderDirectorySize, ReaderDirectorySizeProvider } from "../../ports/ReaderDirectorySizeProvider.js"
import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"
import { normalizePlatformDirectoryPath } from "./PlatformDirectoryPath.js"

const DEFAULT_MAXIMUM_FILES = 1_000_000

export interface PlatformReaderDirectorySizeProviderOptions {
  resourceScheduler?: ResourceScheduler
  maximumFiles?: number
  ownerId?: string
}

export class PlatformReaderDirectorySizeProvider implements ReaderDirectorySizeProvider {
  readonly #maximumFiles: number
  readonly #ownerId: string

  constructor(private readonly options: PlatformReaderDirectorySizeProviderOptions = {}) {
    this.#maximumFiles = boundedPositiveInteger(options.maximumFiles ?? DEFAULT_MAXIMUM_FILES, "maximumFiles")
    this.#ownerId = options.ownerId ?? "neoview:directory-size"
  }

  async measure(path: string, signal?: AbortSignal): Promise<ReaderDirectorySize> {
    signal?.throwIfAborted()
    const normalizedPath = normalizePlatformDirectoryPath(path)
    const lease = await this.options.resourceScheduler?.acquire({
      resource: "io",
      kind: "reader.directory-size.scan",
      priority: "background",
      ownerId: this.#ownerId,
    }, signal)
    let stream: ReaddirpStream | undefined
    const abort = () => stream?.destroy(abortReason(signal))
    const failOnWarning = (error: Error) => stream?.destroy(error)
    let bytes = 0
    let fileCount = 0
    try {
      stream = readdirp(normalizedPath, {
        type: "files",
        alwaysStat: true,
        lstat: true,
        highWaterMark: 256,
      })
      stream.on("warn", failOnWarning)
      signal?.addEventListener("abort", abort, { once: true })
      for await (const entry of stream) {
        signal?.throwIfAborted()
        fileCount += 1
        if (fileCount > this.#maximumFiles) {
          stream.destroy()
          throw new RangeError(`Directory exceeds the ${this.#maximumFiles} file size-scan limit: ${normalizedPath}`)
        }
        const size = safeStatSize(entry.stats?.size)
        if (size === undefined || bytes > Number.MAX_SAFE_INTEGER - size) {
          stream.destroy()
          throw new RangeError(`Directory size exceeds the safe integer range: ${normalizedPath}`)
        }
        bytes += size
      }
      return { path: normalizedPath, bytes, fileCount }
    } finally {
      signal?.removeEventListener("abort", abort)
      stream?.off("warn", failOnWarning)
      if (stream && !stream.destroyed) stream.destroy()
      lease?.release()
    }
  }
}

function safeStatSize(value: number | bigint | undefined): number | undefined {
  if (typeof value === "bigint") {
    return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : undefined
  }
  return Number.isSafeInteger(value) && value! >= 0 ? value : undefined
}

function boundedPositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer`)
  return value
}

function abortReason(signal: AbortSignal | undefined): Error {
  return signal?.reason instanceof Error ? signal.reason : new DOMException("Directory size scan aborted", "AbortError")
}
