import type { ReaderPanelContext } from "../registry"

export default function BookInformationCard({ session }: ReaderPanelContext) {
  const page = session.visiblePages[0]
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
      <dt className="text-muted-foreground">名称</dt>
      <dd className="min-w-0 break-words text-right">{session.book.displayName}</dd>
      <dt className="text-muted-foreground">页数</dt>
      <dd className="text-right tabular-nums">{session.book.pageCount}</dd>
      <dt className="text-muted-foreground">当前页</dt>
      <dd className="min-w-0 truncate text-right" title={page?.name}>{page?.name ?? "—"}</dd>
      <dt className="text-muted-foreground">格式</dt>
      <dd className="text-right">{page?.mimeType ?? "—"}</dd>
      <dt className="text-muted-foreground">尺寸</dt>
      <dd className="text-right tabular-nums">{page?.dimensions ? `${page.dimensions.width} × ${page.dimensions.height}` : "—"}</dd>
    </dl>
  )
}
