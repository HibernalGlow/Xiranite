import { randomUUID } from "node:crypto"
import { basename, isAbsolute, join } from "node:path"

import type { ReaderDirectorySelectionBatchSource } from "../browser/ReaderDirectorySelection.js"
import type {
  ReaderFileOperationResult,
  ReaderFileOperationService,
} from "./ReaderFileOperationService.js"

const OPERATION_BATCH_SIZE = 256
const MAX_ACTIVE_JOBS = 4
const MAX_RETAINED_JOBS = 16
const MAX_FAILURE_SAMPLES = 64

export type ReaderDirectorySelectionOperationKind = "copy" | "move" | "delete" | "trash"
export type ReaderDirectorySelectionOperationStatus = "running" | "completed" | "cancelled" | "failed"

export interface ReaderDirectorySelectionOperationSnapshot {
  id: string
  kind: ReaderDirectorySelectionOperationKind
  destinationPath?: string
  status: ReaderDirectorySelectionOperationStatus
  generation: number
  total: number
  processed: number
  succeeded: number
  failed: number
  cancelled: number
  failureSamples: readonly ReaderFileOperationResult[]
  failureSamplesTruncated: boolean
  startedAt: number
  completedAt?: number
  error?: string
}

interface SelectionOperationJob extends ReaderDirectorySelectionOperationSnapshot {
  controller: AbortController
  done: Promise<void>
}

export class ReaderDirectorySelectionOperationService implements AsyncDisposable {
  readonly #jobs = new Map<string, SelectionOperationJob>()
  #closed = false

  constructor(
    private readonly fileOperations: ReaderFileOperationService,
    private readonly now: () => number = Date.now,
  ) {}

  start(
    source: ReaderDirectorySelectionBatchSource,
    kind: ReaderDirectorySelectionOperationKind,
    destinationPath?: string,
  ): ReaderDirectorySelectionOperationSnapshot {
    this.#assertOpen()
    if (kind !== "copy" && kind !== "move" && kind !== "delete" && kind !== "trash") {
      throw new TypeError("Reader selection operation kind is invalid.")
    }
    if ((kind === "copy" || kind === "move") && (!destinationPath || !isAbsolute(destinationPath) || destinationPath.includes("\0"))) {
      throw new TypeError(`Reader ${kind} selection operation requires an absolute destinationPath.`)
    }
    if (source.selectedCount < 1) throw new RangeError("Reader selection operation requires at least one selected entry.")
    if (this.#activeJobCount() >= MAX_ACTIVE_JOBS) {
      throw new Error(`Reader selection operations cannot exceed ${MAX_ACTIVE_JOBS} active jobs.`)
    }
    this.#pruneCompleted()
    const id = randomUUID()
    const job: SelectionOperationJob = {
      id,
      kind,
      destinationPath,
      status: "running",
      generation: source.generation,
      total: source.selectedCount,
      processed: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
      failureSamples: [],
      failureSamplesTruncated: false,
      startedAt: this.now(),
      controller: new AbortController(),
      done: Promise.resolve(),
    }
    this.#jobs.set(id, job)
    job.done = this.#run(job, source)
    return snapshotOf(job)
  }

  get(id: string): ReaderDirectorySelectionOperationSnapshot | undefined {
    const job = this.#jobs.get(id)
    return job ? snapshotOf(job) : undefined
  }

  cancel(id: string): boolean {
    const job = this.#jobs.get(id)
    if (!job || job.status !== "running") return false
    job.controller.abort(new DOMException("Reader selection operation cancelled", "AbortError"))
    return true
  }

  async wait(id: string): Promise<ReaderDirectorySelectionOperationSnapshot | undefined> {
    const job = this.#jobs.get(id)
    if (!job) return undefined
    await job.done
    return snapshotOf(job)
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    const running = [...this.#jobs.values()].filter((job) => job.status === "running")
    for (const job of running) job.controller.abort(new DOMException("Reader selection operation service closed", "AbortError"))
    await Promise.allSettled(running.map((job) => job.done))
    await this.fileOperations.close()
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close()
  }

  async #run(job: SelectionOperationJob, source: ReaderDirectorySelectionBatchSource): Promise<void> {
    try {
      for (const entries of source.batches(OPERATION_BATCH_SIZE, job.controller.signal)) {
        const result = await this.fileOperations.execute({
          operations: entries.map((entry) => job.kind === "copy" || job.kind === "move"
            ? { kind: job.kind, sourcePath: entry.path, destinationPath: join(job.destinationPath!, basename(entry.path)), overwrite: false }
            : { kind: job.kind, sourcePath: entry.path }),
          signal: job.controller.signal,
        })
        job.processed += result.results.length
        job.succeeded += result.succeeded
        job.failed += result.failed
        job.cancelled += result.cancelled
        for (const item of result.results) {
          if (item.status === "succeeded") continue
          if (job.failureSamples.length < MAX_FAILURE_SAMPLES) {
            ;(job.failureSamples as ReaderFileOperationResult[]).push(item)
          } else {
            job.failureSamplesTruncated = true
          }
        }
        if (job.controller.signal.aborted) break
      }
      job.status = job.controller.signal.aborted ? "cancelled" : "completed"
    } catch (error) {
      if (job.controller.signal.aborted || isAbortError(error)) {
        job.status = "cancelled"
      } else {
        job.status = "failed"
        job.error = errorMessage(error)
      }
    } finally {
      job.completedAt = this.now()
    }
  }

  #activeJobCount(): number {
    let count = 0
    for (const job of this.#jobs.values()) if (job.status === "running") count += 1
    return count
  }

  #pruneCompleted(): void {
    const completed = [...this.#jobs.values()].filter((job) => job.status !== "running")
    const removeCount = Math.max(0, this.#jobs.size - MAX_RETAINED_JOBS + 1)
    for (const job of completed.slice(0, removeCount)) this.#jobs.delete(job.id)
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Reader selection operation service is closed.")
  }
}

function snapshotOf(job: SelectionOperationJob): ReaderDirectorySelectionOperationSnapshot {
  return {
    id: job.id,
    kind: job.kind,
    destinationPath: job.destinationPath,
    status: job.status,
    generation: job.generation,
    total: job.total,
    processed: job.processed,
    succeeded: job.succeeded,
    failed: job.failed,
    cancelled: job.cancelled,
    failureSamples: job.failureSamples.map((item) => ({ ...item, operation: { ...item.operation } })),
    failureSamplesTruncated: job.failureSamplesTruncated,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error: job.error,
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || ("code" in error && error.code === "ABORT_ERR"))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
