import { FileIcon, ImageIcon, LoaderCircle } from "lucide-react"
import { useEffect, useState, type ReactNode, type SyntheticEvent } from "react"

import { cn } from "@/lib/utils"

export interface ReaderThumbnailSurfaceProps {
  url?: string
  urls?: readonly string[]
  kind?: "file" | "folder" | "page"
  fit?: "cover" | "contain"
  loading?: boolean
  imageLoading?: "eager" | "lazy"
  className?: string
  imageClassName?: string
  fallback?: ReactNode
  onDimensions?(width: number, height: number): void
}

export function ReaderThumbnailSurface({
  url,
  urls,
  kind = "page",
  fit = "cover",
  loading = false,
  imageLoading = "lazy",
  className,
  imageClassName,
  fallback,
  onDimensions,
}: ReaderThumbnailSurfaceProps) {
  const [failedUrls, setFailedUrls] = useState<ReadonlySet<string>>(() => new Set())
  const candidates = [...new Set(urls?.length ? urls : url ? [url] : [])]
  const candidateKey = candidates.join("\0")
  const visibleUrls = candidates.filter((candidate) => !failedUrls.has(candidate))
  const showImage = visibleUrls.length > 0
  const grid = candidates.length > 1
  const columns = Math.max(1, Math.ceil(Math.sqrt(visibleUrls.length)))
  const rows = Math.max(1, Math.ceil(visibleUrls.length / columns))

  useEffect(() => setFailedUrls(new Set()), [candidateKey])

  function reportDimensions(event: SyntheticEvent<HTMLImageElement>) {
    const image = event.currentTarget
    if (image.naturalWidth > 0 && image.naturalHeight > 0) onDimensions?.(image.naturalWidth, image.naturalHeight)
  }

  return (
    <span
      className={cn("grid shrink-0 place-items-center overflow-hidden rounded bg-muted/30", className)}
      data-reader-thumbnail-surface="true"
      data-thumbnail-fit={fit}
      data-thumbnail-state={showImage ? "ready" : loading ? "loading" : candidates.length ? "error" : "empty"}
    >
      {grid && showImage ? (
        <span
          className="grid size-full min-h-0 min-w-0 overflow-hidden"
          style={{
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
          }}
          data-thumbnail-grid-count={visibleUrls.length}
          data-thumbnail-grid-columns={columns}
          data-thumbnail-grid-rows={rows}
        >
          {visibleUrls.map((candidate) => (
            <span key={candidate} className="grid min-h-0 min-w-0 place-items-center overflow-hidden">
              <img
                src={candidate}
                alt=""
                loading={imageLoading}
                decoding="async"
                draggable={false}
                className={cn("size-full select-none object-contain", imageClassName)}
                onLoad={visibleUrls.length === 1 ? reportDimensions : undefined}
                onError={() => setFailedUrls((current) => new Set(current).add(candidate))}
              />
            </span>
          ))}
        </span>
      ) : showImage ? (
        <img
          src={visibleUrls[0]}
          alt=""
          loading={imageLoading}
          decoding="async"
          draggable={false}
          className={cn("size-full select-none", fit === "contain" ? "object-contain" : "object-cover", imageClassName)}
          onLoad={reportDimensions}
          onError={() => setFailedUrls((current) => new Set(current).add(visibleUrls[0]!))}
        />
      ) : loading ? (
        <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-label="正在加载缩略图" />
      ) : fallback ?? <ThumbnailFallback kind={kind} />}
    </span>
  )
}

function ThumbnailFallback({ kind }: { kind: NonNullable<ReaderThumbnailSurfaceProps["kind"]> }) {
  if (kind === "folder") return null
  if (kind === "file") return <FileIcon className="size-5 text-muted-foreground" aria-hidden="true" />
  return <ImageIcon className="size-5 text-muted-foreground" aria-hidden="true" />
}
