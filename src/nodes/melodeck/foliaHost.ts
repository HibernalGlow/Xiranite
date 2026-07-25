import type { FoliaPlayerHostAdapter, FoliaResolvedTrack, FoliaTrack } from "@hibernalglow/folia-player"
import { parseLyricsByFormat, type LyricData, type LyricParseFormat } from "@hibernalglow/folia-player/parser"
import { parseWebStream, type IAudioMetadata } from "music-metadata"
import { localBackendFileUrl } from "@/backend/localBackendConfig"
import { listLocalFiles, pickLocalPaths, resolveLocalAudioTracks, type LocalFileEntry } from "@/backend/localFilesClient"

const LYRIC_FORMATS = ["lrc", "vtt", "ttml", "yrc", "qrc", "krc"] as const
const OPTIONAL_FILE_EXTENSIONS = [...LYRIC_FORMATS.map((format) => `.${format}`), ".jpg", ".jpeg", ".png"]
const optionalFilesByDirectory = new Map<string, Map<string, LocalFileEntry>>()
const optionalFilesInFlight = new Map<string, Promise<Map<string, LocalFileEntry>>>()

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

async function readMetadata(track: FoliaTrack, signal: AbortSignal): Promise<IAudioMetadata | null> {
  const response = await fetch(track.src, { cache: "no-store", signal })
  if (!response.ok || !response.body) return null
  return parseWebStream(response.body, track.mimeType, { skipPostHeaders: true })
}

async function resolveMetadata(
  trackPath: string,
  metadata: IAudioMetadata | null,
  signal: AbortSignal,
): Promise<FoliaResolvedTrack> {
  const cover = metadata?.common.picture?.[0]
  const coverBlob = cover
    ? new Blob([cover.data], { type: cover.format })
    : await readFolderCover(trackPath, signal)
  const coverUrl = coverBlob ? URL.createObjectURL(coverBlob) : undefined
  return {
    title: metadata?.common.title,
    artist: metadata?.common.artist,
    album: metadata?.common.album,
    duration: metadata?.format.duration,
    replayGainTrackDb: metadata?.common.replaygain_track_gain?.dB,
    replayGainAlbumDb: metadata?.common.replaygain_album_gain?.dB,
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

function embeddedLyrics(metadata: IAudioMetadata | null): LyricData | null {
  for (const tag of metadata?.common.lyrics ?? []) {
    if (tag.text) {
      const parsed = parseLyricsByFormat("lrc", tag.text)
      if (parsed.lines.length) return parsed
    }
    if (tag.syncText?.length) {
      const lrc = tag.syncText.map((entry) => {
        const seconds = (entry.timestamp ?? 0) / 1000
        const minute = Math.floor(seconds / 60)
        const remainder = (seconds % 60).toFixed(3).padStart(6, "0")
        return `[${String(minute).padStart(2, "0")}:${remainder}]${entry.text ?? ""}`
      }).join("\n")
      const parsed = parseLyricsByFormat("lrc", lrc)
      if (parsed.lines.length) return parsed
    }
  }
  return null
}
