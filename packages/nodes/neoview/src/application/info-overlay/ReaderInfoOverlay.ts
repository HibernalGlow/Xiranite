export interface ReaderInfoOverlaySettings {
  enabled: boolean
  opacity: number
  showBorder: boolean
  width?: number
  height?: number
}

export interface ReaderInfoOverlayPatch {
  enabled?: boolean
  opacity?: number
  showBorder?: boolean
  width?: number | null
  height?: number | null
}

export type ReaderInfoOverlayMutation = ReaderInfoOverlayPatch | { reset: "defaults" }

export const READER_INFO_OVERLAY_OPACITY_MIN = 0
export const READER_INFO_OVERLAY_OPACITY_MAX = 1
export const READER_INFO_OVERLAY_WIDTH_MIN = 120
export const READER_INFO_OVERLAY_WIDTH_MAX = 1_600
export const READER_INFO_OVERLAY_HEIGHT_MIN = 32
export const READER_INFO_OVERLAY_HEIGHT_MAX = 600

export const DEFAULT_READER_INFO_OVERLAY: ReaderInfoOverlaySettings = {
  enabled: false,
  opacity: 0.85,
  showBorder: false,
}

const PATCH_KEYS = new Set<keyof ReaderInfoOverlayPatch | "reset">([
  "enabled",
  "opacity",
  "showBorder",
  "width",
  "height",
  "reset",
])

export function normalizeReaderInfoOverlay(value: unknown): ReaderInfoOverlaySettings {
  const source = isRecord(value) ? value : {}
  const settings: ReaderInfoOverlaySettings = {
    enabled: typeof source.enabled === "boolean" ? source.enabled : DEFAULT_READER_INFO_OVERLAY.enabled,
    opacity: boundedOr(
      source.opacity,
      READER_INFO_OVERLAY_OPACITY_MIN,
      READER_INFO_OVERLAY_OPACITY_MAX,
      DEFAULT_READER_INFO_OVERLAY.opacity,
    ),
    showBorder: typeof source.showBorder === "boolean" ? source.showBorder : DEFAULT_READER_INFO_OVERLAY.showBorder,
  }
  const width = normalizeOptionalDimension(source.width, READER_INFO_OVERLAY_WIDTH_MIN, READER_INFO_OVERLAY_WIDTH_MAX)
  const height = normalizeOptionalDimension(source.height, READER_INFO_OVERLAY_HEIGHT_MIN, READER_INFO_OVERLAY_HEIGHT_MAX)
  if (width !== undefined) settings.width = width
  if (height !== undefined) settings.height = height
  return settings
}

export function parseReaderInfoOverlayPatch(value: unknown): ReaderInfoOverlayMutation {
  if (!isRecord(value)) throw new TypeError("Info overlay patch must be an object")
  for (const key of Object.keys(value)) {
    if (!PATCH_KEYS.has(key as keyof ReaderInfoOverlayPatch | "reset")) {
      throw new TypeError(`Unknown info overlay patch field: ${key}`)
    }
  }
  if ("reset" in value) {
    if (value.reset !== "defaults") throw new TypeError('reset must be "defaults"')
    if (Object.keys(value).length !== 1) throw new TypeError("reset cannot be combined with other fields")
    return { reset: "defaults" }
  }

  const patch: ReaderInfoOverlayPatch = {}
  if ("enabled" in value) patch.enabled = strictBoolean(value.enabled, "enabled")
  if ("opacity" in value) {
    patch.opacity = strictBounded(
      value.opacity,
      READER_INFO_OVERLAY_OPACITY_MIN,
      READER_INFO_OVERLAY_OPACITY_MAX,
      "opacity",
    )
  }
  if ("showBorder" in value) patch.showBorder = strictBoolean(value.showBorder, "showBorder")
  if ("width" in value) {
    patch.width = parseDimensionPatch(
      value.width,
      READER_INFO_OVERLAY_WIDTH_MIN,
      READER_INFO_OVERLAY_WIDTH_MAX,
      "width",
    )
  }
  if ("height" in value) {
    patch.height = parseDimensionPatch(
      value.height,
      READER_INFO_OVERLAY_HEIGHT_MIN,
      READER_INFO_OVERLAY_HEIGHT_MAX,
      "height",
    )
  }
  if (!Object.keys(patch).length) throw new TypeError("Info overlay patch must change at least one field")
  return patch
}

export function applyReaderInfoOverlayPatch(
  current: ReaderInfoOverlaySettings,
  value: unknown,
): ReaderInfoOverlaySettings {
  const mutation = parseReaderInfoOverlayPatch(value)
  if ("reset" in mutation) return { ...DEFAULT_READER_INFO_OVERLAY }
  const next: ReaderInfoOverlaySettings = { ...current }
  if (mutation.enabled !== undefined) next.enabled = mutation.enabled
  if (mutation.opacity !== undefined) next.opacity = mutation.opacity
  if (mutation.showBorder !== undefined) next.showBorder = mutation.showBorder
  if (mutation.width === null) delete next.width
  else if (mutation.width !== undefined) next.width = mutation.width
  if (mutation.height === null) delete next.height
  else if (mutation.height !== undefined) next.height = mutation.height
  return next
}

function normalizeOptionalDimension(value: unknown, minimum: number, maximum: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined
  return Math.min(maximum, Math.max(minimum, value))
}

function parseDimensionPatch(value: unknown, minimum: number, maximum: number, name: string): number | null {
  if (value === null) return null
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number or null`)
  }
  if (value <= 0) return null
  if (value < minimum || value > maximum) {
    throw new RangeError(`${name} must be non-positive to clear or from ${minimum} to ${maximum}`)
  }
  return value
}

function strictBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${name} must be a boolean`)
  return value
}

function strictBounded(value: unknown, minimum: number, maximum: number, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be a finite number from ${minimum} to ${maximum}`)
  }
  return value
}

function boundedOr(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
