import type { FoliaPlayerHostAdapter, FoliaResolvedTrack, FoliaTrack } from "@hibernalglow/folia-player"
import { parseLyricsByFormat, type LyricData, type LyricParseFormat } from "@hibernalglow/folia-player/parser"
import { parseWebStream, type IAudioMetadata } from "music-metadata"
import { localBackendFileUrl } from "@/backend/localBackendConfig"
import { pickLocalPaths, resolveLocalAudioTracks } from "@/backend/localFilesClient"

const LYRIC_FORMATS = ["lrc", "vtt", "ttml", "yrc", "qrc", "krc"] as const

export const foliaMelodeckHost: FoliaPlayerHostAdapter = {
  async scanLibraryRoots(roots, signal) {
    const groups = await Promise.all(roots.map(async (root) => {
      if (signal.aborted) return []
      return resolveLocalAudioTracks(root)
    }))
    if (signal.aborted) throw new DOMException("Aborted", "AbortError")

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
  const base = path.replace(/\.[^./\\]+$/, "")
  for (const format of LYRIC_FORMATS) {
    const response = await fetch(localBackendFileUrl(`${base}.${format}`), { cache: "no-store", signal })
    if (!response.ok) continue
    const [content, translation, romanization] = await Promise.all([
      response.text(),
      readFirstText([`${base}.translation.${format}`, `${base}.trans.${format}`], signal),
      readFirstText([`${base}.romanization.${format}`, `${base}.roma.${format}`], signal),
    ])
    const parsed = parseLyricsByFormat(format as LyricParseFormat, content, translation ?? "", {}, romanization ?? "")
    if (parsed.lines.length) return parsed
  }
  return null
}

async function readFirstText(paths: string[], signal: AbortSignal): Promise<string | null> {
  for (const path of paths) {
    const response = await fetch(localBackendFileUrl(path), { cache: "no-store", signal })
    if (response.ok) return response.text()
  }
  return null
}

async function readFolderCover(trackPath: string, signal: AbortSignal): Promise<Blob | null> {
  const separator = Math.max(trackPath.lastIndexOf("/"), trackPath.lastIndexOf("\\"))
  const folder = separator >= 0 ? trackPath.slice(0, separator + 1) : ""
  for (const name of ["cover.jpg", "cover.png", "folder.jpg", "folder.png"]) {
    const response = await fetch(localBackendFileUrl(`${folder}${name}`), { cache: "no-store", signal })
    if (response.ok) return response.blob()
  }
  return null
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
