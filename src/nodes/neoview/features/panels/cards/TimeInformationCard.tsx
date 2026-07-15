import type { ReaderPanelContext } from "../registry"
import { formatDate } from "./reader-metadata-format"
import { useReaderMetadata } from "./useReaderMetadata"

export default function TimeInformationCard({ session, client }: ReaderPanelContext) {
  if (!session) return null
  return <TimeInformationContent session={session} client={client} />
}

function TimeInformationContent({ session, client }: { session: NonNullable<ReaderPanelContext["session"]>; client: ReaderPanelContext["client"] }) {
  const state = useReaderMetadata(client, session.sessionId, session.frame.generation)
  if (state.loading) return <div className="h-10 animate-pulse rounded bg-muted" aria-label="正在加载时间信息" />
  if (state.error) return <div role="alert" className="text-xs text-destructive">{state.error}</div>
  const page = state.value?.page
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
      <dt className="text-muted-foreground">创建时间</dt><dd className="text-right text-[10px]">{formatDate(page?.createdAtMs ?? state.value?.book.createdAtMs)}</dd>
      <dt className="text-muted-foreground">修改时间</dt><dd className="text-right text-[10px]">{formatDate(page?.modifiedAtMs ?? state.value?.book.modifiedAtMs)}</dd>
    </dl>
  )
}
