import { useEffect, useMemo, useState, type MouseEvent } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { getModule } from "@/components/modules/registry"
import { ModuleRenderer } from "@/components/modules/ModuleRenderer"
import { useWorkspaceActions, useWorkspaceComponent, useWorkspaceShallowSelector } from "@/store/workspaceStore"
import { useWindowControls } from "@/hooks/useWindowControls"
import type { ComponentInstance } from "@/types/workspace"
import { Minus, Minimize2, Square, X } from "lucide-react"

interface Props {
  compId: string
  windowId?: string | null
  moduleIdFallback?: string | null
  titleFallback?: string | null
}

export function FloatingComponentWindow({ compId, windowId, moduleIdFallback, titleFallback }: Props) {
  const { t, i18n } = useTranslation()
  const comp = useWorkspaceComponent(compId)
  const { activeCustomThemeName, activeWorkspaceId, theme, zCounter } = useWorkspaceShallowSelector((state) => ({
    activeCustomThemeName: state.activeCustomThemeName,
    activeWorkspaceId: state.activeWorkspaceId,
    theme: state.theme,
    zCounter: state.zCounter,
  }))
  const workspaceActions = useWorkspaceActions()
  const [isMaximized, setIsMaximized] = useState(false)
  const { controlMain, controlMainPending, closeComponent } = useWindowControls()
  const moduleId = comp?.moduleId ?? moduleIdFallback ?? ""
  const mod = getModule(moduleId)
  const title = titleFallback
    || (mod && i18n.exists(`module:${moduleId}.name`) ? t(`module:${moduleId}.name`) : mod?.name)
    || moduleId
    || t("view:floating.title")

  const themeClass = activeCustomThemeName ? "" : theme === "endfield" ? "theme-endfield" : theme === "wuling" ? "theme-wuling" : ""

  const detail = useMemo(() => {
    if (!moduleId) return t("view:floating.missingModule")
    if (!comp) return t("view:floating.loadingState")
    return `${comp.workspaceId} / ${comp.id}`
  }, [comp, moduleId, t])

  useEffect(() => {
    if (!moduleId || comp) return

    const now = Date.now()
    const fallbackComponent: ComponentInstance = {
      id: compId,
      moduleId,
      state: "floating",
      position: { x: 20, y: 20 },
      size: { w: 460, h: 380 },
      z: zCounter + 1,
      collapsed: false,
      workspaceId: activeWorkspaceId,
      flowPosition: { x: 100, y: 100 },
      flowSize: { width: 384, height: 320 },
      dockPanel: "default",
      createdAt: now,
      updatedAt: now,
    }

    workspaceActions.ensureComponent(fallbackComponent)
  }, [activeWorkspaceId, comp, compId, moduleId, workspaceActions, zCounter])

  async function controlWindow(action: "minimize" | "maximize" | "close") {
    try {
      const result = await controlMain(action)
      if (result.success && result.state) {
        setIsMaximized(result.state === "maximized")
      }
      if (result.success) return

      if (action === "close") {
        await closeComponent(windowId ?? compId)
      }
    } catch {
      // Browser fallback windows may not be tracked by the backend.
    }

    if (action === "close") {
      window.close()
    }
  }

  function handleTitleBarDoubleClick(event: MouseEvent<HTMLElement>) {
    if (event.target instanceof Element && event.target.closest(".xiranite-app-region-no-drag")) return

    event.preventDefault()
    void controlWindow("maximize")
  }

  return (
    <div className={cn("xiranite-floating-window flex h-screen flex-col overflow-hidden bg-background text-foreground", themeClass)}>
      <header
        data-testid="floating-window-titlebar"
        onDoubleClick={handleTitleBarDoubleClick}
        className="xiranite-app-region-drag flex h-10 shrink-0 select-none items-stretch border-b border-border bg-background"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 pl-3 pr-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-[11px] font-semibold uppercase tracking-normal">{title}</div>
            <div className="truncate font-mono text-[9px] text-muted-foreground">{detail}</div>
          </div>
        </div>
        <div
          data-testid="floating-window-caption-controls"
          className="xiranite-app-region-no-drag flex shrink-0 items-stretch"
        >
          <button
            type="button"
            title={t("common:minimize")}
            aria-label={t("common:minimize")}
            disabled={controlMainPending}
            onClick={() => controlWindow("minimize")}
            className="grid w-11 place-items-center text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title={t("common:maximize")}
            aria-label={t("common:maximize")}
            aria-pressed={isMaximized}
            disabled={controlMainPending}
            onClick={() => controlWindow("maximize")}
            className="grid w-11 place-items-center text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45"
          >
            {isMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Square className="h-3 w-3" />}
          </button>
          <button
            type="button"
            title={t("common:closeWindow")}
            aria-label={t("common:closeWindow")}
            disabled={controlMainPending}
            onClick={() => controlWindow("close")}
            className="grid w-11 place-items-center text-muted-foreground transition-colors hover:bg-[#c42b1c] hover:text-white focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      <main className="xiranite-app-region-no-drag min-h-0 flex-1 overflow-hidden p-2">
        {moduleId ? (
          <ModuleRenderer moduleId={moduleId} compId={compId} />
        ) : (
          <div className="grid h-full place-items-center font-mono text-xs text-muted-foreground">
            {t("view:floating.missingTarget")}
          </div>
        )}
      </main>
    </div>
  )
}
