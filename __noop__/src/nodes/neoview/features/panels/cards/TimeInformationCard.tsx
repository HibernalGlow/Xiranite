import { RefreshCw } from "lucide-react"
import { projectReaderTimeInformation } from "@xiranite/node-neoview/ui-core"

import type { ReaderPanelContext } from "../registry"
import { ReaderCardEmptyState } from "./ReaderCardEmptyState"
import { useReaderMetadata } from "./useReaderMetadata"

export default function TimeInformationCard({ session, client }: ReaderPanelContext) {
  if (!session) return <ReaderCardEmptyState>打开书本后显示时间信息</ReaderCardEmptyState>
  return <TimeInformationContent session={session} client={client} />
}

function TimeInformationContent({ session, client }: { session: NonNullable<ReaderPanelContext["session"]>; client: ReaderPanelContext["client"] }) {
  const state = useReaderMetadata(client, session.sessionId, session.frame.generation)
  if (state.loading) return <div className="h-14 animate-pulse rounded bg-muted" aria-label="正在加载时间信息" />
  if (state.error) {
    return (
      <div className="grid justify-items-center gap-2 py-2 text-center text-xs" role="alert">
        <span className="text-destructive">{state.error}</span>
        <button className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" type="button" onClick={state.retry}>
          <RefreshCw className="size-3" aria-hidden="true" />
          重试
        </button>
      </div>
    )
  }
  const page = state.value?.page
  const book = state.value?.book
  if (!page && !book) return <div className="py-2 text-center text-sm text-muted-foreground">暂无时间信息</div>
  const source = page?.timeSource ?? (book ? "book-source" : undefined)
  const projection = projectReaderTimeInformation({
    source,
    createdAtMs: page ? page.createdAtMs : book?.createdAtMs,
    modifiedAtMs: page ? page.modifiedAtMs : book?.modifiedAtMs,
    accessedAtMs: page ? page.accessedAtMs : book?.accessedAtMs,
  }, "zh")
  return (
    <dl className="space-y-2 text-sm" data-time-source={source}>
      <MetadataRow label="创建时间" value={projection.createdText} />
      <MetadataRow label="修改时间" value={projection.modifiedText} />
      <MetadataRow label="访问时间" value={projection.accessedText} />
      <MetadataRow label="时间来源" value={projection.sourceLabel} />
    </dl>
  )
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right text-xs tabular-nums" title={value}>{value}</dd>
    </div>
  )
}
