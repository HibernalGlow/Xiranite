export interface ReaderThumbnailAsset {
  bytes: Uint8Array
  contentType?: string
  sourceSize?: number
  date?: string
  generationHash?: number
}

export type ReaderThumbnailCategory = "file" | "folder"

export interface ReaderThumbnailWrite {
  key: string
  category: ReaderThumbnailCategory
  bytes: Uint8Array
  sourceSize?: number
  date?: string
  generationHash?: number
}

export interface ReaderThumbnailFailure {
  key: string
  reason: string
  retryCount: number
  lastAttempt: string
  errorMessage?: string
}

export interface ReaderThumbnailWriterSnapshot {
  pendingWrites: number
  flushing: boolean
  committedBatches: number
  committedWrites: number
  busyRetries: number
  failedBatches: number
  lastError?: string
}

export interface ReaderThumbnailMaintenanceSnapshot {
  totalRows: number
  fileRows: number
  folderRows: number
  blobBytes: number
  emptyBlobs: number
  failedRows: number
  failuresByReason: Readonly<Record<string, number>>
  databaseBytes?: number
  walBytes?: number
  shmBytes?: number
  writer: ReaderThumbnailWriterSnapshot
}

export type ReaderThumbnailCleanupRequest =
  | { kind: "empty"; limit: number }
  | { kind: "expired"; cutoff: string; limit: number; preserveFolders: true }

export interface ReaderThumbnailInvalidCleanupResult {
  scanned: number
  deleted: number
  unavailableVolumeRowsPreserved: number
  wrapped: boolean
}

export interface ReaderThumbnailStore {
  revision?(): number
  get(key: string, category: ReaderThumbnailCategory): Promise<ReaderThumbnailAsset | undefined>
  getMany?(keys: readonly string[], category: ReaderThumbnailCategory): Promise<ReadonlyMap<string, ReaderThumbnailAsset>>
  put?(thumbnail: ReaderThumbnailWrite): Promise<void>
  getFailure?(key: string): Promise<ReaderThumbnailFailure | undefined>
  recordFailure?(failure: Omit<ReaderThumbnailFailure, "retryCount">): Promise<void>
  maintenanceSnapshot?(): Promise<ReaderThumbnailMaintenanceSnapshot>
  clearFailures?(options: { reason?: string; limit: number }): Promise<number>
  cleanup?(request: ReaderThumbnailCleanupRequest): Promise<number>
  cleanupInvalid?(options: { scanLimit: number; deleteLimit: number }): Promise<ReaderThumbnailInvalidCleanupResult>
}
