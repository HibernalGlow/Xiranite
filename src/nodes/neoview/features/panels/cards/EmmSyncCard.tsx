/**
 * @migrated-from src/lib/cards/properties/EmmSyncCard.svelte
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/properties/EmmSyncCard.tsx
 * @migration-status adapted
 */
import { Database, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ReaderPanelContext } from "../registry"
import { ReaderCardEmptyState } from "./ReaderCardEmptyState"
import { useReaderMetadata } from "./useReaderMetadata"

export default function EmmSyncCard({ session, client, panelActive = true }: ReaderPanelContext) {
  if (!panelActive) return <ReaderCardEmptyState />
  if (!session) return <ReaderCardEmptyState>打开书籍后检查 EMM 数据源</ReaderCardEmptyState>
  return <EmmSyncContent sessionId={session.sessionId} client={client} />
}

function EmmSyncContent({ sessionId, client }: { sessionId: string; client: ReaderPanelContext["client"] }) {
  const state = useReaderMetadata(client, sessionId, 0)
  if (state.loading) return <div className="h-20 animate-pulse rounded bg-muted" aria-label="正在检查 EMM 数据源" />
  if (state.error) return <EmmError message={state.error} retry={state.retry} />
  const available = Boolean(state.value?.book.emm)
  return (
    <div className="space-y-3 text-[11px]" data-emm-sync-card="true">
      <div className="flex items-start gap-2 rounded border bg-muted/30 p-2.5">
        <Database className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 space-y-1">
          <p className="font-medium">{available ? "外部 EMM 数据已连接" : "当前书籍未匹配 EMM 记录"}</p>
          <p className="text-[10px] leading-relaxed text-muted-foreground">当前版本按文件路径实时读取 database.sqlite；无需先把标签和评分同步到 thumbnails.db。</p>
        </div>
      </div>
      <Button type="button" size="sm" variant="outline" className="h-7 text-[10px]" disabled={state.loading} onClick={state.retry}>
        <RefreshCw data-icon="inline-start" />重新读取
      </Button>
    </div>
  )
}

function EmmError({ message, retry }: { message: string; retry(): void }) {
  return <div role="alert" className="grid min-h-20 justify-items-center gap-2 text-center text-[11px] text-destructive"><span>{message}</span><Button type="button" size="sm" variant="outline" onClick={retry}>重试</Button></div>
}
