import { lazy, Suspense, useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from "react"
import { PanelRightClose, PanelRightOpen, X } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useWorkspaceActions, useWorkspaceSelector } from "@/store/workspaceContext"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

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

type OverlayMode = "docked" | "floating"

const OVERLAY_MODE_STORAGE_KEY = "xiranite.overlay.mode"
const OVERLAY_WIDTH_STORAGE_KEY = "xiranite.overlay.width"
const DEFAULT_OVERLAY_WIDTH = 440
const MIN_OVERLAY_WIDTH = 320
const MAX_OVERLAY_WIDTH = 720

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

export function OverlayHost() {
  const overlay = useWorkspaceSelector((state) => state.overlay)
  const workspaceActions = useWorkspaceActions()
  const { t } = useTranslation()
  const [mode, setMode] = useState<OverlayMode>(() => readOverlayMode())
  const [width, setWidth] = useState(() => readOverlayWidth())

  useEffect(() => {
    window.localStorage.setItem(OVERLAY_MODE_STORAGE_KEY, mode)
  }, [mode])

  useEffect(() => {
    window.localStorage.setItem(OVERLAY_WIDTH_STORAGE_KEY, String(width))
  }, [width])

  const startResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    document.body.style.cursor = "ew-resize"
    document.body.style.userSelect = "none"

    const onMove = (moveEvent: PointerEvent) => {
      const maxWidth = Math.min(MAX_OVERLAY_WIDTH, Math.max(MIN_OVERLAY_WIDTH, window.innerWidth - 96))
      const nextWidth = clamp(window.innerWidth - moveEvent.clientX, MIN_OVERLAY_WIDTH, maxWidth)
      setWidth(nextWidth)
    }

    const onUp = () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }

    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp, { once: true })
  }, [])

  if (!overlay) return null

  const floating = mode === "floating"

  return (
    <>
      {floating && (
        <button
          type="button"
          className="absolute inset-0 z-30 bg-background/35 backdrop-blur-[1px]"
          data-testid="workspace-overlay-backdrop"
          aria-label={t("common:collapse")}
          onClick={() => workspaceActions.setOverlay(null)}
        />
      )}
      <aside
        className={cn(
          "relative flex h-full min-h-0 shrink-0 flex-col border-l border-border/60 bg-card/95 animate-in slide-in-from-right-4 fade-in duration-150",
          floating && "absolute bottom-0 right-0 top-0 z-40 shadow-2xl shadow-black/25",
        )}
        data-testid="workspace-push-panel"
        data-overlay-mode={mode}
        style={{ width, maxWidth: "calc(100vw - 5rem)" }}
      >
        <div
          role="separator"
          aria-label={t("overlay:resize")}
          title={t("overlay:resize")}
          className="absolute left-0 top-0 z-20 h-full w-1.5 -translate-x-1/2 cursor-ew-resize bg-transparent transition-colors hover:bg-primary/35"
          onPointerDown={startResize}
        />
        <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3">
          <h2 className="min-w-0 truncate text-[11px] font-mono font-semibold tracking-widest text-foreground">
            {t(TITLE_KEYS[overlay])}
          </h2>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setMode(floating ? "docked" : "floating")}
              className="grid h-8 w-8 place-items-center rounded-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              title={t(floating ? "overlay:dockMode" : "overlay:floatingMode")}
              aria-label={t(floating ? "overlay:dockMode" : "overlay:floatingMode")}
            >
              {floating ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => workspaceActions.setOverlay(null)}
              className="grid h-8 w-8 place-items-center rounded-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              title={t("common:collapse")}
              aria-label={t("common:collapse")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Suspense fallback={<OverlayLoading />}>
            {overlay === "registry" && <ModuleRegistry />}
            {overlay === "settings" && <ThemeSettings />}
            {overlay === "deployment" && <DeploymentHub />}
            {overlay === "operations" && <NodeOperationMonitor />}
          </Suspense>
        </div>
      </aside>
    </>
  )
}

function readOverlayMode(): OverlayMode {
  if (typeof window === "undefined") return "docked"
  const value = window.localStorage.getItem(OVERLAY_MODE_STORAGE_KEY)
  return value === "floating" ? "floating" : "docked"
}

function readOverlayWidth(): number {
  if (typeof window === "undefined") return DEFAULT_OVERLAY_WIDTH
  const value = Number(window.localStorage.getItem(OVERLAY_WIDTH_STORAGE_KEY))
  return Number.isFinite(value) ? clamp(value, MIN_OVERLAY_WIDTH, MAX_OVERLAY_WIDTH) : DEFAULT_OVERLAY_WIDTH
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}
