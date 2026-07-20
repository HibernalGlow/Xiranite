/**
 * @migrated-from src/lib/cards/properties/EmmTagsCard.svelte
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/properties/EmmTagsCard.tsx
 * @migration-status adapted
 */
import { RefreshCw } from "lucide-react"

import type { ReaderPanelContext } from "../registry"
import { ReaderCardEmptyState } from "./ReaderCardEmptyState"
import { useReaderMetadata } from "./useReaderMetadata"

export default function EmmTagsCard({ session, client, panelActive = true }: ReaderPanelContext) {
  if (!panelActive) return <ReaderCardEmptyState />
  if (!session) return <ReaderCardEmptyState>{"未打开书籍\n打开书籍后显示标签"}</ReaderCardEmptyState>
  return <EmmTagsContent sessionId={session.sessionId} client={client} />
}

function EmmTagsContent({ sessionId, client }: { sessionId: string; client: ReaderPanelContext["client"] }) {
  // EMM tags are static for an open book. A stable key avoids page-turn requests.
  const state = useReaderMetadata(client, sessionId, 0)
  if (state.loading) {
    return <div className="h-16 animate-pulse rounded bg-muted" aria-label="正在加载 EMM 标签" aria-busy="true" />
  }
  if (state.error) {
    return (
      <div className="grid min-h-16 justify-items-center gap-2 px-3 py-4 text-center text-[11px]" role="alert">
        <span className="text-destructive">{state.error}</span>
        <button className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" type="button" onClick={state.retry}>
          <RefreshCw className="size-3" aria-hidden="true" />
          重试
        </button>
      </div>
    )
  }
  const emm = state.value?.book.emm
  if (!emm) return <ReaderCardEmptyState>{"无 EMM 数据\n此书籍没有关联的 EMM 元数据"}</ReaderCardEmptyState>
  const tags = emm.tags ?? []
  if (!tags.length) return <ReaderCardEmptyState>暂无标签</ReaderCardEmptyState>
  return (
    <div className="space-y-2 text-[11px]" data-emm-tags-card="true">
      <ul className="flex min-w-0 flex-wrap gap-1" aria-label="EMM 标签" aria-describedby="emm-tags-count">
        {tags.map((value) => {
          const label = value.translatedLabel ?? value.tag
          return (
            <li
              key={`${value.namespace}\0${value.tag}`}
              className="inline-flex min-w-0 max-w-full items-center rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-muted/50"
              title={label !== value.tag ? value.tag : undefined}
              data-emm-tag-namespace={value.namespace}
            >
              <span className="min-w-0 break-words">{label}</span>
            </li>
          )
        })}
      </ul>
      <p id="emm-tags-count" className="pt-1 text-[10px] text-muted-foreground" role="status">
        共 {tags.length} 个标签
      </p>
    </div>
  )
}
