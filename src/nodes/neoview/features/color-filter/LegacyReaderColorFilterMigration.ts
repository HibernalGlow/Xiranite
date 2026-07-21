import {
  DEFAULT_READER_COLOR_FILTER,
  normalizeReaderColorFilter,
  type ReaderColorFilterSettings,
} from "@xiranite/node-neoview/ui-core"

export const LEGACY_READER_COLOR_FILTER_KEY = "neoview-filter-settings"

export async function migrateLegacyReaderColorFilter(options: {
  storage: Pick<Storage, "getItem" | "removeItem">
  canonical: ReaderColorFilterSettings
  persist(settings: ReaderColorFilterSettings): Promise<void>
}): Promise<"absent" | "canonical-won" | "imported" | "invalid"> {
  const raw = options.storage.getItem(LEGACY_READER_COLOR_FILTER_KEY)
  if (raw === null) return "absent"
  if (!sameSettings(options.canonical, DEFAULT_READER_COLOR_FILTER)) {
    options.storage.removeItem(LEGACY_READER_COLOR_FILTER_KEY)
    return "canonical-won"
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return "invalid"
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "invalid"
  await options.persist(normalizeReaderColorFilter(parsed))
  options.storage.removeItem(LEGACY_READER_COLOR_FILTER_KEY)
  return "imported"
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
