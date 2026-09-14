import { useCallback, useMemo, useState, type MouseEvent, type ReactNode } from "react"

import type { MainWindowAction, WindowCommandResult } from "@/backend/runtime/runtime"
import { ContextMenuProvider } from "@/components/context-menu"
import { AppConfigSync } from "@/components/workspace/AppConfigSync"
import {
  FloatingWindowCaptionControls,
  FloatingWindowFrameProvider,
} from "@/components/workspace/FloatingWindowFrame"
import { WorkspaceAppearance } from "@/components/workspace/WorkspaceAppearance"
import { createLogger } from "@/lib/logger"
import { useWorkspaceShallowSelector } from "@/store/workspaceStore"

const logger = createLogger("direct-node-host.window")

export function DirectNodeHostShell({ children, nodeId }: { children: ReactNode; nodeId?: string }) {
  const [isMaximized, setIsMaximized] = useState(false)
  const [pending, setPending] = useState(false)
  const [integratedTitlebars, setIntegratedTitlebars] = useState(0)
  const captionAppearance = useWorkspaceShallowSelector((state) => ({
    position: state.floatingWindowCaptionPosition,
    style: state.floatingWindowCaptionStyle,
    autoCollapse: state.floatingWindowCaptionAutoCollapse,
  }))

  const controlWindow = useCallback(async (action: MainWindowAction) => {
    setPending(true)
    try {
      const runtime = await import("@wailsio/runtime")
      const result = await runtime.Call.ByName(
        "main.XiraniteService.NodeAppWindowControl",
        action,
      ) as WindowCommandResult
      if (result.success && result.state) {
        setIsMaximized(result.state === "maximized" || result.state === "fullscreen")
      }
      if (!result.success) logger.warn("Direct node window control was rejected", { action, message: result.message })
    } catch (error) {
      logger.error("Direct node window control failed", { action }, error)
      if (action === "close") window.close()
    } finally {
      setPending(false)
    }
  }, [])

  const handleTitlebarDoubleClick = useCallback((event: MouseEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.closest(".xiranite-app-region-no-drag")) return
    event.preventDefault()
    void controlWindow("maximize")
  }, [controlWindow])

  const registerIntegratedTitlebar = useCallback(() => {
    setIntegratedTitlebars((count) => count + 1)
    return () => setIntegratedTitlebars((count) => Math.max(0, count - 1))
  }, [])

  const frame = useMemo(() => ({
    captionAppearance: nodeId === "neoview" ? undefined : captionAppearance,
    isMaximized,
    pending,
    control: (action: MainWindowAction) => { void controlWindow(action) },
    handleTitlebarDoubleClick,
    registerIntegratedTitlebar,
  }), [captionAppearance, controlWindow, handleTitlebarDoubleClick, isMaximized, nodeId, pending, registerIntegratedTitlebar])

  const showNativeWindowChrome = typeof window !== "undefined" && Boolean(window._wails)

  return (
    <ContextMenuProvider>
      <AppConfigSync />
      <WorkspaceAppearance />
      <FloatingWindowFrameProvider value={frame}>
        <div
          data-direct-node-host="true"
          data-direct-node-id={nodeId}
          data-floating-window-caption-position={nodeId === "neoview" ? undefined : captionAppearance.position}
          data-floating-window-caption-style={nodeId === "neoview" ? undefined : captionAppearance.style}
          className="xiranite-floating-window relative flex h-screen flex-col overflow-hidden bg-background text-foreground"
        >
          <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
          {showNativeWindowChrome && integratedTitlebars === 0 ? (
            <>
              <div
                aria-hidden="true"
                data-testid="direct-node-host-drag-region"
                onDoubleClick={handleTitlebarDoubleClick}
                className="xiranite-app-region-drag absolute inset-x-0 top-0 z-40 h-10 select-none"
              />
              <FloatingWindowCaptionControls className="absolute right-0 top-0 z-50 h-10 bg-background/90 backdrop-blur-sm" />
            </>
          ) : null}
        </div>
      </FloatingWindowFrameProvider>
    </ContextMenuProvider>
  )
}
