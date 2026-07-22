import { File, FileArchive, FileImage, FileText, Film, Folder, Heart, Music, Star, Tag } from "lucide-react"
import { createContext, useContext, type ReactNode } from "react"

import type { ReaderDirectoryEntryDto, ReaderFolderTagDisplayConfig } from "../../../../adapters/reader-http-client"
import { formatFolderRating } from "./DirectoryCatalog"

export const DEFAULT_FOLDER_TAG_DISPLAY: ReaderFolderTagDisplayConfig = {
  tagMode: "collect",
  showRating: true,
  showCollectTagCount: true,
  showTags: true,
  maxTags: 3,
  showTooltips: true,
}

const FolderEntryDisplayContext = createContext<ReaderFolderTagDisplayConfig>(DEFAULT_FOLDER_TAG_DISPLAY)

export function FolderEntryDisplayProvider({ value, children }: { value: ReaderFolderTagDisplayConfig; children: ReactNode }) {
  return <FolderEntryDisplayContext.Provider value={value}>{children}</FolderEntryDisplayContext.Provider>
}

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

/** Keep the source order while dropping empty EMM/manual tag values. */
export function formatFolderTags(tags: readonly string[] | undefined): string {
  return (tags ?? []).map((tag) => tag.trim()).filter(Boolean).join(" / ")
}

/** A single display contract shared by compact/list/grid and the details column. */
export function formatFolderTagSummary(entry: Pick<ReaderDirectoryEntryDto, "tags" | "collectTagCount">): string {
  const tags = formatFolderTags(entry.tags)
  const collectCount = Number.isFinite(entry.collectTagCount)
    ? `${entry.collectTagCount} 个收藏标签`
    : ""
  return [tags, collectCount].filter(Boolean).join(" / ") || "-"
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
  showTags = true,
  className = "",
}: {
  entry: ReaderDirectoryEntryDto
  showRating: boolean
  showCollectTagCount: boolean
  showTags?: boolean
  className?: string
}) {
  const display = useContext(FolderEntryDisplayContext)
  const rating = formatFolderRating(entry.rating)
  const sourceTags = (display.tagMode === "none"
    ? []
    : display.tagMode === "collect"
      ? [...(entry.collectTags ?? (entry.collectTagCount ? entry.tags ?? [] : [])), ...(entry.manualTags ?? [])]
      : entry.tags ?? []).map((tag) => tag.trim()).filter(Boolean)
  const shownTags = sourceTags.slice(0, display.maxTags)
  const hiddenTagCount = sourceTags.length - shownTags.length
  const tags = shownTags.join(" / ")
  const tagText = hiddenTagCount > 0 ? `${tags} / +${hiddenTagCount}` : tags
  return (
    <span className={`flex shrink-0 items-center gap-1.5 text-[10px] tabular-nums text-muted-foreground ${className}`}>
      {showRating && display.showRating ? <span className="inline-flex items-center gap-0.5" title={display.showTooltips ? `评分 ${rating}` : undefined}><Star className="size-3" />{rating}</span> : null}
      {showCollectTagCount && display.showCollectTagCount ? <span className="inline-flex items-center gap-0.5" title={display.showTooltips ? `收藏标签 ${entry.collectTagCount ?? 0}` : undefined}><Heart className="size-3" />{entry.collectTagCount ?? 0}</span> : null}
      {showTags && display.showTags && display.tagMode !== "none" && tags ? <span className="inline-flex min-w-0 items-center gap-0.5" title={display.showTooltips ? `标签 ${sourceTags.join(" / ")}` : undefined} data-folder-entry-metadata="tags"><Tag className="size-3 shrink-0" /><span className="max-w-40 truncate">{tagText}</span></span> : null}
    </span>
  )
}
