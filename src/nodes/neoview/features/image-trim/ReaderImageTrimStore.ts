import {
  DEFAULT_READER_IMAGE_TRIM,
  normalizeReaderImageTrim,
  type ReaderImageTrimPatch,
  type ReaderImageTrimSettings,
} from "@xiranite/node-neoview/image-trim"

export interface ReaderImageTrimPort {
  subscribe(listener: () => void): () => void
  getSnapshot(): ReaderImageTrimSettings | undefined
  hydrate(settings: ReaderImageTrimSettings): void
  preview(patch: ReaderImageTrimPatch): void
  commit(): Promise<void>
  update(patch: ReaderImageTrimPatch): Promise<void>
  reset(): Promise<void>
  dispose(): void
}

export interface ReaderImageTrimStoreOptions {
  persist(settings: ReaderImageTrimSettings, reset: boolean, signal: AbortSignal): Promise<ReaderImageTrimSettings>
  onError?(cause: unknown): void
}

export function createReaderImageTrimStore(options: ReaderImageTrimStoreOptions): ReaderImageTrimPort {
  let snapshot: ReaderImageTrimSettings | undefined
  let confirmed = DEFAULT_READER_IMAGE_TRIM
  let revision = 0
  let requestedRevision = 0
  let resetRequested = false
  let write: Promise<void> | undefined
  let disposed = false
  let touched = false
  const listeners = new Set<() => void>()
  const controller = new AbortController()

  const publish = (next: ReaderImageTrimSettings) => {
    if (disposed) return
    snapshot = next
    for (const listener of listeners) listener()
  }
  const preview = (patch: ReaderImageTrimPatch) => {
    if (disposed) return
    touched = true
    revision += 1
    publish(normalizeReaderImageTrim({ ...snapshot ?? DEFAULT_READER_IMAGE_TRIM, ...patch }))
  }
  const commit = (reset = false): Promise<void> => {
    if (disposed || !snapshot) return Promise.resolve()
    requestedRevision = revision
    resetRequested ||= reset
    write ??= drain().finally(() => { write = undefined })
    return write
  }
  async function drain(): Promise<void> {
    while (!disposed) {
      const targetRevision = requestedRevision
      const target = snapshot ?? DEFAULT_READER_IMAGE_TRIM
      const reset = resetRequested
      resetRequested = false
      if (!reset && sameSettings(target, confirmed)) return
      try {
        const updated = normalizeReaderImageTrim(await options.persist(target, reset, controller.signal))
        if (disposed) return
        confirmed = updated
        if (revision === targetRevision) publish(updated)
      } catch (cause) {
        if (controller.signal.aborted) return
        if (revision === targetRevision) publish(confirmed)
        options.onError?.(cause)
        throw cause
      }
      if (requestedRevision === targetRevision) return
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
      confirmed = normalizeReaderImageTrim(settings)
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
      publish({ ...DEFAULT_READER_IMAGE_TRIM })
      await commit(true)
    },
    dispose() {
      if (disposed) return
      disposed = true
      controller.abort()
      snapshot = undefined
      listeners.clear()
    },
  }
}

function sameSettings(left: ReaderImageTrimSettings, right: ReaderImageTrimSettings): boolean {
  return left.enabled === right.enabled
    && left.top === right.top
    && left.bottom === right.bottom
    && left.left === right.left
    && left.right === right.right
    && left.linkVertical === right.linkVertical
    && left.linkHorizontal === right.linkHorizontal
    && left.autoTrimThreshold === right.autoTrimThreshold
    && left.autoTrimTarget === right.autoTrimTarget
}
