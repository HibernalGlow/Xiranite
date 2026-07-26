import pMap from "p-map"
import { randomUUID } from "node:crypto"
import { isAbsolute, normalize, resolve } from "node:path"

import { exportFileDeletions } from "./export.js"
import type {
  FileDeletionExport,
  FileDeletionExportFormat,
  FileDeletionQuery,
  FileDeletionRecord,
  FileDeletionRestoreResult,
  FileMutation,
  FileMutationProvider,
  FileOperationBatchResult,
  FileOperationRequest,
  FileOperationResult,
  FileOperationScope,
  FileOperationServiceOptions,
  FileUndoDiscardResult,
  FileUndoJournalEntry,
  FileUndoJournalRecord,
  FileUndoReceipt,
  FileUndoResult,
  FileUndoState,
} from "./types.js"

const DEFAULT_CONCURRENCY = 4
const MAX_CONCURRENCY = 8
const MAX_OPERATIONS = 256
const DEFAULT_UNDO_LIMIT = 50
const EXPORT_PAGE_SIZE = 1_000

interface UndoTransaction extends Omit<FileUndoJournalRecord, "entries"> {
  entries: FileUndoJournalEntry[]
}

interface PendingDeletion {
  index: number
  record: FileDeletionRecord
}

export class FileOperationService {
  readonly #undoLimit: number
  readonly #undo: UndoTransaction[] = []
  readonly #journal?: FileOperationServiceOptions["journal"]
  readonly #deletions?: FileOperationServiceOptions["deletions"]
  readonly #dispose?: FileOperationServiceOptions["dispose"]
  readonly #now: () => number
  readonly #id: () => string
  #hydrated = false
  #hydratePromise?: Promise<void>
  #persistenceError?: string
  #closed = false

  constructor(
    private readonly provider: FileMutationProvider,
    private readonly scope: FileOperationScope,
    options: FileOperationServiceOptions = {},
  ) {
    if (!scope.nodeId.trim()) throw new Error("File operation nodeId cannot be empty.")
    this.#undoLimit = boundedUndoLimit(options.undoLimit)
    this.#journal = options.journal
    this.#deletions = options.deletions
    this.#dispose = options.dispose
    this.#now = options.now ?? Date.now
    this.#id = options.id ?? randomUUID
  }

  async execute(request: FileOperationRequest): Promise<FileOperationBatchResult> {
    this.#assertOpen()
    await this.prepare()
    const operations = validateOperations(request.operations)
    const concurrency = boundedConcurrency(request.concurrency)
    const pending = await this.#createPendingDeletions(operations)
    const pendingByIndex = new Map(pending.map((item) => [item.index, item.record]))
    const receipts: FileUndoJournalEntry[] = []
    let deletionHistoryPersisted = pending.length ? true : undefined

    const results = await pMap(operations, async (operation, index): Promise<FileOperationResult> => {
      const deletion = pendingByIndex.get(index)
      if (request.signal?.aborted) {
        if (deletion) deletionHistoryPersisted = await this.#finishDeletion(deletion, "delete-failed", undefined, "The operation was aborted.") && deletionHistoryPersisted
        return cancelled(index, operation, deletion?.id)
      }
      try {
        const receipt = await this.provider.execute(operation, request.signal)
        if (receipt) receipts.push({ index, receipt, deletionId: deletion?.id })
        if (deletion) {
          deletionHistoryPersisted = await this.#finishDeletion(
            deletion,
            operation.kind === "trash" ? "trashed" : "permanent",
            receipt || undefined,
          ) && deletionHistoryPersisted
        }
        return { index, operation, status: "succeeded", deletionId: deletion?.id }
      } catch (error) {
        if (deletion) deletionHistoryPersisted = await this.#finishDeletion(deletion, "delete-failed", undefined, errorMessage(error)) && deletionHistoryPersisted
        if (request.signal?.aborted || isAbortError(error)) return cancelled(index, operation, deletion?.id)
        return failed(index, operation, error, deletion?.id)
      }
    }, { concurrency, stopOnError: true })

    receipts.sort((left, right) => left.index - right.index)
    const recorded = receipts.length ? await this.#recordUndo(receipts) : undefined
    return {
      results,
      succeeded: countStatus(results, "succeeded"),
      failed: countStatus(results, "failed"),
      cancelled: countStatus(results, "cancelled"),
      undoable: receipts.length,
      undoId: recorded?.id,
      undoPersisted: recorded?.persisted,
      deletionHistoryPersisted,
    }
  }

  prepare(): Promise<void> {
    this.#assertOpen()
    if (this.#hydrated) return Promise.resolve()
    return this.#hydratePromise ??= this.#hydrate()
  }

  undoState(): FileUndoState {
    this.#assertOpen()
    const latest = this.#undo.at(-1)
    return {
      available: Boolean(this.provider.undo && latest),
      count: this.#undo.length,
      latestId: latest?.id,
      latestCreatedAt: latest?.createdAt,
      supportedKinds: ["copy", "move", "rename", "create-directory", ...(this.provider.trashRestore ? ["trash" as const] : [])],
      trashRestore: this.provider.trashRestore === true,
      persistent: Boolean(this.#journal),
      persistenceError: this.#persistenceError,
    }
  }

  async undoLatest(signal?: AbortSignal): Promise<FileUndoResult> {
    this.#assertOpen()
    await this.prepare()
    signal?.throwIfAborted()
    const transaction = this.#undo.at(-1)
    if (!transaction) return { results: [], succeeded: 0, failed: 0, remaining: 0 }
    if (!this.provider.undo) throw new Error("File operation undo is unavailable on this platform.")
    const results: FileOperationResult[] = []
    let succeeded = 0
    for (let offset = transaction.entries.length - 1; offset >= 0; offset -= 1) {
      const entry = transaction.entries[offset]!
      try {
        signal?.throwIfAborted()
        await this.provider.undo(entry.receipt, signal)
        transaction.entries.splice(offset, 1)
        succeeded += 1
        results.push({ index: entry.index, operation: entry.receipt.original, status: "succeeded", deletionId: entry.deletionId })
        if (entry.deletionId) await this.#markRestored(entry.deletionId)
      } catch (error) {
        if (signal?.aborted || isAbortError(error)) throw error
        results.push(failed(entry.index, entry.receipt.original, error, entry.deletionId))
        if (entry.deletionId) await this.#markRestoreFailed(entry.deletionId, error)
        break
      }
    }
    const journalPersisted = await this.#persistTransaction(transaction)
    return {
      undoId: transaction.id,
      results,
      succeeded,
      failed: countStatus(results, "failed"),
      remaining: transaction.entries.length,
      journalPersisted,
    }
  }

  async restoreDeletion(id: string, signal?: AbortSignal): Promise<FileDeletionRestoreResult> {
    this.#assertOpen()
    await this.prepare()
    signal?.throwIfAborted()
    if (!this.#deletions) throw new Error("File deletion history is unavailable.")
    if (!this.provider.undo) throw new Error("File trash restore is unavailable on this platform.")
    const record = await this.#deletions.getFileDeletion(id)
    if (!record) throw Object.assign(new Error(`File deletion record not found: ${id}`), { code: "ENOENT" })
    if (record.state === "restored") return { record, historyPersisted: true }
    if (!record.restoreAvailable || !record.receipt || record.deletionKind !== "trash") {
      throw Object.assign(new Error(`File deletion cannot be restored: ${id}`), { code: "ENOTSUP" })
    }
    try {
      await this.provider.undo(record.receipt, signal)
    } catch (error) {
      const failedRecord = restoreFailedRecord(record, this.#now(), errorMessage(error))
      const historyPersisted = await this.#tryUpdateDeletion(failedRecord)
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { historyPersisted })
    }
    const restored = restoredRecord(record, this.#now())
    const historyPersisted = await this.#tryUpdateDeletion(restored)
    await this.#removeDeletionFromUndo(id)
    return { record: restored, historyPersisted }
  }

  listDeletions(query: FileDeletionQuery = {}) {
    this.#assertOpen()
    if (!this.#deletions) throw new Error("File deletion history is unavailable.")
    return this.#deletions.listFileDeletions(query)
  }

  async exportDeletions(
    format: FileDeletionExportFormat,
    query: Omit<FileDeletionQuery, "cursor" | "limit"> = {},
  ): Promise<FileDeletionExport> {
    this.#assertOpen()
    if (!this.#deletions) throw new Error("File deletion history is unavailable.")
    const records: FileDeletionRecord[] = []
    let cursor: string | undefined
    do {
      const page = await this.#deletions.listFileDeletions({ ...query, cursor, limit: EXPORT_PAGE_SIZE })
      records.push(...page.items)
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    return exportFileDeletions(records, format, this.#now())
  }

  async discardLatest(): Promise<FileUndoDiscardResult> {
    this.#assertOpen()
    await this.prepare()
    const transaction = this.#undo.pop()
    if (!transaction) return { discarded: false, remaining: 0 }
    return {
      undoId: transaction.id,
      discarded: true,
      remaining: this.#undo.length,
      journalPersisted: await this.#persist(() => this.#journal!.removeFileUndoTransaction(transaction.id)),
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    await this.#dispose?.()
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close()
  }

  async #createPendingDeletions(operations: readonly FileMutation[]): Promise<PendingDeletion[]> {
    const pending = operations.flatMap((operation, index): PendingDeletion[] => {
      if (operation.kind !== "delete" && operation.kind !== "trash") return []
      return [{
        index,
        record: {
          id: this.#id(),
          nodeId: this.scope.nodeId,
          componentId: this.scope.componentId,
          workspaceId: this.scope.workspaceId,
          sourcePath: resolvedPath(operation.sourcePath),
          deletionKind: operation.kind,
          deletedAt: this.#now(),
          state: "pending",
          restoreAvailable: false,
        },
      }]
    })
    if (!pending.length) return pending
    if (!this.#deletions) {
      throw Object.assign(new Error("File deletion history store is required for delete and trash operations."), { code: "FILE_DELETION_STORE_REQUIRED" })
    }
    await this.#deletions.createFileDeletionRecords(pending.map((item) => item.record))
    return pending
  }

  async #finishDeletion(
    record: FileDeletionRecord,
    state: "trashed" | "permanent" | "delete-failed",
    receipt?: FileUndoReceipt,
    lastError?: string,
  ): Promise<boolean> {
    record.state = state
    record.receipt = receipt
    record.pathKind = receipt?.guard.kind
    record.size = receipt?.guard.size
    record.restoreAvailable = state === "trashed" && Boolean(receipt?.providerData?.kind === "trash-rs" && this.provider.undo)
    record.lastError = lastError
    return this.#tryUpdateDeletion(record)
  }

  async #recordUndo(entries: FileUndoJournalEntry[]): Promise<{ id: string; persisted?: boolean }> {
    const transaction = { id: this.#id(), createdAt: this.#now(), entries }
    for (const entry of entries) {
      if (!entry.deletionId) continue
      const deletion = await this.#deletions?.getFileDeletion(entry.deletionId)
      if (!deletion) continue
      deletion.transactionId = transaction.id
      deletion.transactionIndex = entry.index
      await this.#tryUpdateDeletion(deletion)
    }
    this.#undo.push(transaction)
    if (this.#undo.length > this.#undoLimit) this.#undo.splice(0, this.#undo.length - this.#undoLimit)
    return {
      id: transaction.id,
      persisted: await this.#persist(() => this.#journal!.saveFileUndoTransaction(transaction, this.#undoLimit, this.scope)),
    }
  }

  async #hydrate(): Promise<void> {
    try {
      if (this.#journal) {
        const records = await this.#journal.loadFileUndoTransactions(this.#undoLimit, this.scope)
        this.#undo.splice(0, this.#undo.length, ...records.map((record) => ({
          id: record.id,
          createdAt: record.createdAt,
          entries: record.entries.map((entry) => ({ ...entry })),
        })))
      }
    } catch (error) {
      this.#persistenceError = errorMessage(error)
    } finally {
      this.#hydrated = true
    }
  }

  async #persistTransaction(transaction: UndoTransaction): Promise<boolean | undefined> {
    if (transaction.entries.length === 0) {
      const index = this.#undo.findIndex((item) => item.id === transaction.id)
      if (index >= 0) this.#undo.splice(index, 1)
      return this.#persist(() => this.#journal!.removeFileUndoTransaction(transaction.id))
    }
    return this.#persist(() => this.#journal!.saveFileUndoTransaction(transaction, this.#undoLimit, this.scope))
  }

  async #removeDeletionFromUndo(deletionId: string): Promise<void> {
    for (const transaction of this.#undo) {
      const length = transaction.entries.length
      transaction.entries = transaction.entries.filter((entry) => entry.deletionId !== deletionId)
      if (transaction.entries.length !== length) await this.#persistTransaction(transaction)
    }
  }

  async #markRestored(id: string): Promise<void> {
    const record = await this.#deletions?.getFileDeletion(id)
    if (record) await this.#tryUpdateDeletion(restoredRecord(record, this.#now()))
  }

  async #markRestoreFailed(id: string, error: unknown): Promise<void> {
    const record = await this.#deletions?.getFileDeletion(id)
    if (record) await this.#tryUpdateDeletion(restoreFailedRecord(record, this.#now(), errorMessage(error)))
  }

  async #tryUpdateDeletion(record: FileDeletionRecord): Promise<boolean> {
    if (!this.#deletions) return false
    try {
      await this.#deletions.updateFileDeletion(record)
      return true
    } catch (error) {
      this.#persistenceError = errorMessage(error)
      return false
    }
  }

  async #persist(operation: () => Promise<unknown>): Promise<boolean | undefined> {
    if (!this.#journal) return undefined
    try {
      await operation()
      this.#persistenceError = undefined
      return true
    } catch (error) {
      this.#persistenceError = errorMessage(error)
      return false
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("File operation service is closed.")
  }
}

function validateOperations(input: readonly FileMutation[]): FileMutation[] {
  if (!Array.isArray(input)) throw new Error("File operations must be an array.")
  if (input.length > MAX_OPERATIONS) throw new Error(`File operation batches cannot exceed ${MAX_OPERATIONS} items.`)
  return input.map((operation) => {
    if (!operation || typeof operation !== "object") throw new Error("File operation is invalid.")
    if (operation.kind !== "copy" && operation.kind !== "move" && operation.kind !== "rename"
      && operation.kind !== "delete" && operation.kind !== "trash" && operation.kind !== "create-directory") {
      throw new Error("File operation kind is invalid.")
    }
    if ((operation.kind === "copy" || operation.kind === "move" || operation.kind === "rename")
      && (!("sourcePath" in operation) || !("destinationPath" in operation))) {
      throw new Error(`${operation.kind} operation requires sourcePath and destinationPath.`)
    }
    if ((operation.kind === "delete" || operation.kind === "trash") && !("sourcePath" in operation)) {
      throw new Error(`${operation.kind} operation requires sourcePath.`)
    }
    if (operation.kind === "create-directory" && !("destinationPath" in operation)) {
      throw new Error("create-directory operation requires destinationPath.")
    }
    if ("sourcePath" in operation) assertAbsolutePath(operation.sourcePath, "sourcePath")
    if ("destinationPath" in operation) assertAbsolutePath(operation.destinationPath, "destinationPath")
    if ("sourcePath" in operation && "destinationPath" in operation) {
      const sameResolvedPath = resolvedPath(operation.sourcePath) === resolvedPath(operation.destinationPath)
      const sameNormalizedPath = normalizedPath(operation.sourcePath) === normalizedPath(operation.destinationPath)
      if (sameResolvedPath || (operation.kind !== "rename" && sameNormalizedPath)) {
        throw new Error("File operation source and destination must differ.")
      }
      if (operation.overwrite !== undefined && typeof operation.overwrite !== "boolean") {
        throw new Error("File operation overwrite must be boolean.")
      }
    }
    return { ...operation }
  })
}

function assertAbsolutePath(path: string, name: string): void {
  if (typeof path !== "string" || path.length === 0 || path.includes("\0") || !isAbsolute(path)) {
    throw new Error(`File operation ${name} must be an absolute path.`)
  }
}

function normalizedPath(path: string): string {
  const value = resolvedPath(path)
  return process.platform === "win32" ? value.toLocaleLowerCase("en-US") : value
}

function resolvedPath(path: string): string {
  return normalize(resolve(path))
}

function boundedConcurrency(value: number | undefined): number {
  const result = value ?? DEFAULT_CONCURRENCY
  if (!Number.isSafeInteger(result) || result < 1 || result > MAX_CONCURRENCY) {
    throw new Error(`File operation concurrency must be from 1 to ${MAX_CONCURRENCY}.`)
  }
  return result
}

function boundedUndoLimit(value: number | undefined): number {
  const result = value ?? DEFAULT_UNDO_LIMIT
  if (!Number.isSafeInteger(result) || result < 1 || result > 100) {
    throw new Error("File operation undoLimit must be from 1 to 100.")
  }
  return result
}

function cancelled(index: number, operation: FileMutation, deletionId?: string): FileOperationResult {
  return { index, operation, status: "cancelled", deletionId, errorCode: "ABORT_ERR", error: "The operation was aborted." }
}

function failed(index: number, operation: FileMutation, error: unknown, deletionId?: string): FileOperationResult {
  return { index, operation, status: "failed", deletionId, errorCode: errorCode(error), error: errorMessage(error) }
}

function countStatus(results: readonly FileOperationResult[], status: FileOperationResult["status"]): number {
  return results.filter((result) => result.status === status).length
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") return error.code
  return "FILE_OPERATION_FAILED"
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || ("code" in error && error.code === "ABORT_ERR"))
}

function restoredRecord(record: FileDeletionRecord, now: number): FileDeletionRecord {
  return {
    ...record,
    state: "restored",
    restoreAvailable: false,
    restoredAt: now,
    lastRestoreAttemptAt: now,
    lastError: undefined,
  }
}

function restoreFailedRecord(record: FileDeletionRecord, now: number, error: string): FileDeletionRecord {
  return { ...record, state: "restore-failed", lastRestoreAttemptAt: now, lastError: error }
}
