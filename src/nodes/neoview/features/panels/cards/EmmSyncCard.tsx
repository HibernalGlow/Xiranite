/**
 * @migrated-from src/lib/cards/properties/EmmSyncCard.svelte
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/properties/EmmSyncCard.tsx
 * @migration-status adapted
 */
import { Database, Pencil, RefreshCw, Save, Undo2 } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
  const [editing, setEditing] = useState(false)
  const [snapshot, setSnapshot] = useState<import("../../../adapters/reader-http-client").ReaderEmmMetadataSnapshotDto>()
  const [rating, setRating] = useState("")
  const [translatedTitle, setTranslatedTitle] = useState("")
  const [loadingOverride, setLoadingOverride] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    setEditing(false)
    setSnapshot(undefined)
    setError(undefined)
  }, [sessionId])

  async function openEditor() {
    if (!client.getEmmMetadata) {
      setError("当前 Reader 后端不支持 XR EMM 覆盖编辑。")
      return
    }
    setLoadingOverride(true)
    setError(undefined)
    try {
      const value = await client.getEmmMetadata(sessionId)
      setSnapshot(value)
      setRating(value.overrides.rating === undefined ? "" : String(value.overrides.rating))
      setTranslatedTitle(value.overrides.translatedTitle ?? "")
      setEditing(true)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoadingOverride(false)
    }
  }

  async function saveOverride() {
    if (!snapshot || !client.updateEmmMetadata) return
    const parsedRating = rating.trim() ? Number(rating) : null
    if (parsedRating !== null && (!Number.isInteger(parsedRating) || parsedRating < 1 || parsedRating > 5)) {
      setError("评分必须是 1 到 5 的整数，或留空继承外部 EMM。")
      return
    }
    const patch = {
      rating: parsedRating,
      translatedTitle: translatedTitle.trim() || null,
    }
    setSaving(true)
    setError(undefined)
    try {
      const value = await client.updateEmmMetadata(sessionId, snapshot.revision, patch)
      setSnapshot(value)
      setEditing(false)
      state.retry()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

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
      {editing ? <div className="grid gap-2 rounded border bg-muted/20 p-2" data-emm-sync-editor="true">
        <label className="grid gap-1"><span>XR 覆盖评分</span><Input className="h-7 text-[10px]" aria-label="XR 覆盖评分" inputMode="numeric" value={rating} disabled={saving} placeholder="留空继承" onChange={(event) => setRating(event.currentTarget.value)} /></label>
        <label className="grid gap-1"><span>XR 覆盖译名</span><Input className="h-7 text-[10px]" aria-label="XR 覆盖译名" value={translatedTitle} disabled={saving} placeholder="留空继承" onChange={(event) => setTranslatedTitle(event.currentTarget.value)} /></label>
        <p className="text-[10px] text-muted-foreground">保存仅写入 xr_ 覆盖记录；外部 database.sqlite 和旧 NeoView 表保持不变。</p>
        <div className="flex flex-wrap gap-1.5"><Button type="button" size="sm" className="h-7 text-[10px]" disabled={saving} onClick={() => void saveOverride()}><Save data-icon="inline-start" />{saving ? "保存中…" : "保存覆盖"}</Button><Button type="button" size="sm" variant="outline" className="h-7 text-[10px]" disabled={saving} onClick={() => setEditing(false)}><Undo2 data-icon="inline-start" />取消</Button></div>
      </div> : <div className="flex flex-wrap gap-1.5"><Button type="button" size="sm" variant="outline" className="h-7 text-[10px]" disabled={state.loading} onClick={state.retry}><RefreshCw data-icon="inline-start" />重新读取</Button><Button type="button" size="sm" variant="outline" className="h-7 text-[10px]" disabled={loadingOverride} onClick={() => void openEditor()}><Pencil data-icon="inline-start" />{loadingOverride ? "读取覆盖…" : "编辑 XR 覆盖"}</Button></div>}
      {error ? <p role="alert" className="text-[10px] text-destructive">{error}</p> : null}
    </div>
  )
}

function EmmError({ message, retry }: { message: string; retry(): void }) {
  return <div role="alert" className="grid min-h-20 justify-items-center gap-2 text-center text-[11px] text-destructive"><span>{message}</span><Button type="button" size="sm" variant="outline" onClick={retry}>重试</Button></div>
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}
