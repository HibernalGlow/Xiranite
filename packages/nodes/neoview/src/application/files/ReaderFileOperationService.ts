import pMap from "p-map"
import { isAbsolute, normalize, resolve } from "node:path"

import type { ReaderFileMutation, ReaderFileMutationProvider } from "../../ports/ReaderFileMutationProvider.js"

const DEFAULT_CONCURRENCY = 4
const MAX_CONCURRENCY = 8
const MAX_OPERATIONS = 256

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
}

export class ReaderFileOperationService {
  constructor(private readonly provider: ReaderFileMutationProvider) {}

  async execute(request: ReaderFileOperationRequest): Promise<ReaderFileOperationBatchResult> {
    const operations = validateOperations(request.operations)
    const concurrency = boundedConcurrency(request.concurrency)
    const results = await pMap(operations, async (operation, index): Promise<ReaderFileOperationResult> => {
      if (request.signal?.aborted) return cancelled(index, operation)
      try {
        await this.provider.execute(operation, request.signal)
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
    return {
      results,
      succeeded: results.filter((result) => result.status === "succeeded").length,
      failed: results.filter((result) => result.status === "failed").length,
      cancelled: results.filter((result) => result.status === "cancelled").length,
    }
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
