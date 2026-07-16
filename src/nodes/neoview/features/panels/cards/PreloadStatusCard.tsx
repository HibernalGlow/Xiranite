/**
 * @migrated-from src/lib/cards/info/PreloadStatusCard.svelte
 * @source-hash sha256:1cceb9bccf3022428af0708c673885636bd29e410abc2e7de79368f2f27e2b76
 * @migration-status partial
 */
import { useCallback, useSyncExternalStore } from "react"

import { cn } from "@/lib/utils"
import type { ReaderPanelContext } from "../registry"
import {
  readerPreloadStatusStore,
  type ReaderPreloadStatusStore,
} from "../../reader/ReaderPreloadStatusStore"

export default function PreloadStatusCard(context: ReaderPanelContext) {
  if (!context.session) return null
  return (
    <PreloadStatusView
      sessionId={context.session.sessionId}
      currentPageIndex={context.session.frame.anchorPageIndex}
      totalPages={context.session.book.pageCount}
    />
  )
}

export function PreloadStatusView({
  sessionId,
  currentPageIndex,
  totalPages,
  store = readerPreloadStatusStore,
}: {
  sessionId: string
  currentPageIndex: number
  totalPages: number
  store?: ReaderPreloadStatusStore
}) {
  const subscribe = useCallback((listener: () => void) => store.subscribe(sessionId, listener), [sessionId, store])
  const getSnapshot = useCallback(() => store.snapshot(sessionId), [sessionId, store])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  return (
    <div className="space-y-3 text-xs" data-neoview-preload-status="true">
      <div className="grid grid-cols-2 gap-2">
        <Metric label="当前页" value={`${totalPages > 0 ? currentPageIndex + 1 : 0} / ${totalPages}`} />
        <Metric label="预解码保留" value={`${snapshot.entries.length} / ${snapshot.retainedLimit}`} />
      </div>

      <div className="grid grid-cols-3 gap-1.5" aria-label="预解码状态汇总">
        <StatusMetric label="加载中" value={snapshot.loadingCount} tone="loading" />
        <StatusMetric label="已就绪" value={snapshot.readyCount} tone="ready" />
        <StatusMetric label="失败" value={snapshot.failedCount} tone="failed" />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>相邻页预解码</span>
          <span>事件同步</span>
        </div>
        {snapshot.entries.length ? (
          <div className="grid grid-cols-3 gap-1.5">
            {snapshot.entries.map((entry) => (
              <div
                key={entry.pageIndex}
                className={cn(
                  "rounded border px-2 py-1 text-center",
                  entry.status === "ready" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-600",
                  entry.status === "loading" && "border-primary/40 bg-primary/10 text-primary",
                  entry.status === "failed" && "border-destructive/40 bg-destructive/10 text-destructive",
                )}
              >
                <span className="block text-[10px]">P{entry.pageIndex + 1}</span>
                <span className="block text-[9px]">{statusLabel(entry.status)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded border border-dashed p-3 text-center text-[10px] text-muted-foreground">
            暂无相邻页预解码任务
          </div>
        )}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border/60 bg-muted/20 p-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium tabular-nums">{value}</div>
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

function statusLabel(status: "loading" | "ready" | "failed"): string {
  if (status === "loading") return "loading"
  if (status === "ready") return "ready"
  return "failed"
}
