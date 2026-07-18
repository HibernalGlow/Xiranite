import {
  DEFAULT_READER_INFO_OVERLAY,
  normalizeReaderInfoOverlay,
  type ReaderInfoOverlayPatch,
  type ReaderInfoOverlaySettings,
} from "@xiranite/node-neoview/info-overlay"

export interface ReaderInfoOverlayPort {
  subscribe(listener: () => void): () => void
  getSnapshot(): ReaderInfoOverlaySettings | undefined
  hydrate(settings: ReaderInfoOverlaySettings): void
  preview(patch: ReaderInfoOverlayPatch): void
  commit(): Promise<void>
  update(patch: ReaderInfoOverlayPatch): Promise<void>
  reset(): Promise<void>
  dispose(): void
}

export interface ReaderInfoOverlayStoreOptions {
  persist(settings: ReaderInfoOverlaySettings, reset: boolean, signal: AbortSignal): Promise<ReaderInfoOverlaySettings>
  onError?(cause: unknown): void
}

export function createReaderInfoOverlayStore(options: ReaderInfoOverlayStoreOptions): ReaderInfoOverlayPort {
  let snapshot: ReaderInfoOverlaySettings | undefined
  let confirmed = DEFAULT_READER_INFO_OVERLAY
  let revision = 0
  let requestedRevision = 0
  let resetRequested = false
  let write: Promise<void> | undefined
  let disposed = false
  let touched = false
  const listeners = new Set<() => void>()
  const controller = new AbortController()

  const publish = (next: ReaderInfoOverlaySettings) => {
    snapshot = next
    for (const listener of listeners) listener()
  }

  const preview = (patch: ReaderInfoOverlayPatch) => {
    if (disposed) return
    touched = true
    revision += 1
    publish(normalizeReaderInfoOverlay({ ...snapshot ?? DEFAULT_READER_INFO_OVERLAY, ...patch }))
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
      const target = snapshot ?? DEFAULT_READER_INFO_OVERLAY
      const reset = resetRequested
      resetRequested = false
      if (!reset && sameSettings(target, confirmed)) return
      try {
        const updated = normalizeReaderInfoOverlay(await options.persist(target, reset, controller.signal))
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
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    hydrate(settings) {
      if (disposed || touched) return
      confirmed = normalizeReaderInfoOverlay(settings)
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
      publish({ ...DEFAULT_READER_INFO_OVERLAY })
      await commit(true)
    },
    dispose() {
      disposed = true
      controller.abort()
      listeners.clear()
    },
  }
}

function sameSettings(left: ReaderInfoOverlaySettings, right: ReaderInfoOverlaySettings): boolean {
  return left.enabled === right.enabled
    && left.opacity === right.opacity
    && left.showBorder === right.showBorder
    && left.width === right.width
    && left.height === right.height
}
