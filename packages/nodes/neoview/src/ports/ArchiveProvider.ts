import type { ArchiveByteRange } from "../domain/archive/archive-range.js"

export type { ArchiveByteRange } from "../domain/archive/archive-range.js"

export type ArchiveEntryKind = "file" | "directory"

export interface ArchiveEntry {
  id: string
  path: string
  kind: ArchiveEntryKind
  uncompressedSize: number
  compressedSize?: number
  compressionMethod?: string
  crc32?: number
  modifiedAt?: string
  encrypted?: boolean
  zip64?: boolean
}

export interface ArchiveCapabilities {
  solid: boolean
  randomAccess: boolean
  entryRange: boolean
  materialization: "never" | "optional" | "required"
}

export interface OpenArchiveEntryOptions {
  signal?: AbortSignal
  range?: ArchiveByteRange
  password?: string
  rawPassword?: Uint8Array
}

export interface MaterializedEntryLease extends AsyncDisposable {
  readonly path: string
  release(): Promise<void>
}

export interface ArchiveProvider extends AsyncDisposable {
  readonly sourcePath: string
  readonly capabilities: ArchiveCapabilities
  list(signal?: AbortSignal): Promise<readonly ArchiveEntry[]>
  openEntry(entryId: string, options?: OpenArchiveEntryOptions): Promise<ReadableStream<Uint8Array>>
  materializeEntry?(entryId: string, signal?: AbortSignal): Promise<MaterializedEntryLease>
  close(): Promise<void>
}
