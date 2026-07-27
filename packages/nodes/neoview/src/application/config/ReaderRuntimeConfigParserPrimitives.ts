import type { TailOverflowBehavior } from "../../domain/navigation/navigation.js"
import { DEFAULT_READER_PRESENTATION, type ReaderAutoRotation, type ReaderFitMode, type ReaderWidePageStretch } from "../../domain/presentation/presentation.js"

export function boundedNumber(value: unknown, min: number, max: number, fallback: number, path: string): number {
  if (value === undefined) return fallback
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${path} must be a finite number between ${min} and ${max}.`)
  }
  return value
}
export function boundedInteger(value: unknown, min: number, max: number, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${path} must be an integer between ${min} and ${max}.`)
  }
  return value
}
export function boundedIntegerWithFallback(value: unknown, min: number, max: number, fallback: number, path: string): number {
  return value === undefined ? fallback : boundedInteger(value, min, max, path)
}
export function mebibytes(value: unknown, min: number, max: number, fallbackBytes: number, path: string): number {
  if (value === undefined) return fallbackBytes
  return boundedInteger(value, min, max, path) * 1024 * 1024
}
export function parseTailOverflow(value: unknown): TailOverflowBehavior | undefined {
  if (value === undefined) return undefined
  const aliases: Readonly<Record<string, TailOverflowBehavior>> = {
    "do-nothing": "do-nothing",
    doNothing: "do-nothing",
    "stay-on-last-page": "stay-on-last-page",
    stayOnLastPage: "stay-on-last-page",
    "next-book": "next-book",
    nextBook: "next-book",
    loop: "loop",
    loopTopBottom: "loop",
    "seamless-loop": "seamless-loop",
    seamlessLoop: "seamless-loop",
  }
  if (typeof value !== "string" || !aliases[value]) {
    throw new Error("[nodes.neoview.reader].tail_overflow_behavior is invalid.")
  }
  return aliases[value]
}
export function readerFitMode(value: unknown, path: string): ReaderFitMode {
  if (value === undefined) return DEFAULT_READER_PRESENTATION.fitMode
  if (value === "fit") return "fit"
  if (value === "fitLeftAlign" || value === "fit-left") return "fit-left"
  if (value === "fitRightAlign" || value === "fit-right") return "fit-right"
  if (value === "fill" || value === "original") return value
  if (value === "fitWidth" || value === "fit-width") return "fit-width"
  if (value === "fitHeight" || value === "fit-height") return "fit-height"
  throw new Error(`${path} must be fit, fill, fitWidth, fitHeight, original, fitLeftAlign or fitRightAlign.`)
}
export function persistedReaderFitMode(value: ReaderFitMode): string {
  if (value === "fit-width") return "fitWidth"
  if (value === "fit-height") return "fitHeight"
  if (value === "fit-left") return "fitLeftAlign"
  if (value === "fit-right") return "fitRightAlign"
  return value
}
export function nestedValue(record: Record<string, unknown> | undefined, section: string, key: string): unknown {
  if (!record) return undefined
  const nested = record[section]
  return isRecord(nested) ? nested[key] : undefined
}
export function optionalStringArray(value: unknown, fallback: readonly string[], path: string): readonly string[] {
  return value === undefined ? fallback : requiredStringArray(value, path)
}
export function optionalConfigPath(value: unknown, path: string): string | undefined {
  if (value === undefined || value === "") return undefined
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
    throw new Error(`${path} must be an empty string or a non-empty path without NUL.`)
  }
  return value.trim()
}
export function readerAutoRotation(value: unknown): ReaderAutoRotation {
  if (value === undefined) return DEFAULT_READER_PRESENTATION.autoRotation
  const aliases: Record<string, ReaderAutoRotation> = {
    none: "none",
    left: "left",
    right: "right",
    horizontalLeft: "horizontal-left",
    "horizontal-left": "horizontal-left",
    horizontalRight: "horizontal-right",
    "horizontal-right": "horizontal-right",
    forcedLeft: "forced-left",
    "forced-left": "forced-left",
    forcedRight: "forced-right",
    "forced-right": "forced-right",
  }
  if (typeof value !== "string" || !aliases[value]) throw new Error("reader auto rotation is invalid.")
  return aliases[value]
}
export function persistedReaderAutoRotation(value: ReaderAutoRotation): string {
  return value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
}
export function readerWidePageStretch(value: unknown): ReaderWidePageStretch {
  if (value === undefined) return DEFAULT_READER_PRESENTATION.widePageStretch
  const aliases: Record<string, ReaderWidePageStretch> = {
    none: "none",
    uniformHeight: "uniform-height",
    "uniform-height": "uniform-height",
    uniformWidth: "uniform-width",
    "uniform-width": "uniform-width",
  }
  if (typeof value !== "string" || !aliases[value]) throw new Error("reader wide page stretch is invalid.")
  return aliases[value]
}
export function persistedReaderWidePageStretch(value: ReaderWidePageStretch): string {
  return value === "uniform-height" ? "uniformHeight" : value === "uniform-width" ? "uniformWidth" : value
}
export function requiredManifestIdentifier(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(value)) {
    throw new Error(`${path} must be a valid identifier.`)
  }
  return value
}
export function requiredManifestText(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 256 || value.includes("\0")) {
    throw new Error(`${path} must be a non-empty string of at most 256 characters without NUL.`)
  }
  return value.trim()
}
export function requiredManifestPath(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 512 || value.includes("\0")) {
    throw new Error(`${path} must be a non-empty relative path without NUL.`)
  }
  const normalized = value.trim().replace(/\\/gu, "/")
  if (normalized.startsWith("/") || /^[a-zA-Z]:\//u.test(normalized) || normalized.split("/").includes("..")) {
    throw new Error(`${path} must be a safe relative path.`)
  }
  return normalized
}
export function requiredManifestPaths(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 64) throw new Error(`${path} must contain between 1 and 64 paths.`)
  const paths = value.map((entry, index) => requiredManifestPath(entry, `${path}[${index}]`))
  if (new Set(paths).size !== paths.length) throw new Error(`${path} must not contain duplicates.`)
  return paths
}
export function requiredManifestScales(value: unknown, path: string): number[] {
  if (!Array.isArray(value) || !value.length || value.length > 8) throw new Error(`${path} must contain between 1 and 8 scales.`)
  const scales = value.map((scale) => boundedInteger(scale, 1, 8, path))
  return [...new Set(scales)].sort((left, right) => left - right)
}
export function requiredManifestNoise(value: unknown, path: string): number[] {
  if (!Array.isArray(value) || value.length > 5) throw new Error(`${path} must contain at most 5 noise levels.`)
  const noise = value.map((level) => boundedInteger(level, -1, 3, path))
  return [...new Set(noise)].sort((left, right) => left - right)
}
export function requiredManifestScaleFiles(value: unknown, scales: readonly number[], path: string): Readonly<Record<number, string>> {
  const record = requireRecord(value, path)
  const result: Record<number, string> = {}
  for (const [scale, alias] of Object.entries(record)) {
    const numericScale = Number(scale)
    if (!Number.isInteger(numericScale) || !scales.includes(numericScale)) throw new Error(`${path}.${scale} is not a declared scale.`)
    result[numericScale] = requiredManifestIdentifier(alias, `${path}.${scale}`)
  }
  return result
}
export function requiredManifestEngine(value: unknown, path: string): "upscayl" | "waifu2x" | "realcugan" {
  const engine = optionalEnum(value, path, ["upscayl", "waifu2x", "realcugan"] as const)
  if (!engine) throw new Error(`${path} is required.`)
  return engine
}
export function optionalHttpsUrl(value: unknown, path: string): string | undefined {
  if (value === undefined || value === "") return undefined
  if (typeof value !== "string") throw new Error(`${path} must be an HTTPS URL.`)
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${path} must be an HTTPS URL.`)
  }
  if (url.protocol !== "https:") throw new Error(`${path} must be an HTTPS URL.`)
  return url.href.endsWith("/") ? url.href : `${url.href}/`
}
export function requiredStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length > 128 || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${path} must be an array containing at most 128 strings.`)
  }
  return value
}
export function optionalStringRecord(value: unknown, fallback: Readonly<Record<string, string>>, path: string): Readonly<Record<string, string>> {
  return value === undefined ? fallback : requiredStringRecord(value, path)
}
export function requiredStringRecord(value: unknown, path: string): Record<string, string> {
  const record = requireRecord(value, path)
  if (Object.keys(record).length > 128 || Object.values(record).some((entry) => typeof entry !== "string")) {
    throw new Error(`${path} must contain at most 128 string values.`)
  }
  return record as Record<string, string>
}
export function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean.`)
  return value
}
export function requiredBoolean(value: unknown, path: string): boolean {
  const parsed = optionalBoolean(value, path)
  if (parsed === undefined) throw new Error(`${path} is required.`)
  return parsed
}
export function requireLayoutId(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)) throw new Error(`${path} is invalid.`)
  return value
}
export function requireLaneTitle(value: unknown, path: string): string {
  if (typeof value !== "string") throw new Error(`${path} must be a string.`)
  const title = value.trim()
  if (!title || title.length > 80) throw new Error(`${path} must contain 1 to 80 characters.`)
  return title
}
export function optionalEnum<const Values extends readonly string[]>(value: unknown, path: string, values: Values): Values[number] | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string" || !values.includes(value)) {
    throw new Error(`${path} must be one of: ${values.join(", ")}.`)
  }
  return value as Values[number]
}
export function optionalRecord(value: unknown, path: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  return requireRecord(value, path)
}
export function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${path} must be a table.`)
  return value
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
