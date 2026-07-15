import type { ReaderPanelContext } from "../registry"
import { formatBytes, formatSourceKind } from "./reader-metadata-format"
import { useReaderMetadata } from "./useReaderMetadata"

export default function BookInformationCard({ session, client }: ReaderPanelContext) {
  if (!session) return null
  return <BookInformationContent session={session} client={client} />
}

function BookInformationContent({ session, client }: { session: NonNullable<ReaderPanelContext["session"]>; client: ReaderPanelContext["client"] }) {
  const state = useReaderMetadata(client, session.sessionId, session.frame.generation)
  const book = state.value?.book
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
      <MetadataState loading={state.loading} error={state.error} />
      <dt className="text-muted-foreground">名称</dt>
      <dd className="min-w-0 break-words text-right">{book?.displayName ?? session.book.displayName}</dd>
      <dt className="text-muted-foreground">路径</dt>
      <dd className="min-w-0 break-all text-right font-mono text-[10px]" title={book?.sourcePath}>{book?.sourcePath ?? "-"}</dd>
      <dt className="text-muted-foreground">类型</dt>
      <dd className="text-right">{book ? formatSourceKind(book.sourceKind) : "-"}</dd>
      <dt className="text-muted-foreground">页码</dt>
      <dd className="text-right tabular-nums">{book?.currentPage ?? session.frame.anchorPageIndex + 1} / {book?.pageCount ?? session.book.pageCount}</dd>
      <dt className="text-muted-foreground">进度</dt>
      <dd className="text-right tabular-nums">{book ? `${book.progressPercent.toFixed(1)}%` : "-"}</dd>
      <dt className="text-muted-foreground">源大小</dt>
      <dd className="text-right tabular-nums">{formatBytes(book?.byteLength)}</dd>
    </dl>
  )
}

function MetadataState({ loading, error }: { loading: boolean; error?: string }) {
  if (loading) return <div className="col-span-2 h-1 animate-pulse rounded bg-muted" aria-label="正在加载书籍信息" />
  return error ? <div className="col-span-2 text-xs text-destructive" role="alert">{error}</div> : null
}
