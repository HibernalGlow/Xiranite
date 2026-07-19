/**
 * Browser-safe image trim settings shared by the NeoView GUI and reader
 * runtime. Keep this module free of Node, DOM, React and Svelte imports.
 */

export const READER_IMAGE_TRIM_MARGIN_MIN = 0
export const READER_IMAGE_TRIM_MARGIN_MAX = 45
export const READER_IMAGE_TRIM_MARGIN_STEP = 0.5
export const READER_IMAGE_TRIM_THRESHOLD_MIN = 5
export const READER_IMAGE_TRIM_THRESHOLD_MAX = 100
export const READER_IMAGE_TRIM_THRESHOLD_STEP = 5

export const READER_IMAGE_TRIM_TARGETS = ["auto", "black", "white"] as const
export type ReaderImageTrimTarget = typeof READER_IMAGE_TRIM_TARGETS[number]

export interface ReaderImageTrimSettings {
  enabled: boolean
  top: number
  bottom: number
  left: number
  right: number
  linkVertical: boolean
  linkHorizontal: boolean
  autoTrimThreshold: number
  autoTrimTarget: ReaderImageTrimTarget
}

export interface ReaderImageTrimPatch {
  enabled?: boolean
  top?: number
  bottom?: number
  left?: number
  right?: number
  linkVertical?: boolean
  linkHorizontal?: boolean
  autoTrimThreshold?: number
  autoTrimTarget?: ReaderImageTrimTarget
}

export type ReaderImageTrimMutation = ReaderImageTrimPatch | { reset: "defaults" }

/** The plain object shape used at persistence boundaries. */
export type ReaderImageTrimJson = {
  enabled: boolean
  top: number
  bottom: number
  left: number
  right: number
  linkVertical: boolean
  linkHorizontal: boolean
  autoTrimThreshold: number
  autoTrimTarget: ReaderImageTrimTarget
}

export const DEFAULT_READER_IMAGE_TRIM: ReaderImageTrimSettings = {
  enabled: false,
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
  linkVertical: false,
  linkHorizontal: false,
  autoTrimThreshold: 30,
  autoTrimTarget: "auto",
}

const PATCH_KEYS = new Set<keyof ReaderImageTrimPatch | "reset">([
  "enabled",
  "top",
  "bottom",
  "left",
  "right",
  "linkVertical",
  "linkHorizontal",
  "autoTrimThreshold",
  "autoTrimTarget",
  "reset",
])

/**
 * Normalize persisted or legacy values without allowing malformed settings to
 * enter the runtime. Legacy snake_case aliases are read here only; strict
 * patches intentionally accept the canonical camelCase contract.
 */
export function normalizeReaderImageTrim(value: unknown): ReaderImageTrimSettings {
  const source = isRecord(value) ? value : {}
  return {
    enabled: booleanOr(first(source, "enabled"), DEFAULT_READER_IMAGE_TRIM.enabled),
    top: normalizeStep(first(source, "top", "topPercent", "top_percent", "topMargin", "top_margin"), READER_IMAGE_TRIM_MARGIN_MIN, READER_IMAGE_TRIM_MARGIN_MAX, READER_IMAGE_TRIM_MARGIN_STEP, DEFAULT_READER_IMAGE_TRIM.top),
    bottom: normalizeStep(first(source, "bottom", "bottomPercent", "bottom_percent", "bottomMargin", "bottom_margin"), READER_IMAGE_TRIM_MARGIN_MIN, READER_IMAGE_TRIM_MARGIN_MAX, READER_IMAGE_TRIM_MARGIN_STEP, DEFAULT_READER_IMAGE_TRIM.bottom),
    left: normalizeStep(first(source, "left", "leftPercent", "left_percent", "leftMargin", "left_margin"), READER_IMAGE_TRIM_MARGIN_MIN, READER_IMAGE_TRIM_MARGIN_MAX, READER_IMAGE_TRIM_MARGIN_STEP, DEFAULT_READER_IMAGE_TRIM.left),
    right: normalizeStep(first(source, "right", "rightPercent", "right_percent", "rightMargin", "right_margin"), READER_IMAGE_TRIM_MARGIN_MIN, READER_IMAGE_TRIM_MARGIN_MAX, READER_IMAGE_TRIM_MARGIN_STEP, DEFAULT_READER_IMAGE_TRIM.right),
    linkVertical: booleanOr(first(source, "linkVertical", "link_vertical"), DEFAULT_READER_IMAGE_TRIM.linkVertical),
    linkHorizontal: booleanOr(first(source, "linkHorizontal", "link_horizontal"), DEFAULT_READER_IMAGE_TRIM.linkHorizontal),
    autoTrimThreshold: normalizeStep(first(source, "autoTrimThreshold", "auto_trim_threshold", "threshold"), READER_IMAGE_TRIM_THRESHOLD_MIN, READER_IMAGE_TRIM_THRESHOLD_MAX, READER_IMAGE_TRIM_THRESHOLD_STEP, DEFAULT_READER_IMAGE_TRIM.autoTrimThreshold),
    autoTrimTarget: isReaderImageTrimTarget(first(source, "autoTrimTarget", "auto_trim_target", "target"))
      ? first(source, "autoTrimTarget", "auto_trim_target", "target") as ReaderImageTrimTarget
      : DEFAULT_READER_IMAGE_TRIM.autoTrimTarget,
  }
}

/** Parse a strict canonical PATCH or the exclusive reset command. */
export function parseReaderImageTrimPatch(value: unknown): ReaderImageTrimMutation {
  if (!isRecord(value)) throw new TypeError("Image trim patch must be an object")
  for (const key of Object.keys(value)) {
    if (!PATCH_KEYS.has(key as keyof ReaderImageTrimPatch | "reset")) {
      throw new TypeError(`Unknown image trim patch field: ${key}`)
    }
  }
  if ("reset" in value) {
    if (value.reset !== "defaults") throw new TypeError('reset must be "defaults"')
    if (Object.keys(value).length !== 1) throw new TypeError("reset cannot be combined with other fields")
    return { reset: "defaults" }
  }

  const patch: ReaderImageTrimPatch = {}
  if ("enabled" in value) patch.enabled = strictBoolean(value.enabled, "enabled")
  if ("top" in value) patch.top = strictStep(value.top, READER_IMAGE_TRIM_MARGIN_MIN, READER_IMAGE_TRIM_MARGIN_MAX, READER_IMAGE_TRIM_MARGIN_STEP, "top")
  if ("bottom" in value) patch.bottom = strictStep(value.bottom, READER_IMAGE_TRIM_MARGIN_MIN, READER_IMAGE_TRIM_MARGIN_MAX, READER_IMAGE_TRIM_MARGIN_STEP, "bottom")
  if ("left" in value) patch.left = strictStep(value.left, READER_IMAGE_TRIM_MARGIN_MIN, READER_IMAGE_TRIM_MARGIN_MAX, READER_IMAGE_TRIM_MARGIN_STEP, "left")
  if ("right" in value) patch.right = strictStep(value.right, READER_IMAGE_TRIM_MARGIN_MIN, READER_IMAGE_TRIM_MARGIN_MAX, READER_IMAGE_TRIM_MARGIN_STEP, "right")
  if ("linkVertical" in value) patch.linkVertical = strictBoolean(value.linkVertical, "linkVertical")
  if ("linkHorizontal" in value) patch.linkHorizontal = strictBoolean(value.linkHorizontal, "linkHorizontal")
  if ("autoTrimThreshold" in value) patch.autoTrimThreshold = strictStep(value.autoTrimThreshold, READER_IMAGE_TRIM_THRESHOLD_MIN, READER_IMAGE_TRIM_THRESHOLD_MAX, READER_IMAGE_TRIM_THRESHOLD_STEP, "autoTrimThreshold")
  if ("autoTrimTarget" in value) {
    if (!isReaderImageTrimTarget(value.autoTrimTarget)) throw new RangeError('autoTrimTarget must be "auto", "black" or "white"')
    patch.autoTrimTarget = value.autoTrimTarget
  }
  if (Object.keys(patch).length === 0) throw new TypeError("Image trim patch must change at least one field")
  return patch
}

export function applyReaderImageTrimPatch(
  current: ReaderImageTrimSettings,
  value: unknown,
): ReaderImageTrimSettings {
  const mutation = parseReaderImageTrimPatch(value)
  if ("reset" in mutation) return { ...DEFAULT_READER_IMAGE_TRIM }
  return projectReaderImageTrimPatch(current, mutation)
}

/**
 * Project a trusted GUI/runtime patch while preserving the legacy linked-edge
 * contract. Strict transport callers should use applyReaderImageTrimPatch.
 */
export function projectReaderImageTrimPatch(
  current: ReaderImageTrimSettings,
  patch: ReaderImageTrimPatch,
): ReaderImageTrimSettings {
  const previous = normalizeReaderImageTrim(current)
  const next = normalizeReaderImageTrim({ ...previous, ...patch })
  const topChanged = patch.top !== undefined
  const bottomChanged = patch.bottom !== undefined
  const leftChanged = patch.left !== undefined
  const rightChanged = patch.right !== undefined

  if (next.linkVertical && !previous.linkVertical) {
    const linked = Math.max(next.top, next.bottom)
    next.top = linked
    next.bottom = linked
  } else if (next.linkVertical && topChanged !== bottomChanged) {
    if (topChanged) next.bottom = next.top
    else next.top = next.bottom
  }

  if (next.linkHorizontal && !previous.linkHorizontal) {
    const linked = Math.max(next.left, next.right)
    next.left = linked
    next.right = linked
  } else if (next.linkHorizontal && leftChanged !== rightChanged) {
    if (leftChanged) next.right = next.left
    else next.left = next.right
  }

  return next
}

/** Return a detached object that is safe to pass through JSON/TOML adapters. */
export function serializeReaderImageTrim(value: ReaderImageTrimSettings): ReaderImageTrimJson {
  const normalized = normalizeReaderImageTrim(value)
  return {
    enabled: normalized.enabled,
    top: normalized.top,
    bottom: normalized.bottom,
    left: normalized.left,
    right: normalized.right,
    linkVertical: normalized.linkVertical,
    linkHorizontal: normalized.linkHorizontal,
    autoTrimThreshold: normalized.autoTrimThreshold,
    autoTrimTarget: normalized.autoTrimTarget,
  }
}

export const toReaderImageTrimJson = serializeReaderImageTrim

export function readerImageTrimClipPath(value: ReaderImageTrimSettings): string | undefined {
  const settings = normalizeReaderImageTrim(value)
  if (!settings.enabled || settings.top === 0 && settings.bottom === 0 && settings.left === 0 && settings.right === 0) return undefined
  return `inset(${settings.top}% ${settings.right}% ${settings.bottom}% ${settings.left}%)`
}

export function isReaderImageTrimTarget(value: unknown): value is ReaderImageTrimTarget {
  return typeof value === "string" && READER_IMAGE_TRIM_TARGETS.includes(value as ReaderImageTrimTarget)
}

function first(source: Record<string, unknown>, ...keys: readonly string[]): unknown {
  for (const key of keys) if (key in source) return source[key]
  return undefined
}

function normalizeStep(value: unknown, minimum: number, maximum: number, step: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  const clamped = Math.min(maximum, Math.max(minimum, value))
  return roundStep(clamped, step)
}

function strictStep(value: unknown, minimum: number, maximum: number, step: number, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be a finite number from ${minimum} to ${maximum}`)
  }
  const snapped = roundStep(value, step)
  if (Math.abs(snapped - value) > 1e-9) throw new RangeError(`${name} must use a step of ${step}`)
  return snapped
}

function roundStep(value: number, step: number): number {
  return Number((Math.round(value / step) * step).toFixed(6))
}

function strictBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${name} must be a boolean`)
  return value
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
