/**
 * @migrated-from src/lib/cards/properties/EmmRawDataCard.svelte
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/properties/EmmRawDataCard.tsx
 * @migration-status adapted
 */
import { useMemo, useState } from "react"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import type { ReaderPanelContext } from "../registry"
import { ReaderCardEmptyState } from "./ReaderCardEmptyState"
import { useReaderMetadata } from "./useReaderMetadata"

export default function EmmRawDataCard({ session, client, panelActive = true }: ReaderPanelContext) {
  if (!panelActive) return <ReaderCardEmptyState />
  if (!session) return <ReaderCardEmptyState>打开书籍后显示 EMM 数据库记录</ReaderCardEmptyState>
  return <EmmRawDataContent sessionId={session.sessionId} client={client} />
}

function EmmRawDataContent({ sessionId, client }: { sessionId: string; client: ReaderPanelContext["client"] }) {
  const state = useReaderMetadata(client, sessionId, 0)
  const [filter, setFilter] = useState("")
  const rows = useMemo(() => {
    const book = state.value?.book
    if (!book?.emm) return []
    const values = [
      ["filepath", book.sourcePath],
      ["translatedTitle", book.emm.translatedTitle],
      ["pageCount", String(book.pageCount)],
      ["tagCount", String(book.emm.tags?.length ?? 0)],
      ...(book.emm.tags ?? []).map((tag, index) => [`tag.${index + 1}`, `${tag.namespace}:${tag.tag}`]),
    ].filter((row): row is [string, string] => Boolean(row[1]))
    const query = filter.trim().toLocaleLowerCase()
    return query ? values.filter(([key, value]) => `${key} ${value}`.toLocaleLowerCase().includes(query)) : values
  }, [filter, state.value])
  if (state.loading) return <div className="h-24 animate-pulse rounded bg-muted" aria-label="正在加载 EMM 数据库记录" />
  if (state.error) return <div role="alert" className="py-4 text-center text-[11px] text-destructive">{state.error}</div>
  if (!state.value?.book.emm) return <ReaderCardEmptyState>当前书籍没有匹配的 EMM 数据库记录</ReaderCardEmptyState>
  return (
    <div className="space-y-2" data-emm-raw-data-card="true">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
        <Input value={filter} onChange={(event) => setFilter(event.currentTarget.value)} className="h-7 pl-7 text-[10px]" aria-label="过滤 EMM 字段和值" placeholder="过滤字段或值" />
      </label>
      <div className="max-h-56 overflow-auto rounded border">
        <table className="w-full table-fixed text-[10px]">
          <thead className="sticky top-0 bg-muted"><tr><th className="w-28 px-2 py-1 text-left font-medium">字段</th><th className="px-2 py-1 text-left font-medium">值</th></tr></thead>
          <tbody>{rows.map(([key, value]) => <tr key={key} className="border-t"><td className="truncate px-2 py-1 text-muted-foreground" title={key}>{key}</td><td className="break-all px-2 py-1" title={value}>{value}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="text-[10px] text-muted-foreground" role="status">{rows.length} 条已验证投影</p>
    </div>
  )
}
