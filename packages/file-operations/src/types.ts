export type FileMutation =
  | { kind: "copy" | "move" | "rename"; sourcePath: string; destinationPath: string; overwrite?: boolean }
  | { kind: "delete" | "trash"; sourcePath: string }
  | { kind: "create-directory"; destinationPath: string }

export interface FileMutationGuard {
  path: string
  kind: "file" | "directory" | "symbolic-link" | "other"
  size: number
  mtimeMs: number
  ctimeMs: number
  device: number
  inode: number
}

export interface RustTrashItemReceipt {
  id: string
  name: string
  originalParent: string
  timeDeleted: number
}

export interface FileUndoReceipt {
  original: FileMutation
  inverse: FileMutation
  guard: FileMutationGuard
  providerData?: {
    kind: "trash-rs"
    item: RustTrashItemReceipt
  } | {
    /** Legacy NeoView receipt. Read-only compatibility; new operations never create it. */
    kind: "windows-recycle-bin"
    itemPath: string
  }
}

export interface FileMutationProvider {
  readonly trashRestore?: boolean
  execute(operation: FileMutation, signal?: AbortSignal): Promise<FileUndoReceipt | undefined | void>
  undo?(receipt: FileUndoReceipt, signal?: AbortSignal): Promise<void>
}

export interface FileOperationLease {
  release(): void
}

export interface FileOperationScheduler {
  acquire(
    request: {
      resource: "io"
      kind: string
      priority: "interactive"
      ownerId: string
    },
    signal?: AbortSignal,
  ): Promise<FileOperationLease>
}

export interface FileOperationScope {
  nodeId: string
  componentId?: string
  workspaceId?: string
}

export interface FileUndoJournalEntry {
  index: number
  receipt: FileUndoReceipt
  deletionId?: string
}

export interface FileUndoJournalRecord {
  id: string
  createdAt: number
  entries: readonly FileUndoJournalEntry[]
}

export interface FileUndoJournalStore {
  loadFileUndoTransactions(limit: number, scope?: FileOperationScope): Promise<FileUndoJournalRecord[]>
  saveFileUndoTransaction(record: FileUndoJournalRecord, limit: number, scope?: FileOperationScope): Promise<void>
  removeFileUndoTransaction(id: string): Promise<boolean>
}

export type FileDeletionState =
  | "pending"
  | "trashed"
  | "restored"
  | "restore-failed"
  | "permanent"
  | "delete-failed"

export interface FileDeletionRecord {
  id: string
  transactionId?: string
  transactionIndex?: number
  nodeId: string
  componentId?: string
  workspaceId?: string
  sourcePath: string
  deletionKind: "trash" | "delete"
  pathKind?: FileMutationGuard["kind"]
  size?: number
  deletedAt: number
  state: FileDeletionState
  restoreAvailable: boolean
  receipt?: FileUndoReceipt
  restoredAt?: number
  lastRestoreAttemptAt?: number
  lastError?: string
}

export interface FileDeletionQuery {
  nodeId?: string
  componentId?: string
  workspaceId?: string
  state?: FileDeletionState
  deletionKind?: "trash" | "delete"
  restoreAvailable?: boolean
  from?: number
  to?: number
  limit?: number
  cursor?: string
}

export interface FileDeletionList {
  items: FileDeletionRecord[]
  nextCursor: string | null
}

export interface FileDeletionStore {
  createFileDeletionRecords(records: readonly FileDeletionRecord[]): Promise<void>
  getFileDeletion(id: string): Promise<FileDeletionRecord | undefined>
  listFileDeletions(query: FileDeletionQuery): Promise<FileDeletionList>
  listFileDeletionNodes(): Promise<string[]>
  updateFileDeletion(record: FileDeletionRecord): Promise<FileDeletionRecord>
}

export interface FileOperationServiceOptions {
  undoLimit?: number
  journal?: FileUndoJournalStore
  deletions?: FileDeletionStore
  dispose?: () => void | Promise<void>
  now?: () => number
  id?: () => string
}

export interface FileOperationRequest {
  operations: readonly FileMutation[]
  concurrency?: number
  signal?: AbortSignal
}

export type FileOperationStatus = "succeeded" | "failed" | "cancelled"

export interface FileOperationResult {
  index: number
  operation: FileMutation
  status: FileOperationStatus
  deletionId?: string
  errorCode?: string
  error?: string
}

export interface FileOperationBatchResult {
  results: FileOperationResult[]
  succeeded: number
  failed: number
  cancelled: number
  undoable: number
  undoId?: string
  undoPersisted?: boolean
  deletionHistoryPersisted?: boolean
}

export interface FileUndoState {
  available: boolean
  count: number
  latestId?: string
  latestCreatedAt?: number
  supportedKinds: readonly FileMutation["kind"][]
  trashRestore: boolean
  persistent: boolean
  persistenceError?: string
}

export interface FileUndoResult {
  undoId?: string
  results: FileOperationResult[]
  succeeded: number
  failed: number
  remaining: number
  journalPersisted?: boolean
}

export interface FileUndoDiscardResult {
  undoId?: string
  discarded: boolean
  remaining: number
  journalPersisted?: boolean
}

export interface FileDeletionRestoreResult {
  record: FileDeletionRecord
  historyPersisted: boolean
}

export type FileDeletionExportFormat = "jsonl" | "csv" | "markdown"

export interface FileDeletionExport {
  format: FileDeletionExportFormat
  contentType: string
  extension: "jsonl" | "csv" | "md"
  content: string
  recordCount: number
}
