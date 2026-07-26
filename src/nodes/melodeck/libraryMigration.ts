import {
  loadFoliaStoredLibrary,
  type FoliaStoredTrack,
} from "@hibernalglow/folia-player"

import type { PersistedTrack } from "@/components/modules/musicPlayer/MusicPlayerSurface"
import {
  loadMelodeckDatabaseLibrary,
  melodeckDatabaseCoverUrl,
  saveMelodeckDatabaseLibrary,
  type MelodeckDatabaseLibrary,
  type MelodeckDatabaseTrack,
} from "@/backend/melodeckLibraryClient"
import { saveMelodeckConfig, type MelodeckConfig } from "./config"

const LIBRARY_NAMESPACE = "xiranite-melodeck"
const ORIGIN_MIGRATION_KEY = "xiranite.melodeck.database-library-migration.v1"

export interface MelodeckLibraryMigrationDependencies {
  loadDatabaseLibrary: () => Promise<MelodeckDatabaseLibrary>
  saveDatabaseLibrary: (tracks: readonly Omit<MelodeckDatabaseTrack, "metadata">[]) => Promise<void>
  loadOriginLibrary: (namespace: string) => Promise<FoliaStoredTrack[] | null>
  isOriginMigrationComplete: () => boolean
  markOriginMigrationComplete: () => void
  removeLegacyTracks: () => Promise<void>
}

const defaultDependencies: MelodeckLibraryMigrationDependencies = {
  loadDatabaseLibrary: loadMelodeckDatabaseLibrary,
  saveDatabaseLibrary: saveMelodeckDatabaseLibrary,
  loadOriginLibrary: loadFoliaStoredLibrary,
  isOriginMigrationComplete: () => window.localStorage.getItem(ORIGIN_MIGRATION_KEY) === "1",
  markOriginMigrationComplete: () => window.localStorage.setItem(ORIGIN_MIGRATION_KEY, "1"),
  removeLegacyTracks: () => saveMelodeckConfig({ saved_tracks: undefined }, { broadcast: false }),
}

export async function loadAndMigrateMelodeckLibrary(
  config: Pick<MelodeckConfig, "saved_tracks">,
  dependencies: MelodeckLibraryMigrationDependencies = defaultDependencies,
): Promise<PersistedTrack[]> {
  const database = await dependencies.loadDatabaseLibrary()
  if (dependencies.isOriginMigrationComplete()) return database.tracks.map(fromDatabaseTrack)

  const originTracks = await dependencies.loadOriginLibrary(LIBRARY_NAMESPACE)
  const legacyTracks = [
    ...(originTracks ?? []).map(fromFoliaStoredTrack),
    ...(config.saved_tracks ?? []),
  ]
  const merged = mergeTracks(database.tracks.map(fromDatabaseTrack), legacyTracks)
  if (!database.initialized || legacyTracks.length > 0) {
    await dependencies.saveDatabaseLibrary(merged.flatMap(toDatabaseTrack))
  }
  if ((config.saved_tracks?.length ?? 0) > 0) await dependencies.removeLegacyTracks()
  dependencies.markOriginMigrationComplete()
  return merged
}

export function saveMelodeckLibrary(tracks: PersistedTrack[]): Promise<void> {
  return saveMelodeckDatabaseLibrary(tracks.flatMap(toDatabaseTrack))
}

export function toDatabaseTrack(track: PersistedTrack): Omit<MelodeckDatabaseTrack, "metadata">[] {
  if (!track.path) return []
  return [{
    path: track.path,
    title: track.name,
    artist: track.writer,
    fileName: track.fileName,
    relativePath: track.relativePath,
    fileSize: track.size,
    lastModified: track.lastModified,
    mimeType: track.type,
  }]
}

export function fromDatabaseTrack(track: MelodeckDatabaseTrack): PersistedTrack {
  return {
    name: track.title,
    writer: track.artist,
    fileName: track.fileName,
    relativePath: track.relativePath,
    path: track.path,
    size: track.fileSize,
    lastModified: track.lastModified,
    type: track.mimeType,
    metadata: track.metadata ? {
      title: track.metadata.title,
      artist: track.metadata.artist,
      album: track.metadata.album,
      duration: track.metadata.duration,
      replayGainTrackDb: track.metadata.replayGainTrackDb,
      replayGainAlbumDb: track.metadata.replayGainAlbumDb,
      coverUrl: track.metadata.hasCover ? melodeckDatabaseCoverUrl(track.path) : undefined,
      lyricsHydrated: track.metadata.lyricsHydrated,
    } : undefined,
  }
}

function fromFoliaStoredTrack(track: FoliaStoredTrack): PersistedTrack {
  return {
    name: track.title,
    writer: track.artist,
    path: track.path,
    size: track.fileSize,
    type: track.mimeType,
  }
}

function mergeTracks(databaseTracks: PersistedTrack[], legacyTracks: PersistedTrack[]): PersistedTrack[] {
  const merged = new Map<string, PersistedTrack>()
  for (const track of databaseTracks) {
    if (track.path) merged.set(normalizePath(track.path), track)
  }
  for (const track of legacyTracks) {
    if (!track.path) continue
    const key = normalizePath(track.path)
    if (!merged.has(key)) merged.set(key, track)
  }
  return [...merged.values()]
}

function normalizePath(path: string): string {
  const normalized = path.replaceAll("\\", "/")
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith("//")
    ? normalized.toLocaleLowerCase("en-US")
    : normalized
}
