/**
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/insights/SourceBreakdownCard.tsx
 * @migration-status adapted
 */
import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"

import type { ReaderRecentDto } from "../../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../registry"
import { ReaderCardEmptyState } from "./ReaderCardEmptyState"
import { buildSourceBreakdown } from "./insights/reader-history-insights"

const HISTORY_WINDOW = 500

export default function SourceBreakdownCard(props: ReaderPanelContext) {
  if (!props.panelActive) return <ReaderCardEmptyState>打开洞察面板后显示来源拆分</ReaderCardEmptyState>
  return <SourceBreakdownContent {...props} />
}

function SourceBreakdownContent({ client, disabled }: ReaderPanelContext) {
  const [events, setEvents] = useState<readonly ReaderRecentDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!client.listRecent) {
      setLoading(false)
      setError("当前 Reader 后端不支持历史洞察。")
      return
    }
    const controller = new AbortController()
    setLoading(true)
    void client.listRecent(0, HISTORY_WINDOW, controller.signal).then((items) => {
      if (controller.signal.aborted) return
      setEvents(items)
      setError(undefined)
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [client, revision])

  const summary = useMemo(
    () => buildSourceBreakdown(events.map((item) => ({
      updatedAt: item.updatedAt,
      path: item.source.path,
      sourceKind: item.source.kind,
    }))),
    [events],
  )

  if (loading) {
    return <div className="h-20 animate-pulse rounded bg-muted" role="status" aria-live="polite" aria-label="正在加载来源拆分" />
  }
  if (error) {
    return (
      <div className="grid gap-2 text-xs">
        <div role="alert" className="text-destructive">{error}</div>
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => setRevision((value) => value + 1)}>重试</Button>
      </div>
    )
  }
  if (!summary.items.length) return <ReaderCardEmptyState>暂无来源数据</ReaderCardEmptyState>

  return (
    <div className="space-y-3" data-neoview-card="source-breakdown">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>样本窗口</span>
        <span className="tabular-nums">{summary.total} 条</span>
      </div>
      {summary.items.map((item) => (
        <div key={item.source} className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span>{item.source}</span>
            <span className="tabular-nums text-muted-foreground">{item.count} ({item.percent}%)</span>
          </div>
          <Progress value={item.percent} className="h-1.5" />
        </div>
      ))}
    </div>
  )
}
