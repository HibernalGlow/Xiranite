import { RefreshCw } from "lucide-react"
import { projectReaderBookInformation } from "@xiranite/node-neoview/ui-core"
import type { ReactNode } from "react"

import type { ReaderPanelContext } from "../registry"
import { useReaderMetadata } from "./useReaderMetadata"

export default function BookInformationCard({ session, client }: ReaderPanelContext) {
  if (!session) return null
  return <BookInformationContent session={session} client={client} />
}

function BookInformationContent({ session, client }: { session: NonNullable<ReaderPanelContext["session"]>; client: ReaderPanelContext["client"] }) {
  const state = useReaderMetadata(client, session.sessionId, session.frame.generation)
  if (state.loading) return <div className="h-24 animate-pulse rounded bg-muted" aria-label="正在加载书籍信息" />
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
  const book = state.value?.book
  if (!book) return <div className="py-2 text-center text-sm text-muted-foreground">暂无书籍信息</div>
  const projection = projectReaderBookInformation({
    displayName: book.displayName,
    translatedTitle: book.emm?.translatedTitle,
    sourceKind: book.sourceKind,
    sourceFormat: book.sourceFormat,
    currentPage: book.currentPage,
    pageCount: book.pageCount,
  }, "zh")
  const hasTranslatedTitle = Boolean(projection.originalTitle)
  return (
    <dl className="space-y-2 text-sm" data-book-information="true">
      <MetadataRow label="名称">
        <span
          className={hasTranslatedTitle
            ? "max-w-[min(200px,70%)] break-words rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-right text-xs text-primary"
            : "min-w-0 max-w-[min(200px,70%)] break-words text-right font-medium"}
          title={projection.displayTitle}
        >
          {projection.displayTitle}
        </span>
      </MetadataRow>
      {projection.originalTitle ? <MetadataRow label="原名"><MetadataValue value={projection.originalTitle} mono /></MetadataRow> : null}
      <MetadataRow label="路径"><MetadataValue value={book.sourcePath} mono /></MetadataRow>
      <MetadataRow label="类型"><MetadataValue value={projection.typeLabel} /></MetadataRow>
      <MetadataRow label="页码"><MetadataValue value={projection.pageText} numeric /></MetadataRow>
      <MetadataRow label="进度"><MetadataValue value={projection.progressText} numeric /></MetadataRow>
    </dl>
  )
}

function MetadataRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="contents">{children}</dd>
    </div>
  )
}

function MetadataValue({ value, mono = false, numeric = false }: { value: string; mono?: boolean; numeric?: boolean }) {
  return (
    <span className={`min-w-0 max-w-[min(200px,70%)] break-words text-right text-xs${mono ? " font-mono" : ""}${numeric ? " tabular-nums" : ""}`} title={value}>
      {value}
    </span>
  )
}
