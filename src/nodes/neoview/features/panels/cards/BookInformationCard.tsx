import { RefreshCw } from "lucide-react"
import type { ReactNode } from "react"

import type { ReaderMetadataDto } from "../../../adapters/reader-http-client"
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
  const translatedTitle = book.emm?.translatedTitle?.trim()
  const hasTranslatedTitle = Boolean(translatedTitle && translatedTitle !== book.displayName)
  return (
    <dl className="space-y-2 text-sm" data-book-information="true">
      <MetadataRow label="名称">
        <span
          className={hasTranslatedTitle
            ? "max-w-[min(200px,70%)] break-words rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-right text-xs text-primary"
            : "min-w-0 max-w-[min(200px,70%)] break-words text-right font-medium"}
          title={translatedTitle || book.displayName}
        >
          {translatedTitle || book.displayName}
        </span>
      </MetadataRow>
      {hasTranslatedTitle ? <MetadataRow label="原名"><MetadataValue value={book.displayName} mono /></MetadataRow> : null}
      <MetadataRow label="路径"><MetadataValue value={book.sourcePath} mono /></MetadataRow>
      <MetadataRow label="类型"><MetadataValue value={formatBookType(book)} /></MetadataRow>
      <MetadataRow label="页码"><MetadataValue value={`${book.currentPage} / ${book.pageCount}`} numeric /></MetadataRow>
      <MetadataRow label="进度"><MetadataValue value={book.progressPercent === undefined ? "—" : `${book.progressPercent.toFixed(1)}%`} numeric /></MetadataRow>
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

function formatBookType(book: ReaderMetadataDto["book"]): string {
  if (book.sourceKind === "directory") return "文件夹"
  if (book.sourceKind === "archive") return "压缩包"
  if (book.sourceKind === "document" && book.sourceFormat === "pdf") return "PDF"
  if (book.sourceKind === "document" && book.sourceFormat === "epub") return "EPUB"
  if (book.sourceKind === "media") return "媒体"
  if (book.sourceKind === "image") return "图片"
  if (book.sourceKind === "document") return "文档"
  return "未知"
}
