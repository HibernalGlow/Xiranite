/**
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/insights/DailyTrendCard.tsx
 * @migration-status adapted
 */
import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"

import type { ReaderHttpClient, ReaderRecentDto } from "../../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../registry"
import { ReaderCardEmptyState } from "./ReaderCardEmptyState"
import { buildDailyTrend } from "./insights/reader-history-insights"

const HISTORY_WINDOW = 500

export default function DailyTrendCard(props: ReaderPanelContext) {
  if (!props.panelActive) return <ReaderCardEmptyState>打开洞察面板后显示近 7 日趋势</ReaderCardEmptyState>
  return <DailyTrendContent {...props} />
}

function DailyTrendContent({ client, disabled }: ReaderPanelContext) {
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
    () => buildDailyTrend(events.map((item) => ({ updatedAt: item.updatedAt }))),
    [events],
  )

  if (loading) {
    return <div className="h-24 animate-pulse rounded bg-muted" role="status" aria-live="polite" aria-label="正在加载阅读趋势" />
  }
  if (error) {
    return (
      <div className="grid gap-2 text-xs">
        <div role="alert" className="text-destructive">{error}</div>
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => setRevision((value) => value + 1)}>重试</Button>
      </div>
    )
  }
  if (!events.length) {
    return <ReaderCardEmptyState>暂无历史访问记录</ReaderCardEmptyState>
  }

  return (
    <div className="space-y-3 text-xs" data-neoview-card="daily-trend">
      <div className="flex items-center justify-between text-muted-foreground">
        <span>本周共 {summary.currentWeek} 次访问</span>
        <span className={summary.deltaPercent >= 0 ? "text-emerald-500" : "text-red-500"}>
          {summary.deltaPercent >= 0 ? "+" : ""}
          {summary.deltaPercent}% 对比上周
        </span>
      </div>
      <div className="flex items-end gap-2" role="img" aria-label="近 7 日阅读趋势柱状图">
        {summary.days.map((day) => (
          <div key={day.key} className="flex flex-1 flex-col items-center gap-2 text-[11px] text-muted-foreground" title={`${day.key}: ${day.count}`}>
            <div className="flex h-16 w-full items-end rounded bg-muted/50">
              <div
                className={`w-full rounded-t ${day.count === summary.maxCount ? "bg-primary" : "bg-primary/70"}`}
                style={{ height: `${(day.count / summary.maxCount) * 100 || 4}%` }}
              />
            </div>
            <span>{day.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Keep the client type reference visible for adapters that tree-shake unused imports carefully.
export type DailyTrendClient = Pick<ReaderHttpClient, "listRecent">
