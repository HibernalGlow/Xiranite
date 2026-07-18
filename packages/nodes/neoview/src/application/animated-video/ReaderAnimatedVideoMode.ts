/** Browser-safe contract shared by the animated-media Card and runtime. */

export const DEFAULT_READER_ANIMATED_VIDEO_KEYWORDS = ["[#dyna]"] as const

export interface ReaderAnimatedVideoModeSettings {
  enabled: boolean
  keywords: readonly string[]
}

export interface ReaderAnimatedVideoModePatch {
  enabled?: boolean
  keywords?: readonly string[]
}

export const DEFAULT_READER_ANIMATED_VIDEO_MODE: ReaderAnimatedVideoModeSettings = {
  enabled: false,
  keywords: DEFAULT_READER_ANIMATED_VIDEO_KEYWORDS,
}

export function normalizeReaderAnimatedVideoKeywords(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return DEFAULT_READER_ANIMATED_VIDEO_KEYWORDS
  const normalized = [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean))]
  return normalized.length ? normalized : DEFAULT_READER_ANIMATED_VIDEO_KEYWORDS
}

export function normalizeReaderAnimatedVideoMode(value: unknown): ReaderAnimatedVideoModeSettings {
  const source = isRecord(value) ? value : {}
  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : DEFAULT_READER_ANIMATED_VIDEO_MODE.enabled,
    keywords: normalizeReaderAnimatedVideoKeywords(source.keywords),
  }
}

export function parseReaderAnimatedVideoModePatch(value: unknown): ReaderAnimatedVideoModePatch {
  if (!isRecord(value)) throw new TypeError("Animated video mode patch must be an object")
  const unknown = Object.keys(value).filter((key) => key !== "enabled" && key !== "keywords")
  if (unknown.length) throw new TypeError(`Animated video mode patch contains unsupported fields: ${unknown.join(", ")}`)
  const patch: ReaderAnimatedVideoModePatch = {}
  if ("enabled" in value) {
    if (typeof value.enabled !== "boolean") throw new TypeError("enabled must be a boolean")
    patch.enabled = value.enabled
  }
  if ("keywords" in value) {
    if (!Array.isArray(value.keywords) || value.keywords.some((item) => typeof item !== "string")) {
      throw new TypeError("keywords must be an array of strings")
    }
    patch.keywords = normalizeReaderAnimatedVideoKeywords(value.keywords)
  }
  if (!Object.keys(patch).length) throw new TypeError("Animated video mode patch must change at least one field")
  return patch
}

export function matchesReaderAnimatedVideoKeyword(text: string, keywords: readonly string[]): boolean {
  const normalized = text.trim().toLowerCase()
  return normalized.length > 0 && keywords.some((keyword) => keyword.length > 0 && normalized.includes(keyword.toLowerCase()))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
