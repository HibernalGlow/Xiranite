import type { ReaderDirectoryEmmRecord, ReaderDirectoryEmmRecordStore } from "../../ports/ReaderDirectoryEmmRecordStore.js"
import type { ReaderEmmCatalogTag, ReaderEmmTagCatalogStore } from "../../ports/ReaderEmmTagCatalogStore.js"
import { openReadonlySqlite, type ReadonlySqliteConnection } from "../sqlite/openReadonlySqlite.js"

type ExternalEmmStore = ReaderDirectoryEmmRecordStore & ReaderEmmTagCatalogStore & { close(): void }

export async function openReadonlyLegacyEmmRecordStore(paths: readonly string[]): Promise<ExternalEmmStore | undefined> {
  if (!paths.length) return undefined
  const databases: ReadonlySqliteConnection[] = []
  try {
    for (const path of paths) {
      const database = await openReadonlySqlite(path)
      const hasMangas = database.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Mangas'")
      if (hasMangas) databases.push(database)
      else database.close()
    }
  } catch (error) {
    for (const database of databases) database.close()
    throw error
  }
  if (!databases.length) return undefined

  return {
    directoryEmmAvailable: true,
    async readDirectoryEmmRecords(paths, signal) {
      const output = new Map<string, ReaderDirectoryEmmRecord>()
      const requested = new Map(paths.map((path) => [normalizePath(path), path]))
      const queryPaths = [...requested.keys()].map(toEmmPath)
      for (let cursor = 0; cursor < queryPaths.length; cursor += 256) {
        signal?.throwIfAborted()
        const batch = queryPaths.slice(cursor, cursor + 256)
        const placeholders = batch.map((_, index) => `?${index + 1}`).join(", ")
        for (const database of databases) {
          for (const row of database.all(
            `SELECT filepath, rating, tags, pageCount FROM Mangas WHERE filepath COLLATE NOCASE IN (${placeholders})`,
            ...batch,
          )) {
            if (typeof row.filepath !== "string") continue
            const normalized = normalizePath(row.filepath)
            const original = requested.get(normalized)
            if (original && !output.has(original)) output.set(original, recordFromRow(row))
          }
        }
      }
      return output
    },
    async sampleEmmTags(count, signal) {
      signal?.throwIfAborted()
      const catalog = new Map<string, ReaderEmmCatalogTag>()
      for (const database of databases) {
        for (const row of database.all("SELECT tags FROM Mangas WHERE tags IS NOT NULL ORDER BY random() LIMIT 50")) {
          for (const tag of parseTags(row.tags)) {
            catalog.set(`${tag.namespace.toLocaleLowerCase()}\0${tag.tag.toLocaleLowerCase()}`, { category: tag.namespace, tag: tag.tag })
            if (catalog.size >= count) return [...catalog.values()]
          }
        }
      }
      return [...catalog.values()]
    },
    close() {
      for (const database of databases) database.close()
      databases.length = 0
    },
  }
}

function recordFromRow(row: Record<string, unknown>): ReaderDirectoryEmmRecord {
  const tags = parseTags(row.tags)
  const pageCount = finiteNumber(row.pageCount)
  const rating = finiteNumber(row.rating)
  return {
    emmJson: JSON.stringify({ ...(tags.length ? { tags } : {}), ...(pageCount === undefined ? {} : { page_count: pageCount }) }),
    ...(rating === undefined ? {} : { ratingData: JSON.stringify({ value: rating, source: "legacy-emm" }) }),
  }
}

function parseTags(value: unknown): { namespace: string; tag: string }[] {
  if (typeof value !== "string") return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return []
    const output: { namespace: string; tag: string }[] = []
    for (const [namespace, tags] of Object.entries(parsed)) {
      if (!Array.isArray(tags)) continue
      for (const tag of tags) {
        if (typeof tag !== "string") continue
        const normalized = tag.trim()
        if (namespace.trim() && normalized && namespace.length <= 128 && normalized.length <= 256) output.push({ namespace: namespace.trim(), tag: normalized })
        if (output.length >= 256) return output
      }
    }
    return output
  } catch {
    return []
  }
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function normalizePath(value: string): string {
  return value.split("::", 1)[0]!.trim().replaceAll("\\", "/").toLocaleLowerCase()
}

function toEmmPath(value: string): string {
  return value.replaceAll("/", "\\")
}
