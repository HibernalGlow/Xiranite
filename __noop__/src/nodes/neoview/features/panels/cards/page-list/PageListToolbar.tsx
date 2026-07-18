import { Grid3X3, ImageIcon, List, Sparkles } from "lucide-react"
import { useEffect, useRef, useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import type { ReaderHttpClient } from "../../../../adapters/reader-http-client"

type PageListViewMode = "list" | "details" | "thumbnails"
type PagePrewarmState =
  | { status: "idle" }
  | { status: "running"; completed: number; total: number }
  | { status: "complete"; total: number }
  | { status: "error"; message: string }

export default function PageListToolbar({
  client,
  sessionId,
  totalPages,
  resultCount,
  filtered,
  viewMode,
  disabled,
  onViewModeChange,
}: {
  client: ReaderHttpClient
  sessionId: string
  totalPages: number
  resultCount: number
  filtered: boolean
  viewMode: PageListViewMode
  disabled: boolean
  onViewModeChange(mode: PageListViewMode): void
}) {
  const controllerRef = useRef<AbortController>()
  const [prewarm, setPrewarm] = useState<PagePrewarmState>({ status: "idle" })

  useEffect(() => {
    controllerRef.current?.abort()
    controllerRef.current = undefined
    setPrewarm({ status: "idle" })
    return () => {
      controllerRef.current?.abort()
      controllerRef.current = undefined
    }
  }, [client, sessionId])

  function prewarmAllThumbnails() {
    if (!client.listPageCatalog || totalPages < 1 || prewarm.status === "running") return
    const controller = new AbortController()
    controllerRef.current?.abort()
    controllerRef.current = controller
    setPrewarm({ status: "running", completed: 0, total: totalPages })
    void import("./prewarmPageThumbnails").then(({ prewarmPageThumbnails }) => (
      prewarmPageThumbnails(client, sessionId, totalPages, controller.signal, (completed, total) => {
        if (controllerRef.current === controller) setPrewarm({ status: "running", completed, total })
      })
    )).then((total) => {
      if (controllerRef.current === controller) setPrewarm({ status: "complete", total })
    }).catch((error) => {
      if (!controller.signal.aborted && controllerRef.current === controller) {
        setPrewarm({ status: "error", message: errorMessage(error) })
      }
    }).finally(() => {
      if (controllerRef.current === controller) controllerRef.current = undefined
    })
  }

  return (
    <div className="grid gap-1" data-page-prewarm-status={prewarm.status}>
      <div className="flex items-center gap-1">
        <ViewModeButton label="列表" mode="list" current={viewMode} onChange={onViewModeChange}><List /></ViewModeButton>
        <ViewModeButton label="带图列表" mode="details" current={viewMode} onChange={onViewModeChange}><ImageIcon /></ViewModeButton>
        <ViewModeButton label="缩略图网格" mode="thumbnails" current={viewMode} onChange={onViewModeChange}><Grid3X3 /></ViewModeButton>
        <Button
          type="button"
          size="icon-sm"
          variant="secondary"
          aria-label="预热全部缩略图"
          title="预热全部缩略图"
          disabled={disabled || totalPages < 1 || !client.listPageCatalog || prewarm.status === "running"}
          onClick={prewarmAllThumbnails}
        >
          <Sparkles className={prewarm.status === "running" ? "animate-pulse" : undefined} />
        </Button>
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
          {filtered ? `${resultCount} / ${totalPages}` : `${totalPages} 页`}
        </span>
      </div>
      {prewarm.status === "running" ? (
        <div className="text-[10px] tabular-nums text-muted-foreground" role="status" aria-live="polite">
          正在预加载全部缩略图 {prewarm.completed} / {prewarm.total}
        </div>
      ) : prewarm.status === "complete" ? (
        <div className="text-[10px] text-muted-foreground" role="status">全部缩略图已预加载</div>
      ) : prewarm.status === "error" ? (
        <div className="text-[10px] text-destructive" role="alert">预加载失败：{prewarm.message}</div>
      ) : null}
    </div>
  )
}

function ViewModeButton({ label, mode, current, onChange, children }: { label: string; mode: PageListViewMode; current: PageListViewMode; onChange(mode: PageListViewMode): void; children: ReactNode }) {
  return <Button type="button" size="icon-sm" variant={mode === current ? "default" : "ghost"} title={label} aria-label={label} aria-pressed={mode === current} onClick={() => onChange(mode)}>{children}</Button>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
