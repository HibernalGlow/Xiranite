import { FileIcon, Folder, ImageIcon, LoaderCircle } from "lucide-react"
import { useState, type ReactNode } from "react"

import { cn } from "@/lib/utils"

export interface ReaderThumbnailSurfaceProps {
  url?: string
  kind?: "file" | "folder" | "page"
  fit?: "cover" | "contain"
  loading?: boolean
  className?: string
  imageClassName?: string
  fallback?: ReactNode
}

export function ReaderThumbnailSurface({
  url,
  kind = "page",
  fit = "cover",
  loading = false,
  className,
  imageClassName,
  fallback,
}: ReaderThumbnailSurfaceProps) {
  const [failedUrl, setFailedUrl] = useState<string>()
  const showImage = Boolean(url && url !== failedUrl)

  return (
    <span
      className={cn("grid shrink-0 place-items-center overflow-hidden rounded bg-muted/30", className)}
      data-reader-thumbnail-surface="true"
      data-thumbnail-fit={fit}
      data-thumbnail-state={showImage ? "ready" : loading ? "loading" : failedUrl === url && url ? "error" : "empty"}
    >
      {showImage ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className={cn("size-full select-none", fit === "contain" ? "object-contain" : "object-cover", imageClassName)}
          onError={() => setFailedUrl(url)}
        />
      ) : loading ? (
        <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-label="正在加载缩略图" />
      ) : fallback ?? <ThumbnailFallback kind={kind} />}
    </span>
  )
}

function ThumbnailFallback({ kind }: { kind: NonNullable<ReaderThumbnailSurfaceProps["kind"]> }) {
  if (kind === "folder") return <Folder className="size-5 text-muted-foreground" aria-hidden="true" />
  if (kind === "file") return <FileIcon className="size-5 text-muted-foreground" aria-hidden="true" />
  return <ImageIcon className="size-5 text-muted-foreground" aria-hidden="true" />
}
