/**
 * @migrated-from src/lib/cards/info/PreloadStatusCard.svelte
 * @source-hash sha256:1cceb9bccf3022428af0708c673885636bd29e410abc2e7de79368f2f27e2b76
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/info/PreloadStatusCard.tsx
 * @migration-status partial
 */
import { lazy, Suspense, useCallback, useSyncExternalStore } from "react"
import { cn } from "@/lib/utils"
import type { ReaderStorageDiagnosticsDto } from "../../../adapters/reader-http-client"
import {
  readerPreloadStatusStore,
  type ReaderPreloadEntryStatus,
  type ReaderPreloadStatusStore,
} from "../../reader/ReaderPreloadStatusStore"
import type { ReaderPanelContext } from "../registry"
import { useReaderPreloadDiagnostics } from "./useReaderPreloadDiagnostics"

const LazyPreloadActionControls = lazy(() => import("./PreloadActionControls").then((module) => ({ default: module.PreloadActionControls })))

const PAGES_BEHIND = 3
const PAGES_AHEAD = 5

export default function PreloadStatusCard({ session, client, disabled, panelActive = true, onPreloadAction }: ReaderPanelContext) {
  if (!session) return <PreloadStatusEmptyView state="no-session" />
  if (!panelActive) return <PreloadStatusEmptyView state="inactive" />
  return (
    <PreloadStatusContent
      client={client}
      sessionId={session.sessionId}
      frameGeneration={session.frame.generation}
      currentPageIndex={session.frame.anchorPageIndex}
      totalPages={session.book.pageCount}
      disabled={disabled}
      onPreloadAction={onPreloadAction}
    />
  )
}

function PreloadStatusContent({
  client,
  sessionId,
  frameGeneration,
  currentPageIndex,
  totalPages,
  disabled,
  onPreloadAction,
}: {
  client: ReaderPanelContext["client"]
  sessionId: string
  frameGeneration: number
  currentPageIndex: number
  totalPages: number
  disabled: boolean
  onPreloadAction?: ReaderPanelContext["onPreloadAction"]
}) {
  const diagnostics = useReaderPreloadDiagnostics(client, sessionId, frameGeneration)
  return (
    <PreloadStatusView
      sessionId={sessionId}
      currentPageIndex={currentPageIndex}
      totalPages={totalPages}
      diagnostics={diagnostics.value}
      diagnosticsLoading={diagnostics.loading}
      diagnosticsError={diagnostics.error}
      onRetry={diagnostics.retry}
      actionsDisabled={disabled}
      onPreloadAction={onPreloadAction}
      onActionComplete={diagnostics.retry}
    />
  )
}

export function PreloadStatusView({
  sessionId,
  currentPageIndex,
  totalPages,
  diagnostics,
  diagnosticsLoading = false,
  diagnosticsError,
  onRetry,
  actionsDisabled = false,
  onPreloadAction,
  onActionComplete,
  store = readerPreloadStatusStore,
}: {
  sessionId: string
  currentPageIndex: number
  totalPages: number
  diagnostics?: ReaderStorageDiagnosticsDto
  diagnosticsLoading?: boolean
  diagnosticsError?: string
  onRetry?: () => void
  actionsDisabled?: boolean
  onPreloadAction?: ReaderPanelContext["onPreloadAction"]
  onActionComplete?: () => void
  store?: ReaderPreloadStatusStore
}) {
  const subscribe = useCallback((listener: () => void) => store.subscribe(sessionId, listener), [sessionId, store])
  const getSnapshot = useCallback(() => store.snapshot(sessionId), [sessionId, store])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const presentation = diagnostics?.assets.presentation
  const usagePercent = presentation?.maxBytes
    ? Math.min(100, Math.max(0, presentation.bytes / presentation.maxBytes * 100))
    : undefined
  const predecodeByPage = new Map(snapshot.entries.map((entry) => [entry.pageIndex, entry.status]))
  const serverByPage = new Map(diagnostics?.reader?.sessionPreload?.pages.map((entry) => [entry.pageIndex, entry.outcome]) ?? [])
  const nearbyPages = buildNearbyPages(currentPageIndex, totalPages)
  const preload = diagnostics?.reader?.preload

  return (
    <div className="space-y-3 text-xs" data-neoview-preload-status="true">
      <div className="grid grid-cols-2 gap-2" aria-label="预加载摘要">
        <Metric metricId="current-page" label="当前页" value={`${totalPages > 0 ? currentPageIndex + 1 : 0} / ${totalPages}`} />
        <Metric metricId="memory-entries" label="内存池" value={presentation?.entries === undefined ? "--" : `${presentation.entries} 项`} />
      </div>

      {presentation ? (
        <div className="space-y-1.5" aria-label="服务端呈现缓存">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{formatPreloadBytes(presentation.bytes)} / {formatPreloadBytes(presentation.maxBytes)}</span>
            <span className="flex items-center gap-2">
              <span data-preload-metric="active-leases">活动租约 <span className="tabular-nums">{presentation.activeLeases ?? "--"}</span></span>
              <span className="tabular-nums">{usagePercent === undefined ? "--" : `${usagePercent.toFixed(1)}%`}</span>
            </span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded bg-muted"
            role="progressbar"
            aria-label="服务端呈现缓存使用率"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={usagePercent}
          >
            <div className="h-full rounded bg-primary transition-[width]" style={{ width: `${usagePercent ?? 0}%` }} />
          </div>
        </div>
      ) : null}

      <section className="space-y-1.5" aria-labelledby="nearby-preload-heading">
        <div className="flex items-center justify-between">
          <h3 id="nearby-preload-heading" className="text-[10px] font-normal text-muted-foreground">附近页状态</h3>
          <span className="text-[10px] text-muted-foreground" aria-live="polite">
            {diagnosticsLoading ? "刷新中" : diagnostics ? "已同步" : "等待诊断"}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {nearbyPages.map((pageIndex) => (
            <PageStatus
              key={pageIndex}
              pageIndex={pageIndex}
              current={pageIndex === currentPageIndex}
              status={predecodeByPage.get(pageIndex)}
              serverOutcome={serverByPage.get(pageIndex)}
              serverAvailable={Boolean(diagnostics?.reader?.sessionPreload)}
            />
          ))}
        </div>
      </section>

      <div className="grid grid-cols-3 gap-1.5" aria-label="浏览器预解码状态">
        <StatusMetric label="加载中" value={snapshot.loadingCount} tone="loading" />
        <StatusMetric label="已就绪" value={snapshot.readyCount} tone="ready" />
        <StatusMetric label="失败" value={snapshot.failedCount} tone="failed" />
      </div>

      {preload ? (
        <div className="grid grid-cols-3 gap-1.5" aria-label="服务端预加载队列">
          <QueueMetric label="邻近" value={preload.candidates.near} />
          <QueueMetric label="前方" value={preload.candidates.ahead} />
          <QueueMetric label="后台" value={preload.candidates.background} />
        </div>
      ) : null}

      <Suspense fallback={null}>
        <LazyPreloadActionControls
          disabled={actionsDisabled}
          onAction={onPreloadAction}
          onComplete={onActionComplete}
        />
      </Suspense>

      {diagnosticsError ? (
        <div className="flex items-center justify-between gap-2 rounded border border-destructive/40 bg-destructive/10 p-2 text-[10px] text-destructive" role="alert">
          <span>{diagnosticsError}</span>
          {onRetry ? <button type="button" className="shrink-0 underline-offset-2 hover:underline" onClick={onRetry}>重试</button> : null}
        </div>
      ) : null}
    </div>
  )
}

function buildNearbyPages(currentPageIndex: number, totalPages: number): number[] {
  if (totalPages <= 0) return []
  const start = Math.max(0, Math.min(currentPageIndex, totalPages - 1) - PAGES_BEHIND)
  const end = Math.min(totalPages - 1, Math.max(0, currentPageIndex) + PAGES_AHEAD)
  return Array.from({ length: end - start + 1 }, (_, offset) => start + offset)
}

export function formatPreloadBytes(value: number | undefined): string {
  if (!Number.isFinite(value) || value! < 0) return "--"
  if (value! < 1_024) return `${value} B`
  if (value! < 1_048_576) return `${(value! / 1_024).toFixed(1)} KB`
  if (value! < 1_073_741_824) return `${(value! / 1_048_576).toFixed(1)} MB`
  return `${(value! / 1_073_741_824).toFixed(2)} GB`
}

function Metric({ metricId, label, value }: { metricId: string; label: string; value: string }) {
  return (
    <div className="rounded border border-border/60 bg-muted/20 p-2" data-preload-metric={metricId}>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium tabular-nums">{value}</div>
    </div>
  )
}

function PageStatus({ pageIndex, current, status, serverOutcome, serverAvailable }: {
  pageIndex: number
  current: boolean
  status?: ReaderPreloadEntryStatus
  serverOutcome?: "started" | "ready" | "failed" | "cancelled" | "evicted"
  serverAvailable: boolean
}) {
  const serverLabel = serverOutcome === "ready" ? "已缓存" : serverOutcome === "started" ? "服务端加载中" : serverOutcome === "failed" ? "服务端失败" : "冷页"
  const browserLabel = current ? "当前" : status === "ready" ? "已预解码" : status === "loading" ? "加载中" : status === "failed" ? "失败" : "未预解码"
  const label = serverAvailable ? `${browserLabel}，${serverLabel}` : browserLabel
  const tone = current
    ? "current"
    : status === "failed" || serverOutcome === "failed"
      ? "failed"
      : status === "loading" || serverOutcome === "started"
        ? "loading"
        : status === "ready" || serverOutcome === "ready"
          ? "cached"
          : "cold"
  return (
    <div
      className={cn(
        "rounded border px-2 py-1 text-center",
        tone === "current" && "border-primary bg-primary/10 text-primary",
        tone === "cached" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-600",
        tone === "loading" && "border-primary/40 bg-primary/10 text-primary",
        tone === "failed" && "border-destructive/40 bg-destructive/10 text-destructive",
        tone === "cold" && "border-border/60 bg-muted/20 text-muted-foreground",
      )}
      aria-label={`第 ${pageIndex + 1} 页，${label}`}
      data-preload-nearby-page={pageIndex}
      data-preload-tone={tone}
      data-server-cache-state={serverAvailable ? (serverOutcome === "ready" ? "cached" : serverOutcome === "started" ? "loading" : serverOutcome === "failed" ? "failed" : "cold") : undefined}
    >
      <span className="block text-[10px]">P{pageIndex + 1}</span>
      <span className="block text-[9px]">{label}</span>
    </div>
  )
}

/** Keep the legacy summary shell mounted before a Reader session exists. */
export function PreloadStatusEmptyView({ state = "no-session" }: { state?: "no-session" | "inactive" }) {
  return (
    <div
      className="space-y-3 text-xs"
      data-neoview-preload-status="true"
      data-preload-empty="true"
      data-preload-state={state}
      data-testid="preload-status-empty"
    >
      <div className="grid grid-cols-2 gap-2" aria-label="预加载摘要">
        <Metric metricId="current-page" label="当前页" value="0 / 0" />
        <Metric metricId="memory-entries" label="内存池" value="--" />
      </div>
      <section className="space-y-1.5" aria-labelledby="nearby-preload-empty-heading">
        <div className="flex items-center justify-between">
          <h3 id="nearby-preload-empty-heading" className="text-[10px] font-normal text-muted-foreground">附近页缓存</h3>
          <span className="text-[10px] text-muted-foreground" aria-live="polite">等待书本</span>
        </div>
      </section>
    </div>
  )
}

function StatusMetric({ label, value, tone }: { label: string; value: number; tone: "loading" | "ready" | "failed" }) {
  return (
    <div className={cn(
      "rounded border px-2 py-1.5 text-center",
      tone === "loading" && "border-primary/30 bg-primary/5",
      tone === "ready" && "border-emerald-500/30 bg-emerald-500/5",
      tone === "failed" && "border-destructive/30 bg-destructive/5",
    )}>
      <div className="text-[9px] text-muted-foreground">{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  )
}

function QueueMetric({ label, value }: { label: string; value: number }) {
  return <div className="rounded border border-border/60 bg-muted/20 px-2 py-1 text-center"><span className="text-[9px] text-muted-foreground">{label}</span><span className="ml-1 tabular-nums">{value}</span></div>
}
