/**
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/insights/ReadingHeatmapCard.tsx
 * @migration-status adapted
 */
import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"

import type { ReaderRecentDto } from "../../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../registry"
import { ReaderCardEmptyState } from "./ReaderCardEmptyState"
import { buildReadingHeatmap } from "./insights/reader-history-insights"

const HISTORY_WINDOW = 500
const WEEKDAY_SHORT = ["日", "一", "二", "三", "四", "五", "六"] as const

export default function ReadingHeatmapCard(props: ReaderPanelContext) {
  if (!props.panelActive) return <ReaderCardEmptyState>打开洞察面板后显示阅读热力</ReaderCardEmptyState>
  return <ReadingHeatmapContent {...props} />
}

function ReadingHeatmapContent({ client, disabled }: ReaderPanelContext) {
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
    () => buildReadingHeatmap(events.map((item) => ({ updatedAt: item.updatedAt }))),
    [events],
  )

  if (loading) {
    return <div className="h-28 animate-pulse rounded bg-muted" role="status" aria-live="polite" aria-label="正在加载阅读热力" />
  }
  if (error) {
    return (
      <div className="grid gap-2 text-xs">
        <div role="alert" className="text-destructive">{error}</div>
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => setRevision((value) => value + 1)}>重试</Button>
      </div>
    )
  }
  if (!events.length) return <ReaderCardEmptyState>暂无历史访问记录</ReaderCardEmptyState>

  return (
    <div className="space-y-3 overflow-hidden" data-neoview-card="reading-heatmap">
      {summary.topSlot ? (
        <p className="text-xs text-muted-foreground">
          高峰时段:{" "}
          <span className="font-medium text-foreground">
            {summary.topSlot.weekdayLabel} {summary.topSlot.hourLabel}
          </span>
        </p>
      ) : null}
      <div
        className="grid gap-0.5 overflow-hidden"
        style={{ gridTemplateColumns: "auto repeat(24, minmax(0, 1fr))" }}
        role="img"
        aria-label="星期与小时阅读热力图"
      >
        <span />
        {Array.from({ length: 24 }, (_, hour) => (
          <span key={hour} className="text-center text-[8px] text-muted-foreground tabular-nums">
            {hour % 6 === 0 ? hour : ""}
          </span>
        ))}
        {WEEKDAY_SHORT.map((label, weekday) => (
          <HeatmapRow
            key={label}
            label={label}
            weekday={weekday}
            maxCount={summary.maxCount}
            cells={summary.cells}
          />
        ))}
      </div>
    </div>
  )
}

function HeatmapRow({
  label,
  weekday,
  maxCount,
  cells,
}: {
  label: string
  weekday: number
  maxCount: number
  cells: ReturnType<typeof buildReadingHeatmap>["cells"]
}) {
  return (
    <>
      <span className="pr-1 text-[10px] text-muted-foreground">{label}</span>
      {Array.from({ length: 24 }, (_, hour) => {
        const cell = cells[weekday * 24 + hour]!
        const intensity = maxCount > 0 ? cell.count / maxCount : 0
        return (
          <span
            key={hour}
            title={`${cell.weekdayLabel} ${cell.hourLabel}: ${cell.count}`}
            className="aspect-square min-h-2 rounded-[2px]"
            style={{
              backgroundColor: cell.count === 0
                ? "color-mix(in oklab, var(--muted) 55%, transparent)"
                : `color-mix(in oklab, var(--primary) ${Math.max(18, Math.round(intensity * 100))}%, transparent)`,
            }}
          />
        )
      })}
    </>
  )
}
