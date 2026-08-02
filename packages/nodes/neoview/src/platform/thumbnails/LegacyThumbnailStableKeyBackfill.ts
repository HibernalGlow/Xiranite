import type { WritableSqliteConnection } from "../sqlite/openWritableSqlite.js"
import { stableThumbnailKey } from "./ThumbnailKeyIdentity.js"

type RunTransaction = (operation: () => void, resourceKind: string) => Promise<void>

export async function backfillStableThumbnailRows(
  database: WritableSqliteConnection,
  rows: Iterable<Record<string, unknown>>,
  runTransaction: RunTransaction,
): Promise<void> {
  const copies = new Map<string, string>()
  for (const row of rows) {
    const sourceKey = rowKey(row, "thumbs.key")
    const stableKey = stableThumbnailKey(sourceKey)
    if (stableKey !== sourceKey && !copies.has(stableKey)) copies.set(stableKey, sourceKey)
  }
  if (!copies.size) return
  await runTransaction(() => {
    for (const [stableKey, sourceKey] of copies) {
      database.run(
        `INSERT INTO thumbs (key, size, date, ghash, category, value, emm_json, rating_data, ai_translation, manual_tags)
         SELECT ?1, size, date, ghash, category, value, emm_json, rating_data, ai_translation, manual_tags
         FROM thumbs WHERE key = ?2
         ON CONFLICT(key) DO NOTHING`,
        stableKey,
        sourceKey,
      )
    }
  }, "neoview.thumbnail.stable-key-backfill")
}

export async function backfillStableFailureRow(
  database: WritableSqliteConnection,
  row: Record<string, unknown>,
  runTransaction: RunTransaction,
): Promise<void> {
  const sourceKey = rowKey(row, "failed_thumbnails.key")
  const stableKey = stableThumbnailKey(sourceKey)
  if (stableKey === sourceKey) return
  await runTransaction(() => {
    database.run(
      `INSERT INTO failed_thumbnails (key, reason, retry_count, last_attempt, error_message)
       SELECT ?1, reason, retry_count, last_attempt, error_message FROM failed_thumbnails WHERE key = ?2
       ON CONFLICT(key) DO NOTHING`,
      stableKey,
      sourceKey,
    )
    database.run("DELETE FROM failed_thumbnails WHERE key = ?1", sourceKey)
  }, "neoview.thumbnail.failure-stable-key-backfill")
}

function rowKey(row: Record<string, unknown>, label: string): string {
  if (typeof row.key !== "string") throw new Error(`${label} must be text.`)
  return row.key
}
