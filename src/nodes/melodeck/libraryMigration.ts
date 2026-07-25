import {
  loadFoliaStoredLibrary,
  saveFoliaStoredLibrary,
  type FoliaStoredTrack,
} from "@hibernalglow/folia-player"

import type { PersistedTrack } from "@/components/modules/musicPlayer/MusicPlayerSurface"
import { saveMelodeckConfig, type MelodeckConfig } from "./config"

const LIBRARY_NAMESPACE = "xiranite-melodeck"

export interface MelodeckLibraryMigrationDependencies {
  loadLibrary: (namespace: string) => Promise<FoliaStoredTrack[] | null>
  saveLibrary: (namespace: string, tracks: FoliaStoredTrack[]) => Promise<void>
  removeLegacyTracks: () => Promise<void>
}

const defaultDependencies: MelodeckLibraryMigrationDependencies = {
  loadLibrary: loadFoliaStoredLibrary,
  saveLibrary: saveFoliaStoredLibrary,
  removeLegacyTracks: () => saveMelodeckConfig({ saved_tracks: undefined }, { broadcast: false }),
}

export async function loadAndMigrateMelodeckLibrary(
  config: Pick<MelodeckConfig, "saved_tracks">,
  dependencies: MelodeckLibraryMigrationDependencies = defaultDependencies,
): Promise<PersistedTrack[]> {
  const storedTracks = await dependencies.loadLibrary(LIBRARY_NAMESPACE)
  if (storedTracks !== null) return storedTracks.map(fromFoliaStoredTrack)

  const legacyTracks = (config.saved_tracks ?? []).flatMap(toFoliaStoredTrack)
  if (!legacyTracks.length) return []

  await dependencies.saveLibrary(LIBRARY_NAMESPACE, legacyTracks)
  await dependencies.removeLegacyTracks()
  return legacyTracks.map(fromFoliaStoredTrack)
}

export function saveMelodeckLibrary(tracks: PersistedTrack[]): Promise<void> {
  return saveFoliaStoredLibrary(LIBRARY_NAMESPACE, tracks.flatMap(toFoliaStoredTrack))
}

export function toFoliaStoredTrack(track: PersistedTrack): FoliaStoredTrack[] {
  if (!track.path) return []
  return [{
    id: track.path,
    path: track.path,
    title: track.name,
    artist: track.writer,
    mimeType: track.type,
    fileSize: track.size,
  }]
}

export function fromFoliaStoredTrack(track: FoliaStoredTrack): PersistedTrack {
  return {
    name: track.title,
    writer: track.artist,
    path: track.path,
    size: track.fileSize,
    type: track.mimeType,
  }
}
