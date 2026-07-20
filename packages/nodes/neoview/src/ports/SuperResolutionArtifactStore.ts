import type { Readable } from "node:stream"

export interface SuperResolutionArtifactMetadata {
  readonly bookKey: string
  readonly contentType: "image/jpeg" | "image/png" | "image/webp"
  readonly extension: "jpg" | "png" | "webp"
}

export interface SuperResolutionArtifactLease {
  readonly key: string
  readonly size: number
  readonly integrity: string
  readonly metadata: SuperResolutionArtifactMetadata & { readonly createdAt: number }
  openStream(signal?: AbortSignal): Readable
  release(): void
  [Symbol.dispose](): void
}

export type SuperResolutionArtifactProducer = (
  destinationPath: string,
  signal: AbortSignal,
) => void | Promise<void>

export interface SuperResolutionArtifactStoreSnapshot {
  entries: number
  bytes: number
  maxBytes: number
  maxEntryBytes: number
  activeLeases: number
  hits: number
  misses: number
  writes: number
  rejectedWrites: number
  evictions: number
  integrityFailures: number
}

export interface SuperResolutionArtifactCleanupResult extends SuperResolutionArtifactStoreSnapshot {
  reason: "age" | "budget" | "book" | "explicit" | "low-disk"
  removedEntries: number
  removedBytes: number
}

export interface SuperResolutionArtifactStore {
  acquire(key: string, signal?: AbortSignal): Promise<SuperResolutionArtifactLease | undefined>
  publish(
    key: string,
    metadata: SuperResolutionArtifactMetadata,
    producer: SuperResolutionArtifactProducer,
    signal?: AbortSignal,
  ): Promise<boolean>
  invalidate(key: string): Promise<void>
  clearBook(bookKey: string): Promise<SuperResolutionArtifactCleanupResult>
  cleanup(reason?: "age" | "budget" | "explicit" | "low-disk"): Promise<SuperResolutionArtifactCleanupResult>
  clear(): Promise<SuperResolutionArtifactCleanupResult>
  snapshot(): Promise<SuperResolutionArtifactStoreSnapshot>
  countBook?(bookKey: string): Promise<number>
  close(): Promise<void>
  [Symbol.asyncDispose](): Promise<void>
}
