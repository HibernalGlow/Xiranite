import type { ReaderThumbnailCategory } from "../../ports/ReaderThumbnailStore.js"
import type { ReadonlySqliteConnection, SqliteBinding } from "../sqlite/openReadonlySqlite.js"
import { legacyThumbnailKeyLikePattern, stableThumbnailKey } from "./ThumbnailKeyIdentity.js"

const THUMBNAIL_COLUMNS = "key, size, date, ghash, category, value"
const FALLBACK_PATTERN_CHUNK_SIZE = 64

export function findStableThumbnailKeyRow(
  key: string,
  readExact: (candidate: string) => Record<string, unknown> | undefined,
  readLegacy: (likePattern: string) => readonly Record<string, unknown>[],
  keyColumn = "key",
): Record<string, unknown> | undefined {
  const stableKey = stableThumbnailKey(key)
  const exact = readExact(stableKey) ?? (stableKey === key ? undefined : readExact(key))
  if (exact) return exact
  return readLegacy(legacyThumbnailKeyLikePattern(stableKey))
    .find((row) => stableRowKey(row, keyColumn) === stableKey)
}

export function readStableThumbnailRows(
  database: Pick<ReadonlySqliteConnection, "all">,
  keys: readonly string[],
  category: ReaderThumbnailCategory,
): ReadonlyMap<string, Record<string, unknown>> {
  const requestedKeys = [...new Set(keys)]
  const stableKeys = [...new Set(requestedKeys.map(stableThumbnailKey))]
  const rowsByStoredKey = rowsByKey(readExactRows(database, stableKeys, category))
  const output = new Map<string, Record<string, unknown>>()

  for (const requestedKey of requestedKeys) {
    const row = rowsByStoredKey.get(stableThumbnailKey(requestedKey))
    if (row) output.set(requestedKey, row)
  }

  const rawKeys = requestedKeys.filter((key) => !output.has(key) && stableThumbnailKey(key) !== key)
  if (rawKeys.length) {
    for (const [storedKey, row] of rowsByKey(readExactRows(database, rawKeys, category))) {
      rowsByStoredKey.set(storedKey, row)
    }
    for (const requestedKey of rawKeys) {
      const row = rowsByStoredKey.get(requestedKey)
      if (row) output.set(requestedKey, row)
    }
  }

  const unresolvedStableKeys = new Set(requestedKeys.filter((key) => !output.has(key)).map(stableThumbnailKey))
  const fallbackRows = new Map<string, Record<string, unknown>>()
  const unresolved = [...unresolvedStableKeys]
  for (let offset = 0; offset < unresolved.length; offset += FALLBACK_PATTERN_CHUNK_SIZE) {
    const chunk = unresolved.slice(offset, offset + FALLBACK_PATTERN_CHUNK_SIZE)
    const where = chunk.map((_, index) => `key LIKE ?${index + 2} ESCAPE '\\'`).join(" OR ")
    const bindings: SqliteBinding[] = [category, ...chunk.map(legacyThumbnailKeyLikePattern)]
    const rows = database.all(
      `SELECT ${THUMBNAIL_COLUMNS} FROM thumbs
       WHERE category = ?1 AND value IS NOT NULL AND (${where})
       ORDER BY date DESC, key ASC`,
      ...bindings,
    )
    for (const row of rows) {
      const stableKey = stableRowKey(row)
      if (unresolvedStableKeys.has(stableKey) && !fallbackRows.has(stableKey)) fallbackRows.set(stableKey, row)
    }
  }
  for (const requestedKey of requestedKeys) {
    if (output.has(requestedKey)) continue
    const row = fallbackRows.get(stableThumbnailKey(requestedKey))
    if (row) output.set(requestedKey, row)
  }
  return output
}

function readExactRows(
  database: Pick<ReadonlySqliteConnection, "all">,
  keys: readonly string[],
  category: ReaderThumbnailCategory,
): Record<string, unknown>[] {
  if (!keys.length) return []
  const placeholders = keys.map((_, index) => `?${index + 2}`).join(", ")
  const bindings: SqliteBinding[] = [category, ...keys]
  return database.all(
    `SELECT ${THUMBNAIL_COLUMNS} FROM thumbs
     WHERE category = ?1 AND value IS NOT NULL AND key IN (${placeholders})`,
    ...bindings,
  )
}

function rowsByKey(rows: readonly Record<string, unknown>[]): Map<string, Record<string, unknown>> {
  return new Map(rows.map((row) => [storedRowKey(row), row]))
}

function stableRowKey(row: Record<string, unknown>, column = "key"): string {
  return stableThumbnailKey(storedRowKey(row, column))
}

function storedRowKey(row: Record<string, unknown>, column = "key"): string {
  const key = row[column]
  if (typeof key !== "string") throw new Error(`${column} must be text.`)
  return key
}
