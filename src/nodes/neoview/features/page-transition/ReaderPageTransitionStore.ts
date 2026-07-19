/**
 * @migrated-from src/lib/stores/pageTransitionStore.svelte.ts
 * @source-hash sha256:9287221d7515ad90003010d58c04798127897c22a35226cdb8eb5fecc5b9cdd0
 * @features page-transition
 * @migration-status adapted
 */
import {
  DEFAULT_READER_PAGE_TRANSITION,
  normalizeReaderPageTransition,
  type ReaderPageTransitionPatch,
  type ReaderPageTransitionSettings,
} from "@xiranite/node-neoview/page-transition"
import { persistReaderSettingsWithTimeout } from "../reader/reader-settings-save-timeout"

export interface ReaderPageTransitionPort {
  subscribe(listener: () => void): () => void
  getSnapshot(): ReaderPageTransitionSettings
  hydrate(settings: ReaderPageTransitionSettings): void
  preview(patch: ReaderPageTransitionPatch): void
  commit(reset?: boolean): Promise<void>
  update(patch: ReaderPageTransitionPatch): Promise<void>
  reset(): Promise<void>
  dispose(): void
}

export interface ReaderPageTransitionStoreOptions {
  persist(
    settings: ReaderPageTransitionSettings,
    reset: boolean,
    signal: AbortSignal,
  ): Promise<ReaderPageTransitionSettings>
  onError?(cause: unknown): void
  saveTimeoutMs?: number
}

export function createReaderPageTransitionStore(
  options: ReaderPageTransitionStoreOptions,
): ReaderPageTransitionPort {
  let snapshot = { ...DEFAULT_READER_PAGE_TRANSITION }
  let confirmed = snapshot
  let touched = false
  let disposed = false
  let revision = 0
  let requestedRevision = 0
  let resetRequested = false
  let write: Promise<void> | undefined
  const listeners = new Set<() => void>()
  const controller = new AbortController()

  const publish = (next: ReaderPageTransitionSettings) => {
    snapshot = next
    for (const listener of listeners) listener()
  }

  const preview = (patch: ReaderPageTransitionPatch) => {
    if (disposed) return
    touched = true
    revision += 1
    publish(normalizeReaderPageTransition({ ...snapshot, ...patch }))
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
        const updated = normalizeReaderPageTransition(await persistReaderSettingsWithTimeout({
          persist: (signal) => options.persist(target, reset, signal),
          signal: controller.signal,
          timeoutMs: options.saveTimeoutMs,
        }))
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
      confirmed = normalizeReaderPageTransition(settings)
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
      publish({ ...DEFAULT_READER_PAGE_TRANSITION })
      await commit(true)
    },
    dispose() {
      disposed = true
      controller.abort()
      listeners.clear()
    },
  }
}

function sameSettings(left: ReaderPageTransitionSettings, right: ReaderPageTransitionSettings): boolean {
  return left.enabled === right.enabled
    && left.type === right.type
    && left.duration === right.duration
    && left.easing === right.easing
}
