import { createClient, type Client, type InValue, type Row } from "@libsql/client"
import { withXiraniteFileLock } from "@xiranite/config"
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import type {
  MelodeckLibraryTrackRecord,
  MelodeckLibraryTrackWithMetadata,
  MelodeckRepository,
  MelodeckTrackMetadataRecord,
} from "./melodeck.js"

export interface LibsqlMelodeckRepositoryOptions {
  url: string
  authToken?: string
}

export interface LibsqlMelodeckRepository extends MelodeckRepository {
  client: Client
}

const LOCAL_LIBSQL_BUSY_TIMEOUT_MS = 5_000
const LIBRARY_INSERT_CHUNK_SIZE = 100

export async function createLibsqlMelodeckRepository(
  options: LibsqlMelodeckRepositoryOptions,
): Promise<LibsqlMelodeckRepository> {
  const client = createClient({ url: options.url, authToken: options.authToken })
  if (localLibsqlPath(options.url)) {
    await client.execute(`PRAGMA busy_timeout = ${LOCAL_LIBSQL_BUSY_TIMEOUT_MS}`)
  }
  await initializeSchema(client, options.url)

  return {
    client,
    async loadLibrary() {
      const [stateResult, tracksResult] = await Promise.all([
        client.execute("SELECT updated_at FROM melodeck_library_state WHERE id = 1"),
        client.execute(`SELECT
          library.path_key,
          library.path,
          library.title,
          library.artist,
          library.file_name,
          library.relative_path,
          library.file_size,
          library.last_modified,
          library.mime_type,
          library.sort_order,
          metadata.file_size AS metadata_file_size,
          metadata.last_modified AS metadata_last_modified,
          metadata.title AS metadata_title,
          metadata.artist AS metadata_artist,
          metadata.album AS metadata_album,
          metadata.duration AS metadata_duration,
          metadata.replay_gain_track_db,
          metadata.replay_gain_album_db,
          metadata.lyrics_hydrated,
          metadata.cover_data IS NOT NULL AS metadata_has_cover,
          metadata.updated_at AS metadata_updated_at
        FROM melodeck_library_tracks AS library
        LEFT JOIN melodeck_track_metadata AS metadata
          ON metadata.path_key = library.path_key
          AND metadata.file_size = library.file_size
          AND metadata.last_modified = library.last_modified
        ORDER BY library.sort_order ASC, library.path ASC`),
      ])
      return {
        initialized: stateResult.rows.length > 0,
        tracks: tracksResult.rows.map(toLibraryTrack),
      }
    },
    async replaceLibrary(tracks, updatedAt) {
      const transaction = await client.transaction("write")
      try {
        await transaction.execute("DELETE FROM melodeck_library_tracks")
        for (let start = 0; start < tracks.length; start += LIBRARY_INSERT_CHUNK_SIZE) {
          const chunk = tracks.slice(start, start + LIBRARY_INSERT_CHUNK_SIZE)
          const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ")
          const args = chunk.flatMap<InValue>((track) => [
            track.key,
            track.path,
            track.title,
            track.artist ?? null,
            track.fileName ?? null,
            track.relativePath ?? null,
            finiteInteger(track.fileSize),
            finiteInteger(track.lastModified),
            track.mimeType ?? null,
            track.sortOrder,
          ])
          await transaction.execute({
            sql: `INSERT INTO melodeck_library_tracks (
              path_key, path, title, artist, file_name, relative_path, file_size, last_modified, mime_type, sort_order
            ) VALUES ${placeholders}`,
            args,
          })
        }
        await transaction.execute({
          sql: `INSERT INTO melodeck_library_state (id, updated_at) VALUES (1, ?)
            ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
          args: [updatedAt],
        })
        await transaction.execute(`DELETE FROM melodeck_track_metadata
          WHERE path_key NOT IN (SELECT path_key FROM melodeck_library_tracks)`)
        await transaction.commit()
      } catch (error) {
        await transaction.rollback().catch(() => undefined)
        throw error
      }
    },
    async getMetadata(key) {
      const result = await client.execute({
        sql: `SELECT path_key, path, file_size, last_modified, title, artist, album, duration,
          replay_gain_track_db, replay_gain_album_db, lyrics_json, lyrics_hydrated,
          cover_mime_type, cover_data, updated_at
        FROM melodeck_track_metadata WHERE path_key = ? LIMIT 1`,
        args: [key],
      })
      const row = result.rows[0]
      return row ? toMetadata(row) : undefined
    },
    async saveMetadata(metadata) {
      await client.batch([{
        sql: `INSERT INTO melodeck_track_metadata (
          path_key, path, file_size, last_modified, title, artist, album, duration,
          replay_gain_track_db, replay_gain_album_db, lyrics_json, lyrics_hydrated,
          cover_mime_type, cover_data, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(path_key) DO UPDATE SET
          path = excluded.path,
          file_size = excluded.file_size,
          last_modified = excluded.last_modified,
          title = excluded.title,
          artist = excluded.artist,
          album = excluded.album,
          duration = excluded.duration,
          replay_gain_track_db = excluded.replay_gain_track_db,
          replay_gain_album_db = excluded.replay_gain_album_db,
          lyrics_json = excluded.lyrics_json,
          lyrics_hydrated = excluded.lyrics_hydrated,
          cover_mime_type = excluded.cover_mime_type,
          cover_data = excluded.cover_data,
          updated_at = excluded.updated_at`,
        args: [
          metadata.key,
          metadata.path,
          metadata.fileSize,
          metadata.lastModified,
          metadata.title ?? null,
          metadata.artist ?? null,
          metadata.album ?? null,
          finiteNumber(metadata.duration),
          finiteNumber(metadata.replayGainTrackDb),
          finiteNumber(metadata.replayGainAlbumDb),
          metadata.lyrics === undefined ? null : JSON.stringify(metadata.lyrics),
          metadata.lyricsHydrated ? 1 : 0,
          metadata.coverMimeType ?? null,
          metadata.coverData ?? null,
          metadata.updatedAt,
        ],
      }, {
        sql: `UPDATE melodeck_library_tracks
          SET file_size = ?, last_modified = ?
          WHERE path_key = ?`,
        args: [metadata.fileSize, metadata.lastModified, metadata.key],
      }], "write")
    },
  }
}

async function initializeSchema(client: Client, url: string): Promise<void> {
  const initialize = async () => {
    await client.batch([
      `CREATE TABLE IF NOT EXISTS melodeck_library_state (
        id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS melodeck_library_tracks (
        path_key TEXT PRIMARY KEY NOT NULL,
        path TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT,
        file_name TEXT,
        relative_path TEXT,
        file_size INTEGER,
        last_modified INTEGER,
        mime_type TEXT,
        sort_order INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS melodeck_library_tracks_order_idx
        ON melodeck_library_tracks (sort_order ASC, path ASC)`,
      `CREATE TABLE IF NOT EXISTS melodeck_track_metadata (
        path_key TEXT PRIMARY KEY NOT NULL,
        path TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        last_modified INTEGER NOT NULL,
        title TEXT,
        artist TEXT,
        album TEXT,
        duration REAL,
        replay_gain_track_db REAL,
        replay_gain_album_db REAL,
        lyrics_json TEXT,
        lyrics_hydrated INTEGER NOT NULL DEFAULT 0,
        cover_mime_type TEXT,
        cover_data BLOB,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS melodeck_track_metadata_updated_idx
        ON melodeck_track_metadata (updated_at DESC)`,
    ], "write")
    await addColumnIfMissing(client, "melodeck_library_tracks", "last_modified", "INTEGER")
  }

  const databasePath = localLibsqlPath(url)
  if (!databasePath) {
    await initialize()
    return
  }
  await mkdir(dirname(databasePath), { recursive: true })
  await withXiraniteFileLock(databasePath, async (assertLockHeld) => {
    assertLockHeld()
    await initialize()
    assertLockHeld()
  })
}

function toLibraryTrack(row: Row): MelodeckLibraryTrackWithMetadata {
  const track: MelodeckLibraryTrackRecord = {
    key: requiredString(row.path_key, "path_key"),
    path: requiredString(row.path, "path"),
    title: requiredString(row.title, "title"),
    artist: optionalString(row.artist),
    fileName: optionalString(row.file_name),
    relativePath: optionalString(row.relative_path),
    fileSize: optionalNumber(row.file_size),
    lastModified: optionalNumber(row.last_modified),
    mimeType: optionalString(row.mime_type),
    sortOrder: requiredNumber(row.sort_order, "sort_order"),
  }
  const metadataUpdatedAt = optionalNumber(row.metadata_updated_at)
  if (metadataUpdatedAt === undefined) return track
  return {
    ...track,
    metadata: {
      fileSize: requiredNumber(row.metadata_file_size, "metadata_file_size"),
      lastModified: requiredNumber(row.metadata_last_modified, "metadata_last_modified"),
      title: optionalString(row.metadata_title),
      artist: optionalString(row.metadata_artist),
      album: optionalString(row.metadata_album),
      duration: optionalNumber(row.metadata_duration),
      replayGainTrackDb: optionalNumber(row.replay_gain_track_db),
      replayGainAlbumDb: optionalNumber(row.replay_gain_album_db),
      lyricsHydrated: requiredNumber(row.lyrics_hydrated, "lyrics_hydrated") === 1,
      coverMimeType: undefined,
      updatedAt: metadataUpdatedAt,
      hasCover: requiredNumber(row.metadata_has_cover, "metadata_has_cover") === 1,
    },
  }
}

async function addColumnIfMissing(client: Client, table: string, column: string, type: string): Promise<void> {
  try {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  } catch (error) {
    if (error instanceof Error && /duplicate column/i.test(error.message)) return
    throw error
  }
}

function toMetadata(row: Row): MelodeckTrackMetadataRecord {
  return {
    key: requiredString(row.path_key, "path_key"),
    path: requiredString(row.path, "path"),
    fileSize: requiredNumber(row.file_size, "file_size"),
    lastModified: requiredNumber(row.last_modified, "last_modified"),
    title: optionalString(row.title),
    artist: optionalString(row.artist),
    album: optionalString(row.album),
    duration: optionalNumber(row.duration),
    replayGainTrackDb: optionalNumber(row.replay_gain_track_db),
    replayGainAlbumDb: optionalNumber(row.replay_gain_album_db),
    lyrics: parseOptionalJson(row.lyrics_json),
    lyricsHydrated: requiredNumber(row.lyrics_hydrated, "lyrics_hydrated") === 1,
    coverMimeType: optionalString(row.cover_mime_type),
    coverData: optionalBytes(row.cover_data),
    updatedAt: requiredNumber(row.updated_at, "updated_at"),
  }
}

function localLibsqlPath(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    return parsed.protocol === "file:" ? fileURLToPath(parsed) : undefined
  } catch {
    return undefined
  }
}

function requiredString(value: Row[string], field: string): string {
  if (typeof value !== "string") throw new Error(`Invalid Melo deck database field: ${field}`)
  return value
}

function optionalString(value: Row[string]): string | undefined {
  return typeof value === "string" ? value : undefined
}

function requiredNumber(value: Row[string], field: string): number {
  const number = optionalNumber(value)
  if (number === undefined) throw new Error(`Invalid Melo deck database field: ${field}`)
  return number
}

function optionalNumber(value: Row[string]): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (typeof value === "bigint") return Number(value)
  return undefined
}

function finiteNumber(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) ? value : null
}

function finiteInteger(value: number | undefined): number | null {
  return value !== undefined && Number.isSafeInteger(value) ? value : null
}

function parseOptionalJson(value: Row[string]): unknown {
  if (typeof value !== "string") return undefined
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function optionalBytes(value: Row[string]): Uint8Array | undefined {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  return undefined
}
