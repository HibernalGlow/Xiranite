/**
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/insights/ReadingStreakCard.tsx
 * @migration-status adapted
 */
import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"

import type { ReaderRecentDto } from "../../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../registry"
import { ReaderCardEmptyState } from "./ReaderCardEmptyState"
import { buildReadingStreak } from "./insights/reader-history-insights"

const HISTORY_WINDOW = 500

export default function ReadingStreakCard(props: ReaderPanelContext) {
  if (!props.panelActive) return <ReaderCardEmptyState>打开洞察面板后显示连续阅读</ReaderCardEmptyState>
  return <ReadingStreakContent {...props} />
}

function ReadingStreakContent({ client, disabled }: ReaderPanelContext) {
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
    () => buildReadingStreak(events.map((item) => ({ updatedAt: item.updatedAt }))),
    [events],
  )

  if (loading) {
    return <div className="h-24 animate-pulse rounded bg-muted" role="status" aria-live="polite" aria-label="正在加载连续阅读" />
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
    <div className="space-y-3" data-neoview-card="reading-streak">
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-xs text-muted-foreground">当前连续</p>
          <p className="text-lg font-semibold tabular-nums">{summary.currentStreak} 天</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">最长连续</p>
          <p className="text-lg font-semibold tabular-nums">{summary.longestStreak} 天</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">最近活跃</p>
          <p className="text-sm font-medium tabular-nums">{summary.lastActiveDate ?? "暂无"}</p>
        </div>
      </div>
      {summary.points.length ? (
        <div className="flex h-16 items-end gap-0.5" role="img" aria-label="连续阅读走势">
          {summary.points.slice(-28).map((point) => (
            <div
              key={point.date}
              title={`${point.date}: ${point.value} 天`}
              className="min-w-0 flex-1 rounded-t bg-primary/70"
              style={{ height: `${(point.value / summary.maxValue) * 100 || 4}%` }}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
