import {
  FileOperationService,
  createMemoryFileOperationStore,
  type FileDeletionStore,
  type FileOperationScope,
  type FileOperationServiceOptions,
} from "@xiranite/file-operations"

import type { ReaderFileMutationProvider } from "../../ports/ReaderFileMutationProvider.js"
import type { ReaderFileUndoJournalStore } from "../../ports/ReaderFileUndoJournalStore.js"

export type {
  FileOperationBatchResult as ReaderFileOperationBatchResult,
  FileOperationRequest as ReaderFileOperationRequest,
  FileOperationResult as ReaderFileOperationResult,
  FileOperationStatus as ReaderFileOperationStatus,
  FileUndoDiscardResult as ReaderFileUndoDiscardResult,
  FileUndoResult as ReaderFileUndoResult,
  FileUndoState as ReaderFileUndoState,
} from "@xiranite/file-operations"

export interface ReaderFileOperationServiceOptions {
  undoLimit?: number
  journal?: ReaderFileUndoJournalStore
  deletions?: FileDeletionStore
  scope?: Partial<FileOperationScope>
  disposeJournal?: () => void | Promise<void>
}

/** Compatibility facade. The implementation and behavior live in @xiranite/file-operations. */
export class ReaderFileOperationService extends FileOperationService {
  constructor(provider: ReaderFileMutationProvider, options: ReaderFileOperationServiceOptions = {}) {
    const memory = options.deletions ? undefined : createMemoryFileOperationStore()
    const serviceOptions: FileOperationServiceOptions = {
      undoLimit: options.undoLimit,
      journal: options.journal,
      deletions: options.deletions ?? memory,
      dispose: options.disposeJournal,
    }
    super(provider, { nodeId: "neoview", ...options.scope }, serviceOptions)
  }
}
