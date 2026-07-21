import {
  DEFAULT_READER_PAGE_TRANSITION,
  normalizeReaderPageTransition,
  type ReaderPageTransitionSettings,
} from "@xiranite/node-neoview/ui-core"

export const LEGACY_READER_PAGE_TRANSITION_KEY = "neoview-page-transition-settings"

export async function migrateLegacyReaderPageTransition(options: {
  storage: Pick<Storage, "getItem" | "removeItem">
  canonical: ReaderPageTransitionSettings
  persist(settings: ReaderPageTransitionSettings): Promise<void>
}): Promise<"absent" | "canonical-won" | "imported" | "invalid"> {
  const raw = options.storage.getItem(LEGACY_READER_PAGE_TRANSITION_KEY)
  if (raw === null) return "absent"
  if (!sameSettings(options.canonical, DEFAULT_READER_PAGE_TRANSITION)) {
    options.storage.removeItem(LEGACY_READER_PAGE_TRANSITION_KEY)
    return "canonical-won"
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return "invalid"
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "invalid"
  await options.persist(normalizeReaderPageTransition(parsed))
  options.storage.removeItem(LEGACY_READER_PAGE_TRANSITION_KEY)
  return "imported"
}

function sameSettings(left: ReaderPageTransitionSettings, right: ReaderPageTransitionSettings): boolean {
  return left.enabled === right.enabled
    && left.type === right.type
    && left.duration === right.duration
    && left.easing === right.easing
}
