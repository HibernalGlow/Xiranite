import { persistReaderSettingsWithTimeout } from "../reader/reader-settings-save-timeout"

export interface ReaderOptimisticSettingsPort<Settings, Patch> {
  subscribe(listener: () => void): () => void
  getSnapshot(): Settings
  hydrate(settings: Settings): void
  preview(patch: Patch): void
  commit(reset?: boolean): Promise<void>
  update(patch: Patch): Promise<void>
  reset(): Promise<void>
  dispose(): void
}

export interface ReaderOptimisticSettingsStoreOptions<Settings, Patch> {
  initial: Settings
  apply(settings: Settings, patch: Patch): Settings
  normalize(value: unknown): Settings
  equals(left: Settings, right: Settings): boolean
  persist(settings: Settings, reset: boolean, signal: AbortSignal): Promise<Settings>
  onError?(cause: unknown): void
  saveTimeoutMs?: number
}

interface WriteCycle {
  promise: Promise<void>
  resolve(): void
  reject(cause: unknown): void
}

export function createReaderOptimisticSettingsStore<Settings, Patch>(
  options: ReaderOptimisticSettingsStoreOptions<Settings, Patch>,
): ReaderOptimisticSettingsPort<Settings, Patch> {
  let snapshot = options.normalize(options.initial)
  let confirmed = snapshot
  let touched = false
  let disposed = false
  let revision = 0
  let requestedCommitId = 0
  let processedCommitId = 0
  let resetRequested = false
  let write: WriteCycle | undefined
  const listeners = new Set<() => void>()
  const controller = new AbortController()

  const publish = (next: Settings) => {
    snapshot = next
    for (const listener of listeners) listener()
  }

  const preview = (patch: Patch) => {
    if (disposed) return
    touched = true
    revision += 1
    publish(options.normalize(options.apply(snapshot, patch)))
  }

  const ensureDrain = () => {
    if (disposed || write || processedCommitId >= requestedCommitId) return
    let resolve!: () => void
    let reject!: (cause: unknown) => void
    const promise = new Promise<void>((onResolve, onReject) => {
      resolve = onResolve
      reject = onReject
    })
    const cycle: WriteCycle = { promise, resolve, reject }
    write = cycle
    void drain().then(() => finalize(), (cause) => finalize(cause))

    function finalize(cause?: unknown) {
      if (write !== cycle) return
      write = undefined
      if (cause === undefined) cycle.resolve()
      else cycle.reject(cause)
      ensureDrain()
    }
  }

  const commit = (reset = false): Promise<void> => {
    if (disposed) return Promise.resolve()
    requestedCommitId += 1
    resetRequested ||= reset
    ensureDrain()
    return write?.promise ?? Promise.resolve()
  }

  async function drain(): Promise<void> {
    while (!disposed && processedCommitId < requestedCommitId) {
      const targetCommitId = requestedCommitId
      const targetRevision = revision
      const target = snapshot
      const reset = resetRequested
      resetRequested = false

      if (!reset && options.equals(target, confirmed)) {
        processedCommitId = targetCommitId
        continue
      }

      try {
        const updated = options.normalize(await persistReaderSettingsWithTimeout({
          persist: (signal) => options.persist(target, reset, signal),
          signal: controller.signal,
          timeoutMs: options.saveTimeoutMs,
        }))
        if (disposed) return
        confirmed = updated
        if (revision === targetRevision) publish(updated)
        processedCommitId = targetCommitId
      } catch (cause) {
        if (disposed || controller.signal.aborted) return
        if (revision === targetRevision) publish(confirmed)
        processedCommitId = targetCommitId
        options.onError?.(cause)
        throw cause
      }
    }
  }

  return {
    subscribe(listener) {
      if (disposed) return () => undefined
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    hydrate(settings) {
      if (disposed || touched) return
      confirmed = options.normalize(settings)
      publish(confirmed)
    },
    preview,
    commit,
    async update(patch) {
      preview(patch)
      await commit()
    },
    async reset() {
      if (disposed) return
      touched = true
      revision += 1
      publish(options.normalize(options.initial))
      await commit(true)
    },
    dispose() {
      if (disposed) return
      disposed = true
      controller.abort()
      const cycle = write
      write = undefined
      cycle?.resolve()
      listeners.clear()
    },
  }
}
