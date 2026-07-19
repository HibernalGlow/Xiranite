import { randomUUID } from "node:crypto"

import type { ReaderPageMaterializer, ReaderPageMaterializationLease } from "../../ports/ReaderPageMaterializer.js"
import type { ReaderService, ReaderSessionId } from "./contracts.js"

const DEFAULT_TTL_MS = 60 * 60 * 1_000
const DEFAULT_MAX_LEASES = 16
const DEFAULT_MAX_ENTRY_BYTES = 512 * 1024 * 1024
const DEFAULT_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024

export interface ReaderClipboardMaterialization {
  token: string
  path: string
  byteLength: number
  expiresAt: number
}

export interface ReaderClipboardMaterializationServiceOptions {
  ttlMs?: number
  maxLeases?: number
  maxEntryBytes?: number
  maxTotalBytes?: number
  now?: () => number
}

interface ActiveLease {
  sessionId: ReaderSessionId
  lease: ReaderPageMaterializationLease
  expiresAt: number
  timeout: ReturnType<typeof setTimeout>
  releaseFlight?: Promise<void>
}

interface PendingMaterialization {
  controller: AbortController
  done: Promise<void>
  finish(): void
}

export class ReaderClipboardMaterializationService implements AsyncDisposable {
  readonly #leases = new Map<string, ActiveLease>()
  readonly #sessionUnsubscribers = new Map<ReaderSessionId, () => void>()
  readonly #pendingBySession = new Map<ReaderSessionId, Set<PendingMaterialization>>()
  readonly #closingSessions = new Set<ReaderSessionId>()
  readonly #releaseFlights = new Map<ReaderSessionId, Promise<void>>()
  readonly #ttlMs: number
  readonly #maxLeases: number
  readonly #maxEntryBytes: number
  readonly #maxTotalBytes: number
  readonly #now: () => number
  #pending = 0
  #activeBytes = 0
  #closed = false

  constructor(
    private readonly reader: ReaderService,
    private readonly materializer: ReaderPageMaterializer,
    options: ReaderClipboardMaterializationServiceOptions = {},
  ) {
    this.#ttlMs = positiveInteger(options.ttlMs ?? DEFAULT_TTL_MS, "ttlMs")
    this.#maxLeases = positiveInteger(options.maxLeases ?? DEFAULT_MAX_LEASES, "maxLeases")
    this.#maxEntryBytes = positiveInteger(options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES, "maxEntryBytes")
    this.#maxTotalBytes = positiveInteger(options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES, "maxTotalBytes")
    this.#now = options.now ?? Date.now
  }

  async materialize(sessionId: ReaderSessionId, pageId: string, signal?: AbortSignal): Promise<ReaderClipboardMaterialization> {
    this.#assertOpen()
    signal?.throwIfAborted()
    if (this.#closingSessions.has(sessionId)) throw new Error("Reader session is closing.")
    const session = this.reader.getSession(sessionId)
    if (!session) throw new Error("Reader session not found.")
    const page = session.getPage(pageId)
    if (!page) throw new Error("Reader page not found.")
    if (!page.entryPath) throw new Error("Only archive entries require clipboard materialization.")
    if (this.#leases.size + this.#pending >= this.#maxLeases) {
      throw new Error(`Reader clipboard materialization limit reached (${this.#maxLeases}).`)
    }
    if (page.byteLength !== undefined && page.byteLength > this.#maxEntryBytes) {
      throw new Error(`Reader page exceeds the ${this.#maxEntryBytes} byte clipboard materialization budget.`)
    }

    const controller = new AbortController()
    const abort = () => controller.abort(signal?.reason)
    signal?.addEventListener("abort", abort, { once: true })
    let finishPending!: () => void
    const pending: PendingMaterialization = {
      controller,
      done: new Promise<void>((resolve) => { finishPending = resolve }),
      finish: () => finishPending(),
    }
    const sessionPending = this.#pendingBySession.get(sessionId) ?? new Set<PendingMaterialization>()
    sessionPending.add(pending)
    this.#pendingBySession.set(sessionId, sessionPending)
    this.#pending += 1
    let lease: ReaderPageMaterializationLease | undefined
    try {
      lease = await this.materializer.materialize(page, { signal: controller.signal, maxBytes: this.#maxEntryBytes })
      controller.signal.throwIfAborted()
      this.#assertOpen()
      if (this.#closingSessions.has(sessionId) || !this.reader.getSession(sessionId)) {
        throw new Error("Reader session is closing.")
      }
      if (this.#activeBytes + lease.byteLength > this.#maxTotalBytes) {
        throw new Error(`Reader clipboard materializations exceed the ${this.#maxTotalBytes} byte total budget.`)
      }
      const token = randomUUID()
      const expiresAt = this.#now() + this.#ttlMs
      const timeout = setTimeout(() => void this.release(token).catch(() => undefined), this.#ttlMs)
      timeout.unref?.()
      this.#leases.set(token, { sessionId, lease, expiresAt, timeout })
      this.#activeBytes += lease.byteLength
      this.#watchSession(sessionId)
      return { token, path: lease.path, byteLength: lease.byteLength, expiresAt }
    } catch (error) {
      await lease?.release().catch(() => undefined)
      throw error
    } finally {
      signal?.removeEventListener("abort", abort)
      this.#pending -= 1
      sessionPending.delete(pending)
      if (!sessionPending.size) this.#pendingBySession.delete(sessionId)
      pending.finish()
    }
  }

  async release(token: string, sessionId?: ReaderSessionId): Promise<boolean> {
    const active = this.#leases.get(token)
    if (!active || (sessionId !== undefined && active.sessionId !== sessionId)) return false
    const existing = active.releaseFlight
    if (existing) {
      await existing
      return true
    }
    clearTimeout(active.timeout)
    const operation = Promise.resolve().then(() => active.lease.release())
    active.releaseFlight = operation
    try {
      await operation
    } catch (error) {
      if (active.releaseFlight === operation) active.releaseFlight = undefined
      throw error
    }
    if (this.#leases.get(token) === active) {
      this.#leases.delete(token)
      this.#activeBytes -= active.lease.byteLength
    }
    if (active.releaseFlight === operation) active.releaseFlight = undefined
    this.#unwatchIdleSession(active.sessionId)
    return true
  }

  async releaseSession(sessionId: ReaderSessionId): Promise<void> {
    const existing = this.#releaseFlights.get(sessionId)
    if (existing) return existing
    const operation = this.#releaseSession(sessionId)
    this.#releaseFlights.set(sessionId, operation)
    try {
      await operation
    } finally {
      if (this.#releaseFlights.get(sessionId) === operation) this.#releaseFlights.delete(sessionId)
    }
  }

  async #releaseSession(sessionId: ReaderSessionId): Promise<void> {
    this.#closingSessions.add(sessionId)
    const pending = [...(this.#pendingBySession.get(sessionId) ?? [])]
    for (const operation of pending) operation.controller.abort(new Error("Reader session is closing."))
    await Promise.allSettled(pending.map((operation) => operation.done))
    const tokens = [...this.#leases].flatMap(([token, active]) => active.sessionId === sessionId ? [token] : [])
    const results = await Promise.allSettled(tokens.map((token) => this.release(token)))
    this.#sessionUnsubscribers.get(sessionId)?.()
    this.#sessionUnsubscribers.delete(sessionId)
    if (!this.reader.getSession(sessionId)) this.#closingSessions.delete(sessionId)
    const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : [])
    if (errors.length) throw new AggregateError(errors, "Failed to release reader clipboard materializations.")
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.#closed = true
    const pending = [...this.#pendingBySession.values()].flatMap((operations) => [...operations])
    for (const operation of pending) operation.controller.abort(new Error("Reader clipboard materialization service is closed."))
    await Promise.allSettled(pending.map((operation) => operation.done))
    await Promise.allSettled(this.#releaseFlights.values())
    const results = await Promise.allSettled([...this.#leases.keys()].map((token) => this.release(token)))
    for (const unsubscribe of this.#sessionUnsubscribers.values()) unsubscribe()
    this.#sessionUnsubscribers.clear()
    this.#closingSessions.clear()
    const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : [])
    if (errors.length) throw new AggregateError(errors, "Failed to close reader clipboard materializations.")
  }

  #watchSession(sessionId: ReaderSessionId): void {
    if (this.#sessionUnsubscribers.has(sessionId)) return
    const session = this.reader.getSession(sessionId)
    if (!session) return
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "closed") void this.releaseSession(sessionId).catch(() => undefined)
    })
    this.#sessionUnsubscribers.set(sessionId, unsubscribe)
  }

  #unwatchIdleSession(sessionId: ReaderSessionId): void {
    if ([...this.#leases.values()].some((active) => active.sessionId === sessionId)) return
    this.#sessionUnsubscribers.get(sessionId)?.()
    this.#sessionUnsubscribers.delete(sessionId)
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Reader clipboard materialization service is closed.")
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer`)
  return value
}
