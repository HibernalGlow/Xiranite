import type { ReaderPage } from "../../domain/page/page.js"
import type {
  ReaderPageMaterializationLease,
  ReaderPageMaterializer,
} from "../../ports/ReaderPageMaterializer.js"
import type { ReaderSessionId } from "./contracts.js"

const DEFAULT_MAX_ENTRY_BYTES = 2 * 1024 * 1024 * 1024
const DEFAULT_MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024

export interface ReaderSeekableMediaCacheOptions {
  maxEntryBytes?: number
  maxTotalBytes?: number
}

export interface ReaderSeekableMediaLease {
  readonly path: string
  readonly byteLength: number
  release(): Promise<void>
}

interface MaterializationRecord {
  readonly key: string
  readonly sessionId: ReaderSessionId
  readonly page: ReaderPage
  readonly controller: AbortController
  readonly promise: Promise<ReaderPageMaterializationLease>
  waiters: number
  references: number
  settled: boolean
  releaseRequested: boolean
  materialization?: ReaderPageMaterializationLease
}

export class ReaderSeekableMediaCache implements AsyncDisposable {
  readonly #materializer: ReaderPageMaterializer
  readonly #maxEntryBytes: number
  readonly #maxTotalBytes: number
  readonly #records = new Map<string, MaterializationRecord>()
  #reservedBytes = 0
  #closed = false

  constructor(materializer: ReaderPageMaterializer, options: ReaderSeekableMediaCacheOptions = {}) {
    this.#materializer = materializer
    this.#maxEntryBytes = positiveInteger(options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES, "maxEntryBytes")
    this.#maxTotalBytes = positiveInteger(options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES, "maxTotalBytes")
    if (this.#maxEntryBytes > this.#maxTotalBytes) throw new RangeError("maxEntryBytes must not exceed maxTotalBytes")
  }

  async acquire(
    sessionId: ReaderSessionId,
    page: ReaderPage,
    signal?: AbortSignal,
  ): Promise<ReaderSeekableMediaLease> {
    if (this.#closed) throw new Error("Reader seekable media cache is closed.")
    signal?.throwIfAborted()
    if (page.mediaKind !== "video" || !page.entryPath) {
      throw new Error("Only archive video pages require seekable media materialization.")
    }
    const byteLength = page.byteLength
    if (!Number.isSafeInteger(byteLength) || byteLength === undefined || byteLength < 0) {
      throw new Error("Archive video must declare a safe byte length before materialization.")
    }
    if (byteLength > this.#maxEntryBytes) {
      throw new Error(`Archive video exceeds the ${this.#maxEntryBytes} byte seekable media budget.`)
    }

    const key = `${sessionId}\u0000${page.id}\u0000${page.contentVersion}`
    let record = this.#records.get(key)
    if (!record) {
      if (this.#reservedBytes + byteLength > this.#maxTotalBytes) {
        throw new Error(`Seekable media materializations exceed the ${this.#maxTotalBytes} byte total budget.`)
      }
      record = this.#createRecord(key, sessionId, page, byteLength)
      this.#records.set(key, record)
      this.#reservedBytes += byteLength
    }
    if (record.releaseRequested) throw abortError("Reader session no longer owns this media materialization.")

    record.waiters += 1
    try {
      const materialization = await waitForMaterialization(record.promise, signal)
      if (record.releaseRequested) throw abortError("Reader session no longer owns this media materialization.")
      record.references += 1
      let released = false
      return {
        path: materialization.path,
        byteLength: materialization.byteLength,
        release: async () => {
          if (released) return
          released = true
          record!.references -= 1
          if (record!.releaseRequested && record!.references === 0) await this.#releaseRecord(record!)
        },
      }
    } finally {
      record.waiters -= 1
      if (!record.settled && record.waiters === 0) {
        record.releaseRequested = true
        record.controller.abort(abortError("Seekable media materialization has no active waiters."))
      }
    }
  }

  async releaseSession(sessionId: ReaderSessionId): Promise<void> {
    const pending: Promise<unknown>[] = []
    for (const record of this.#records.values()) {
      if (record.sessionId !== sessionId) continue
      record.releaseRequested = true
      if (!record.settled) {
        record.controller.abort(abortError("Reader session closed during media materialization."))
        pending.push(record.promise.catch(() => undefined))
      } else if (record.references === 0) {
        pending.push(this.#releaseRecord(record))
      }
    }
    await Promise.all(pending)
  }

  async retainSessionPages(sessionId: ReaderSessionId, pageIds: ReadonlySet<string>): Promise<void> {
    const pending: Promise<unknown>[] = []
    for (const record of this.#records.values()) {
      if (record.sessionId !== sessionId) continue
      if (pageIds.has(record.page.id)) {
        if (record.settled) record.releaseRequested = false
        continue
      }
      record.releaseRequested = true
      if (!record.settled) {
        record.controller.abort(abortError("Reader media page left the retained frame."))
        pending.push(record.promise.catch(() => undefined))
      } else if (record.references === 0) {
        pending.push(this.#releaseRecord(record))
      }
    }
    await Promise.all(pending)
  }

  snapshot(): { entries: number; reservedBytes: number; activeReferences: number; pending: number } {
    let activeReferences = 0
    let pending = 0
    for (const record of this.#records.values()) {
      activeReferences += record.references
      if (!record.settled) pending += 1
    }
    return { entries: this.#records.size, reservedBytes: this.#reservedBytes, activeReferences, pending }
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    await Promise.all([...new Set([...this.#records.values()].map((record) => record.sessionId))]
      .map((sessionId) => this.releaseSession(sessionId)))
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }

  #createRecord(
    key: string,
    sessionId: ReaderSessionId,
    page: ReaderPage,
    reservedBytes: number,
  ): MaterializationRecord {
    const controller = new AbortController()
    const record = {} as MaterializationRecord
    Object.assign(record, {
      key,
      sessionId,
      page,
      controller,
      waiters: 0,
      references: 0,
      settled: false,
      releaseRequested: false,
    })
    const promise = this.#materializer.materialize(page, {
      signal: controller.signal,
      maxBytes: this.#maxEntryBytes,
    }).then(async (materialization) => {
      record.materialization = materialization
      record.settled = true
      if (record.releaseRequested) {
        await this.#releaseRecord(record, reservedBytes)
        throw abortError("Seekable media materialization was released before use.")
      }
      return materialization
    }, (error) => {
      record.settled = true
      this.#deleteRecord(record, reservedBytes)
      throw error
    })
    Object.assign(record, { promise })
    return record
  }

  async #releaseRecord(record: MaterializationRecord, reservedBytes = record.page.byteLength ?? 0): Promise<void> {
    if (this.#records.get(record.key) !== record) return
    this.#deleteRecord(record, reservedBytes)
    await record.materialization?.release()
  }

  #deleteRecord(record: MaterializationRecord, reservedBytes: number): void {
    if (this.#records.get(record.key) !== record) return
    this.#records.delete(record.key)
    this.#reservedBytes -= reservedBytes
  }
}

function waitForMaterialization<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort))
  })
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`)
  return value
}

function abortError(message: string): DOMException {
  return new DOMException(message, "AbortError")
}
