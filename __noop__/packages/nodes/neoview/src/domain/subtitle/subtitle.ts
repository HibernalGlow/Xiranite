import { posix } from "node:path"

export type ReaderSubtitleFormat = "srt" | "ass" | "ssa" | "vtt"

const SUBTITLE_FORMATS = new Set<ReaderSubtitleFormat>(["srt", "ass", "ssa", "vtt"])

export function subtitleFormatFromPath(path: string): ReaderSubtitleFormat | undefined {
  const extension = posix.extname(normalizeSeparators(path)).slice(1).toLowerCase()
  return SUBTITLE_FORMATS.has(extension as ReaderSubtitleFormat) ? extension as ReaderSubtitleFormat : undefined
}

export function subtitleMatchesVideo(
  video: { name: string; entryPath?: string },
  subtitle: { name: string; entryPath?: string },
): boolean {
  if (video.entryPath && subtitle.entryPath) {
    if (posix.dirname(normalizeSeparators(video.entryPath)).toLowerCase()
      !== posix.dirname(normalizeSeparators(subtitle.entryPath)).toLowerCase()) return false
  }
  const videoStem = stem(video.name).toLowerCase()
  const subtitleStem = stem(subtitle.name).toLowerCase()
  return subtitleStem === videoStem || subtitleStem.startsWith(`${videoStem}.`)
}

function stem(path: string): string {
  const name = posix.basename(normalizeSeparators(path))
  const extension = posix.extname(name)
  return extension ? name.slice(0, -extension.length) : name
}

function normalizeSeparators(path: string): string {
  return path.replaceAll("\\", "/")
}
