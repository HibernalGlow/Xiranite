import type { ViewSource } from "../../domain/book/book.js"
import type { ReaderFileTreeChangeKind } from "../../ports/ReaderFileTreeWatcher.js"
import type { ReaderSourceSubscription, ReaderSourceWatcher } from "../../ports/ReaderSourceWatcher.js"

export interface ReaderSourceChangeSnapshot {
  revision: number
  state: "changed" | "unavailable"
  kinds: readonly ReaderFileTreeChangeKind[]
  count: number
}

interface WatchState {
  revision: number
  snapshot?: ReaderSourceChangeSnapshot
  subscription?: ReaderSourceSubscription
  opening?: Promise<void>
  waiters: Set<() => void>
}

export class ReaderSourceWatchService implements AsyncDisposable {
  readonly #states = new Map<string, WatchState>()

  constructor(
    private readonly watcher: ReaderSourceWatcher,
    private readonly timeoutMs = 25_000,
  ) {}

  async waitForChange(
    sessionId: string,
    source: ViewSource,
    afterRevision: number,
    signal?: AbortSignal,
  ): Promise<ReaderSourceChangeSnapshot | undefined> {
    signal?.throwIfAborted()
    const state = this.#state(sessionId)
    await this.#ensureOpen(sessionId, source, state)
    signal?.throwIfAborted()
    if (state.snapshot && state.revision > afterRevision) return state.snapshot
    await waitForNotification(state.waiters, this.timeoutMs, signal)
    return state.snapshot && state.revision > afterRevision ? state.snapshot : undefined
  }

  async release(sessionId: string): Promise<void> {
    const state = this.#states.get(sessionId)
    if (!state) return
    this.#states.delete(sessionId)
    for (const notify of state.waiters) notify()
    state.waiters.clear()
    await state.opening?.catch(() => undefined)
    await state.subscription?.close()
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await Promise.all([...this.#states.keys()].map((sessionId) => this.release(sessionId)))
  }

  #state(sessionId: string): WatchState {
    let state = this.#states.get(sessionId)
    if (!state) {
      state = { revision: 0, waiters: new Set() }
      this.#states.set(sessionId, state)
    }
    return state
  }

  async #ensureOpen(sessionId: string, source: ViewSource, state: WatchState): Promise<void> {
    if (state.subscription) return
    if (!state.opening) {
      state.opening = this.watcher.subscribe(
        source,
        (changes) => this.#publish(sessionId, {
          state: "changed",
          kinds: [...new Set(changes.map(({ kind }) => kind))],
          count: changes.length,
        }),
        () => this.#publish(sessionId, { state: "unavailable", kinds: [], count: 0 }),
      ).then((subscription) => {
        if (this.#states.get(sessionId) === state) state.subscription = subscription
        else return subscription.close()
      }).finally(() => {
        state.opening = undefined
      })
    }
    await state.opening
  }

  #publish(
    sessionId: string,
    change: Omit<ReaderSourceChangeSnapshot, "revision">,
  ): void {
    const state = this.#states.get(sessionId)
    if (!state) return
    state.revision += 1
    state.snapshot = { revision: state.revision, ...change }
    for (const notify of state.waiters) notify()
    state.waiters.clear()
  }
}

function waitForNotification(waiters: Set<() => void>, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      cleanup()
      resolve()
    }
    const abort = () => {
      cleanup()
      reject(signal?.reason ?? new DOMException("The operation was aborted", "AbortError"))
    }
    const cleanup = () => {
      if (timer) clearTimeout(timer)
      waiters.delete(finish)
      signal?.removeEventListener("abort", abort)
    }
    waiters.add(finish)
    timer = setTimeout(finish, timeoutMs)
    signal?.addEventListener("abort", abort, { once: true })
    if (signal?.aborted) abort()
  })
}
