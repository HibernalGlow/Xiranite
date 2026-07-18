export const READER_COLOR_FILTER_PRESET_IDS = [
  "redAndBlue",
  "redAndBlueGray",
  "blueSky",
  "violetAndBrown",
  "violetAndCarnation",
  "paleYellowAndBrown",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "violet",
] as const

export type ReaderColorFilterPresetId = typeof READER_COLOR_FILTER_PRESET_IDS[number]

export interface ReaderColorPoint {
  h: number
  s: number
  m: number
}

export const READER_COLOR_FILTER_PRESETS: Readonly<Record<ReaderColorFilterPresetId, readonly ReaderColorPoint[]>> = {
  redAndBlue: [
    { h: 0, s: 0, m: 1 },
    { h: 240, s: 0.6, m: 1 },
    { h: 0, s: 0.7, m: 1 },
    { h: 50, s: 1.5, m: 1 },
    { h: 0, s: 0, m: 1 },
  ],
  redAndBlueGray: [
    { h: 0, s: 0, m: 1 },
    { h: 240, s: 0.4, m: 1 },
    { h: 0, s: 0.5, m: 1 },
    { h: 50, s: 1, m: 1 },
    { h: 0, s: 0, m: 1 },
  ],
  blueSky: [
    { h: 0, s: 0, m: 1 },
    { h: 204, s: 0.73, m: 1 },
    { h: 200, s: 0.79, m: 1 },
    { h: 206, s: 0.84, m: 1 },
  ],
  violetAndBrown: [
    { h: 323, s: 0.37, m: 1 },
    { h: 321, s: 0.42, m: 1 },
    { h: 314, s: 0.49, m: 2 },
    { h: 18, s: 0.72, m: 3 },
    { h: 28, s: 0.83, m: 1 },
  ],
  violetAndCarnation: [
    { h: 0, s: 0, m: 1 },
    { h: 300, s: 0.7, m: 1 },
    { h: 300, s: 0.4, m: 2 },
    { h: 1, s: 0.4, m: 1 },
    { h: 0, s: 0, m: 1 },
  ],
  paleYellowAndBrown: [
    { h: 203, s: 0, m: 1 },
    { h: 238, s: 0.14, m: 1 },
    { h: 15, s: 0.55, m: 1 },
    { h: 14, s: 0.63, m: 1 },
    { h: 41, s: 0.5, m: 1 },
    { h: 44, s: 0.58, m: 1 },
    { h: 45, s: 0.78, m: 1 },
    { h: 48, s: 0.93, m: 1 },
    { h: 52, s: 0.95, m: 1 },
  ],
  red: [
    { h: 0, s: 0, m: 1 },
    { h: 0, s: 0.7, m: 1 },
    { h: 0, s: 0, m: 1 },
  ],
  orange: [
    { h: 0, s: 0, m: 1 },
    { h: 30, s: 1.33, m: 1 },
    { h: 0, s: 0, m: 1 },
  ],
  yellow: [
    { h: 0, s: 0, m: 1 },
    { h: 50, s: 2, m: 1 },
    { h: 0, s: 0, m: 1 },
  ],
  green: [
    { h: 0, s: 0, m: 1 },
    { h: 120, s: 0.7, m: 1 },
    { h: 0, s: 0, m: 1 },
  ],
  blue: [
    { h: 0, s: 0, m: 1 },
    { h: 230, s: 0.7, m: 1 },
    { h: 0, s: 0, m: 1 },
  ],
  violet: [
    { h: 0, s: 0, m: 1 },
    { h: 280, s: 0.7, m: 1 },
    { h: 0, s: 0, m: 1 },
  ],
}

export const READER_COLOR_FILTER_PRESET_LABELS: Readonly<Record<ReaderColorFilterPresetId, string>> = {
  redAndBlue: "红蓝",
  redAndBlueGray: "红蓝灰",
  blueSky: "蓝天",
  violetAndBrown: "紫棕",
  violetAndCarnation: "紫粉",
  paleYellowAndBrown: "淡黄棕",
  red: "红色",
  orange: "橙色",
  yellow: "黄色",
  green: "绿色",
  blue: "蓝色",
  violet: "紫色",
}

export interface ReaderColorFilterSettings {
  colorizeEnabled: boolean
  colorizePreset: ReaderColorFilterPresetId
  customColors: readonly ReaderColorPoint[]
  onlyBlackAndWhite: boolean
  brightness: number
  contrast: number
  saturation: number
  sepia: number
  hueRotate: number
  invert: boolean
  negative: boolean
}

export type ReaderColorFilterPatch = Partial<ReaderColorFilterSettings>

export interface ReaderColorFilterTables {
  r: readonly number[]
  g: readonly number[]
  b: readonly number[]
}

export interface ReaderColorFilterCssOptions {
  filterId: string
  colorizeAllowed: boolean
}

export const DEFAULT_READER_COLOR_FILTER: ReaderColorFilterSettings = {
  colorizeEnabled: false,
  colorizePreset: "redAndBlueGray",
  customColors: [],
  onlyBlackAndWhite: false,
  brightness: 100,
  contrast: 100,
  saturation: 100,
  sepia: 0,
  hueRotate: 0,
  invert: false,
  negative: false,
}

const PATCH_KEYS = new Set<keyof ReaderColorFilterSettings>([
  "colorizeEnabled",
  "colorizePreset",
  "customColors",
  "onlyBlackAndWhite",
  "brightness",
  "contrast",
  "saturation",
  "sepia",
  "hueRotate",
  "invert",
  "negative",
])

export function normalizeReaderColorFilter(value: unknown): ReaderColorFilterSettings {
  const source = isRecord(value) ? value : {}
  return {
    colorizeEnabled: booleanOr(source.colorizeEnabled, false),
    colorizePreset: isReaderColorFilterPresetId(source.colorizePreset)
      ? source.colorizePreset
      : DEFAULT_READER_COLOR_FILTER.colorizePreset,
    customColors: normalizeColorPoints(source.customColors),
    onlyBlackAndWhite: booleanOr(source.onlyBlackAndWhite, false),
    brightness: boundedOr(source.brightness, 50, 150, 100),
    contrast: boundedOr(source.contrast, 50, 150, 100),
    saturation: boundedOr(source.saturation, 0, 200, 100),
    sepia: boundedOr(source.sepia, 0, 100, 0),
    hueRotate: boundedOr(source.hueRotate, 0, 360, 0),
    invert: booleanOr(source.invert, false),
    negative: booleanOr(source.negative, false),
  }
}

export function parseReaderColorFilterPatch(value: unknown): ReaderColorFilterPatch {
  if (!isRecord(value) || Array.isArray(value)) throw new TypeError("Color filter patch must be an object")
  for (const key of Object.keys(value)) {
    if (!PATCH_KEYS.has(key as keyof ReaderColorFilterSettings)) {
      throw new TypeError(`Unknown color filter patch field: ${key}`)
    }
  }

  const patch: ReaderColorFilterPatch = {}
  if ("colorizeEnabled" in value) patch.colorizeEnabled = strictBoolean(value.colorizeEnabled, "colorizeEnabled")
  if ("colorizePreset" in value) {
    if (!isReaderColorFilterPresetId(value.colorizePreset)) throw new RangeError("colorizePreset must be a known preset")
    patch.colorizePreset = value.colorizePreset
  }
  if ("customColors" in value) patch.customColors = parseColorPoints(value.customColors)
  if ("onlyBlackAndWhite" in value) patch.onlyBlackAndWhite = strictBoolean(value.onlyBlackAndWhite, "onlyBlackAndWhite")
  if ("brightness" in value) patch.brightness = strictBounded(value.brightness, 50, 150, "brightness")
  if ("contrast" in value) patch.contrast = strictBounded(value.contrast, 50, 150, "contrast")
  if ("saturation" in value) patch.saturation = strictBounded(value.saturation, 0, 200, "saturation")
  if ("sepia" in value) patch.sepia = strictBounded(value.sepia, 0, 100, "sepia")
  if ("hueRotate" in value) patch.hueRotate = strictBounded(value.hueRotate, 0, 360, "hueRotate")
  if ("invert" in value) patch.invert = strictBoolean(value.invert, "invert")
  if ("negative" in value) patch.negative = strictBoolean(value.negative, "negative")
  return patch
}

export function applyReaderColorFilterPatch(
  current: ReaderColorFilterSettings,
  value: unknown,
): ReaderColorFilterSettings {
  return normalizeReaderColorFilter({ ...current, ...parseReaderColorFilterPatch(value) })
}

export function activeReaderColorFilterPoints(settings: ReaderColorFilterSettings): readonly ReaderColorPoint[] {
  return settings.customColors.length >= 2
    ? settings.customColors
    : READER_COLOR_FILTER_PRESETS[settings.colorizePreset] ?? READER_COLOR_FILTER_PRESETS.redAndBlueGray
}

export function projectReaderColorFilterTables(settings: ReaderColorFilterSettings): ReaderColorFilterTables {
  const colors = activeReaderColorFilterPoints(settings)
  const expanded = colors.flatMap((color) => Array.from({ length: color.m }, () => color))
  const step = 1 / (expanded.length - 1)
  const r: number[] = []
  const g: number[] = []
  const b: number[] = []

  for (let index = 0; index < expanded.length; index += 1) {
    const color = expanded[index]!
    const center = step * index
    const up = 1 - center
    const rgb = hslToRgb(color.h / 360, 1, 0.5)
    const multiplier = 1 - (rgb.r + rgb.g + rgb.b - 1) / 2
    const scaledR = color.s * rgb.r
    const scaledG = color.s * rgb.g
    const scaledB = color.s * rgb.b
    let nextR = scaledR > 0 ? center + up * scaledR * multiplier : center + scaledR * multiplier * center
    let nextG = scaledG > 0 ? center + up * scaledG * multiplier : center + scaledG * multiplier * center
    let nextB = scaledB > 0 ? center + up * scaledB * multiplier : center + scaledB * multiplier * center

    if (center === 1 && color.s > 1) {
      nextR += scaledR * (color.s - 1)
      nextG += scaledG * (color.s - 1)
      nextB += scaledB * (color.s - 1)
    }

    const adjusted = keepLuminance(center, nextR, nextG, nextB, color.s)
    r.push(adjusted.r)
    g.push(adjusted.g)
    b.push(adjusted.b)
  }
  return { r, g, b }
}

export function projectReaderColorFilterCss(
  settings: ReaderColorFilterSettings,
  options: ReaderColorFilterCssOptions,
): string {
  if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(options.filterId)) {
    throw new TypeError("filterId must be a valid CSS/SVG identifier")
  }
  const filters: string[] = []
  if (settings.colorizeEnabled && options.colorizeAllowed) {
    filters.push(`grayscale(100%) url(#${options.filterId})`)
  }
  if (settings.brightness !== 100) filters.push(`brightness(${settings.brightness}%)`)
  if (settings.saturation !== 100) filters.push(`saturate(${settings.saturation}%)`)
  if (settings.contrast !== 100) filters.push(`contrast(${settings.contrast}%)`)
  if (settings.sepia !== 0) filters.push(`sepia(${settings.sepia}%)`)
  if (settings.hueRotate !== 0) filters.push(`hue-rotate(${settings.hueRotate}deg)`)
  if (settings.invert) filters.push("invert(100%)")
  if (settings.negative) filters.push("invert(100%) hue-rotate(180deg)")
  return filters.join(" ")
}

export function isReaderColorFilterPresetId(value: unknown): value is ReaderColorFilterPresetId {
  return typeof value === "string" && READER_COLOR_FILTER_PRESET_IDS.includes(value as ReaderColorFilterPresetId)
}

function normalizeColorPoints(value: unknown): readonly ReaderColorPoint[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 32).flatMap((point) => {
    if (!isRecord(point)) return []
    const h = finiteNumber(point.h)
    const s = finiteNumber(point.s)
    const m = finiteNumber(point.m)
    if (h === undefined || s === undefined || m === undefined) return []
    return [{ h: clamp(h, 0, 360), s: clamp(s, 0, 2), m: Math.round(clamp(m, 1, 16)) }]
  })
}

function parseColorPoints(value: unknown): readonly ReaderColorPoint[] {
  if (!Array.isArray(value) || value.length > 32) throw new RangeError("customColors must contain at most 32 points")
  return value.map((point, index) => {
    if (!isRecord(point) || Object.keys(point).some((key) => key !== "h" && key !== "s" && key !== "m")) {
      throw new TypeError(`customColors[${index}] must contain only h, s and m`)
    }
    return {
      h: strictBounded(point.h, 0, 360, `customColors[${index}].h`),
      s: strictBounded(point.s, 0, 2, `customColors[${index}].s`),
      m: strictInteger(point.m, 1, 16, `customColors[${index}].m`),
    }
  })
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  if (s === 0) return { r: l, g: l, b: l }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return { r: hueToRgb(p, q, h + 1 / 3), g: hueToRgb(p, q, h), b: hueToRgb(p, q, h - 1 / 3) }
}

function hueToRgb(p: number, q: number, initial: number): number {
  let t = initial
  if (t < 0) t += 1
  if (t > 1) t -= 1
  if (t < 1 / 6) return p + (q - p) * 6 * t
  if (t < 1 / 2) return q
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
  return p
}

function keepLuminance(center: number, initialR: number, initialG: number, initialB: number, saturation: number) {
  const s = Math.max(1, saturation)
  const startLuminance = luminance(initialR, initialG, initialB)
  const increase = startLuminance <= center
  const distance = Math.abs(initialR - center) * 0.2126
    + Math.abs(initialG - center) * 0.7152
    + Math.abs(initialB - center) * 0.0722
  const adjustedCenter = increase ? center - (s - 1) * distance * 0.1 : center + (s - 1) * distance * 0.1
  let r = initialR
  let g = initialG
  let b = initialB
  let change = Math.abs(adjustedCenter - startLuminance) / 3

  for (let iteration = 0; iteration <= 10_000; iteration += 1) {
    const nextR = increase ? r + change : Math.max(0, r - change)
    const nextG = increase ? g + change : Math.max(0, g - change)
    const nextB = increase ? b + change : Math.max(0, b - change)
    const nextLuminance = luminance(nextR, nextG, nextB)
    if ((increase && nextLuminance >= adjustedCenter) || (!increase && nextLuminance <= adjustedCenter)) break
    change = Math.max(0.001, Math.abs(adjustedCenter - nextLuminance) / 3)
    r = nextR
    g = nextG
    b = nextB
  }
  return { r, g, b }
}

function luminance(r: number, g: number, b: number): number {
  return r * 0.2126 + g * 0.7152 + b * 0.0722
}

function boundedOr(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const number = finiteNumber(value)
  return number === undefined ? fallback : clamp(number, minimum, maximum)
}

function strictBounded(value: unknown, minimum: number, maximum: number, name: string): number {
  const number = finiteNumber(value)
  if (number === undefined || number < minimum || number > maximum) {
    throw new RangeError(`${name} must be a finite number from ${minimum} to ${maximum}`)
  }
  return number
}

function strictInteger(value: unknown, minimum: number, maximum: number, name: string): number {
  const number = strictBounded(value, minimum, maximum, name)
  if (!Number.isInteger(number)) throw new TypeError(`${name} must be an integer`)
  return number
}

function strictBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${name} must be a boolean`)
  return value
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
