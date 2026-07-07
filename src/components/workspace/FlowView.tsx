import { lazy, Suspense, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Plus, Workflow } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { isComponentVisibleInView } from "@/lib/componentVisibility"
import { useWorkspaceActions, useWorkspaceVisibleComponents } from "@/store/workspaceContext"
import type { ComponentInstance } from "@/types/workspace"

const FlowCanvasView = lazy(() =>
  import("./FlowCanvasView").then((module) => ({ default: module.FlowCanvasView })),
)

function isFlowCanvasVisible(component: ComponentInstance) {
  return isComponentVisibleInView(component, "flow")
}

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

function FlowEmptyState() {
  const workspaceActions = useWorkspaceActions()
  const { t } = useTranslation()

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center">
      <div className="space-y-4 text-center">
        <Workflow className="mx-auto h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm font-mono text-muted-foreground">{t("view:flow.empty")}</p>
        <Button
          size="sm"
          variant="outline"
          className="font-mono text-xs"
          onClick={() => workspaceActions.setOverlay("registry")}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {t("view:flow.openRegistry")}
        </Button>
      </div>
    </div>
  )
}

function FlowCanvasLoading({ label, onActivate }: { label?: string; onActivate(): void }) {
  const { t } = useTranslation()
  const text = label ?? t("view:flow.loadingCanvas")

  return (
    <button
      type="button"
      className="absolute inset-0 z-10 flex flex-col overflow-hidden p-5 text-left"
      onClick={onActivate}
      onFocus={onActivate}
      aria-label={text}
      title={text}
    >
      <div className="relative h-full w-full overflow-hidden rounded-md border border-border/60 bg-card/60">
        <div className="absolute left-10 top-10 h-52 w-72 rounded-md border border-border/50 bg-background/70 p-3 shadow-sm">
          <Skeleton className="mb-3 h-3 w-24 rounded-sm" />
          <Skeleton className="h-24 w-full rounded-sm" />
          <Skeleton className="mt-3 h-2.5 w-2/3 rounded-sm" />
        </div>
        <div className="absolute left-[24rem] top-32 h-48 w-72 rounded-md border border-border/50 bg-background/70 p-3 shadow-sm">
          <Skeleton className="mb-3 h-3 w-20 rounded-sm" />
          <Skeleton className="h-20 w-full rounded-sm" />
          <Skeleton className="mt-3 h-2.5 w-3/4 rounded-sm" />
        </div>
        <div className="absolute left-64 top-24 h-px w-32 rotate-12 bg-border/70" />
        <span className="absolute bottom-4 left-4 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          {text}
        </span>
      </div>
    </button>
  )
}

export function FlowView() {
  const { t } = useTranslation()
  const visibleComponents = useWorkspaceVisibleComponents()
  const hasFlowComponents = visibleComponents.some(isFlowCanvasVisible)
  const [canvasRequested, setCanvasRequested] = useState(false)

  useEffect(() => {
    if (!hasFlowComponents) {
      if (canvasRequested) setCanvasRequested(false)
      return undefined
    }
    if (canvasRequested || typeof window === "undefined") return undefined

    const idleWindow = window as IdleWindow
    if (idleWindow.requestIdleCallback) {
      const handle = idleWindow.requestIdleCallback(() => setCanvasRequested(true), { timeout: 700 })
      return () => idleWindow.cancelIdleCallback?.(handle)
    }

    const handle = window.setTimeout(() => setCanvasRequested(true), 140)
    return () => window.clearTimeout(handle)
  }, [canvasRequested, hasFlowComponents])

  return (
    <div className="relative flex-1 min-h-0 w-full ws-canvas-bg">
      {hasFlowComponents ? (
        <Suspense fallback={<FlowCanvasLoading onActivate={() => setCanvasRequested(true)} />}>
          {canvasRequested
            ? <FlowCanvasView />
            : <FlowCanvasLoading onActivate={() => setCanvasRequested(true)} label={t("view:flow.loadCanvas")} />}
        </Suspense>
      ) : (
        <FlowEmptyState />
      )}
    </div>
  )
}
