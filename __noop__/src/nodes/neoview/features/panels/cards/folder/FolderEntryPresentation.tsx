import { File, Folder, Heart, Star } from "lucide-react"

import type { ReaderDirectoryEntryDto } from "../../../../adapters/reader-http-client"
import { formatFolderRating } from "./DirectoryCatalog"

export function FolderEntryIcon({ entry, className = "size-4" }: { entry: ReaderDirectoryEntryDto; className?: string }) {
  return entry.kind === "directory"
    ? <Folder className={`${className} shrink-0 text-amber-500`} />
    : <File className={`${className} shrink-0 text-muted-foreground`} />
}

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
