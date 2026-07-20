import {
  LegacySuperResolutionSettingsCodec,
  parseSuperResolutionPreferences,
} from "@xiranite/node-neoview/super-resolution"

import type { ReaderSuperResolutionConditionDto } from "../../../adapters/reader-http-client"

export interface UpscaleConditionImportResult {
  conditions: ReaderSuperResolutionConditionDto[]
  warnings: string[]
}

export function parseUpscaleConditionImport(text: string): UpscaleConditionImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`Invalid condition JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  const value = unwrapConditions(parsed)
  if (!Array.isArray(value) || value.length === 0) throw new Error("Condition backup must contain a non-empty array.")
  return isLegacyConditionArray(value) ? convertLegacyConditions(value) : {
    conditions: normalizeCurrentConditions(value),
    warnings: [],
  }
}

function unwrapConditions(value: unknown): unknown {
  if (Array.isArray(value)) return value
  if (!isRecord(value)) return value
  if (Array.isArray(value.conditions)) return value.conditions
  if (Array.isArray(value.conditionsList)) return value.conditionsList
  if (isRecord(value.preferences) && Array.isArray(value.preferences.conditions)) return value.preferences.conditions
  if (isRecord(value.superResolution)
    && isRecord(value.superResolution.preferences)
    && Array.isArray(value.superResolution.preferences.conditions)) return value.superResolution.preferences.conditions
  return value
}

function isLegacyConditionArray(value: readonly unknown[]): boolean {
  return value.some((item) => {
    if (!isRecord(item)) return false
    const match = isRecord(item.match) ? item.match : {}
    const action = isRecord(item.action) ? item.action : {}
    return "minPixels" in match || "maxPixels" in match || "regexBookPath" in match || "regexImagePath" in match
      || "model" in action || "modelName" in action || "noiseLevel" in action
  })
}

function convertLegacyConditions(value: readonly unknown[]): UpscaleConditionImportResult {
  const decoded = new LegacySuperResolutionSettingsCodec().decodePanel({ conditionsList: value }, "conditions-backup")
  const preferences = parseSuperResolutionPreferences(decoded.preferencesPatch)
  const warnings = decoded.entries
    .filter((entry) => (entry.disposition === "invalid" || entry.disposition === "unknown") && entry.message)
    .map((entry) => `${entry.sourcePath}: ${entry.message}`)
  const conditions = preferences.conditions.map((condition, priority) => ({ ...condition, priority }))
  if (!conditions.length) throw new Error(warnings[0] ?? "No compatible conditions were found in the backup.")
  return { conditions, warnings }
}

function normalizeCurrentConditions(value: readonly unknown[]): ReaderSuperResolutionConditionDto[] {
  return value.map((item, priority) => {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.name !== "string"
      || typeof item.enabled !== "boolean" || !isRecord(item.match) || !isRecord(item.action)) {
      throw new Error(`Condition ${priority + 1} has incomplete fields.`)
    }
    const action = item.action as ReaderSuperResolutionConditionDto["action"]
    if (action.skip !== true && typeof action.modelId !== "string") {
      throw new Error(`Condition ${priority + 1} requires action.modelId unless it skips upscale.`)
    }
    return {
      ...(item as unknown as ReaderSuperResolutionConditionDto),
      priority,
      match: { dimensionMode: "and", ...(item.match as ReaderSuperResolutionConditionDto["match"]) },
      action: { skip: false, ...action },
    }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
