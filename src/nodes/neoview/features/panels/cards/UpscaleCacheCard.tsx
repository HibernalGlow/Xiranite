import { HardDrive, Loader2, RefreshCw, Trash2 } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import type { ReaderUpscaleCacheCleanupDto, ReaderUpscaleCacheSnapshotDto } from "../../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../registry"

const RETENTION = [7, 14, 30, 60, 90]

export default function UpscaleCacheCard({ client, session, disabled, panelActive = true }: ReaderPanelContext) {
  const [snapshot, setSnapshot] = useState<ReaderUpscaleCacheSnapshotDto>()
  const [operation, setOperation] = useState<"refresh" | "age" | "book" | "all">()
  const [days, setDays] = useState(30)
  const [confirmKind, setConfirmKind] = useState<"age" | "book" | "all">()
  const [feedback, setFeedback] = useState<string>()
  const sessionId = session?.sessionId
  const refresh = useCallback(async (signal?: AbortSignal) => { if (!sessionId || !client.upscaleCache) return; setOperation("refresh"); try { setSnapshot(await client.upscaleCache(sessionId, signal)); setFeedback(undefined) } catch { setFeedback("缓存统计暂时不可用") } finally { setOperation(undefined) } }, [client, sessionId])
  useEffect(() => { if (!panelActive || disabled || !sessionId) return; const controller = new AbortController(); void refresh(controller.signal); return () => controller.abort() }, [disabled, panelActive, refresh, sessionId])
  const cleanup = async (kind: "age" | "book" | "all") => { if (!sessionId || !client.cleanupUpscaleCache || operation) return; setConfirmKind(undefined); setOperation(kind); setFeedback(undefined); try { const result: ReaderUpscaleCacheCleanupDto = await client.cleanupUpscaleCache(sessionId, kind); setSnapshot(result); setFeedback(`已清理 ${result.removedEntries} 个缓存条目（${formatBytes(result.removedBytes)}）`) } catch { setFeedback("缓存清理失败，请重试") } finally { setOperation(undefined) } }
  if (!session) return <div className="space-y-2 text-xs text-muted-foreground" data-neoview-upscale-cache="true"><HardDrive className="mx-auto size-5" /><p className="text-center">打开书籍后可管理超分缓存</p></div>
  return <div className="space-y-3 text-xs" data-neoview-upscale-cache="true">
    <div className="grid grid-cols-2 gap-2"><Metric label="缓存条目" value={snapshot ? snapshot.entries.toLocaleString() : "--"} /><Metric label="占用空间" value={snapshot ? formatBytes(snapshot.bytes) : "--"} /><Metric label="命中" value={snapshot ? snapshot.hits.toLocaleString() : "--"} /><Metric label="淘汰" value={snapshot ? snapshot.evictions.toLocaleString() : "--"} /></div>
    <div className="flex items-center justify-between"><span className="text-muted-foreground">清理天数</span><select className="h-7 rounded border border-input bg-background px-2 text-xs" value={days} disabled={disabled || operation !== undefined} onChange={(event) => setDays(Number(event.currentTarget.value))}>{RETENTION.map((value) => <option key={value} value={value}>{value} 天</option>)}</select></div>
    <p className="text-[10px] text-muted-foreground">后端按配置的保留策略执行过期清理；选择值会记录本次意图。</p>
    <div className="grid grid-cols-2 gap-2"><Button type="button" variant="outline" size="sm" className="gap-1.5 text-[10px]" disabled={disabled || operation !== undefined} onClick={() => void refresh()}>{operation === "refresh" ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}刷新</Button><Button type="button" variant="outline" size="sm" className="gap-1.5 text-[10px]" disabled title="缓存目录由后端托管"><HardDrive className="size-3" />打开目录</Button></div>
    <div className="grid grid-cols-3 gap-2"><Button type="button" variant="outline" size="sm" className="gap-1 text-[10px]" disabled={disabled || operation !== undefined || !snapshot?.entries} onClick={() => setConfirmKind("age")}><Trash2 className="size-3" />过期</Button><Button type="button" variant="outline" size="sm" className="gap-1 text-[10px]" disabled={disabled || operation !== undefined || !snapshot?.entries} onClick={() => setConfirmKind("book")}><Trash2 className="size-3" />本书</Button><Button type="button" variant="outline" size="sm" className="gap-1 text-[10px] text-destructive hover:text-destructive" disabled={disabled || operation !== undefined || !snapshot?.entries} onClick={() => setConfirmKind("all")}><Trash2 className="size-3" />全部</Button></div>
    {feedback ? <p className="rounded bg-muted/60 p-2 text-[10px]" role="status">{feedback}</p> : null}
    <AlertDialog open={confirmKind !== undefined} onOpenChange={(open) => { if (!open) setConfirmKind(undefined) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>确认清理超分缓存？</AlertDialogTitle><AlertDialogDescription>{confirmKind === "all" ? "将清除全部共享超分缓存，当前书籍也会重新生成。" : confirmKind === "book" ? "将清除当前书籍的超分缓存。" : `将执行 ${days} 天前的过期清理（按后端保留策略）。`}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant={confirmKind === "all" ? "destructive" : "default"} onClick={() => { if (confirmKind) void cleanup(confirmKind) }}>清理</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>
}
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded border border-border/60 bg-muted/20 p-2 text-center"><div className="text-[10px] text-muted-foreground">{label}</div><div className="mt-1 font-medium tabular-nums">{value}</div></div> }
function formatBytes(value: number): string { if (!Number.isFinite(value) || value < 0) return "--"; if (value < 1024) return `${value} B`; if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`; if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`; return `${(value / 1024 ** 3).toFixed(2)} GB` }
