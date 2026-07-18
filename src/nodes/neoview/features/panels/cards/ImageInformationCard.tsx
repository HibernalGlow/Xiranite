import { ImageIcon, Video } from "lucide-react"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import type { ReaderPanelContext } from "../registry"
import { ReaderCardEmptyState } from "./ReaderCardEmptyState"
import {
  formatMediaBitRate,
  formatMediaDuration,
  formatMediaFileSize,
  formatMediaFormat,
  formatMediaKind,
} from "./reader-metadata-format"
import { useReaderMetadata } from "./useReaderMetadata"
import { useReaderPageMediaInformation } from "./useReaderPageMediaInformation"

/**
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/info/ImageInfoCard.tsx
 */
export default function ImageInformationCard(context: ReaderPanelContext) {
  if (!context.session || context.panelActive === false) {
    return (
      <section data-neoview-card="image-information" data-image-information-state="empty">
        <ReaderCardEmptyState>暂无媒体信息</ReaderCardEmptyState>
      </section>
    )
  }
  return <ImageInformationContent {...context} session={context.session} />
}

function ImageInformationContent({ session, client, presentation }: ReaderPanelContext & { session: NonNullable<ReaderPanelContext["session"]> }) {
  const metadata = useReaderMetadata(client, session.sessionId, session.frame.generation)
  const page = metadata.value?.page
  const activePage = session.visiblePages.find((candidate) => candidate.index === session.frame.anchorPageIndex)
  const media = useReaderPageMediaInformation(client, session.sessionId, activePage)

  if (metadata.loading) return <div className="h-12 animate-pulse rounded bg-muted" aria-label="正在加载图像信息" />
  if (metadata.error) {
    return (
      <div className="grid gap-2 text-sm">
        <div role="alert" className="text-xs text-destructive">{metadata.error}</div>
        <Button type="button" size="sm" variant="outline" onClick={metadata.retry}>重试图像信息</Button>
      </div>
    )
  }
  if (!page) return <div className="py-2 text-center text-sm text-muted-foreground">暂无媒体信息</div>

  const video = page.mediaKind === "video"
  const dimensions = rotatedDimensions(page.dimensions, presentation?.rotation)
  return (
    <div className="space-y-2 text-sm" data-neoview-image-information="true">
      <dl className="contents">
        <InformationRow label="类型">
          <span className="flex items-center gap-1">
            {video ? <Video className="size-4" aria-hidden="true" /> : <ImageIcon className="size-4" aria-hidden="true" />}
            {formatMediaKind(page.mediaKind)}
          </span>
        </InformationRow>
        <InformationRow label="文件名">
          <span className="max-w-[150px] truncate font-mono text-xs" title={page.name}>{page.name}</span>
        </InformationRow>
        <InformationRow label="尺寸">
          <span className="tabular-nums">{page.dimensions ? `${page.dimensions.width} × ${page.dimensions.height}` : "—"}</span>
        </InformationRow>

        {video ? (
          <>
            <InformationRow label="时长"><span className="tabular-nums">{formatMediaDuration(media.value?.durationSeconds)}</span></InformationRow>
            {media.value?.frameRate ? <InformationRow label="帧率"><span className="tabular-nums">{media.value.frameRate.toFixed(0)} fps</span></InformationRow> : null}
            {media.value?.bitRateBps ? <InformationRow label="码率"><span className="tabular-nums">{formatMediaBitRate(media.value.bitRateBps)}</span></InformationRow> : null}
            {media.value?.videoCodec ? <InformationRow label="视频编码"><span className="max-w-[150px] break-words text-right" title={media.value.videoCodec}>{media.value.videoCodec}</span></InformationRow> : null}
            {media.value?.audioCodec ? <InformationRow label="音频编码"><span className="max-w-[150px] break-words text-right" title={media.value.audioCodec}>{media.value.audioCodec}</span></InformationRow> : null}
          </>
        ) : (
          <>
            <InformationRow label="格式">{formatMediaFormat(page.name, page.mimeType)}</InformationRow>
            {page.byteLength ? <InformationRow label="大小"><span className="tabular-nums">{formatMediaFileSize(page.byteLength)}</span></InformationRow> : null}
          </>
        )}
      </dl>

      {video && media.loading ? <div role="status" aria-live="polite" className="text-xs text-muted-foreground">正在读取视频信息</div> : null}
      {video && media.error ? (
        <div className="grid gap-1.5 border-t pt-2">
          <div role="alert" className="text-xs text-destructive">{media.error}</div>
          <Button type="button" size="sm" variant="outline" onClick={media.retry}>重试视频信息</Button>
        </div>
      ) : null}

      <dl className="space-y-2 border-t pt-2">
        <InformationRow label="MIME"><span className="max-w-[150px] break-words text-right" title={page.mimeType}>{page.mimeType ?? "—"}</span></InformationRow>
        {presentation ? (
          <>
            <InformationRow label="旋转后尺寸"><span className="tabular-nums">{dimensions ? `${dimensions.width} × ${dimensions.height}` : "—"}</span></InformationRow>
            <InformationRow label="适应模式">{formatFitMode(presentation.fitMode)}</InformationRow>
            <InformationRow label="手动缩放"><span className="tabular-nums">{Math.round(presentation.manualScale * 100)}%</span></InformationRow>
          </>
        ) : null}
      </dl>
    </div>
  )
}

function InformationRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}:</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  )
}

function rotatedDimensions(dimensions: { width: number; height: number } | undefined, rotation = 0) {
  if (!dimensions) return undefined
  return rotation === 90 || rotation === 270
    ? { width: dimensions.height, height: dimensions.width }
    : dimensions
}

function formatFitMode(mode: string): string {
  if (mode === "fit") return "适应窗口"
  if (mode === "fill") return "填满窗口"
  if (mode === "fit-width") return "适应宽度"
  if (mode === "fit-height") return "适应高度"
  if (mode === "original") return "原始大小"
  return mode
}
