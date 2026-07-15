import type { ReaderPanelContext } from "../registry"
import { formatBytes } from "./reader-metadata-format"
import { useReaderMetadata } from "./useReaderMetadata"

export default function StorageInformationCard({ session, client }: ReaderPanelContext) {
  if (!session) return null
  return <StorageInformationContent session={session} client={client} />
}

function StorageInformationContent({ session, client }: { session: NonNullable<ReaderPanelContext["session"]>; client: ReaderPanelContext["client"] }) {
  const state = useReaderMetadata(client, session.sessionId, session.frame.generation)
  if (state.loading) return <div className="h-10 animate-pulse rounded bg-muted" aria-label="正在加载存储信息" />
  if (state.error) return <div role="alert" className="text-xs text-destructive">{state.error}</div>
  const page = state.value?.page
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
      <dt className="text-muted-foreground">路径</dt><dd className="min-w-0 break-all text-right font-mono text-[10px]" title={page?.displayPath}>{page?.displayPath ?? "-"}</dd>
      <dt className="text-muted-foreground">页面大小</dt><dd className="text-right tabular-nums">{formatBytes(page?.byteLength)}</dd>
      <dt className="text-muted-foreground">书籍大小</dt><dd className="text-right tabular-nums">{formatBytes(state.value?.book.byteLength)}</dd>
    </dl>
  )
}
