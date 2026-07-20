/**
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/ai/AiTranslationCacheCard.tsx
 * @migration-status adapted
 */
import { Database, Loader2, Trash2 } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"

import type { ReaderAiCacheStatsDto } from "../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../registry"
import { ReaderCardEmptyState } from "./ReaderCardEmptyState"

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

  if (loading && !stats) {
    return <div className="h-20 animate-pulse rounded bg-muted" role="status" aria-label="正在加载翻译缓存" />
  }

  return (
    <div className="space-y-3 text-xs" data-neoview-card="ai-translation-cache">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Database className="size-4 text-muted-foreground" />
        翻译缓存
      </div>
      <div className="grid grid-cols-2 gap-2 rounded-md border bg-muted/30 p-3">
        <div>
          <div className="text-muted-foreground">内存缓存</div>
          <div className="text-lg font-semibold tabular-nums">{stats?.memoryEntries ?? 0}</div>
        </div>
        <div>
          <div className="text-muted-foreground">持久缓存</div>
          <div className="text-lg font-semibold tabular-nums">{stats?.persistentEntries ?? "—"}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={disabled || busy} onClick={() => void refresh()}>刷新</Button>
        <Button type="button" size="sm" variant="outline" disabled={disabled || busy} onClick={() => void clear("memory")}>
          {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}
          清内存
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={disabled || busy || stats?.persistentEntries == null} onClick={() => void clear("persistent")}>
          清持久
        </Button>
        <Button type="button" size="sm" variant="destructive" disabled={disabled || busy} onClick={() => void clear("all")}>
          全部清空
        </Button>
      </div>
      {error ? <div role="alert" className="text-destructive">{error}</div> : null}
      {message ? <div className="text-muted-foreground">{message}</div> : null}
    </div>
  )
}
