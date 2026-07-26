export interface MelodeckLibraryTrackRecord {
  key: string
  path: string
  title: string
  artist?: string
  fileName?: string
  relativePath?: string
  fileSize?: number
  lastModified?: number
  mimeType?: string
  sortOrder: number
}

export interface MelodeckTrackMetadataRecord {
  key: string
  path: string
  fileSize: number
  lastModified: number
  title?: string
  artist?: string
  album?: string
  duration?: number
  replayGainTrackDb?: number
  replayGainAlbumDb?: number
  lyrics?: unknown
  lyricsHydrated: boolean
  coverMimeType?: string
  coverData?: Uint8Array
  updatedAt: number
}

export interface MelodeckLibraryTrackWithMetadata extends MelodeckLibraryTrackRecord {
  metadata?: Omit<MelodeckTrackMetadataRecord, "key" | "path" | "lyrics" | "coverData"> & {
    hasCover: boolean
  }
}

export interface MelodeckLibrarySnapshot {
  initialized: boolean
  tracks: MelodeckLibraryTrackWithMetadata[]
}

export interface MelodeckRepository {
  loadLibrary(): Promise<MelodeckLibrarySnapshot>
  replaceLibrary(tracks: readonly MelodeckLibraryTrackRecord[], updatedAt: number): Promise<void>
  getMetadata(key: string): Promise<MelodeckTrackMetadataRecord | undefined>
  saveMetadata(metadata: MelodeckTrackMetadataRecord): Promise<void>
}

export interface MemoryMelodeckRepositoryOptions {
  initialized?: boolean
  tracks?: readonly MelodeckLibraryTrackRecord[]
  metadata?: readonly MelodeckTrackMetadataRecord[]
}

export function createMemoryMelodeckRepository(
  options: MemoryMelodeckRepositoryOptions = {},
): MelodeckRepository {
  let initialized = options.initialized ?? false
  let tracks = new Map((options.tracks ?? []).map((track) => [track.key, structuredClone(track)]))
  let metadata = new Map((options.metadata ?? []).map((entry) => [entry.key, cloneMetadata(entry)]))

  return {
    async loadLibrary() {
      return {
        initialized,
        tracks: [...tracks.values()]
          .sort((left, right) => left.sortOrder - right.sortOrder || left.path.localeCompare(right.path))
          .map((track) => withMetadata(track, metadata.get(track.key))),
      }
    },
    async replaceLibrary(nextTracks) {
      initialized = true
      tracks = new Map(nextTracks.map((track) => [track.key, structuredClone(track)]))
      const liveKeys = new Set(tracks.keys())
      metadata = new Map([...metadata].filter(([key]) => liveKeys.has(key)))
    },
    async getMetadata(key) {
      const entry = metadata.get(key)
      return entry ? cloneMetadata(entry) : undefined
    },
    async saveMetadata(entry) {
      metadata.set(entry.key, cloneMetadata(entry))
      const track = tracks.get(entry.key)
      if (track) tracks.set(entry.key, { ...track, fileSize: entry.fileSize, lastModified: entry.lastModified })
    },
  }
}

function withMetadata(
  track: MelodeckLibraryTrackRecord,
  metadata: MelodeckTrackMetadataRecord | undefined,
): MelodeckLibraryTrackWithMetadata {
  const clonedTrack = structuredClone(track)
  if (!metadata || metadata.fileSize !== track.fileSize || metadata.lastModified !== track.lastModified) return clonedTrack
  const { key: _key, path: _path, lyrics: _lyrics, coverData, ...lightweight } = cloneMetadata(metadata)
  return { ...clonedTrack, metadata: { ...lightweight, hasCover: Boolean(coverData?.byteLength) } }
}

function cloneMetadata(metadata: MelodeckTrackMetadataRecord): MelodeckTrackMetadataRecord {
  return {
    ...structuredClone({ ...metadata, coverData: undefined }),
    coverData: metadata.coverData ? new Uint8Array(metadata.coverData) : undefined,
  }
}
