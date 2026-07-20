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
import {
  createReaderOptimisticSettingsStore,
  type ReaderOptimisticSettingsPort,
} from "../settings/ReaderOptimisticSettingsStore"

export type ReaderPageTransitionPort = ReaderOptimisticSettingsPort<ReaderPageTransitionSettings, ReaderPageTransitionPatch>

export interface ReaderPageTransitionStoreOptions {
  persist(settings: ReaderPageTransitionSettings, reset: boolean, signal: AbortSignal): Promise<ReaderPageTransitionSettings>
  onError?(cause: unknown): void
  saveTimeoutMs?: number
}

export function createReaderPageTransitionStore(options: ReaderPageTransitionStoreOptions): ReaderPageTransitionPort {
  return createReaderOptimisticSettingsStore({
    initial: DEFAULT_READER_PAGE_TRANSITION,
    apply: (settings, patch) => ({ ...settings, ...patch }),
    normalize: normalizeReaderPageTransition,
    equals: sameSettings,
    ...options,
  })
}

function sameSettings(left: ReaderPageTransitionSettings, right: ReaderPageTransitionSettings): boolean {
  return left.enabled === right.enabled
    && left.type === right.type
    && left.duration === right.duration
    && left.easing === right.easing
}
