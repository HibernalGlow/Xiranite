import { stat } from "node:fs/promises"
import { posix, win32 } from "node:path"
import { streamEfuFileRecords } from "@xiranite/shared/efu-stream"

import { pageMediaType, pathExtension, type ReaderMediaTypeResolver } from "../../domain/page/media.js"
import type {
  ReaderDirectoryEntry,
  ReaderDirectoryListing,
  ReaderDirectoryListingProvider,
} from "../../ports/ReaderDirectoryListingProvider.js"
import { platformReaderBookFileKind } from "./PlatformReaderBookCandidate.js"

const MAX_EFU_ENTRIES = 100_000
const WINDOWS_FILE_TIME_EPOCH_MS = 11_644_473_600_000n

/** Adds Everything File List snapshots to the normal platform directory provider. */
export class PlatformEfuDirectoryListingProvider implements ReaderDirectoryListingProvider {
  constructor(
    private readonly directoryProvider: ReaderDirectoryListingProvider,
    private readonly mediaFormats?: ReaderMediaTypeResolver,
  ) {}

  canonicalize(path: string, signal?: AbortSignal): Promise<string> {
    return this.directoryProvider.canonicalize?.(path, signal) ?? Promise.resolve(path)
  }

  async exists(path: string, signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted()
    try {
      await stat(path)
      signal?.throwIfAborted()
      return true
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error
      const code = (error as NodeJS.ErrnoException).code
      if (code === "ENOENT" || code === "ENOTDIR") return false
      throw error
    }
  }

  async read(path: string, signal?: AbortSignal): Promise<ReaderDirectoryListing> {
    if (pathExtension(path) !== "efu") return this.directoryProvider.read(path, signal)
    signal?.throwIfAborted()
    const source = await stat(path)
    if (!source.isFile()) return this.directoryProvider.read(path, signal)
    return readEfuDirectoryListing(path, this.mediaFormats, signal)
  }
}

export async function readEfuDirectoryListing(
  path: string,
  mediaFormats?: ReaderMediaTypeResolver,
  signal?: AbortSignal,
): Promise<ReaderDirectoryListing> {
  const entries: ReaderDirectoryEntry[] = []
  const seen = new Set<string>()

  for await (const record of streamEfuFileRecords(path, signal)) {
    signal?.throwIfAborted()
    const filename = record.filename
    const key = normalizePathKey(filename)
    if (seen.has(key)) continue
    if (entries.length >= MAX_EFU_ENTRIES) {
      throw new Error(`EFU file exceeds ${MAX_EFU_ENTRIES} unique entries: ${path}`)
    }
    seen.add(key)
    const attributes = record.attributes ?? ""
    const kind = efuEntryKind(filename, attributes)
    const size = parseEfuSize(record.size)
    const modifiedAt = parseEfuModifiedAt(record.dateModified)
    entries.push({
      name: platformBaseName(filename),
      path: filename,
      kind,
      readerSupported: efuReaderSupported(filename, kind, mediaFormats),
      ...(size === undefined || kind !== "file" ? {} : { size }),
      ...(modifiedAt === undefined ? {} : { modifiedAt }),
    })
  }

  return { path, sourceKind: "efu", entries }
}

function efuEntryKind(path: string, attributes: string): ReaderDirectoryEntry["kind"] {
  if (attributes.toUpperCase().includes("D") || /[\\/]$/u.test(path)) return "directory"
  return "file"
}

function efuReaderSupported(
  path: string,
  kind: ReaderDirectoryEntry["kind"],
  mediaFormats?: ReaderMediaTypeResolver,
): boolean {
  if (kind === "directory") return true
  if (kind !== "file") return false
  return Boolean(pageMediaType(path, mediaFormats))
    || platformReaderBookFileKind(path, mediaFormats) !== undefined
    || pathExtension(path) === "pdf"
}

function parseEfuSize(value: string | undefined): number | undefined {
  const source = value?.trim()
  if (!source || !/^\d+$/u.test(source)) return undefined
  const parsed = BigInt(source)
  return parsed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(parsed) : undefined
}

function parseEfuModifiedAt(value: string | undefined): number | undefined {
  const source = value?.trim()
  if (!source) return undefined
  if (/^\d+$/u.test(source)) {
    const raw = BigInt(source)
    if (raw >= 100_000_000_000_000n) {
      const milliseconds = raw / 10_000n - WINDOWS_FILE_TIME_EPOCH_MS
      return milliseconds >= 0n && milliseconds <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(milliseconds) : undefined
    }
    const numeric = Number(raw)
    if (numeric >= 1_000_000_000_000) return numeric
    if (numeric >= 1_000_000_000) return numeric * 1_000
  }
  const parsed = Date.parse(source)
  return Number.isFinite(parsed) ? parsed : undefined
}

function platformBaseName(path: string): string {
  return path.includes("\\") || /^[A-Za-z]:/u.test(path) ? win32.basename(path) : posix.basename(path)
}

function normalizePathKey(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/u, "")
  return /^(?:[A-Za-z]:|\/\/)/u.test(normalized) ? normalized.toLowerCase() : normalized
}
