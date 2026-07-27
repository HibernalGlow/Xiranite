import { randomUUID } from "node:crypto"
import { close, open, rename, rm, stat, type FileHandle } from "node:fs/promises"
import { basename, dirname, extname, join } from "node:path"
import {
  type Entry,
  type FileEntry,
  type ZipWriterAddDataOptions,
  type WritableWriter,
  Reader,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js/index-native.js"

import { normalizeArchivePath } from "../../../domain/archive/archive-path.js"
import { NodeFileReader } from "./NodeFileReader.js"

const EDITABLE_ARCHIVE_EXTENSIONS = new Set([".zip", ".cbz"])

export interface DeleteZipArchiveEntryRequest {
  archivePath: string
  entryIndex: number
  signal?: AbortSignal
}

export interface DeleteZipArchiveEntryResult {
  archivePath: string
  deletedEntryPath: string
  remainingEntries: number
}

export interface ZipArchiveEntryDeletionOptions {
  onBeforeReplace?: (archivePath: string) => void | Promise<void>
}

interface FileIdentity {
  size: number
  mtimeMs: number
  ctimeMs: number
}

/**
 * Rewrites a root ZIP/CBZ archive without one indexed entry. The temporary
 * archive stays beside the source so the replacement remains one-volume.
 */
export async function deleteZipArchiveEntry(
  request: DeleteZipArchiveEntryRequest,
  options: ZipArchiveEntryDeletionOptions = {},
): Promise<DeleteZipArchiveEntryResult> {
  assertEditableArchivePath(request.archivePath)
  assertEntryIndex(request.entryIndex)
  request.signal?.throwIfAborted()

  const sourceIdentity = await readFileIdentity(request.archivePath)
  const temporaryPath = temporaryArchivePath(request.archivePath)
  const sourceReader = new NodeFileReader(request.archivePath)
  const zipReader = new ZipReader(sourceReader, { useWebWorkers: false })
  let writer: NodeFileWriter | undefined
  let replacementReady = false

  try {
    const entries = await zipReader.getEntries()
    request.signal?.throwIfAborted()
    validateEntries(entries)
    const target = entries[request.entryIndex]
    if (!target) throw new Error(`ZIP archive entry index ${request.entryIndex} was not found.`)
    if (target.directory) throw new Error(`ZIP archive entry index ${request.entryIndex} is a directory.`)

    writer = new NodeFileWriter(temporaryPath)
    const zipWriter = new ZipWriter(writer, { keepOrder: true, useWebWorkers: false })
    let remainingEntries = 0
    for (const [index, entry] of entries.entries()) {
      request.signal?.throwIfAborted()
      if (index === request.entryIndex) continue
      await copyEntry(zipWriter, entry, request.signal)
      remainingEntries += 1
    }
    await zipWriter.close()
    await writer.syncAndClose()
    writer = undefined
    await zipReader.close()
    await sourceReader.close()
    replacementReady = true

    await options.onBeforeReplace?.(request.archivePath)
    request.signal?.throwIfAborted()
    if (!sameFileIdentity(sourceIdentity, await readFileIdentity(request.archivePath))) {
      throw new Error("ZIP archive changed while its replacement was being prepared.")
    }

    // `rename` is an atomic same-directory replacement on the supported host.
    await rename(temporaryPath, request.archivePath)
    return {
      archivePath: request.archivePath,
      deletedEntryPath: normalizeArchivePath(target.filename),
      remainingEntries,
    }
  } finally {
    await zipReader.close().catch(() => undefined)
    await sourceReader.close().catch(() => undefined)
    await writer?.close().catch(() => undefined)
    if (!replacementReady) await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

class NodeFileWriter implements WritableWriter {
  readonly writable: WritableStream<Uint8Array>
  #handle: FileHandle | undefined
  #initializing: Promise<void> | undefined
  #closed = false

  constructor(readonly path: string) {
    this.writable = new WritableStream({
      start: async () => await this.init(),
      write: async (chunk) => await this.writeChunk(chunk),
      close: async () => await this.syncAndClose(),
      abort: async () => await this.close(),
    })
  }

  async init(): Promise<void> {
    if (this.#closed) throw new Error(`ZIP temporary writer is closed: ${this.path}`)
    if (this.#handle) return
    if (!this.#initializing) {
      this.#initializing = open(this.path, "wx").then((handle) => {
        this.#handle = handle
      })
    }
    try {
      await this.#initializing
    } finally {
      this.#initializing = undefined
    }
  }

  async writeChunk(chunk: Uint8Array): Promise<void> {
    await this.init()
    const handle = this.#handle
    if (!handle) throw new Error(`ZIP temporary writer is unavailable: ${this.path}`)
    let offset = 0
    while (offset < chunk.byteLength) {
      const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset, null)
      if (bytesWritten < 1) throw new Error(`ZIP temporary writer made no progress: ${this.path}`)
      offset += bytesWritten
    }
  }

  async syncAndClose(): Promise<void> {
    const handle = this.#handle
    this.#handle = undefined
    if (!handle) return
    this.#closed = true
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  async close(): Promise<void> {
    const handle = this.#handle
    this.#handle = undefined
    this.#closed = true
    await handle?.close()
  }
}

async function copyEntry(zipWriter: ZipWriter<unknown>, entry: Entry, signal: AbortSignal | undefined): Promise<void> {
  const options = entryOptions(entry, signal)
  if (entry.directory) {
    await zipWriter.add(entry.filename, undefined, options)
    return
  }

  const stream = new TransformStream<Uint8Array, Uint8Array>()
  await Promise.all([
    copyFileEntryToStream(entry, stream.writable, signal),
    zipWriter.add(entry.filename, stream.readable, options),
  ])
}

async function copyFileEntryToStream(entry: FileEntry, writable: WritableStream<Uint8Array>, signal: AbortSignal | undefined): Promise<void> {
  await entry.getData(writable, {
    passThrough: true,
    signal,
    useWebWorkers: false,
  })
}

function entryOptions(entry: Entry, signal: AbortSignal | undefined): ZipWriterAddDataOptions {
  const common: ZipWriterAddDataOptions = {
    directory: entry.directory,
    executable: entry.executable,
    comment: entry.comment,
    lastModDate: entry.lastModDate,
    lastAccessDate: entry.lastAccessDate,
    creationDate: entry.creationDate,
    useUnicodeFileNames: entry.filenameUTF8,
    version: entry.version,
    versionMadeBy: entry.versionMadeBy,
    msDosCompatible: entry.msDosCompatible,
    internalFileAttributes: entry.internalFileAttributes,
    externalFileAttributes: entry.externalFileAttributes,
    signal,
  }
  if (entry.directory) return common
  return {
    ...common,
    passThrough: true,
    uncompressedSize: entry.uncompressedSize,
    signature: entry.signature,
    compressionMethod: entry.compressionMethod,
  }
}

function validateEntries(entries: readonly Entry[]): void {
  if (entries.some((entry) => entry.encrypted)) {
    throw new Error("Deleting ZIP entries from encrypted archives is not supported.")
  }
  for (const entry of entries) normalizeArchivePath(entry.filename)
}

function assertEditableArchivePath(archivePath: string): void {
  if (!archivePath || archivePath.includes("\0")) throw new Error("ZIP archive path must be non-empty and contain no NUL.")
  if (!EDITABLE_ARCHIVE_EXTENSIONS.has(extname(archivePath).toLowerCase())) {
    throw new Error("Only .zip and .cbz archives support entry deletion.")
  }
}

function assertEntryIndex(entryIndex: number): void {
  if (!Number.isSafeInteger(entryIndex) || entryIndex < 0) throw new RangeError("ZIP archive entry index must be a non-negative integer.")
}

async function readFileIdentity(path: string): Promise<FileIdentity> {
  const metadata = await stat(path)
  if (!metadata.isFile()) throw new Error(`ZIP archive is not a file: ${path}`)
  return { size: metadata.size, mtimeMs: metadata.mtimeMs, ctimeMs: metadata.ctimeMs }
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs
}

function temporaryArchivePath(archivePath: string): string {
  return join(dirname(archivePath), `.${basename(archivePath)}.${randomUUID()}.xiranite-rewrite`)
}
