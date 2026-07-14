import { realpath, stat } from "node:fs/promises"
import { basename } from "node:path"

import { ArchiveCredentialStore } from "../../application/reader/ArchiveCredentialStore.js"
import type { ReaderBook, ViewSource } from "../../domain/book/book.js"
import { normalizeArchivePath } from "../../domain/archive/archive-path.js"
import { pageMediaType, pathExtension } from "../../domain/page/media.js"
import type { ReaderPage } from "../../domain/page/page.js"
import { compareNaturalPath } from "../../domain/sorting/natural-sort.js"
import type { ArchiveEntry, ArchiveProvider, MaterializedEntryLease } from "../../ports/ArchiveProvider.js"
import type { ReaderBookLoadOptions } from "../../ports/ReaderBookLoader.js"
import type { PlatformReaderBookLoaderOptions } from "../books/PlatformReaderBookLoader.js"
import { createReaderBook, stableOpaqueId, versionFromFile } from "../books/book-utils.js"
import { ArchivePageContent } from "../content/ArchivePageContent.js"
import { materializeArchiveEntry } from "./materialize-entry.js"

const ARCHIVE_EXTENSIONS = new Set(["zip", "cbz", "rar", "cbr", "7z", "cb7"])
const DEFAULT_MAX_ARCHIVE_DEPTH = 4
const DEFAULT_MAX_MATERIALIZED_BYTES = 64 * 1024 * 1024 * 1024

export async function loadArchiveBook(
  source: Extract<ViewSource, { kind: "archive" }>,
  loadOptions: ReaderBookLoadOptions = {},
  options: PlatformReaderBookLoaderOptions = {},
): Promise<ReaderBook> {
  const signal = loadOptions.signal
  signal?.throwIfAborted()
  const entryPaths = normalizeEntryPaths(source)
  const maxDepth = boundedOption(options.maxArchiveDepth ?? DEFAULT_MAX_ARCHIVE_DEPTH, "maxArchiveDepth", 0, 16)
  if (entryPaths.length > maxDepth) {
    throw new Error(`Nested archive depth ${entryPaths.length} exceeds the configured limit ${maxDepth}.`)
  }
  const maxMaterializedBytes = boundedOption(
    options.maxArchiveMaterializedBytes ?? DEFAULT_MAX_MATERIALIZED_BYTES,
    "maxArchiveMaterializedBytes",
    0,
    Number.MAX_SAFE_INTEGER,
  )
  const credentials = new ArchiveCredentialStore(loadOptions.archivePasswords)
  const resources: Array<() => Promise<void>> = [credentials.close.bind(credentials)]
  try {
    const archivePath = await realpath(source.path)
    const extension = pathExtension(archivePath)
    if (!ARCHIVE_EXTENSIONS.has(extension)) {
      throw new Error(`Archive format is not available yet: .${extension || "unknown"}`)
    }
    const archiveStats = await stat(archivePath)
    if (!archiveStats.isFile()) throw new Error(`Reader source is not an archive file: ${source.path}`)
    signal?.throwIfAborted()
    let provider = await createArchiveProvider(archivePath, extension, options, maxMaterializedBytes)
    resources.push(provider.close.bind(provider))
    let materializedBytes = 0
    const chainVersions: string[] = []
    const providerEntryPaths: string[] = []
    for (const entryPath of entryPaths) {
      signal?.throwIfAborted()
      const providerEntries = await provider.list(signal)
      const entry = findArchiveEntry(providerEntries, entryPath)
      const nestedExtension = pathExtension(entry.path)
      if (!ARCHIVE_EXTENSIONS.has(nestedExtension)) {
        throw new Error(`Nested archive entry has an unsupported format: ${entry.path}`)
      }
      const layerMaterializedBytes = provider.capabilities.materialization === "required"
        ? totalFileBytes(providerEntries)
        : entry.uncompressedSize
      materializedBytes += layerMaterializedBytes
      if (!Number.isSafeInteger(materializedBytes) || materializedBytes > maxMaterializedBytes) {
        throw new Error(`Nested archives require ${materializedBytes} materialized bytes, exceeding the ${maxMaterializedBytes} byte budget.`)
      }
      const layerBudget = maxMaterializedBytes - (materializedBytes - layerMaterializedBytes)
      const rawPassword = credentials.copyRawPassword(providerEntryPaths)
      let lease: MaterializedEntryLease
      try {
        lease = await materializeNestedEntry(provider, entry, signal, options, layerBudget, rawPassword)
      } finally {
        credentials.clearRawPassword(rawPassword)
      }
      resources.push(() => lease.release())
      chainVersions.push(entry.crc32?.toString(16) ?? entry.id)
      providerEntryPaths.push(entryPath)
      provider = await createArchiveProvider(
        lease.path,
        nestedExtension,
        options,
        maxMaterializedBytes - materializedBytes,
      )
      resources.push(provider.close.bind(provider))
    }
    const entries = await provider.list(signal)
    const pageEntries = entries
      .filter((entry) => entry.kind === "file" && pageMediaType(entry.path))
      .sort((left, right) => compareNaturalPath(left.path, right.path))
    const normalizedSource: Extract<ViewSource, { kind: "archive" }> = entryPaths.length
      ? { kind: "archive", path: archivePath, entryPaths }
      : { kind: "archive", path: archivePath }
    const bookId = stableOpaqueId("book", normalizedSource.kind, archivePath, ...entryPaths)
    const archiveVersion = versionFromFile(archiveStats.size, archiveStats.mtimeMs)
    const pages = pageEntries.map((entry, index): ReaderPage => {
      const media = pageMediaType(entry.path)!
      return {
        id: stableOpaqueId("page", bookId, entry.id),
        index,
        name: basename(entry.path),
        sourcePath: archivePath,
        entryPath: entry.path,
        mediaKind: media.kind,
        mimeType: media.mimeType,
        byteLength: entry.uncompressedSize,
        contentVersion: [archiveVersion, ...chainVersions, entry.crc32?.toString(16) ?? entry.id].join("-"),
        content: new ArchivePageContent(
          provider,
          entry.id,
          entry.uncompressedSize,
          media.mimeType,
          credentials,
          providerEntryPaths,
        ),
      }
    })
    return createReaderBook({
      id: bookId,
      source: normalizedSource,
      displayName: basename(entryPaths.at(-1) ?? archivePath),
      pages,
      dispose: () => releaseResources(resources),
    })
  } catch (error) {
    try {
      await releaseResources(resources)
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Nested archive loading and cleanup both failed.")
    }
    throw error
  }
}

async function createArchiveProvider(
  sourcePath: string,
  extension: string,
  options: PlatformReaderBookLoaderOptions,
  maxMaterializedBytes: number,
): Promise<ArchiveProvider> {
  if (extension === "zip" || extension === "cbz") {
    const { ZipArchiveProvider } = await import("./zip/ZipArchiveProvider.js")
    return new ZipArchiveProvider(sourcePath)
  }
  const { SevenZipArchiveProvider } = await import("./sevenzip/SevenZipArchiveProvider.js")
  return new SevenZipArchiveProvider(sourcePath, {
    resourceScheduler: options.resourceScheduler,
    tempDirectory: options.archiveTempDirectory,
    maxMaterializedBytes,
  })
}

async function materializeNestedEntry(
  provider: ArchiveProvider,
  entry: ArchiveEntry,
  signal: AbortSignal | undefined,
  options: PlatformReaderBookLoaderOptions,
  maxBytes: number,
  rawPassword: Uint8Array | undefined,
): Promise<MaterializedEntryLease> {
  try {
    if (provider.materializeEntry) return await provider.materializeEntry(entry.id, { signal, rawPassword })
    return await materializeArchiveEntry(provider, entry, {
      signal,
      tempDirectory: options.archiveTempDirectory,
      maxBytes,
      resourceScheduler: options.resourceScheduler,
      rawPassword,
    })
  } finally {
    rawPassword?.fill(0)
  }
}

function normalizeEntryPaths(source: Extract<ViewSource, { kind: "archive" }>): string[] {
  if (source.entryPath && source.entryPaths) throw new Error("Archive source cannot contain both entryPath and entryPaths.")
  const paths = source.entryPaths ?? (source.entryPath ? [source.entryPath] : [])
  return paths.map((path) => normalizeArchivePath(path))
}

function findArchiveEntry(entries: readonly ArchiveEntry[], path: string): ArchiveEntry {
  const entry = entries.find((candidate) => candidate.path === path)
  if (!entry) throw new Error(`Nested archive entry was not found: ${path}`)
  if (entry.kind !== "file") throw new Error(`Nested archive entry is not a file: ${path}`)
  return entry
}

function totalFileBytes(entries: readonly ArchiveEntry[]): number {
  let total = 0
  for (const entry of entries) {
    if (entry.kind !== "file") continue
    total += entry.uncompressedSize
    if (!Number.isSafeInteger(total)) throw new Error("Archive materialized size exceeds the safe integer range.")
  }
  return total
}

async function releaseResources(resources: Array<() => Promise<void>>): Promise<void> {
  const errors: unknown[] = []
  for (const release of resources.reverse()) {
    try {
      await release()
    } catch (error) {
      errors.push(error)
    }
  }
  resources.length = 0
  if (errors.length) throw new AggregateError(errors, "Failed to release nested archive resources.")
}

function boundedOption(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}`)
  }
  return value
}
