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
  released: boolean
  releasedPromise: Promise<void>
  resolveReleased: () => void
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
    if (state.released || this.#states.get(sessionId) !== state) return undefined
    if (state.snapshot && state.revision > afterRevision) return state.snapshot
    await waitForNotification(state, this.timeoutMs, signal)
    if (state.released || this.#states.get(sessionId) !== state) return undefined
    return state.snapshot && state.revision > afterRevision ? state.snapshot : undefined
  }

  async release(sessionId: string): Promise<void> {
    const state = this.#states.get(sessionId)
    if (!state) return
    this.#states.delete(sessionId)
    state.released = true
    state.resolveReleased()
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
      let resolveReleased!: () => void
      const releasedPromise = new Promise<void>((resolve) => {
        resolveReleased = resolve
      })
      state = {
        revision: 0,
        waiters: new Set(),
        released: false,
        releasedPromise,
        resolveReleased,
      }
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
    await Promise.race([state.opening, state.releasedPromise])
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

function waitForNotification(state: WatchState, timeoutMs: number, signal?: AbortSignal): Promise<void> {
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
      if (timer !== undefined) clearTimeout(timer)
      state.waiters.delete(finish)
      signal?.removeEventListener("abort", abort)
    }
    if (state.released) {
      finish()
      return
    }
    state.waiters.add(finish)
    timer = setTimeout(finish, timeoutMs)
    signal?.addEventListener("abort", abort, { once: true })
    if (signal?.aborted) abort()
  })
}
