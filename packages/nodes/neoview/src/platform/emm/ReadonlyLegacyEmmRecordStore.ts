import type { ReaderDirectoryEmmRecord, ReaderDirectoryEmmRecordStore, ReaderEmmRawField, ReaderEmmRawFieldType } from "../../ports/ReaderDirectoryEmmRecordStore.js"
import type { ReaderEmmCatalogTag, ReaderEmmTagCatalogStore } from "../../ports/ReaderEmmTagCatalogStore.js"
import { openReadonlySqlite, type ReadonlySqliteConnection } from "../sqlite/openReadonlySqlite.js"

type ExternalEmmStore = ReaderDirectoryEmmRecordStore & ReaderEmmTagCatalogStore & { close(): void }

const RAW_FIELD_TYPES = new Map<string, ReaderEmmRawFieldType>([
  ["bundlesize", "bytes"], ["category", "string"], ["coverhash", "string"], ["coverpath", "path"],
  ["createdat", "datetime"], ["updatedat", "datetime"], ["mtime", "datetime"], ["exist", "boolean"],
  ["filecount", "number"], ["filepath", "path"], ["filesize", "bytes"], ["hash", "string"],
  ["hiddenbook", "boolean"], ["id", "number"], ["mark", "number"], ["pagecount", "number"],
  ["posted", "timestamp"], ["readcount", "number"], ["title", "string"], ["title_jpn", "string"],
  ["type", "string"], ["url", "url"], ["rating", "number"], ["status", "string"], ["date", "datetime"],
  ["tags", "string"],
])
const MAX_RAW_FIELDS = 64
const MAX_RAW_STRING_LENGTH = 4_096

export async function openReadonlyLegacyEmmRecordStore(paths: readonly string[]): Promise<ExternalEmmStore | undefined> {
  if (!paths.length) return undefined
  const databases: Array<{ connection: ReadonlySqliteConnection; rawColumns: readonly string[] }> = []
  try {
    for (const path of paths) {
      const database = await openReadonlySqlite(path)
      const hasMangas = database.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Mangas'")
      if (hasMangas) databases.push({ connection: database, rawColumns: discoverRawColumns(database) })
      else database.close()
    }
  } catch (error) {
    for (const { connection } of databases) connection.close()
    throw error
  }
  if (!databases.length) return undefined

  return {
    directoryEmmAvailable: true,
    async readDirectoryEmmRecords(paths, signal, options) {
      const output = new Map<string, ReaderDirectoryEmmRecord>()
      const requested = new Map(paths.map((path) => [normalizePath(path), path]))
      const queryPaths = [...requested.keys()].map(toEmmPath)
      for (let cursor = 0; cursor < queryPaths.length; cursor += 256) {
        signal?.throwIfAborted()
        const batch = queryPaths.slice(cursor, cursor + 256)
        const placeholders = batch.map((_, index) => `?${index + 1}`).join(", ")
        for (const { connection, rawColumns } of databases) {
          const columns = options?.includeRaw ? rawColumns : ["filepath", "rating", "tags", "pageCount"]
          for (const row of connection.all(
            `SELECT ${columns.map(quoteIdentifier).join(", ")} FROM Mangas WHERE filepath COLLATE NOCASE IN (${placeholders})`,
            ...batch,
          )) {
            if (typeof row.filepath !== "string") continue
            const normalized = normalizePath(row.filepath)
            const original = requested.get(normalized)
            if (original && !output.has(original)) output.set(original, recordFromRow(row, options?.includeRaw ? rawColumns : undefined))
          }
        }
      }
      return output
    },
    async sampleEmmTags(count, signal) {
      signal?.throwIfAborted()
      const catalog = new Map<string, ReaderEmmCatalogTag>()
      for (const { connection } of databases) {
        for (const row of connection.all("SELECT tags FROM Mangas WHERE tags IS NOT NULL ORDER BY random() LIMIT 50")) {
          for (const tag of parseTags(row.tags)) {
            catalog.set(`${tag.namespace.toLocaleLowerCase()}\0${tag.tag.toLocaleLowerCase()}`, { category: tag.namespace, tag: tag.tag })
            if (catalog.size >= count) return [...catalog.values()]
          }
        }
      }
      return [...catalog.values()]
    },
    close() {
      for (const { connection } of databases) connection.close()
      databases.length = 0
    },
  }
}

function recordFromRow(row: Record<string, unknown>, rawColumns?: readonly string[]): ReaderDirectoryEmmRecord {
  const tags = parseTags(row.tags)
  const pageCount = finiteNumber(row.pageCount)
  const rating = finiteNumber(row.rating)
  return {
    emmJson: JSON.stringify({ ...(tags.length ? { tags } : {}), ...(pageCount === undefined ? {} : { page_count: pageCount }) }),
    ...(rating === undefined ? {} : { ratingData: JSON.stringify({ value: rating, source: "legacy-emm" }) }),
    ...(rawColumns ? { rawFields: rawFieldsFromRow(row, rawColumns) } : {}),
  }
}

function discoverRawColumns(database: ReadonlySqliteConnection): readonly string[] {
  const available = new Map(database.all("PRAGMA table_info(Mangas)").flatMap((row) => {
    const name = typeof row.name === "string" ? row.name : undefined
    return name && RAW_FIELD_TYPES.has(name.toLocaleLowerCase()) ? [[name.toLocaleLowerCase(), name] as const] : []
  }))
  const ordered = [...RAW_FIELD_TYPES.keys()].flatMap((key) => available.get(key) ? [available.get(key)!] : [])
  return ordered.slice(0, MAX_RAW_FIELDS)
}

function rawFieldsFromRow(row: Record<string, unknown>, columns: readonly string[]): ReaderEmmRawField[] {
  return columns.flatMap((key) => {
    const type = RAW_FIELD_TYPES.get(key.toLocaleLowerCase())
    const value = rawScalar(row[key], type)
    return type && value !== undefined ? [{ key, type, value }] : []
  }).sort((left, right) => left.key.localeCompare(right.key, "en-US"))
}

function rawScalar(value: unknown, type: ReaderEmmRawFieldType | undefined): string | number | boolean | undefined {
  if (!type || value === null || value === undefined) return undefined
  if (type === "boolean") {
    if (value === true || value === false) return value
    if (value === 0 || value === 1) return value === 1
  }
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "bigint") return value >= Number.MIN_SAFE_INTEGER && value <= Number.MAX_SAFE_INTEGER ? Number(value) : String(value)
  if (typeof value === "string") return value.slice(0, MAX_RAW_STRING_LENGTH)
  return undefined
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
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
