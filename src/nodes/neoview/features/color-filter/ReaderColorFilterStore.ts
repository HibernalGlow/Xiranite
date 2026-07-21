/**
 * @migrated-from src/lib/stores/colorFilterStore.svelte.ts
 * @features color-filter
 * @migration-status adapted
 */
import {
  DEFAULT_READER_COLOR_FILTER,
  normalizeReaderColorFilter,
  type ReaderColorFilterPatch,
  type ReaderColorFilterSettings,
} from "@xiranite/node-neoview/ui-core"
import {
  createReaderOptimisticSettingsStore,
  type ReaderOptimisticSettingsPort,
} from "../settings/ReaderOptimisticSettingsStore"

export type ReaderColorFilterPort = ReaderOptimisticSettingsPort<ReaderColorFilterSettings, ReaderColorFilterPatch>

export interface ReaderColorFilterStoreOptions {
  persist(settings: ReaderColorFilterSettings, reset: boolean, signal: AbortSignal): Promise<ReaderColorFilterSettings>
  onError?(cause: unknown): void
  saveTimeoutMs?: number
}

export function createReaderColorFilterStore(options: ReaderColorFilterStoreOptions): ReaderColorFilterPort {
  return createReaderOptimisticSettingsStore({
    initial: DEFAULT_READER_COLOR_FILTER,
    apply: (settings, patch) => ({ ...settings, ...patch }),
    normalize: normalizeReaderColorFilter,
    equals: sameSettings,
    ...options,
  })
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
