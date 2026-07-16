export type ReaderPreloadEntryStatus = "loading" | "ready" | "failed"

export interface ReaderPreloadStatusEntry {
  pageIndex: number
  status: ReaderPreloadEntryStatus
}

export interface ReaderPreloadStatusSnapshot {
  sessionId: string
  retainedLimit: number
  entries: readonly ReaderPreloadStatusEntry[]
  loadingCount: number
  readyCount: number
  failedCount: number
}

interface SessionState {
  entries: Map<number, ReaderPreloadEntryStatus>
  snapshot: ReaderPreloadStatusSnapshot
}

export class ReaderPreloadStatusStore {
  readonly #sessions = new Map<string, SessionState>()
  readonly #listeners = new Map<string, Set<() => void>>()

  constructor(readonly retainedLimit: number) {}

  subscribe(sessionId: string, listener: () => void): () => void {
    let listeners = this.#listeners.get(sessionId)
    if (!listeners) {
      listeners = new Set()
      this.#listeners.set(sessionId, listeners)
    }
    listeners.add(listener)
    return () => {
      listeners!.delete(listener)
      if (!listeners!.size) {
        this.#listeners.delete(sessionId)
        if (!this.#sessions.get(sessionId)?.entries.size) this.#sessions.delete(sessionId)
      }
    }
  }

  snapshot(sessionId: string): ReaderPreloadStatusSnapshot {
    return this.#state(sessionId).snapshot
  }

  begin(sessionId: string, pageIndex: number): void {
    this.#update(sessionId, pageIndex, "loading")
  }

  ready(sessionId: string, pageIndex: number): void {
    this.#update(sessionId, pageIndex, "ready")
  }

  fail(sessionId: string, pageIndex: number): void {
    this.#update(sessionId, pageIndex, "failed")
  }

  evict(sessionId: string, pageIndex: number): void {
    const state = this.#sessions.get(sessionId)
    if (!state?.entries.delete(pageIndex)) return
    this.#publish(sessionId, state)
  }

  clear(sessionId: string): void {
    const state = this.#sessions.get(sessionId)
    if (!state || !state.entries.size) return
    state.entries.clear()
    this.#publish(sessionId, state)
    if (!this.#listeners.has(sessionId)) this.#sessions.delete(sessionId)
  }

  listenerCount(sessionId: string): number {
    return this.#listeners.get(sessionId)?.size ?? 0
  }

  #update(sessionId: string, pageIndex: number, status: ReaderPreloadEntryStatus): void {
    const state = this.#state(sessionId)
    if (state.entries.get(pageIndex) === status) return
    state.entries.set(pageIndex, status)
    this.#publish(sessionId, state)
  }

  #state(sessionId: string): SessionState {
    let state = this.#sessions.get(sessionId)
    if (!state) {
      state = { entries: new Map(), snapshot: createSnapshot(sessionId, this.retainedLimit, new Map()) }
      this.#sessions.set(sessionId, state)
    }
    return state
  }

  #publish(sessionId: string, state: SessionState): void {
    state.snapshot = createSnapshot(sessionId, this.retainedLimit, state.entries)
    for (const listener of this.#listeners.get(sessionId) ?? []) listener()
  }
}

function createSnapshot(
  sessionId: string,
  retainedLimit: number,
  values: ReadonlyMap<number, ReaderPreloadEntryStatus>,
): ReaderPreloadStatusSnapshot {
  const entries = [...values]
    .map(([pageIndex, status]) => ({ pageIndex, status }))
    .toSorted((left, right) => left.pageIndex - right.pageIndex)
  let loadingCount = 0
  let readyCount = 0
  let failedCount = 0
  for (const entry of entries) {
    if (entry.status === "loading") loadingCount += 1
    else if (entry.status === "ready") readyCount += 1
    else failedCount += 1
  }
  return { sessionId, retainedLimit, entries, loadingCount, readyCount, failedCount }
}

export const readerPreloadStatusStore = new ReaderPreloadStatusStore(4)
