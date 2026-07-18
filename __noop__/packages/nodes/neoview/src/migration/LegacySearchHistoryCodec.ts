import { z } from "zod"

import type { ReaderSearchHistoryScope } from "../application/browser/ReaderSearchHistoryService.js"
import { LegacySettingsCodec } from "./LegacySettingsCodec.js"

const RAW_STORAGE_SCOPES: Readonly<Record<string, ReaderSearchHistoryScope>> = {
  "neoview-folder-search-history": "folder",
  "neoview-file-search-history": "file",
  "neoview-bookmark-search-history": "bookmark",
  "neoview-history-search-history": "history",
}
const historyArraySchema = z.array(z.unknown())
const historyObjectSchema = z.object({ query: z.string(), timestamp: z.number() })

export interface LegacySearchHistoryEntry {
  scope: ReaderSearchHistoryScope
  query: string
  usedAt: number
}

export interface DecodedLegacySearchHistory {
  entries: readonly LegacySearchHistoryEntry[]
  scopes: readonly ReaderSearchHistoryScope[]
  issues: readonly { sourcePath: string; message: string }[]
}

/** Decodes only legacy search-history runtime data; it never creates a TOML patch. */
export class LegacySearchHistoryCodec {
  constructor(private readonly clock: () => number = Date.now) {}

  decode(input: string | unknown): DecodedLegacySearchHistory {
    const pending = new LegacySettingsCodec().decode(input, { modules: ["search-history"] }).pendingData
    const candidates = new Map<ReaderSearchHistoryScope, { sourcePath: string; value: unknown }>()
    const extended = record(pending.searchHistory)
    if (extended) {
      for (const scope of ["folder", "file", "bookmark", "history"] as const) {
        if (scope in extended) candidates.set(scope, { sourcePath: `extended.searchHistory.${scope}`, value: extended[scope] })
      }
    }
    for (const [key, scope] of Object.entries(RAW_STORAGE_SCOPES)) {
      if (key in pending) candidates.set(scope, { sourcePath: `rawLocalStorage.${key}`, value: pending[key] })
    }

    const entries: LegacySearchHistoryEntry[] = []
    const scopes: ReaderSearchHistoryScope[] = []
    const issues: Array<{ sourcePath: string; message: string }> = []
    const now = this.clock()
    if (!Number.isSafeInteger(now) || now < 0) throw new Error("Legacy search history clock is invalid.")
    for (const [scope, candidate] of candidates) {
      const value = parseStorageValue(candidate.value, candidate.sourcePath, issues)
      const parsed = historyArraySchema.safeParse(value)
      if (!parsed.success) {
        issues.push({ sourcePath: candidate.sourcePath, message: "Expected a JSON array." })
        continue
      }
      scopes.push(scope)
      const seen = new Set<string>()
      for (const [index, item] of parsed.data.entries()) {
        const sourcePath = `${candidate.sourcePath}[${index}]`
        const decoded = decodeItem(item, Math.max(0, now - 86_400_000 - index), sourcePath, issues)
        if (!decoded || seen.has(decoded.query)) continue
        seen.add(decoded.query)
        if (entries.filter((entry) => entry.scope === scope).length < 20) entries.push({ scope, ...decoded })
      }
    }
    return { entries, scopes, issues }
  }
}

function decodeItem(
  value: unknown,
  fallbackTimestamp: number,
  sourcePath: string,
  issues: Array<{ sourcePath: string; message: string }>,
): { query: string; usedAt: number } | undefined {
  let query: string
  let usedAt = fallbackTimestamp
  if (typeof value === "string") {
    query = value
  } else {
    const parsed = historyObjectSchema.safeParse(value)
    if (!parsed.success || !Number.isSafeInteger(parsed.data.timestamp) || parsed.data.timestamp < 0) {
      issues.push({ sourcePath, message: "Expected a query string or { query, timestamp } with a non-negative safe integer timestamp." })
      return undefined
    }
    query = parsed.data.query
    usedAt = parsed.data.timestamp
  }
  query = query.trim()
  if (!query || query.length > 512 || query.includes("\0")) {
    issues.push({ sourcePath, message: "Query must be 1..512 characters without NUL." })
    return undefined
  }
  return { query, usedAt }
}

function parseStorageValue(
  value: unknown,
  sourcePath: string,
  issues: Array<{ sourcePath: string; message: string }>,
): unknown {
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value) as unknown
  } catch {
    issues.push({ sourcePath, message: "Expected JSON-encoded localStorage history." })
    return undefined
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
