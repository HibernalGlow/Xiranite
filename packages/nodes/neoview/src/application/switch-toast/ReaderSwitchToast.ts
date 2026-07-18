export interface ReaderSwitchToastSettings {
  enableBook: boolean
  enablePage: boolean
  enableAction: boolean
  enableBoundaryToast: boolean
  showBookPath: boolean
  showBookPageProgress: boolean
  showBookType: boolean
  showPageIndex: boolean
  showPageSize: boolean
  showPageDimensions: boolean
  bookTitleTemplate: string
  bookDescriptionTemplate: string
  pageTitleTemplate: string
  pageDescriptionTemplate: string
  positionX: number
  positionY: number
  opacity: number
  liquidGlass: boolean
}

export type ReaderSwitchToastPatch = Partial<ReaderSwitchToastSettings>

export interface ReaderSwitchToastBookContext {
  name: string
  displayName: string
  path: string
  type: string
  totalPages: number
  currentPageIndex: number
  currentPageDisplay: number
  progressPercent: number | null
  emmTranslatedTitle?: string
  emmRating?: number | null
  emmTags?: Record<string, string[]>
  emmRaw?: Record<string, unknown>
}

export interface ReaderSwitchToastPageContext {
  name: string
  displayName: string
  path: string
  innerPath?: string
  index: number
  indexDisplay: number
  width?: number
  height?: number
  dimensionsFormatted?: string
  size?: number
  sizeFormatted?: string
}

export interface ReaderSwitchToastContext {
  book: ReaderSwitchToastBookContext | null
  page: ReaderSwitchToastPageContext | null
}

export interface ReaderSwitchToastLegacyAliases {
  showBookSwitchToast?: unknown
}

export const READER_SWITCH_TOAST_POSITION_MIN = 0
export const READER_SWITCH_TOAST_POSITION_MAX = 4_096
export const READER_SWITCH_TOAST_OPACITY_MIN = 0.1
export const READER_SWITCH_TOAST_OPACITY_MAX = 1

export const DEFAULT_READER_SWITCH_TOAST: ReaderSwitchToastSettings = {
  enableBook: false,
  enablePage: false,
  enableAction: false,
  enableBoundaryToast: true,
  showBookPath: true,
  showBookPageProgress: true,
  showBookType: false,
  showPageIndex: true,
  showPageSize: false,
  showPageDimensions: true,
  bookTitleTemplate: "\u5df2\u5207\u6362\u5230 {{book.displayName}}\uff08\u7b2c {{book.currentPageDisplay}} / {{book.totalPages}} \u9875\uff09",
  bookDescriptionTemplate: "\u8def\u5f84\uff1a{{book.path}}",
  pageTitleTemplate: "\u7b2c {{page.indexDisplay}} / {{book.totalPages}} \u9875",
  pageDescriptionTemplate: "{{page.dimensionsFormatted}}  {{page.sizeFormatted}}",
  positionX: 20,
  positionY: 20,
  opacity: 0.92,
  liquidGlass: false,
}

const BOOLEAN_KEYS = [
  "enableBook",
  "enablePage",
  "enableAction",
  "enableBoundaryToast",
  "showBookPath",
  "showBookPageProgress",
  "showBookType",
  "showPageIndex",
  "showPageSize",
  "showPageDimensions",
  "liquidGlass",
] as const satisfies readonly (keyof ReaderSwitchToastSettings)[]

const TEMPLATE_KEYS = [
  "bookTitleTemplate",
  "bookDescriptionTemplate",
  "pageTitleTemplate",
  "pageDescriptionTemplate",
] as const satisfies readonly (keyof ReaderSwitchToastSettings)[]

const PATCH_KEYS = new Set<keyof ReaderSwitchToastSettings>([
  ...BOOLEAN_KEYS,
  ...TEMPLATE_KEYS,
  "positionX",
  "positionY",
  "opacity",
])

export function normalizeReaderSwitchToast(
  value: unknown,
  legacy: ReaderSwitchToastLegacyAliases = {},
): ReaderSwitchToastSettings {
  const source = isRecord(value) ? value : {}
  const normalized = { ...DEFAULT_READER_SWITCH_TOAST }
  for (const key of BOOLEAN_KEYS) {
    const candidate = source[key]
    if (typeof candidate === "boolean") normalized[key] = candidate
  }
  if (source.enableBook === undefined && typeof legacy.showBookSwitchToast === "boolean") {
    normalized.enableBook = legacy.showBookSwitchToast
  }
  for (const key of TEMPLATE_KEYS) {
    const candidate = source[key]
    if (typeof candidate === "string") normalized[key] = candidate
  }
  normalized.positionX = boundedOr(
    source.positionX,
    READER_SWITCH_TOAST_POSITION_MIN,
    READER_SWITCH_TOAST_POSITION_MAX,
    DEFAULT_READER_SWITCH_TOAST.positionX,
  )
  normalized.positionY = boundedOr(
    source.positionY,
    READER_SWITCH_TOAST_POSITION_MIN,
    READER_SWITCH_TOAST_POSITION_MAX,
    DEFAULT_READER_SWITCH_TOAST.positionY,
  )
  normalized.opacity = boundedOr(
    source.opacity,
    READER_SWITCH_TOAST_OPACITY_MIN,
    READER_SWITCH_TOAST_OPACITY_MAX,
    DEFAULT_READER_SWITCH_TOAST.opacity,
  )
  return normalized
}

export function parseReaderSwitchToastPatch(value: unknown): ReaderSwitchToastPatch {
  if (!isRecord(value)) throw new TypeError("Switch toast patch must be an object")
  for (const key of Object.keys(value)) {
    if (!PATCH_KEYS.has(key as keyof ReaderSwitchToastSettings)) {
      throw new TypeError(`Unknown switch toast patch field: ${key}`)
    }
  }

  const patch: ReaderSwitchToastPatch = {}
  for (const key of BOOLEAN_KEYS) {
    if (!(key in value)) continue
    const candidate = value[key]
    if (typeof candidate !== "boolean") throw new TypeError(`${key} must be a boolean`)
    patch[key] = candidate
  }
  for (const key of TEMPLATE_KEYS) {
    if (!(key in value)) continue
    const candidate = value[key]
    if (typeof candidate !== "string") throw new TypeError(`${key} must be a string`)
    patch[key] = candidate
  }
  if ("positionX" in value) {
    patch.positionX = strictBounded(value.positionX, READER_SWITCH_TOAST_POSITION_MIN, READER_SWITCH_TOAST_POSITION_MAX, "positionX")
  }
  if ("positionY" in value) {
    patch.positionY = strictBounded(value.positionY, READER_SWITCH_TOAST_POSITION_MIN, READER_SWITCH_TOAST_POSITION_MAX, "positionY")
  }
  if ("opacity" in value) {
    patch.opacity = strictBounded(value.opacity, READER_SWITCH_TOAST_OPACITY_MIN, READER_SWITCH_TOAST_OPACITY_MAX, "opacity")
  }
  return patch
}

export function applyReaderSwitchToastPatch(
  current: ReaderSwitchToastSettings,
  value: unknown,
): ReaderSwitchToastSettings {
  return { ...current, ...parseReaderSwitchToastPatch(value) }
}

export function renderReaderSwitchToastTemplate(
  template: string | undefined,
  context: ReaderSwitchToastContext,
): string {
  if (!template) return ""
  return template.replace(/{{\s*([^}]+?)\s*}}/g, (match, expression: string) => {
    const path = String(expression || "")
    if (!path.startsWith("book.") && !path.startsWith("page.")) return match
    const [root, ...segments] = path.split(".")
    let value: unknown = root === "book" ? context.book : context.page
    for (const segment of segments) {
      if (value === null || typeof value !== "object") {
        value = undefined
        break
      }
      value = (value as Record<string, unknown>)[segment]
    }
    if (value === undefined || value === null) return ""
    if (typeof value === "object") return JSON.stringify(value)
    return String(value)
  })
}

function boundedOr(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback
}

function strictBounded(value: unknown, minimum: number, maximum: number, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be a finite number from ${minimum} to ${maximum}`)
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
