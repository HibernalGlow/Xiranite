const READER_CONFIG_SECTIONS = [
  "imageProcessing",
  "preload",
  "emm",
  "aiTranslation",
  "imageTrim",
  "media",
  "slideshow",
  "historyList",
  "bookmarkList",
  "pageList",
  "book",
  "viewDefaults",
  "folderView",
  "colorFilter",
  "pageTransition",
  "switchToast",
  "infoOverlay",
  "systemMonitor",
  "superResolution",
  "inputBindings",
  "radialMenu",
  "voiceControl",
  "shellControl",
  "board",
  "cardId",
] as const

export type ReaderConfigSection = (typeof READER_CONFIG_SECTIONS)[number]

const READER_CONFIG_SECTION_SET = new Set<string>(READER_CONFIG_SECTIONS)

/**
 * Normalizes the explicit section protocol while retaining the legacy shape.
 * The controller can therefore keep its existing section-specific update hooks.
 */
export function normalizeReaderConfigPatch(body: Record<string, unknown>): Record<string, unknown> {
  if (!Object.hasOwn(body, "section")) return body

  const keys = Object.keys(body)
  if (keys.some((key) => key !== "section" && key !== "patch")) {
    throw new Error("Reader config section patch only accepts section and patch fields.")
  }
  if (typeof body.section !== "string" || !READER_CONFIG_SECTION_SET.has(body.section)) {
    throw new Error(`Unsupported reader config section: ${String(body.section)}.`)
  }
  if (!body.patch || typeof body.patch !== "object" || Array.isArray(body.patch)) {
    throw new Error("Reader config section patch must contain an object patch.")
  }
  return { [body.section]: body.patch }
}
