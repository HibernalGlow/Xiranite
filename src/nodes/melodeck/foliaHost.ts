import {
  parseRemoteEmbeddedMetadataAsync,
  type EmbeddedMetadataResult,
  type FoliaPlayerHostAdapter,
  type FoliaResolvedTrack,
  type FoliaTrack,
} from "@hibernalglow/folia-player"
import { parseLyricsByFormat, type LyricData, type LyricParseFormat } from "@hibernalglow/folia-player/parser"
import { localBackendFileUrl } from "@/backend/localBackendConfig"
import {
  loadMelodeckDatabaseMetadata,
  melodeckDatabaseCoverUrl,
  saveMelodeckDatabaseMetadata,
  type MelodeckDatabaseMetadata,
} from "@/backend/melodeckLibraryClient"
import { listLocalFiles, pickLocalPaths, resolveLocalAudioTracks, type LocalFileEntry } from "@/backend/localFilesClient"
import { createLogger } from "@/lib/logger"
import type { XiraniteFoliaTrack } from "./foliaTypes"

const LYRIC_FORMATS = ["lrc", "vtt", "ttml", "yrc", "qrc", "krc"] as const
const OPTIONAL_FILE_EXTENSIONS = [...LYRIC_FORMATS.map((format) => `.${format}`), ".jpg", ".jpeg", ".png"]
const optionalFilesByDirectory = new Map<string, Map<string, LocalFileEntry>>()
const optionalFilesInFlight = new Map<string, Promise<Map<string, LocalFileEntry>>>()
const logger = createLogger("melodeck.metadata")

export const foliaMelodeckHost: FoliaPlayerHostAdapter = {
  async scanLibraryRoots(roots, signal) {
    optionalFilesByDirectory.clear()
    optionalFilesInFlight.clear()
    const results = await Promise.allSettled(roots.map(async (root) => {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError")
      return resolveLocalAudioTracks(root)
    }))
    if (signal.aborted) throw new DOMException("Aborted", "AbortError")

    const groups = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : [])
    if (!groups.length) {
      const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected")
      if (failure) throw failure.reason
    }

    const seen = new Set<string>()
    return groups.flatMap((tracks) => tracks.flatMap<FoliaTrack>((track) => {
      if (seen.has(track.path)) return []
      seen.add(track.path)
      return [{
        id: track.path,
        path: track.path,
        src: track.src,
        title: track.name,
        artist: track.writer,
        mimeType: track.type,
        fileSize: track.size,
        xiraniteSource: {
          title: track.name,
          artist: track.writer,
          fileName: track.fileName,
          relativePath: track.relativePath,
          lastModified: track.lastModified,
        },
      } satisfies XiraniteFoliaTrack]
    }))
  },

  async pickLibraryRoot() {
    if (typeof window !== "undefined" && window._wails) {
      const { Dialogs } = await import("@wailsio/runtime")
      const selected = await Dialogs.OpenFile({
        CanChooseFiles: false,
        CanChooseDirectories: true,
        AllowsMultipleSelection: false,
        Title: "选择音乐文件夹",
      })
      return selected || null
    }
    return (await pickLocalPaths("directory"))[0] ?? null
  },

  async hydrateTrackPreview(track, signal) {
    if (!track.path) return {}
    const cached = await loadCachedMetadata(track.path, signal)
    if (cached) return fromDatabaseMetadata(cached)

    const metadata = await parseMetadata(track, signal)
    const cover = await resolveCover(track.path, metadata, signal)
    const lyrics = embeddedLyrics(metadata)
    return persistMetadata({
      path: track.path,
      metadata,
      cover,
      lyrics,
      lyricsHydrated: false,
      signal,
    })
  },

  async hydrateTrack(track, signal) {
    if (!track.path) return {}
    const cached = await loadCachedMetadata(track.path, signal)
    if (cached?.lyricsHydrated) return fromDatabaseMetadata(cached)
    if (cached) {
      const lyrics = await readLyrics(track.path, signal) ?? cached.lyrics ?? null
      return persistDatabaseMetadata({ ...cached, lyrics, lyricsHydrated: true }, signal)
    }

    const [metadata, lyrics] = await Promise.all([
      parseMetadata(track, signal),
      readLyrics(track.path, signal),
    ])
    const cover = await resolveCover(track.path, metadata, signal)
    return persistMetadata({
      path: track.path,
      metadata,
      cover,
      lyrics: lyrics ?? embeddedLyrics(metadata),
      lyricsHydrated: true,
      signal,
    })
  },
}

async function parseMetadata(track: FoliaTrack, signal: AbortSignal): Promise<EmbeddedMetadataResult | null> {
  const metadata = await parseRemoteEmbeddedMetadataAsync(track.src, {
    filePath: track.path,
    includeCover: true,
    signal,
  })
  if (!metadata || signal.aborted) return null
  return metadata
}

async function loadCachedMetadata(path: string, signal: AbortSignal): Promise<MelodeckDatabaseMetadata | null> {
  try {
    return await loadMelodeckDatabaseMetadata(path, signal)
  } catch (error) {
    if (signal.aborted) throw error
    logger.warn("Metadata database read failed; falling back to file extraction", error)
    return null
  }
}

async function resolveCover(
  trackPath: string,
  metadata: EmbeddedMetadataResult | null,
  signal: AbortSignal,
): Promise<Blob | null> {
  return metadata?.cover ?? await readFolderCover(trackPath, signal)
}

async function persistMetadata(options: {
  path: string
  metadata: EmbeddedMetadataResult | null
  cover: Blob | null
  lyrics: LyricData | null
  lyricsHydrated: boolean
  signal: AbortSignal
}): Promise<FoliaResolvedTrack> {
  const resolved = {
    title: options.metadata?.title,
    artist: options.metadata?.artist,
    album: options.metadata?.album,
    duration: options.metadata?.duration ? options.metadata.duration / 1000 : undefined,
    replayGainTrackDb: options.metadata?.replayGainTrackGain,
    replayGainAlbumDb: options.metadata?.replayGainAlbumGain,
    lyrics: options.lyrics,
  }
  try {
    const saved = await saveMelodeckDatabaseMetadata({
      path: options.path,
      ...resolved,
      cover: options.cover,
      lyricsHydrated: options.lyricsHydrated,
    }, options.signal)
    return fromDatabaseMetadata(saved)
  } catch (error) {
    if (options.signal.aborted) throw error
    logger.warn("Metadata database write failed; keeping the extracted data in memory", error)
    return withTransientCover(resolved, options.cover)
  }
}

async function persistDatabaseMetadata(
  metadata: MelodeckDatabaseMetadata,
  signal: AbortSignal,
): Promise<FoliaResolvedTrack> {
  try {
    const saved = await saveMelodeckDatabaseMetadata({
      path: metadata.path,
      title: metadata.title,
      artist: metadata.artist,
      album: metadata.album,
      duration: metadata.duration,
      replayGainTrackDb: metadata.replayGainTrackDb,
      replayGainAlbumDb: metadata.replayGainAlbumDb,
      lyrics: metadata.lyrics,
      lyricsHydrated: metadata.lyricsHydrated,
      cover: undefined,
    }, signal)
    return fromDatabaseMetadata(saved)
  } catch (error) {
    if (signal.aborted) throw error
    logger.warn("Metadata database update failed; using the cached record", error)
    return fromDatabaseMetadata(metadata)
  }
}

function fromDatabaseMetadata(metadata: MelodeckDatabaseMetadata): FoliaResolvedTrack {
  return {
    title: metadata.title,
    artist: metadata.artist,
    album: metadata.album,
    duration: metadata.duration,
    replayGainTrackDb: metadata.replayGainTrackDb,
    replayGainAlbumDb: metadata.replayGainAlbumDb,
    lyrics: metadata.lyrics,
    coverUrl: metadata.hasCover ? melodeckDatabaseCoverUrl(metadata.path) : undefined,
  }
}

function withTransientCover(
  resolved: Omit<FoliaResolvedTrack, "coverUrl" | "release">,
  cover: Blob | null,
): FoliaResolvedTrack {
  const coverUrl = cover ? URL.createObjectURL(cover) : undefined
  return {
    ...resolved,
    coverUrl,
    release: coverUrl ? () => URL.revokeObjectURL(coverUrl) : undefined,
  }
}

async function readLyrics(path: string, signal: AbortSignal): Promise<LyricData | null> {
  const { directory, stem } = splitLocalTrackPath(path)
  const files = await listOptionalFiles(directory, signal)
  for (const format of LYRIC_FORMATS) {
    const lyricPath = findOptionalFile(files, `${stem}.${format}`)
    if (!lyricPath) continue
    const [content, translation, romanization] = await Promise.all([
      readText(lyricPath, signal),
      readFirstText(files, [`${stem}.translation.${format}`, `${stem}.trans.${format}`], signal),
      readFirstText(files, [`${stem}.romanization.${format}`, `${stem}.roma.${format}`], signal),
    ])
    const parsed = parseLyricsByFormat(format as LyricParseFormat, content, translation ?? "", {}, romanization ?? "")
    if (parsed.lines.length) return parsed
  }
  return null
}

async function readFirstText(
  files: Map<string, LocalFileEntry>,
  names: string[],
  signal: AbortSignal,
): Promise<string | null> {
  for (const name of names) {
    const path = findOptionalFile(files, name)
    if (path) return readText(path, signal)
  }
  return null
}

async function readFolderCover(trackPath: string, signal: AbortSignal): Promise<Blob | null> {
  const { directory } = splitLocalTrackPath(trackPath)
  const files = await listOptionalFiles(directory, signal)
  for (const name of ["cover.jpg", "cover.png", "folder.jpg", "folder.png"]) {
    const path = findOptionalFile(files, name)
    if (!path) continue
    const response = await fetch(localBackendFileUrl(path), { cache: "no-store", signal })
    if (response.ok) return response.blob()
  }
  return null
}

async function listOptionalFiles(directory: string, signal: AbortSignal): Promise<Map<string, LocalFileEntry>> {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError")
  const cached = optionalFilesByDirectory.get(directory)
  if (cached) return cached

  let pending = optionalFilesInFlight.get(directory)
  if (!pending) {
    pending = listLocalFiles(directory, { extensions: OPTIONAL_FILE_EXTENSIONS, limit: 2000 }).then((entries) => {
      const files = new Map(entries.filter((entry) => !entry.isDirectory).map((entry) => [entry.name.toLocaleLowerCase(), entry]))
      optionalFilesByDirectory.set(directory, files)
      return files
    }).finally(() => {
      optionalFilesInFlight.delete(directory)
    })
    optionalFilesInFlight.set(directory, pending)
  }

  const files = await pending
  if (signal.aborted) throw new DOMException("Aborted", "AbortError")
  return files
}

function findOptionalFile(files: Map<string, LocalFileEntry>, name: string): string | undefined {
  return files.get(name.toLocaleLowerCase())?.path
}

async function readText(path: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(localBackendFileUrl(path), { cache: "no-store", signal })
  if (!response.ok) throw new Error(`Unable to read local text file: ${response.status}`)
  return response.text()
}

function splitLocalTrackPath(trackPath: string): { directory: string; stem: string } {
  const separator = Math.max(trackPath.lastIndexOf("/"), trackPath.lastIndexOf("\\"))
  const directory = separator >= 0 ? trackPath.slice(0, separator) : "."
  const filename = separator >= 0 ? trackPath.slice(separator + 1) : trackPath
  return { directory, stem: filename.replace(/\.[^.]+$/, "") }
}

function embeddedLyrics(metadata: EmbeddedMetadataResult | null): LyricData | null {
  if (!metadata?.lyrics) return null
  const parsed = parseLyricsByFormat("lrc", metadata.lyrics, metadata.translationLyrics ?? "")
  return parsed.lines.length ? parsed : null
}
