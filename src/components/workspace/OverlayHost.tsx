import { lazy, Suspense } from "react"
import { X } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useWorkspaceActions, useWorkspaceSelector } from "@/store/workspaceContext"
import { Skeleton } from "@/components/ui/skeleton"

const ModuleRegistry = lazy(() =>
  import("@/components/views/ModuleRegistry").then((module) => ({ default: module.ModuleRegistry })),
)
const ThemeSettings = lazy(() =>
  import("@/components/views/ThemeSettings").then((module) => ({ default: module.ThemeSettings })),
)
const DeploymentHub = lazy(() =>
  import("@/components/views/DeploymentHub").then((module) => ({ default: module.DeploymentHub })),
)
const NodeOperationMonitor = lazy(() =>
  import("@/components/views/NodeOperationMonitor").then((module) => ({ default: module.NodeOperationMonitor })),
)

const TITLE_KEYS = {
  registry: "overlay:registry",
  settings: "overlay:settings",
  deployment: "overlay:deployment",
  operations: "overlay:operations",
} as const

function OverlayLoading() {
  return (
    <div className="space-y-3 p-4">
      <Skeleton className="h-8 w-36 rounded-sm" />
      <Skeleton className="h-20 w-full rounded-sm" />
      <Skeleton className="h-20 w-11/12 rounded-sm" />
      <Skeleton className="h-20 w-full rounded-sm" />
    </div>
  )
}

/**
 * OverlayHost — 取代被删除的侧栏。
 *
 * 顶栏按钮触发 SET_OVERLAY，弹出层从右侧滑入。
 * Registry / Settings / DeploymentHub 三个视图均承载于此。
 */
export function OverlayHost() {
  const overlay = useWorkspaceSelector((state) => state.overlay)
  const workspaceActions = useWorkspaceActions()
  const { t } = useTranslation()
  const open = overlay !== null

  return (
    <>
      {open && (
        <>
          {/* 遮罩 */}
          <div
            onClick={() => workspaceActions.setOverlay(null)}
            className="fixed inset-0 z-40 bg-black/40 animate-in fade-in duration-150"
          />
          {/* 抽屉 */}
          <aside
            className="fixed right-0 top-0 bottom-0 z-50 flex w-full max-w-[560px] flex-col border-l border-border bg-card animate-in slide-in-from-right duration-200"
          >
            <header className="h-12 flex items-center justify-between px-4 border-b border-border flex-shrink-0">
              <h2 className="text-xs font-mono font-semibold tracking-widest text-foreground">
                {overlay ? t(TITLE_KEYS[overlay]) : ""}
              </h2>
              <button
                onClick={() => workspaceActions.setOverlay(null)}
                className="grid h-8 w-8 place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="flex-1 overflow-auto">
              <Suspense fallback={<OverlayLoading />}>
                {overlay === "registry" && <ModuleRegistry />}
                {overlay === "settings" && <ThemeSettings />}
                {overlay === "deployment" && <DeploymentHub />}
                {overlay === "operations" && <NodeOperationMonitor />}
              </Suspense>
            </div>
          </aside>
        </>
      )}
    </>
  )
}
