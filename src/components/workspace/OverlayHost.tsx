import { lazy, Suspense, useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { PanelRightClose, PanelRightOpen, X } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useWorkspaceActions, useWorkspaceSelector } from "@/store/workspaceContext"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
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
const NodeRunHistoryView = lazy(() =>
  import("@/components/views/NodeRunHistoryView").then((module) => ({ default: module.NodeRunHistoryView })),
)

const TITLE_KEYS = {
  registry: "overlay:registry",
  settings: "overlay:settings",
  deployment: "overlay:deployment",
  operations: "overlay:operations",
  history: "overlay:history",
} as const

type OverlayMode = "docked" | "floating"

const OVERLAY_MODE_STORAGE_KEY = "xiranite.overlay.mode"
const OVERLAY_WIDTH_STORAGE_KEY = "xiranite.overlay.width"
const LEGACY_CONFIG_CHANGED_EVENT = "xiranite:legacy-config-changed"
const DEFAULT_OVERLAY_WIDTH = 440
const MIN_OVERLAY_WIDTH = 320
const MAX_OVERLAY_WIDTH = 720

function OverlayLoading() {
  return (
    <div className="flex flex-col gap-3 p-4">
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
  const reducedMotion = useReducedMotion()

  useEffect(() => {
    writeOverlayMode(mode)
  }, [mode])

  useEffect(() => {
    writeOverlayWidth(width)
  }, [width])

  useEffect(() => {
    const refreshOverlayConfig = () => {
      setMode(readOverlayMode())
      setWidth(readOverlayWidth())
    }

    window.addEventListener(LEGACY_CONFIG_CHANGED_EVENT, refreshOverlayConfig)
    return () => window.removeEventListener(LEGACY_CONFIG_CHANGED_EVENT, refreshOverlayConfig)
  }, [])

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

  const floating = mode === "floating"
  const panelTransition = reducedMotion
    ? { duration: 0 }
    : { duration: 0.18, ease: [0.16, 1, 0.3, 1] as const }

  return (
    <AnimatePresence initial={false}>
      {overlay ? (
        <>
          {floating && (
            <motion.button
              type="button"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={panelTransition}
              className="absolute inset-0 z-30 bg-background/35 backdrop-blur-[2px]"
              data-testid="workspace-overlay-backdrop"
              aria-label={t("common:collapse")}
              onClick={() => workspaceActions.setOverlay(null)}
            />
          )}
          <motion.aside
            layout
            key="workspace-overlay"
            initial={{ opacity: 0, x: reducedMotion ? 0 : 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: reducedMotion ? 0 : 28 }}
            transition={panelTransition}
            className={cn(
              "relative flex h-full min-h-0 shrink-0 flex-col border-l border-border/60 bg-card/95 backdrop-blur-sm",
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
          <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-background/45 px-3 backdrop-blur">
            <div className="min-w-0">
              <h2 className="min-w-0 truncate font-mono text-[11px] font-semibold tracking-widest text-foreground">
                {t(TITLE_KEYS[overlay])}
              </h2>
              <Badge variant="outline" className="mt-1 h-4 rounded-sm px-1.5 font-mono text-[8px] uppercase text-muted-foreground">
                {floating ? t("overlay:floatingMode") : t("overlay:dockMode")}
              </Badge>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <ToggleGroup
                type="single"
                value={mode}
                onValueChange={(value) => {
                  if (value) setMode(value as OverlayMode)
                }}
                variant="outline"
                size="sm"
                className="rounded-md border border-border/60 bg-muted/20 p-0.5"
                spacing={1}
              >
                <ToggleGroupItem
                  value="docked"
                  title={t("overlay:dockMode")}
                  aria-label={t("overlay:dockMode")}
                  className="size-7 px-0 text-muted-foreground data-[state=on]:bg-background data-[state=on]:text-primary data-[state=on]:shadow-xs"
                >
                  <PanelRightClose className="size-3.5" />
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="floating"
                  title={t("overlay:floatingMode")}
                  aria-label={t("overlay:floatingMode")}
                  className="size-7 px-0 text-muted-foreground data-[state=on]:bg-background data-[state=on]:text-primary data-[state=on]:shadow-xs"
                >
                  <PanelRightOpen className="size-3.5" />
                </ToggleGroupItem>
              </ToggleGroup>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => workspaceActions.setOverlay(null)}
                className="text-muted-foreground hover:text-foreground"
                title={t("common:collapse")}
                aria-label={t("common:collapse")}
              >
                <X />
              </Button>
            </div>
          </header>
          <motion.div
            key={overlay}
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
            initial={{ opacity: 0, y: reducedMotion ? 0 : 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reducedMotion ? 0 : 6 }}
            transition={panelTransition}
          >
            <Suspense fallback={<OverlayLoading />}>
            {overlay === "registry" && <ModuleRegistry />}
            {overlay === "settings" && <ThemeSettings />}
            {overlay === "deployment" && <DeploymentHub />}
            {overlay === "operations" && <NodeOperationMonitor />}
            {overlay === "history" && <NodeRunHistoryView />}
            </Suspense>
          </motion.div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
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

function writeOverlayMode(mode: OverlayMode) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(OVERLAY_MODE_STORAGE_KEY, mode)
  dispatchLegacyConfigChanged()
}

function writeOverlayWidth(width: number) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(OVERLAY_WIDTH_STORAGE_KEY, String(width))
  dispatchLegacyConfigChanged()
}

function dispatchLegacyConfigChanged() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(LEGACY_CONFIG_CHANGED_EVENT))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}
