import type { ArchiveByteRange } from "../domain/archive/archive-range.js"
import type { ResourceClass, ResourceLease } from "./ResourceScheduler.js"

export type { ArchiveByteRange } from "../domain/archive/archive-range.js"

export type ArchiveEntryKind = "file" | "directory"

export interface ArchiveEntry {
  id: string
  sourceIndex?: number
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
  resourceLease?: ResourceLease
}

export type ArchivePreloadDirection = "forward" | "backward"

/**
 * Advisory speculative demand supplied by the reader preload coordinator.
 * Entry IDs are provider-local; visible openEntry calls remain hard demands.
 */
export interface ArchivePreloadDemand {
  generation: number
  direction: ArchivePreloadDirection
  directionConfidence: number
  entryIds: readonly string[]
}

export interface MaterializedEntryLease extends AsyncDisposable {
  readonly path: string
  release(): Promise<void>
}

export interface ArchiveProviderSnapshot {
  initialized: boolean
  indexEntries: number
  indexPayloadBytes: number
  activeExtractions: number
}

export interface ArchiveProvider extends AsyncDisposable {
  readonly sourcePath: string
  readonly capabilities: ArchiveCapabilities
  readonly entryStreamResource?: ResourceClass
  list(signal?: AbortSignal): Promise<readonly ArchiveEntry[]>
  openEntry(entryId: string, options?: OpenArchiveEntryOptions): Promise<ReadableStream<Uint8Array>>
  updatePreloadDemand?(demand: ArchivePreloadDemand): Promise<void>
  materializeEntry?(
    entryId: string,
    options?: Pick<OpenArchiveEntryOptions, "signal" | "password" | "rawPassword">,
  ): Promise<MaterializedEntryLease>
  snapshot?(): ArchiveProviderSnapshot
  close(): Promise<void>
}
