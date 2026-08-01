import type { ViewSource } from "../../domain/book/book.js"
import type { ReaderSourceRelocationResult } from "../../ports/ReaderLibraryStore.js"
import { readerBookIdForSource } from "../books/ReaderSourceIdentity.js"
import type { WritableSqliteConnection } from "../sqlite/openWritableSqlite.js"

interface SourceRow {
  identity: string
  sourceJson: string
}

export function migrateStableReaderSourceIdentities(database: WritableSqliteConnection): number {
  const rows = database.all(
    "SELECT book_id, source_json FROM xr_reader_progress WHERE source_json LIKE '%[CM%'",
  )
  let migrated = 0
  for (const row of rows) {
    const identity = text(row.book_id)
    const sourceJson = text(row.source_json)
    const source = sourceJson && tryParseStoredReaderSource(sourceJson)
    if (!identity || !source || readerBookIdForSource(source) === identity) continue
    mergeBookIdentity(database, identity, readerBookIdForSource(source))
    migrated += 1
  }
  return migrated
}

export function relocateReaderSourcePath(
  database: WritableSqliteConnection,
  sourcePath: string,
  destinationPath: string,
  platform: NodeJS.Platform,
): ReaderSourceRelocationResult {
  const sourceKey = normalizePath(sourcePath, platform)
  const destinationKey = normalizePath(destinationPath, platform)
  if (!sourceKey || !destinationKey || sourceKey === destinationKey) {
    throw new Error("Reader source relocation paths must be distinct and non-empty.")
  }

  const result: ReaderSourceRelocationResult = {
    progress: 0,
    bookmarks: 0,
    playlistEntries: 0,
    pathStacks: 0,
    folderSortRules: 0,
    emmOverrides: 0,
    folderRatings: 0,
  }
  const identityMoves: Array<readonly [string, string]> = []

  for (const row of sourceRows(database, "xr_reader_progress", "book_id")) {
    const source = tryParseStoredReaderSource(row.sourceJson)
    if (!source || normalizePath(source.path, platform) !== sourceKey) continue
    const relocated = { ...source, path: destinationPath } as ViewSource
    database.run(
      "UPDATE xr_reader_progress SET source_json = ?2, display_name = ?3 WHERE book_id = ?1",
      row.identity,
      JSON.stringify(relocated),
      filename(destinationPath),
    )
    result.progress += 1
    const destinationIdentity = readerBookIdForSource(relocated)
    if (row.identity !== destinationIdentity) identityMoves.push([row.identity, destinationIdentity])
  }

  result.bookmarks = relocateSourceJsonRows(
    database,
    "xr_reader_bookmarks",
    ["id"],
    sourceKey,
    destinationPath,
    platform,
    true,
  )
  result.playlistEntries = relocateSourceJsonRows(
    database,
    "xr_reader_playlist_entries",
    ["playlist_id", "id"],
    sourceKey,
    destinationPath,
    platform,
    true,
  )
  result.pathStacks = relocatePathStacks(database, sourceKey, destinationPath, platform)

  for (const [sourceIdentity, destinationIdentity] of identityMoves) {
    mergeBookIdentity(database, sourceIdentity, destinationIdentity)
  }

  const sourceSortKey = normalizeSortPath(sourcePath)
  const destinationSortKey = normalizeSortPath(destinationPath)
  result.folderSortRules = relocateKeyedRow(database, {
    table: "xr_reader_folder_sort_rules",
    sourceKey: sourceSortKey,
    destinationKey: destinationSortKey,
    destinationPath,
    columns: "sort_field, sort_order, directories_first, updated_at",
    newer: "excluded.updated_at > xr_reader_folder_sort_rules.updated_at",
  })
  const sourceEmmKey = normalizeEmmPath(sourcePath)
  const destinationEmmKey = normalizeEmmPath(destinationPath)
  result.emmOverrides = relocateKeyedRow(database, {
    table: "xr_reader_emm_overrides",
    sourceKey: sourceEmmKey,
    destinationKey: destinationEmmKey,
    destinationPath,
    columns: "overrides_json, revision, updated_at",
    newer: "excluded.updated_at > xr_reader_emm_overrides.updated_at OR (excluded.updated_at = xr_reader_emm_overrides.updated_at AND excluded.revision > xr_reader_emm_overrides.revision)",
  })
  result.folderRatings = relocateKeyedRow(database, {
    table: "xr_reader_folder_ratings",
    sourceKey: sourceEmmKey,
    destinationKey: destinationEmmKey,
    destinationPath,
    columns: "average_rating, entry_count, direct, updated_at",
    newer: "excluded.updated_at > xr_reader_folder_ratings.updated_at",
  })
  return result
}

function mergeBookIdentity(database: WritableSqliteConnection, sourceIdentity: string, destinationIdentity: string): void {
  if (sourceIdentity === destinationIdentity) return
  database.run(
    `INSERT INTO xr_reader_progress (book_id, source_json, display_name, page_index, page_count, updated_at)
     SELECT ?2, source_json, display_name, page_index, page_count, updated_at
     FROM xr_reader_progress WHERE book_id = ?1
     ON CONFLICT(book_id) DO UPDATE SET source_json = excluded.source_json,
       display_name = excluded.display_name, page_index = excluded.page_index,
       page_count = excluded.page_count, updated_at = excluded.updated_at
     WHERE excluded.updated_at > xr_reader_progress.updated_at`,
    sourceIdentity,
    destinationIdentity,
  )
  mergeBookKeyedRow(database, "xr_reader_book_settings", sourceIdentity, destinationIdentity,
    "favorite, rating, reading_direction, page_mode, horizontal_book, revision, updated_at",
    "excluded.updated_at > xr_reader_book_settings.updated_at OR (excluded.updated_at = xr_reader_book_settings.updated_at AND excluded.revision > xr_reader_book_settings.revision)")
  mergeBookKeyedRow(database, "xr_reader_media_progress", sourceIdentity, destinationIdentity,
    "position, duration, completed, updated_at", "excluded.updated_at > xr_reader_media_progress.updated_at")
  mergeBookKeyedRow(database, "xr_reader_path_stacks", sourceIdentity, destinationIdentity,
    "path_stack_json, updated_at", "excluded.updated_at > xr_reader_path_stacks.updated_at")
  database.run("DELETE FROM xr_reader_progress WHERE book_id = ?1", sourceIdentity)
}

function mergeBookKeyedRow(
  database: WritableSqliteConnection,
  table: string,
  sourceIdentity: string,
  destinationIdentity: string,
  columns: string,
  newer: string,
): void {
  database.run(
    `INSERT INTO ${table} (book_id, ${columns})
     SELECT ?2, ${columns} FROM ${table} WHERE book_id = ?1
     ON CONFLICT(book_id) DO UPDATE SET ${columns.split(", ").map((column) => `${column} = excluded.${column}`).join(", ")}
     WHERE ${newer}`,
    sourceIdentity,
    destinationIdentity,
  )
  database.run(`DELETE FROM ${table} WHERE book_id = ?1`, sourceIdentity)
}

function sourceRows(database: WritableSqliteConnection, table: string, identity: string): SourceRow[] {
  return database.all(`SELECT ${identity} AS identity, source_json FROM ${table}`).flatMap((row) => {
    const rowIdentity = text(row.identity)
    const sourceJson = text(row.source_json)
    return rowIdentity && sourceJson ? [{ identity: rowIdentity, sourceJson }] : []
  })
}

function relocateSourceJsonRows(
  database: WritableSqliteConnection,
  table: string,
  identityColumns: readonly string[],
  sourceKey: string,
  destinationPath: string,
  platform: NodeJS.Platform,
  updateName: boolean,
): number {
  let changed = 0
  for (const row of database.all(`SELECT ${identityColumns.join(", ")}, source_json FROM ${table}`)) {
    const sourceJson = text(row.source_json)
    const source = sourceJson && tryParseStoredReaderSource(sourceJson)
    if (!source || normalizePath(source.path, platform) !== sourceKey) continue
    const bindings = identityColumns.flatMap((column) => text(row[column]) ?? [])
    if (bindings.length !== identityColumns.length) continue
    const predicate = identityColumns.map((column, index) => `${column} = ?${index + 1}`).join(" AND ")
    database.run(
      `UPDATE ${table} SET source_json = ?${bindings.length + 1}${updateName ? `, name = ?${bindings.length + 2}` : ""} WHERE ${predicate}`,
      ...bindings,
      JSON.stringify({ ...source, path: destinationPath }),
      ...(updateName ? [filename(destinationPath)] : []),
    )
    changed += 1
  }
  return changed
}

function relocatePathStacks(
  database: WritableSqliteConnection,
  sourceKey: string,
  destinationPath: string,
  platform: NodeJS.Platform,
): number {
  let changed = 0
  for (const row of database.all("SELECT book_id, path_stack_json FROM xr_reader_path_stacks")) {
    const bookId = text(row.book_id)
    const encoded = text(row.path_stack_json)
    if (!bookId || !encoded) continue
    let stack: unknown
    try { stack = JSON.parse(encoded) } catch { continue }
    if (!Array.isArray(stack)) continue
    let relocated = false
    const next = stack.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry
      const candidate = entry as Record<string, unknown>
      if (typeof candidate.path !== "string" || normalizePath(candidate.path, platform) !== sourceKey) return entry
      relocated = true
      return { ...candidate, path: destinationPath }
    })
    if (!relocated) continue
    database.run("UPDATE xr_reader_path_stacks SET path_stack_json = ?2 WHERE book_id = ?1", bookId, JSON.stringify(next))
    changed += 1
  }
  return changed
}

function relocateKeyedRow(database: WritableSqliteConnection, options: {
  table: string
  sourceKey: string
  destinationKey: string
  destinationPath: string
  columns: string
  newer: string
}): number {
  if (options.sourceKey === options.destinationKey) return 0
  const exists = database.get(`SELECT 1 AS found FROM ${options.table} WHERE path_key = ?1`, options.sourceKey)
  if (!exists) return 0
  database.run(
    `INSERT INTO ${options.table} (path_key, display_path, ${options.columns})
     SELECT ?2, ?3, ${options.columns} FROM ${options.table} WHERE path_key = ?1
     ON CONFLICT(path_key) DO UPDATE SET display_path = excluded.display_path,
       ${options.columns.split(", ").map((column) => `${column} = excluded.${column}`).join(", ")}
     WHERE ${options.newer}`,
    options.sourceKey,
    options.destinationKey,
    options.destinationPath,
  )
  database.run(`DELETE FROM ${options.table} WHERE path_key = ?1`, options.sourceKey)
  return 1
}

export function parseStoredReaderSource(value: unknown): ViewSource {
  const source = typeof value === "string" ? tryParseStoredReaderSource(value) : undefined
  if (!source) throw new Error("Stored reader source is invalid.")
  return source
}

function tryParseStoredReaderSource(value: string): ViewSource | undefined {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { return undefined }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
  const source = parsed as Record<string, unknown>
  if (typeof source.path !== "string" || !source.path) return undefined
  if (source.kind === "path" || source.kind === "directory" || source.kind === "image" || source.kind === "media") return source as unknown as ViewSource
  if (source.kind === "document" && (source.format === "pdf" || source.format === "epub")) return source as unknown as ViewSource
  if (source.kind === "archive"
    && (source.entryPath === undefined || typeof source.entryPath === "string")
    && (source.entryPaths === undefined || (Array.isArray(source.entryPaths) && source.entryPaths.every((entry) => typeof entry === "string")))) {
    return source as unknown as ViewSource
  }
  return undefined
}

function normalizePath(path: string, platform: NodeJS.Platform): string {
  const normalized = path.trim().replaceAll("\\", "/")
  return platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized
}

function normalizeSortPath(path: string): string {
  return path.replaceAll("\\", "/").toLocaleLowerCase("en-US")
}

function normalizeEmmPath(path: string): string {
  return path.replaceAll("\\", "/").toLocaleLowerCase("en-US")
}

function filename(path: string): string {
  return path.replace(/[\\/]+$/u, "").split(/[\\/]/u).at(-1) || path
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined
}
