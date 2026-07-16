import { z } from "zod"

import type { ReaderMediaProgressRecord, ReaderMediaProgressStore } from "../../ports/ReaderMediaProgressStore.js"
import { LatestRecordWriteCoordinator } from "../persistence/LatestRecordWriteCoordinator.js"

const mediaProgressSchema = z.object({
  position: z.number().finite().nonnegative(),
  duration: z.number().finite().nonnegative(),
  completed: z.boolean(),
}).strict().refine((value) => value.position <= value.duration, {
  message: "Media position cannot exceed duration.",
  path: ["position"],
})

export type ReaderMediaProgressUpdate = z.input<typeof mediaProgressSchema>

export class ReaderMediaProgressService {
  readonly #writes: LatestRecordWriteCoordinator<string, ReaderMediaProgressRecord>
  #closed = false

  constructor(
    private readonly store: ReaderMediaProgressStore,
    private readonly clock: () => number = Date.now,
    writeDelayMs = 500,
  ) {
    this.#writes = new LatestRecordWriteCoordinator(
      (record) => record.bookId,
      (record) => this.store.saveMediaProgress(record),
      writeDelayMs,
    )
  }

  async get(bookId: string): Promise<ReaderMediaProgressRecord | undefined> {
    this.#assertOpen()
    assertBookId(bookId)
    return this.#writes.latest(bookId) ?? await this.store.getMediaProgress(bookId)
  }

  record(bookId: string, update: ReaderMediaProgressUpdate): ReaderMediaProgressRecord {
    this.#assertOpen()
    assertBookId(bookId)
    const parsed = mediaProgressSchema.parse(update)
    const record = { bookId, ...parsed, updatedAt: this.clock() }
    this.#writes.record(record)
    return record
  }

  flush(bookId: string): Promise<void> {
    this.#assertOpen()
    assertBookId(bookId)
    return this.#writes.flush(bookId)
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    await this.#writes.close()
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Reader media progress service is closed.")
  }
}

function assertBookId(bookId: string): void {
  if (!bookId.trim() || bookId.length > 512) throw new Error("Reader media progress bookId must contain 1 to 512 characters.")
}
