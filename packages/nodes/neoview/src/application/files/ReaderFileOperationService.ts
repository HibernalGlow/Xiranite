import pMap from "p-map"
import { randomUUID } from "node:crypto"
import { isAbsolute, normalize, resolve } from "node:path"

import type { ReaderFileMutation, ReaderFileMutationProvider, ReaderFileUndoReceipt } from "../../ports/ReaderFileMutationProvider.js"

const DEFAULT_CONCURRENCY = 4
const MAX_CONCURRENCY = 8
const MAX_OPERATIONS = 256
const DEFAULT_UNDO_LIMIT = 50

export interface ReaderFileOperationRequest {
  operations: readonly ReaderFileMutation[]
  concurrency?: number
  signal?: AbortSignal
}

export type ReaderFileOperationStatus = "succeeded" | "failed" | "cancelled"

export interface ReaderFileOperationResult {
  index: number
  operation: ReaderFileMutation
  status: ReaderFileOperationStatus
  errorCode?: string
  error?: string
}

export interface ReaderFileOperationBatchResult {
  results: ReaderFileOperationResult[]
  succeeded: number
  failed: number
  cancelled: number
  undoable: number
  undoId?: string
}

export interface ReaderFileUndoState {
  available: boolean
  count: number
  latestId?: string
  latestCreatedAt?: number
  supportedKinds: readonly ReaderFileMutation["kind"][]
  trashRestore: false
}

export interface ReaderFileUndoResult {
  undoId?: string
  results: ReaderFileOperationResult[]
  succeeded: number
  failed: number
  remaining: number
}

interface UndoTransaction {
  id: string
  createdAt: number
  entries: Array<{ index: number; receipt: ReaderFileUndoReceipt }>
}

export class ReaderFileOperationService {
  readonly #undoLimit: number
  readonly #undo: UndoTransaction[] = []

  constructor(private readonly provider: ReaderFileMutationProvider, options: { undoLimit?: number } = {}) {
    this.#undoLimit = boundedUndoLimit(options.undoLimit)
  }

  async execute(request: ReaderFileOperationRequest): Promise<ReaderFileOperationBatchResult> {
    const operations = validateOperations(request.operations)
    const concurrency = boundedConcurrency(request.concurrency)
    const receipts: Array<{ index: number; receipt: ReaderFileUndoReceipt }> = []
    const results = await pMap(operations, async (operation, index): Promise<ReaderFileOperationResult> => {
      if (request.signal?.aborted) return cancelled(index, operation)
      try {
        const receipt = await this.provider.execute(operation, request.signal)
        if (receipt) receipts.push({ index, receipt })
        return { index, operation, status: "succeeded" }
      } catch (error) {
        if (request.signal?.aborted || isAbortError(error)) return cancelled(index, operation)
        return {
          index,
          operation,
          status: "failed",
          errorCode: errorCode(error),
          error: errorMessage(error),
        }
      }
    }, { concurrency, stopOnError: true })
    receipts.sort((left, right) => left.index - right.index)
    const undoId = receipts.length ? this.#recordUndo(receipts) : undefined
    return {
      results,
      succeeded: results.filter((result) => result.status === "succeeded").length,
      failed: results.filter((result) => result.status === "failed").length,
      cancelled: results.filter((result) => result.status === "cancelled").length,
      undoable: receipts.length,
      undoId,
    }
  }

  undoState(): ReaderFileUndoState {
    const latest = this.#undo.at(-1)
    return {
      available: Boolean(this.provider.undo && latest),
      count: this.#undo.length,
      latestId: latest?.id,
      latestCreatedAt: latest?.createdAt,
      supportedKinds: ["copy", "move", "rename", "create-directory"],
      trashRestore: false,
    }
  }

  async undoLatest(signal?: AbortSignal): Promise<ReaderFileUndoResult> {
    signal?.throwIfAborted()
    const transaction = this.#undo.at(-1)
    if (!transaction) return { results: [], succeeded: 0, failed: 0, remaining: 0 }
    if (!this.provider.undo) throw new Error("Reader file operation undo is unavailable on this platform.")
    const results: ReaderFileOperationResult[] = []
    let succeeded = 0
    for (let offset = transaction.entries.length - 1; offset >= 0; offset -= 1) {
      const entry = transaction.entries[offset]!
      try {
        signal?.throwIfAborted()
        await this.provider.undo(entry.receipt, signal)
        transaction.entries.splice(offset, 1)
        succeeded += 1
        results.push({ index: entry.index, operation: entry.receipt.original, status: "succeeded" })
      } catch (error) {
        if (signal?.aborted || isAbortError(error)) throw error
        results.push({
          index: entry.index,
          operation: entry.receipt.original,
          status: "failed",
          errorCode: errorCode(error),
          error: errorMessage(error),
        })
        break
      }
    }
    if (transaction.entries.length === 0) this.#undo.pop()
    return {
      undoId: transaction.id,
      results,
      succeeded,
      failed: results.filter((result) => result.status === "failed").length,
      remaining: transaction.entries.length,
    }
  }

  #recordUndo(entries: Array<{ index: number; receipt: ReaderFileUndoReceipt }>): string {
    const transaction = { id: randomUUID(), createdAt: Date.now(), entries }
    this.#undo.push(transaction)
    if (this.#undo.length > this.#undoLimit) this.#undo.splice(0, this.#undo.length - this.#undoLimit)
    return transaction.id
  }
}

function validateOperations(input: readonly ReaderFileMutation[]): ReaderFileMutation[] {
  if (!Array.isArray(input)) throw new Error("Reader file operations must be an array.")
  if (input.length > MAX_OPERATIONS) throw new Error(`Reader file operation batches cannot exceed ${MAX_OPERATIONS} items.`)
  return input.map((operation) => {
    if (!operation || typeof operation !== "object") throw new Error("Reader file operation is invalid.")
    if (operation.kind !== "copy" && operation.kind !== "move" && operation.kind !== "rename"
      && operation.kind !== "delete" && operation.kind !== "trash" && operation.kind !== "create-directory") {
      throw new Error("Reader file operation kind is invalid.")
    }
    if ((operation.kind === "copy" || operation.kind === "move" || operation.kind === "rename")
      && (!("sourcePath" in operation) || !("destinationPath" in operation))) {
      throw new Error(`Reader ${operation.kind} operation requires sourcePath and destinationPath.`)
    }
    if ((operation.kind === "delete" || operation.kind === "trash") && !("sourcePath" in operation)) {
      throw new Error(`Reader ${operation.kind} operation requires sourcePath.`)
    }
    if (operation.kind === "create-directory" && !("destinationPath" in operation)) {
      throw new Error("Reader create-directory operation requires destinationPath.")
    }
    if ("sourcePath" in operation) assertAbsolutePath(operation.sourcePath, "sourcePath")
    if ("destinationPath" in operation) assertAbsolutePath(operation.destinationPath, "destinationPath")
    if ("sourcePath" in operation && "destinationPath" in operation) {
      if (normalizedPath(operation.sourcePath) === normalizedPath(operation.destinationPath)) {
        throw new Error("Reader file operation source and destination must differ.")
      }
      if (operation.overwrite !== undefined && typeof operation.overwrite !== "boolean") {
        throw new Error("Reader file operation overwrite must be boolean.")
      }
    }
    return { ...operation }
  })
}

function assertAbsolutePath(path: string, name: string): void {
  if (typeof path !== "string" || path.length === 0 || path.includes("\0") || !isAbsolute(path)) {
    throw new Error(`Reader file operation ${name} must be an absolute path.`)
  }
}

function normalizedPath(path: string): string {
  const value = normalize(resolve(path))
  return process.platform === "win32" ? value.toLocaleLowerCase("en-US") : value
}

function boundedConcurrency(value: number | undefined): number {
  const result = value ?? DEFAULT_CONCURRENCY
  if (!Number.isSafeInteger(result) || result < 1 || result > MAX_CONCURRENCY) {
    throw new Error(`Reader file operation concurrency must be from 1 to ${MAX_CONCURRENCY}.`)
  }
  return result
}

function boundedUndoLimit(value: number | undefined): number {
  const result = value ?? DEFAULT_UNDO_LIMIT
  if (!Number.isSafeInteger(result) || result < 1 || result > 100) {
    throw new Error("Reader file operation undoLimit must be from 1 to 100.")
  }
  return result
}

function cancelled(index: number, operation: ReaderFileMutation): ReaderFileOperationResult {
  return { index, operation, status: "cancelled", errorCode: "ABORT_ERR", error: "The operation was aborted." }
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
