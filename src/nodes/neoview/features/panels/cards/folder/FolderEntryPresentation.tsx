import { File, FileArchive, FileImage, FileText, Film, Folder, Heart, Music, Star } from "lucide-react"

import type { ReaderDirectoryEntryDto } from "../../../../adapters/reader-http-client"
import { formatFolderRating } from "./DirectoryCatalog"

export function FolderEntryIcon({ entry, className = "size-4" }: { entry: ReaderDirectoryEntryDto; className?: string }) {
  const Icon = getFolderEntryIcon(entry)
  return <Icon className={`${className} shrink-0 ${folderEntryIconClass(entry)}`} />
}

export function getFolderEntryIcon(entry: Pick<ReaderDirectoryEntryDto, "kind" | "name">) {
  if (entry.kind === "directory") return Folder
  const extension = folderEntryExtension(entry.name)
  if (IMAGE_EXTENSIONS.has(extension)) return FileImage
  if (VIDEO_EXTENSIONS.has(extension)) return Film
  if (AUDIO_EXTENSIONS.has(extension)) return Music
  if (ARCHIVE_EXTENSIONS.has(extension)) return FileArchive
  if (TEXT_EXTENSIONS.has(extension)) return FileText
  return File
}

export function folderEntryExtension(name: string): string {
  const dot = name.lastIndexOf(".")
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLocaleLowerCase() : ""
}

export function formatFolderSize(value: number | undefined): string {
  if (!Number.isFinite(value)) return ""
  if (value! < 1024) return `${value} B`
  if (value! < 1024 ** 2) return `${(value! / 1024).toFixed(1)} KiB`
  if (value! < 1024 ** 3) return `${(value! / 1024 ** 2).toFixed(1)} MiB`
  return `${(value! / 1024 ** 3).toFixed(2)} GiB`
}

export function formatFolderDate(value: number | undefined): string {
  if (!Number.isFinite(value)) return ""
  return new Date(value!).toLocaleDateString()
}

export function FolderEntryFileMetadata({ entry, className = "" }: { entry: Pick<ReaderDirectoryEntryDto, "size" | "modifiedAt">; className?: string }) {
  const date = formatFolderDate(entry.modifiedAt)
  const size = formatFolderSize(entry.size)
  if (!date && !size) return null
  return <span className={`truncate text-[9px] text-muted-foreground ${className}`} title={[date, size].filter(Boolean).join(" · ")}>{[date, size].filter(Boolean).join(" · ")}</span>
}

function folderEntryIconClass(entry: Pick<ReaderDirectoryEntryDto, "kind" | "name">): string {
  if (entry.kind === "directory") return "text-amber-500"
  const extension = folderEntryExtension(entry.name)
  if (IMAGE_EXTENSIONS.has(extension)) return "text-sky-500"
  if (VIDEO_EXTENSIONS.has(extension)) return "text-violet-500"
  if (AUDIO_EXTENSIONS.has(extension)) return "text-emerald-500"
  if (ARCHIVE_EXTENSIONS.has(extension)) return "text-orange-500"
  if (TEXT_EXTENSIONS.has(extension)) return "text-cyan-600"
  return "text-muted-foreground"
}

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "ico", "avif"])
const VIDEO_EXTENSIONS = new Set(["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "nov"])
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "flac", "aac", "ogg", "m4a"])
const ARCHIVE_EXTENSIONS = new Set(["zip", "rar", "7z", "tar", "gz", "cbz", "cbr"])
const TEXT_EXTENSIONS = new Set(["txt", "md", "json", "xml", "yaml", "yml", "ini", "cfg"])

export function FolderEntryMetadata({
  entry,
  showRating,
  showCollectTagCount,
  className = "",
}: {
  entry: ReaderDirectoryEntryDto
  showRating: boolean
  showCollectTagCount: boolean
  className?: string
}) {
  const rating = formatFolderRating(entry.rating)
  return (
    <span className={`flex shrink-0 items-center gap-1.5 text-[10px] tabular-nums text-muted-foreground ${className}`}>
      {showRating ? <span className="inline-flex items-center gap-0.5" title={`评分 ${rating}`}><Star className="size-3" />{rating}</span> : null}
      {showCollectTagCount ? <span className="inline-flex items-center gap-0.5" title={`收藏标签 ${entry.collectTagCount ?? 0}`}><Heart className="size-3" />{entry.collectTagCount ?? 0}</span> : null}
    </span>
  )
}
