import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { ModuleRenderer } from "@/components/modules/ModuleRenderer"
import { useWorkspaceActions, useWorkspaceComponent, useWorkspaceShallowSelector } from "@/store/workspaceStore"
import { useWindowControls } from "@/hooks/useWindowControls"
import { FloatingWindowCaptionControls, FloatingWindowFrameProvider } from "./FloatingWindowFrame"
import type { MainWindowAction } from "@/backend/runtime/runtime"
import type { ComponentInstance } from "@/types/workspace"

interface Props {
  compId: string
  windowId?: string | null
  moduleIdFallback?: string | null
  titleFallback?: string | null
}

export function FloatingComponentWindow({ compId, windowId, moduleIdFallback }: Props) {
  const { t } = useTranslation()
  const comp = useWorkspaceComponent(compId)
  const { activeCustomThemeName, activeWorkspaceId, theme, zCounter } = useWorkspaceShallowSelector((state) => ({
    activeCustomThemeName: state.activeCustomThemeName,
    activeWorkspaceId: state.activeWorkspaceId,
    theme: state.theme,
    zCounter: state.zCounter,
  }))
  const workspaceActions = useWorkspaceActions()
  const [isMaximized, setIsMaximized] = useState(false)
  const [integratedTitlebars, setIntegratedTitlebars] = useState(0)
  const { controlMain, controlMainPending, closeComponent } = useWindowControls()
  const moduleId = comp?.moduleId ?? moduleIdFallback ?? ""

  const themeClass = activeCustomThemeName ? "" : theme === "endfield" ? "theme-endfield" : theme === "wuling" ? "theme-wuling" : ""

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

  const controlWindow = useCallback(async (action: MainWindowAction) => {
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
  }, [closeComponent, compId, controlMain, windowId])

  const handleTitleBarDoubleClick = useCallback((event: MouseEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.closest(".xiranite-app-region-no-drag")) return

    event.preventDefault()
    void controlWindow("maximize")
  }, [controlWindow])

  const registerIntegratedTitlebar = useCallback(() => {
    setIntegratedTitlebars((count) => count + 1)
    return () => setIntegratedTitlebars((count) => Math.max(0, count - 1))
  }, [])

  const frame = useMemo(() => ({
    isMaximized,
    pending: controlMainPending,
    control: (action: MainWindowAction) => void controlWindow(action),
    handleTitlebarDoubleClick: handleTitleBarDoubleClick,
    registerIntegratedTitlebar,
  }), [controlMainPending, controlWindow, handleTitleBarDoubleClick, isMaximized, registerIntegratedTitlebar])

  return (
    <FloatingWindowFrameProvider value={frame}>
      <div className={cn("xiranite-floating-window relative flex h-screen flex-col overflow-hidden bg-background text-foreground", themeClass)}>
        <main className="min-h-0 flex-1 overflow-hidden">
          {moduleId ? (
            <ModuleRenderer moduleId={moduleId} compId={compId} />
          ) : (
            <div className="grid h-full place-items-center font-mono text-xs text-muted-foreground">
              {t("view:floating.missingTarget")}
            </div>
          )}
        </main>
        {integratedTitlebars === 0 ? (
          <>
            <div
              aria-hidden="true"
              data-testid="floating-window-fallback-drag-region"
              onDoubleClick={handleTitleBarDoubleClick}
              className="xiranite-app-region-drag absolute inset-x-0 top-0 z-40 h-10 select-none"
            />
            <FloatingWindowCaptionControls className="absolute right-0 top-0 z-50 h-10 bg-background/90 backdrop-blur-sm" />
          </>
        ) : null}
      </div>
    </FloatingWindowFrameProvider>
  )
}
