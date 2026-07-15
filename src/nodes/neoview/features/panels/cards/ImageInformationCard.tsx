import type { ReaderPanelContext } from "../registry"
import { formatBytes, formatMediaKind } from "./reader-metadata-format"
import { useReaderMetadata } from "./useReaderMetadata"

export default function ImageInformationCard({ session, client }: ReaderPanelContext) {
  if (!session) return null
  return <ImageInformationContent session={session} client={client} />
}

function ImageInformationContent({ session, client }: { session: NonNullable<ReaderPanelContext["session"]>; client: ReaderPanelContext["client"] }) {
  const state = useReaderMetadata(client, session.sessionId, session.frame.generation)
  const page = state.value?.page
  if (state.loading) return <div className="h-12 animate-pulse rounded bg-muted" aria-label="正在加载图像信息" />
  if (state.error) return <div role="alert" className="text-xs text-destructive">{state.error}</div>
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
      <dt className="text-muted-foreground">类型</dt><dd className="text-right">{page ? formatMediaKind(page.mediaKind) : "-"}</dd>
      <dt className="text-muted-foreground">文件名</dt><dd className="min-w-0 truncate text-right font-mono text-[10px]" title={page?.name}>{page?.name ?? "-"}</dd>
      <dt className="text-muted-foreground">尺寸</dt><dd className="text-right tabular-nums">{page?.dimensions ? `${page.dimensions.width} x ${page.dimensions.height}` : "-"}</dd>
      <dt className="text-muted-foreground">格式</dt><dd className="text-right">{page?.mimeType ?? "-"}</dd>
      <dt className="text-muted-foreground">大小</dt><dd className="text-right tabular-nums">{formatBytes(page?.byteLength)}</dd>
    </dl>
  )
}
