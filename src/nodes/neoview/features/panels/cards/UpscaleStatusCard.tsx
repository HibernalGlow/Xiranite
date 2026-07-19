import { Check, ImageOff, Loader2, SkipForward, X } from "lucide-react"
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"

import { Switch } from "@/components/ui/switch"
import type { ReaderUpscalePreloadSnapshotDto } from "../../../adapters/reader-http-client"
import {
  EMPTY_READER_UPSCALE_ARTIFACT_SNAPSHOT,
  readerUpscaleArtifactSnapshot,
  subscribeReaderUpscaleArtifact,
} from "../../reader/ReaderUpscaleArtifactStore"
import type { ReaderPanelContext } from "../registry"
import { useSuperResolutionPreferences } from "./useSuperResolutionPreferences"

export default function UpscaleStatusCard({ client, session, disabled, panelActive = true, superResolution, onSuperResolutionConfigChange }: ReaderPanelContext) {
  const page = session?.visiblePages.find((candidate) => candidate.index === session.frame.anchorPageIndex) ?? session?.visiblePages[0]
  const sessionId = session?.sessionId ?? ""
  const pageId = page?.id ?? ""
  const subscribe = useCallback((listener: () => void) => sessionId && pageId ? subscribeReaderUpscaleArtifact(sessionId, pageId, listener) : () => undefined, [pageId, sessionId])
  const getSnapshot = useCallback(() => sessionId && pageId
    ? readerUpscaleArtifactSnapshot(sessionId, pageId)
    : EMPTY_READER_UPSCALE_ARTIFACT_SNAPSHOT, [pageId, sessionId])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const { preferences, commit } = useSuperResolutionPreferences(client, superResolution, onSuperResolutionConfigChange)
  const [preloads, setPreloads] = useState<readonly ReaderUpscalePreloadSnapshotDto[]>([])
  const [useUpscaled, setUseUpscaled] = useState(true)
  const [zoomOpen, setZoomOpen] = useState(false)
  const [size, setSize] = useState({ width: 400, height: 450 })
  const resizeRef = useRef<{ direction: string; x: number; y: number; width: number; height: number }>()

  useEffect(() => {
    if (!panelActive || !session || !client.upscalePreloadSnapshots) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      try { setPreloads(await client.upscalePreloadSnapshots!(session.sessionId, controller.signal)) } catch { /* status remains last-known */ }
      if (!controller.signal.aborted) timer = setTimeout(refresh, 2_000)
    }
    void refresh()
    return () => { controller.abort(); if (timer) clearTimeout(timer) }
  }, [client, panelActive, session])

  useEffect(() => () => {
    window.removeEventListener("pointermove", resizeWindow)
    window.removeEventListener("pointerup", stopResize)
  }, [])

  const artifactUrl = snapshot.result?.artifactUrl
  const hasUpscaled = snapshot.state === "completed" && Boolean(artifactUrl)
  const previewVisible = preferences?.showPanelPreview ?? false
  const displayUrl = useUpscaled && artifactUrl ? artifactUrl : page?.assetUrl
  const scale = preferences?.defaultScale ?? 2
  const total = preloads.reduce((sum, item) => sum + item.planned, 0)
  const pending = preloads.reduce((sum, item) => sum + item.pending, 0)
  const settled = preloads.reduce((sum, item) => sum + item.settled, 0)
  const failed = preloads.reduce((sum, item) => sum + item.failed, 0)
  const info = statusInfo(snapshot.state, snapshot.result?.decision?.reason, snapshot.error)

  function startResize(event: React.PointerEvent, direction: string) {
    event.preventDefault()
    resizeRef.current = { direction, x: event.clientX, y: event.clientY, ...size }
    window.addEventListener("pointermove", resizeWindow)
    window.addEventListener("pointerup", stopResize)
  }
  function resizeWindow(event: PointerEvent) {
    const start = resizeRef.current
    if (!start) return
    const dx = event.clientX - start.x; const dy = event.clientY - start.y
    setSize({ width: Math.max(240, start.width + (start.direction.includes("e") ? dx : start.direction.includes("w") ? -dx : 0)), height: Math.max(220, start.height + (start.direction.includes("s") ? dy : start.direction.includes("n") ? -dy : 0)) })
  }
  function stopResize() { resizeRef.current = undefined; window.removeEventListener("pointermove", resizeWindow); window.removeEventListener("pointerup", stopResize) }

  return <>
    <div className="space-y-3 text-xs" data-neoview-upscale-status="true">
      <div className="flex items-center justify-between"><span className="text-muted-foreground">当前页面</span><span className="font-mono">{page ? page.index + 1 : 0}</span></div>
      <div className="space-y-2 rounded bg-muted/50 p-2"><div className="flex items-center justify-between"><span className="text-muted-foreground">状态</span><span className={info.className}>{info.icon}{info.label}</span></div><p className="text-[10px] text-muted-foreground">{info.description}</p></div>
      {superResolution?.provider !== "disabled" ? <><Row label="模型" value={preferences?.defaultModelId ?? "--"} /><Row label="放大倍率" value={`${scale}x`} /></> : null}
      {page?.dimensions ? <div className="space-y-1"><Row label="原图尺寸" value={`${page.dimensions.width}x${page.dimensions.height}`} />{hasUpscaled ? <Row label="超分尺寸" value={`${page.dimensions.width * scale}x${page.dimensions.height * scale}`} accent /> : null}</div> : null}
      <div className="flex items-center justify-between"><span className="text-muted-foreground">显示预览</span><Switch checked={previewVisible} disabled={disabled} onCheckedChange={(value) => commit({ showPanelPreview: value })} aria-label="显示预览" /></div>
      {previewVisible ? displayUrl ? <div className="space-y-2"><button type="button" className="w-full overflow-hidden rounded border border-border/60" disabled={!hasUpscaled} onClick={() => setUseUpscaled((value) => !value)} aria-label="切换原图和超分图"><img src={displayUrl} alt={useUpscaled && hasUpscaled ? "超分图" : "原图"} className="max-h-48 w-full bg-muted/30 object-contain" /></button><p className="text-center text-[10px] text-muted-foreground">{useUpscaled && hasUpscaled ? "超分图" : "原图"}{hasUpscaled ? "，点击图片切换" : ""}</p></div> : <div className="rounded bg-muted/30 p-4 text-center text-muted-foreground">暂无图片</div> : null}
      {hasUpscaled ? <div className="flex items-center justify-between"><span className="text-muted-foreground">放大对比</span><Switch checked={zoomOpen} onCheckedChange={setZoomOpen} aria-label="放大对比" /></div> : null}
      {superResolution?.provider !== "disabled" ? <div className="space-y-1 border-t pt-2 text-[10px] text-muted-foreground"><div className="flex justify-between"><span>队列</span><span>{pending} 等待 / {preloads.filter((item) => item.state === "running").length} 处理中</span></div><div className="flex justify-between"><span>预加载任务</span><span>{settled} 已结算 / {failed} 失败 / {total} 计划</span></div></div> : <p className="py-2 text-center text-muted-foreground">超分功能未启用</p>}
    </div>
    {zoomOpen && hasUpscaled && page && artifactUrl ? <div className="fixed right-4 top-1/2 z-50 -translate-y-1/2 overflow-hidden rounded border border-border bg-background/95 shadow-2xl" style={size}><ResizeHandles onStart={startResize} /><div className="flex h-9 items-center justify-between border-b px-3"><span className={useUpscaled ? "text-xs text-emerald-600" : "text-xs"}>{useUpscaled ? "超分图" : "原图"}</span><button type="button" className="grid size-6 place-items-center rounded hover:bg-muted" title="关闭对比浮窗" aria-label="关闭对比浮窗" onClick={() => setZoomOpen(false)}><X className="size-3.5" /></button></div><button type="button" className="flex h-[calc(100%-60px)] w-full items-center justify-center bg-muted/20" onClick={() => setUseUpscaled((value) => !value)} aria-label="点击切换原图和超分图"><img src={useUpscaled ? artifactUrl : page.assetUrl} alt={useUpscaled ? "超分图" : "原图"} className="max-h-full max-w-full object-contain" /></button><div className="absolute inset-x-0 bottom-0 flex h-6 items-center justify-between border-t bg-background/90 px-3 text-[10px] text-muted-foreground"><span>{page.dimensions ? useUpscaled ? `${page.dimensions.width * scale}x${page.dimensions.height * scale}` : `${page.dimensions.width}x${page.dimensions.height}` : ""}</span><span>点击切换，拖拽边缘调整</span></div></div> : null}
  </>
}

function Row({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) { return <div className={accent ? "flex items-center justify-between text-emerald-600" : "flex items-center justify-between"}><span className="text-muted-foreground">{label}</span><span className="max-w-40 truncate font-mono text-[10px]" title={value}>{value}</span></div> }
function statusInfo(state: "idle" | "processing" | "completed" | "skipped" | "failed", reason?: string, error?: string) {
  if (state === "processing") return { label: "超分中", description: "正在进行超分处理", className: "flex items-center gap-1.5 text-blue-600", icon: <Loader2 className="size-3.5 animate-spin" /> }
  if (state === "completed") return { label: "已完成", description: "超分完成", className: "flex items-center gap-1.5 text-emerald-600", icon: <Check className="size-3.5" /> }
  if (state === "skipped") return { label: "已跳过", description: policyReason(reason), className: "flex items-center gap-1.5 text-amber-600", icon: <SkipForward className="size-3.5" /> }
  if (state === "failed") return { label: "失败", description: error || "超分处理失败，请检查 runtime、CLI 与模型文件", className: "flex items-center gap-1.5 text-destructive", icon: <X className="size-3.5" /> }
  return { label: "未超分", description: "尚未进行超分", className: "flex items-center gap-1.5 text-muted-foreground", icon: <ImageOff className="size-3.5" /> }
}
function policyReason(reason?: string): string {
  if (reason === "automatic-upscale-disabled") return "自动超分开关尚未在当前 Reader 生效"
  if (reason === "missing-model-defaults") return "未选择默认模型或放大倍率"
  if (reason === "below-conditional-minimum") return "图片尺寸低于条件阈值"
  if (reason === "condition-skip") return "匹配到“不超分”条件"
  return reason ? `超分策略已跳过：${reason}` : "不符合条件或 provider 已跳过"
}
function ResizeHandles({ onStart }: { onStart(event: React.PointerEvent, direction: string): void }) { return <>{["n", "s", "e", "w", "ne", "nw", "se", "sw"].map((direction) => <button key={direction} type="button" className={resizeClass(direction)} aria-label={`${direction} 方向调整大小`} onPointerDown={(event) => onStart(event, direction)} />)}</> }
function resizeClass(direction: string): string { const classes: Record<string, string> = { n: "top-0 left-3 right-3 h-1 cursor-n-resize", s: "bottom-0 left-3 right-3 h-1 cursor-s-resize", e: "right-0 top-3 bottom-3 w-1 cursor-e-resize", w: "left-0 top-3 bottom-3 w-1 cursor-w-resize", ne: "right-0 top-0 size-3 cursor-ne-resize", nw: "left-0 top-0 size-3 cursor-nw-resize", se: "right-0 bottom-0 size-3 cursor-se-resize", sw: "left-0 bottom-0 size-3 cursor-sw-resize" }; return `absolute z-10 ${classes[direction]}` }
