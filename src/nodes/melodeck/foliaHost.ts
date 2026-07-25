import {
  parseRemoteEmbeddedMetadataAsync,
  type EmbeddedMetadataResult,
  type FoliaPlayerHostAdapter,
  type FoliaResolvedTrack,
  type FoliaTrack,
} from "@hibernalglow/folia-player"
import { parseLyricsByFormat, type LyricData, type LyricParseFormat } from "@hibernalglow/folia-player/parser"
import { localBackendFileUrl } from "@/backend/localBackendConfig"
import { listLocalFiles, pickLocalPaths, resolveLocalAudioTracks, type LocalFileEntry } from "@/backend/localFilesClient"

const LYRIC_FORMATS = ["lrc", "vtt", "ttml", "yrc", "qrc", "krc"] as const
const OPTIONAL_FILE_EXTENSIONS = [...LYRIC_FORMATS.map((format) => `.${format}`), ".jpg", ".jpeg", ".png"]
const optionalFilesByDirectory = new Map<string, Map<string, LocalFileEntry>>()
const optionalFilesInFlight = new Map<string, Promise<Map<string, LocalFileEntry>>>()
const metadataCache = new Map<string, EmbeddedMetadataResult>()
const METADATA_CACHE_LIMIT = 128

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
      }]
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
    const metadata = await readMetadata(track, signal)
    return resolveMetadata(track.path, metadata, signal)
  },

  async hydrateTrack(track, signal) {
    if (!track.path) return {}
    const [metadata, lyrics] = await Promise.all([
      readMetadata(track, signal),
      readLyrics(track.path, signal),
    ])
    const resolved = await resolveMetadata(track.path, metadata, signal)
    return {
      ...resolved,
      lyrics: lyrics ?? embeddedLyrics(metadata),
    } satisfies FoliaResolvedTrack
  },
}

async function readMetadata(track: FoliaTrack, signal: AbortSignal): Promise<EmbeddedMetadataResult | null> {
  const cacheKey = `${track.path ?? track.id}\0${track.fileSize ?? ""}`
  const cached = metadataCache.get(cacheKey)
  if (cached) return cached

  const metadata = await parseRemoteEmbeddedMetadataAsync(track.src, {
    filePath: track.path,
    includeCover: true,
    signal,
  })
  if (!metadata || signal.aborted) return null
  metadataCache.set(cacheKey, metadata)
  if (metadataCache.size > METADATA_CACHE_LIMIT) metadataCache.delete(metadataCache.keys().next().value as string)
  return metadata
}

async function resolveMetadata(
  trackPath: string,
  metadata: EmbeddedMetadataResult | null,
  signal: AbortSignal,
): Promise<FoliaResolvedTrack> {
  const coverBlob = metadata?.cover ?? await readFolderCover(trackPath, signal)
  const coverUrl = coverBlob ? URL.createObjectURL(coverBlob) : undefined
  return {
    title: metadata?.title,
    artist: metadata?.artist,
    album: metadata?.album,
    duration: metadata?.duration ? metadata.duration / 1000 : undefined,
    replayGainTrackDb: metadata?.replayGainTrackGain,
    replayGainAlbumDb: metadata?.replayGainAlbumGain,
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
