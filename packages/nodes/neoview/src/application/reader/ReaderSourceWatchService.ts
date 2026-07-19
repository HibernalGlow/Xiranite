import type { ViewSource } from "../../domain/book/book.js"
import type { ReaderFileTreeChangeKind } from "../../ports/ReaderFileTreeWatcher.js"
import type { ReaderSourceChange, ReaderSourceSubscription, ReaderSourceWatcher } from "../../ports/ReaderSourceWatcher.js"

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
  closing?: Promise<void>
  attemptId: number
  failed: boolean
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
    await state.closing?.catch(() => undefined)
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
        attemptId: 0,
        failed: false,
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
    if (state.subscription || state.opening || state.released) return
    await state.closing?.catch(() => undefined)
    state.closing = undefined
    if (state.released || this.#states.get(sessionId) !== state) return
    if (state.subscription || state.opening) return
    const attemptId = ++state.attemptId
    state.failed = false
    const onChanges = (changes: readonly ReaderSourceChange[]) => {
      this.#publish(sessionId, state, attemptId, {
        state: "changed",
        kinds: [...new Set(changes.map(({ kind }) => kind))],
        count: changes.length,
      })
    }
    const onError = () => this.#handleError(sessionId, state, attemptId)
    if (!state.opening) {
      state.opening = this.watcher.subscribe(
        source,
        onChanges,
        onError,
      ).then((subscription) => {
        if (this.#states.get(sessionId) === state && !state.failed) state.subscription = subscription
        else return subscription.close()
      }).finally(() => {
        state.opening = undefined
      })
    }
    await Promise.race([state.opening, state.releasedPromise])
  }

  #publish(
    sessionId: string,
    state: WatchState,
    attemptId: number,
    change: Omit<ReaderSourceChangeSnapshot, "revision">,
  ): void {
    if (this.#states.get(sessionId) !== state || state.released || state.attemptId !== attemptId || state.failed) return
    state.revision += 1
    state.snapshot = { revision: state.revision, ...change }
    for (const notify of state.waiters) notify()
    state.waiters.clear()
  }

  #handleError(sessionId: string, state: WatchState, attemptId: number): void {
    if (this.#states.get(sessionId) !== state || state.released || state.attemptId !== attemptId || state.failed) return
    const subscription = state.subscription
    state.subscription = undefined
    this.#publish(sessionId, state, attemptId, { state: "unavailable", kinds: [], count: 0 })
    state.failed = true
    if (subscription) state.closing = closeQuietly(subscription)
  }
}

function closeQuietly(subscription: ReaderSourceSubscription): Promise<void> {
  try {
    return Promise.resolve(subscription.close()).catch(() => undefined)
  } catch {
    return Promise.resolve()
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
