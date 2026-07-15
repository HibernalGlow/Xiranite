export type ReaderThumbnailDatabaseCompatibility =
  | "missing"
  | "current"
  | "legacy-upgrade-required"
  | "newer-read-only"
  | "incompatible"

export interface ReaderThumbnailDatabaseBackupResult {
  sourcePath: string
  destinationPath: string
  bytes: number
  compatibility: ReaderThumbnailDatabaseCompatibility
  metadataVersion?: string
  userVersion?: number
  journalMode?: string
  quickCheck: "ok"
}

export interface ReaderThumbnailDatabaseOptimizeResult {
  backup: ReaderThumbnailDatabaseBackupResult
  checkpoint?: { busy: number; logFrames: number; checkpointedFrames: number }
  optimized: true
  vacuumed: boolean
  journalModeBefore?: string
  journalModeAfter?: string
}

export interface ReaderThumbnailDatabaseMaintenance {
  backup(sourcePath: string, destinationPath: string, signal?: AbortSignal): Promise<ReaderThumbnailDatabaseBackupResult>
  optimize(
    sourcePath: string,
    options: { backupPath: string; vacuum: boolean },
    signal?: AbortSignal,
  ): Promise<ReaderThumbnailDatabaseOptimizeResult>
}
