import type { ReaderFileUndoReceipt } from "./ReaderFileMutationProvider.js"

export interface ReaderFileUndoJournalRecord {
  id: string
  createdAt: number
  entries: readonly { index: number; receipt: ReaderFileUndoReceipt }[]
}

export interface ReaderFileUndoJournalStore {
  loadFileUndoTransactions(limit: number): Promise<ReaderFileUndoJournalRecord[]>
  saveFileUndoTransaction(record: ReaderFileUndoJournalRecord, limit: number): Promise<void>
  removeFileUndoTransaction(id: string): Promise<boolean>
}
