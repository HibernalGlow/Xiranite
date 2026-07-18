export const READER_PAGE_TRANSITION_TYPES = [
  "none",
  "fade",
  "slide",
  "slideUp",
  "zoom",
  "flip",
] as const

export type ReaderPageTransitionType = typeof READER_PAGE_TRANSITION_TYPES[number]

export const READER_PAGE_TRANSITION_EASINGS = [
  "linear",
  "ease",
  "easeIn",
  "easeOut",
  "easeInOut",
  "easeOutQuad",
  "easeOutCubic",
] as const

export type ReaderPageTransitionEasing = typeof READER_PAGE_TRANSITION_EASINGS[number]
export type ReaderPageTransitionDirection = "next" | "prev"

export const READER_PAGE_TRANSITION_TYPE_LABELS: Readonly<Record<ReaderPageTransitionType, string>> = {
  none: "\u65e0\u52a8\u753b",
  fade: "\u6de1\u5165\u6de1\u51fa",
  slide: "\u6c34\u5e73\u6ed1\u52a8",
  slideUp: "\u5782\u76f4\u6ed1\u52a8",
  zoom: "\u7f29\u653e",
  flip: "\u7ffb\u8f6c",
}

export const READER_PAGE_TRANSITION_EASING_LABELS: Readonly<Record<ReaderPageTransitionEasing, string>> = {
  linear: "\u7ebf\u6027",
  ease: "\u5e73\u6ed1",
  easeIn: "\u6e10\u5165",
  easeOut: "\u6e10\u51fa",
  easeInOut: "\u6e10\u5165\u6e10\u51fa",
  easeOutQuad: "\u4e8c\u6b21\u6e10\u51fa",
  easeOutCubic: "\u4e09\u6b21\u6e10\u51fa",
}

export const READER_PAGE_TRANSITION_EASING_CSS: Readonly<Record<ReaderPageTransitionEasing, string>> = {
  linear: "linear",
  ease: "ease",
  easeIn: "ease-in",
  easeOut: "ease-out",
  easeInOut: "ease-in-out",
  easeOutQuad: "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
  easeOutCubic: "cubic-bezier(0.215, 0.61, 0.355, 1)",
}

export interface ReaderPageTransitionSettings {
  enabled: boolean
  type: ReaderPageTransitionType
  duration: number
  easing: ReaderPageTransitionEasing
}

export type ReaderPageTransitionPatch = Partial<ReaderPageTransitionSettings>

export interface ReaderPageTransitionCssState {
  transform?: string
  opacity?: number
}

export interface ReaderPageTransitionCssProjection {
  enabled: boolean
  className: string
  transition: string
  from: ReaderPageTransitionCssState
  to: ReaderPageTransitionCssState
}

export const DEFAULT_READER_PAGE_TRANSITION: ReaderPageTransitionSettings = {
  enabled: false,
  type: "none",
  duration: 0,
  easing: "easeOutQuad",
}

const PATCH_KEYS = new Set<keyof ReaderPageTransitionSettings>(["enabled", "type", "duration", "easing"])

export function normalizeReaderPageTransition(value: unknown): ReaderPageTransitionSettings {
  const source = isRecord(value) ? value : {}
  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : DEFAULT_READER_PAGE_TRANSITION.enabled,
    type: isReaderPageTransitionType(source.type) ? source.type : DEFAULT_READER_PAGE_TRANSITION.type,
    duration: normalizeImportedDuration(source.duration),
    easing: isReaderPageTransitionEasing(source.easing) ? source.easing : DEFAULT_READER_PAGE_TRANSITION.easing,
  }
}

export function parseReaderPageTransitionPatch(value: unknown): ReaderPageTransitionPatch {
  if (!isRecord(value)) throw new TypeError("Page transition patch must be an object")
  for (const key of Object.keys(value)) {
    if (!PATCH_KEYS.has(key as keyof ReaderPageTransitionSettings)) {
      throw new TypeError(`Unknown page transition patch field: ${key}`)
    }
  }

  const patch: ReaderPageTransitionPatch = {}
  if ("enabled" in value) {
    if (typeof value.enabled !== "boolean") throw new TypeError("enabled must be a boolean")
    patch.enabled = value.enabled
  }
  if ("type" in value) {
    if (!isReaderPageTransitionType(value.type)) throw new RangeError("type must be a known page transition type")
    patch.type = value.type
  }
  if ("duration" in value) {
    if (typeof value.duration !== "number" || !Number.isFinite(value.duration) || value.duration < 0 || value.duration > 500) {
      throw new RangeError("duration must be a finite number from 0 to 500")
    }
    patch.duration = value.duration
  }
  if ("easing" in value) {
    if (!isReaderPageTransitionEasing(value.easing)) throw new RangeError("easing must be a known page transition easing")
    patch.easing = value.easing
  }
  return patch
}

export function projectReaderPageTransitionCss(
  settings: ReaderPageTransitionSettings,
  direction: ReaderPageTransitionDirection,
): ReaderPageTransitionCssProjection {
  if (!settings.enabled || settings.type === "none") {
    return { enabled: false, className: "", transition: "none", from: {}, to: {} }
  }
  const easing = READER_PAGE_TRANSITION_EASING_CSS[settings.easing]
  return {
    enabled: true,
    className: `page-transition-${settings.type}-enter-${direction}`,
    transition: `transform ${settings.duration}ms ${easing}, opacity ${settings.duration}ms ${easing}`,
    from: transitionStart(settings.type, direction),
    to: transitionEnd(settings.type),
  }
}

export function isReaderPageTransitionType(value: unknown): value is ReaderPageTransitionType {
  return typeof value === "string" && READER_PAGE_TRANSITION_TYPES.includes(value as ReaderPageTransitionType)
}

export function isReaderPageTransitionEasing(value: unknown): value is ReaderPageTransitionEasing {
  return typeof value === "string" && READER_PAGE_TRANSITION_EASINGS.includes(value as ReaderPageTransitionEasing)
}

function transitionStart(
  type: Exclude<ReaderPageTransitionType, "none">,
  direction: ReaderPageTransitionDirection,
): ReaderPageTransitionCssState {
  switch (type) {
    case "fade": return { opacity: 0 }
    case "slide": return { transform: `translateX(${direction === "next" ? "30%" : "-30%"})`, opacity: 0 }
    case "slideUp": return { transform: `translateY(${direction === "next" ? "30%" : "-30%"})`, opacity: 0 }
    case "zoom": return { transform: `scale(${direction === "next" ? "0.9" : "1.1"})`, opacity: 0 }
    case "flip": return { transform: `perspective(1000px) rotateY(${direction === "next" ? "-15deg" : "15deg"})`, opacity: 0 }
  }
}

function transitionEnd(type: Exclude<ReaderPageTransitionType, "none">): ReaderPageTransitionCssState {
  if (type === "fade") return { opacity: 1 }
  if (type === "flip") return { transform: "perspective(1000px) rotateY(0deg)", opacity: 1 }
  if (type === "zoom") return { transform: "scale(1)", opacity: 1 }
  return { transform: type === "slide" ? "translateX(0)" : "translateY(0)", opacity: 1 }
}

function normalizeImportedDuration(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_READER_PAGE_TRANSITION.duration
  return Math.min(1_000, Math.max(0, value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
