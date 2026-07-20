/**
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/ai/AiTranslationCacheCard.tsx
 * @migration-status adapted
 */
import { Database, Download, HardDrive, Loader2, RefreshCcw, Trash2, Upload } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"

import type { ReaderAiCacheStatsDto } from "../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../registry"
import { ReaderCardEmptyState } from "./ReaderCardEmptyState"
import { formatAiCount, formatAiHitRate } from "./ai/ai-translation-defaults"

export default function AiTranslationCacheCard(props: ReaderPanelContext) {
  if (!props.panelActive) return <ReaderCardEmptyState>打开 AI 面板后管理翻译缓存</ReaderCardEmptyState>
  return <AiTranslationCacheContent {...props} />
}

function AiTranslationCacheContent({ client, disabled }: ReaderPanelContext) {
  const [stats, setStats] = useState<ReaderAiCacheStatsDto>()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [message, setMessage] = useState<string>()

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!client.aiCacheStats) {
      setError("当前 Reader 后端不支持 AI 缓存统计。")
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const next = await client.aiCacheStats(signal)
      if (signal?.aborted) return
      setStats(next)
      setError(undefined)
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [client])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)
    return () => controller.abort()
  }, [refresh])

  async function clear(scope: "memory" | "persistent" | "all"): Promise<void> {
    if (!client.aiClearCache) {
      setError("当前 Reader 后端不支持清理 AI 缓存。")
      return
    }
    setBusy(true)
    setError(undefined)
    setMessage(undefined)
    try {
      const result = await client.aiClearCache(scope)
      setMessage(`已清理 ${result.cleared} 条（${result.scope}）`)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  function exportSnapshot(): void {
    const payload = {
      exportedAt: new Date().toISOString(),
      stats: stats ?? null,
      note: "Live entry export is not yet exposed by the control plane; this snapshot covers session metrics only.",
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `neoview-ai-translation-cache-${Date.now()}.json`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    setMessage("已导出缓存统计快照")
  }

  if (loading && !stats) {
    return <div className="h-24 animate-pulse rounded-md bg-muted/40" role="status" aria-label="正在加载翻译缓存" />
  }

  return (
    <div className="space-y-3 text-xs" data-neoview-card="ai-translation-cache">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <Database className="size-3.5 text-muted-foreground" />
        翻译缓存
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Metric label="缓存条目" value={formatAiCount(stats?.memoryEntries)} emphasis />
        <Metric label="缓存命中率" value={formatAiHitRate(stats?.hitRate)} emphasis />
      </div>

      <div className="space-y-1 rounded-md border border-border/50 bg-muted/15 px-2.5 py-2 text-[11px]">
        <StatRow label="总翻译数" value={formatAiCount(stats?.totalTranslations)} />
        <StatRow label="缓存命中" value={formatAiCount(stats?.cacheHits)} />
        <StatRow label="API 调用" value={formatAiCount(stats?.apiCalls)} />
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <HardDrive className="size-3" />
            数据库缓存
          </span>
          <span className="inline-flex items-center gap-1 tabular-nums">
            {formatAiCount(stats?.persistentEntries)}
            <button
              type="button"
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              title="刷新数据库缓存数量"
              disabled={disabled || busy}
              onClick={() => void refresh()}
            >
              <RefreshCcw className="size-3" />
            </button>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-[10px]" disabled={disabled || busy} onClick={exportSnapshot}>
          <Download className="size-3" />
          导出
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-[10px]" disabled title="条目导入尚未接入统一控制面">
          <Upload className="size-3" />
          导入
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1 text-[10px] text-destructive hover:text-destructive"
          disabled={disabled || busy}
          onClick={() => void clear("all")}
        >
          {busy ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
          清空
        </Button>
      </div>

      {error ? <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive">{error}</div> : null}
      {message ? <div className="text-[11px] text-muted-foreground" role="status">{message}</div> : null}
    </div>
  )
}

function Metric({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-center">
      <div className={emphasis ? "text-2xl font-bold tabular-nums text-primary" : "text-lg font-semibold tabular-nums"}>
        {value}
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground">{label}</div>
    </div>
  )
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}
