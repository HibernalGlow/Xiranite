import { z } from "zod"

import type { ReaderBookSettingsOverrides } from "../ports/ReaderBookSettingsStore.js"
import { LegacySettingsCodec } from "./LegacySettingsCodec.js"

const STORAGE_KEY = "neoview-book-settings"
const MAX_ENTRIES = 10_000
const PathSchema = z.string().min(1).max(32_768)
  .refine((value) => !value.includes("\0"))
  .refine(isLegacyAbsolutePath, "Legacy book settings path must be absolute.")
const BooleanSchema = z.boolean()
const RatingSchema = z.number().int().min(1).max(5)
const DirectionSchema = z.enum(["left-to-right", "right-to-left"])

export interface LegacyBookSettingsEntry {
  path: string
  overrides: ReaderBookSettingsOverrides
}

export interface LegacyBookSettingsReport {
  totalEntries: number
  validEntries: number
  invalidEntries: number
  invalidFields: number
  unknownFields: number
}

export interface DecodedLegacyBookSettings {
  entries: readonly LegacyBookSettingsEntry[]
  report: LegacyBookSettingsReport
}

export class LegacyBookSettingsCodec {
  decode(input: string | unknown): DecodedLegacyBookSettings {
    const root = parseJsonValue(input, "Legacy book settings")
    const entriesObject = locateEntries(root)
    const rawEntries = Object.entries(entriesObject)
    if (rawEntries.length > MAX_ENTRIES) throw new Error(`Legacy book settings exceed the ${MAX_ENTRIES}-entry limit.`)

    const entries: LegacyBookSettingsEntry[] = []
    let invalidEntries = 0
    let invalidFields = 0
    let unknownFields = 0
    for (const [rawPath, rawSettings] of rawEntries) {
      const path = PathSchema.safeParse(rawPath)
      if (!path.success || !isRecord(rawSettings)) {
        invalidEntries += 1
        continue
      }
      const overrides: ReaderBookSettingsOverrides = {}
      for (const [key, value] of Object.entries(rawSettings)) {
        switch (key) {
          case "favorite": invalidFields += assign(BooleanSchema, value, (parsed) => { overrides.favorite = parsed }); break
          case "rating": invalidFields += assign(RatingSchema, value, (parsed) => { overrides.rating = parsed }); break
          case "readingDirection": invalidFields += assign(DirectionSchema, value, (parsed) => { overrides.direction = parsed }); break
          case "doublePageView": invalidFields += assign(BooleanSchema, value, (parsed) => { overrides.pageMode = parsed ? "double" : "single" }); break
          case "horizontalBook": invalidFields += assign(BooleanSchema, value, (parsed) => { overrides.horizontalBook = parsed }); break
          default: unknownFields += 1
        }
      }
      if (!Object.keys(overrides).length) {
        invalidEntries += 1
        continue
      }
      entries.push({ path: path.data, overrides })
    }
    return {
      entries,
      report: {
        totalEntries: rawEntries.length,
        validEntries: entries.length,
        invalidEntries,
        invalidFields,
        unknownFields,
      },
    }
  }
}

function locateEntries(root: unknown): Record<string, unknown> {
  if (!isRecord(root)) throw new Error("Legacy book settings must be a JSON object.")
  if (Object.hasOwn(root, STORAGE_KEY)) return requireStorageObject(root[STORAGE_KEY])
  if (looksLikeDirectMap(root)) return root
  const decoded = new LegacySettingsCodec().decode(root, { modules: ["book-settings"] })
  const pending = decoded.pendingData[STORAGE_KEY]
  if (pending === undefined) throw new Error(`Legacy settings do not contain ${STORAGE_KEY}.`)
  return requireStorageObject(pending)
}

function requireStorageObject(value: unknown): Record<string, unknown> {
  const parsed = typeof value === "string" ? parseJsonValue(value, STORAGE_KEY) : value
  if (!isRecord(parsed)) throw new Error(`${STORAGE_KEY} must contain a JSON object.`)
  return parsed
}

function looksLikeDirectMap(value: Record<string, unknown>): boolean {
  const entries = Object.entries(value)
  if (!entries.length) return true
  return entries.every(([path, settings]) => PathSchema.safeParse(path).success && isRecord(settings))
}

function assign<T>(schema: z.ZodType<T>, value: unknown, set: (value: T) => void): 0 | 1 {
  const parsed = schema.safeParse(value)
  if (!parsed.success) return 1
  set(parsed.data)
  return 0
}

function parseJsonValue(value: string | unknown, label: string): unknown {
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value) as unknown
  } catch {
    throw new Error(`${label} is not valid JSON.`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isLegacyAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\") || value.startsWith("/")
}
