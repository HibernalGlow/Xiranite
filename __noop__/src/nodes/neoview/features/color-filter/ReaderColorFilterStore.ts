import {
  DEFAULT_READER_COLOR_FILTER,
  normalizeReaderColorFilter,
  type ReaderColorFilterPatch,
  type ReaderColorFilterSettings,
} from "@xiranite/node-neoview/color-filter"

export interface ReaderColorFilterPort {
  subscribe(listener: () => void): () => void
  getSnapshot(): ReaderColorFilterSettings
  hydrate(settings: ReaderColorFilterSettings): void
  preview(patch: ReaderColorFilterPatch): void
  commit(reset?: boolean): Promise<void>
  update(patch: ReaderColorFilterPatch): Promise<void>
  reset(): Promise<void>
  dispose(): void
}

export interface ReaderColorFilterStoreOptions {
  persist(settings: ReaderColorFilterSettings, reset: boolean, signal: AbortSignal): Promise<ReaderColorFilterSettings>
  onError?(cause: unknown): void
}

export function createReaderColorFilterStore(options: ReaderColorFilterStoreOptions): ReaderColorFilterPort {
  let snapshot = { ...DEFAULT_READER_COLOR_FILTER }
  let confirmed = snapshot
  let touched = false
  let disposed = false
  let revision = 0
  let requestedRevision = 0
  let resetRequested = false
  let write: Promise<void> | undefined
  const listeners = new Set<() => void>()
  const controller = new AbortController()

  const publish = (next: ReaderColorFilterSettings) => {
    snapshot = next
    for (const listener of listeners) listener()
  }

  const preview = (patch: ReaderColorFilterPatch) => {
    if (disposed) return
    touched = true
    revision += 1
    publish(normalizeReaderColorFilter({ ...snapshot, ...patch }))
  }

  const commit = (reset = false): Promise<void> => {
    if (disposed) return Promise.resolve()
    requestedRevision = revision
    resetRequested ||= reset
    write ??= drain().finally(() => { write = undefined })
    return write
  }

  async function drain(): Promise<void> {
    while (!disposed) {
      const targetRevision = requestedRevision
      const target = snapshot
      const reset = resetRequested
      resetRequested = false
      if (!reset && sameSettings(target, confirmed)) return
      try {
        const updated = normalizeReaderColorFilter(await options.persist(target, reset, controller.signal))
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
      confirmed = normalizeReaderColorFilter(settings)
      publish(confirmed)
    },
    preview,
    commit,
    async update(patch) {
      preview(patch)
      await commit()
    },
    async reset() {
      touched = true
      revision += 1
      publish({ ...DEFAULT_READER_COLOR_FILTER })
      await commit(true)
    },
    dispose() {
      disposed = true
      controller.abort()
      listeners.clear()
    },
  }
}

function sameSettings(left: ReaderColorFilterSettings, right: ReaderColorFilterSettings): boolean {
  return left.colorizeEnabled === right.colorizeEnabled
    && left.colorizePreset === right.colorizePreset
    && left.onlyBlackAndWhite === right.onlyBlackAndWhite
    && left.brightness === right.brightness
    && left.contrast === right.contrast
    && left.saturation === right.saturation
    && left.sepia === right.sepia
    && left.hueRotate === right.hueRotate
    && left.invert === right.invert
    && left.negative === right.negative
    && JSON.stringify(left.customColors) === JSON.stringify(right.customColors)
}
