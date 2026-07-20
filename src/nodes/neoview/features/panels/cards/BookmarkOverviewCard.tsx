/**
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/insights/BookmarkOverviewCard.tsx
 * @migration-status adapted
 */
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"

import type { ReaderLibraryStatisticsDto } from "../../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../registry"
import { ReaderCardEmptyState } from "./ReaderCardEmptyState"

export default function BookmarkOverviewCard(props: ReaderPanelContext) {
  if (!props.panelActive) return <ReaderCardEmptyState>打开洞察面板后显示书签总览</ReaderCardEmptyState>
  return <BookmarkOverviewContent {...props} />
}

function BookmarkOverviewContent({ client, disabled }: ReaderPanelContext) {
  const [stats, setStats] = useState<ReaderLibraryStatisticsDto>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!client.libraryStatistics) {
      setLoading(false)
      setError("当前 Reader 后端不支持书签统计。")
      return
    }
    const controller = new AbortController()
    setLoading(true)
    void client.libraryStatistics(controller.signal).then((value) => {
      if (controller.signal.aborted) return
      setStats(value)
      setError(undefined)
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [client, revision])

  if (loading) {
    return <div className="h-20 animate-pulse rounded bg-muted" role="status" aria-live="polite" aria-label="正在加载书签总览" />
  }
  if (error) {
    return (
      <div className="grid gap-2 text-xs">
        <div role="alert" className="text-destructive">{error}</div>
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => setRevision((value) => value + 1)}>重试</Button>
      </div>
    )
  }
  if (!stats) return <ReaderCardEmptyState>暂无书签数据</ReaderCardEmptyState>

  const rows = [
    { label: "历史记录", value: stats.recentCount },
    { label: "书签", value: stats.bookmarkCount },
    { label: "书签列表", value: stats.bookmarkListCount },
    { label: "媒体进度", value: stats.mediaProgressCount },
  ] as const
  const max = Math.max(...rows.map((row) => row.value), 1)

  return (
    <div className="space-y-3" data-neoview-card="bookmark-overview">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">总计书签</span>
        <span className="text-lg font-semibold tabular-nums">{stats.bookmarkCount}</span>
      </div>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-[10px] text-muted-foreground">{row.label}</span>
            <Progress value={(row.value / max) * 100} className="h-1.5 flex-1" />
            <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
